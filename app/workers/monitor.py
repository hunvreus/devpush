import asyncio
import logging
from datetime import datetime, timezone

from arq.connections import ArqRedis, RedisSettings, create_pool
from sqlalchemy import exc, inspect, select

from config import get_settings
from db import AsyncSessionLocal
from models import Deployment
from services.deployment import DeploymentService
from services.kubernetes import KubernetesService

logger = logging.getLogger(__name__)

deployment_probe_state: dict[str, bool] = {}


async def _http_probe(ip: str, port: int, timeout: float = 5) -> bool:
    if not ip:
        return False
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=timeout
        )
        writer.write(
            b"GET / HTTP/1.1\r\n"
            b"Host: deployment.local\r\n"
            b"Connection: close\r\n\r\n"
        )
        await writer.drain()
        data = await asyncio.wait_for(reader.read(128), timeout=timeout)
        writer.close()
        await writer.wait_closed()
        return data.startswith(b"HTTP/")
    except Exception:
        return False


async def _check_status(
    deployment: Deployment,
    runtime: KubernetesService,
    redis_pool: ArqRedis,
    db,
) -> None:
    if deployment.status == "completed":
        return
    if deployment_probe_state.get(deployment.id):
        return

    deployment_probe_state[deployment.id] = True
    log_prefix = f"[DeployMonitor:{deployment.id}]"

    try:
        settings = get_settings()
        now_utc = datetime.now(timezone.utc)
        created_at = (
            deployment.created_at.replace(tzinfo=timezone.utc)
            if deployment.created_at.tzinfo is None
            else deployment.created_at
        )
        if (now_utc - created_at).total_seconds() > settings.deployment_timeout_seconds:
            await redis_pool.enqueue_job(
                "fail_deployment",
                deployment.id,
                "deploy",
                "Timed out waiting for app to respond on port 8000. Ensure your app starts an HTTP server on this port.",
            )
            logger.warning(f"{log_prefix} Deployment timed out; failure job enqueued.")
            return
    except Exception:
        logger.error(f"{log_prefix} Error while evaluating timeout.", exc_info=True)

    if not deployment.container_id:
        await redis_pool.enqueue_job(
            "fail_deployment",
            deployment.id,
            "deploy",
            "Container stopped unexpectedly. Check the deployment logs for errors.",
        )
        return

    try:
        runtime_status = await runtime.get_workload_status(deployment.container_id)
        status = runtime_status.get("status", "unknown")
        logger.info(f"{log_prefix} Workload status: {status}")

        if status in {"failed", "exited", "removed"}:
            reason = runtime_status.get("reason") or (
                "Container stopped unexpectedly. Check the deployment logs for errors."
            )
            await redis_pool.enqueue_job(
                "fail_deployment",
                deployment.id,
                "deploy",
                reason,
            )
            logger.warning(f"{log_prefix} Deployment failed: {reason}")
            return

        if status == "running":
            pod_ip = runtime_status.get("pod_ip", "")
            if pod_ip and await _http_probe(pod_ip, 8000):
                await DeploymentService.update_status(
                    db,
                    deployment,
                    status="finalize",
                    redis_client=redis_pool,
                )
                await redis_pool.enqueue_job("finalize_deployment", deployment.id)
                logger.info(f"{log_prefix} Deployment ready (finalization enqueued).")
                return
            logger.info(
                f"{log_prefix} Workload running but app probe not ready yet (pod_ip={pod_ip})."
            )

    except Exception as error:
        logger.error(f"{log_prefix} Unexpected monitor error.", exc_info=True)
        await redis_pool.enqueue_job(
            "fail_deployment",
            deployment.id,
            "deploy",
            f"Unexpected error while monitoring deployment: {error}",
        )
    finally:
        deployment_probe_state[deployment.id] = False


async def monitor():
    logger.info("Deployment monitor started")
    settings = get_settings()
    runtime = KubernetesService(settings)
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    redis_pool = await create_pool(redis_settings)
    try:
        async with AsyncSessionLocal() as db:
            schema_ready = False
            while True:
                try:
                    if not schema_ready:
                        schema_ready = await db.run_sync(
                            lambda sync_session: inspect(
                                sync_session.connection()
                            ).has_table("alembic_version")
                        )
                        if not schema_ready:
                            logger.warning(
                                "Database schema not ready (no alembic_version); waiting for migrations..."
                            )
                            await asyncio.sleep(5)
                            continue

                    result = await db.execute(
                        select(Deployment).where(
                            Deployment.status == "deploy",
                            Deployment.container_status == "running",
                        )
                    )
                    deployments_to_check = result.scalars().all()
                    if deployments_to_check:
                        await asyncio.gather(
                            *[
                                _check_status(deployment, runtime, redis_pool, db)
                                for deployment in deployments_to_check
                            ]
                        )

                except exc.SQLAlchemyError as error:
                    logger.error(f"Database error in monitor loop: {error}. Reconnecting.")
                    await db.close()
                    db = AsyncSessionLocal()
                except Exception:
                    logger.error("Critical error in monitor main loop", exc_info=True)

                await asyncio.sleep(2)
    finally:
        await runtime.close()
        await redis_pool.close()


if __name__ == "__main__":
    asyncio.run(monitor())
