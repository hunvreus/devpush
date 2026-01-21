import asyncio
import logging
import aiodocker
from sqlalchemy import select, exc, inspect
from arq.connections import ArqRedis, RedisSettings, create_pool
import httpx
from datetime import datetime, timezone
from config import get_settings

from db import AsyncSessionLocal
from models import Deployment

logger = logging.getLogger(__name__)

deployment_probe_state = {}  # deployment_id -> {"container": container_obj, "probe_active": bool}
WORKSPACE_NETWORK_PREFIX = "devpush_workspace_"


async def _http_probe(ip: str, port: int, timeout: float = 5) -> bool:
    """Check if the app responds to HTTP requests."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            await client.get(f"http://{ip}:{port}/")
            return True
    except Exception:
        return False


async def _get_service_container_id(
    docker_client: aiodocker.Docker, service_name: str
) -> str | None:
    try:
        containers = await docker_client.containers.list(all=True)
    except Exception:
        return None

    fallback_ids = []
    for container in containers:
        if isinstance(container, dict):
            labels = container.get("Labels") or {}
            container_id = container.get("Id")
            names = container.get("Names") or []
        else:
            labels = getattr(container, "labels", {}) or {}
            container_id = getattr(container, "id", None)
            names = getattr(container, "names", []) or []

        if labels.get("com.docker.compose.service") == service_name:
            return container_id
        if any(service_name in name for name in names):
            return container_id
        if container_id:
            fallback_ids.append(container_id)

    for container_id in fallback_ids:
        try:
            container = await docker_client.containers.get(container_id)
            info = await container.show()
        except Exception:
            continue

        labels = info.get("Config", {}).get("Labels", {}) or {}
        name = (info.get("Name") or "").lstrip("/")
        if labels.get("com.docker.compose.service") == service_name:
            return container_id
        if service_name in name:
            return container_id

    return None


async def _ensure_probe_on_network(
    docker_client: aiodocker.Docker, probe_id: str | None, network_name: str | None
):
    if not probe_id or not network_name:
        return

    try:
        network = await docker_client.networks.get(network_name)
    except aiodocker.DockerError:
        return

    try:
        await network.connect({"Container": probe_id})
    except aiodocker.DockerError as error:
        if error.status == 403 and "endpoint with name" in str(error).lower():
            return
        if error.status != 409:
            raise


async def _network_has_deployments(
    docker_client: aiodocker.Docker, network_name: str
) -> bool:
    try:
        network = await docker_client.networks.get(network_name)
    except aiodocker.DockerError as error:
        if error.status != 404:
            raise
        return False

    info = await network.show()
    containers = info.get("Containers") or {}
    for container_id in containers.keys():
        try:
            container = await docker_client.containers.get(container_id)
            container_info = await container.show()
        except Exception:
            continue

        labels = container_info.get("Config", {}).get("Labels", {}) or {}
        if labels.get("devpush.deployment_id"):
            return True

    return False


async def _remove_network_if_empty(
    docker_client: aiodocker.Docker, network_name: str
):
    try:
        network = await docker_client.networks.get(network_name)
    except aiodocker.DockerError as error:
        if error.status != 404:
            raise
        return

    info = await network.show()
    containers = info.get("Containers") or {}
    if containers:
        return

    try:
        await network.delete()
    except aiodocker.DockerError:
        return


async def _detach_probe_from_unused_networks(
    docker_client: aiodocker.Docker,
    probe_id: str | None,
):
    if not probe_id:
        return

    try:
        container = await docker_client.containers.get(probe_id)
        info = await container.show()
    except Exception:
        return

    networks = info.get("NetworkSettings", {}).get("Networks", {}) or {}
    for network_name in networks.keys():
        if not network_name.startswith(WORKSPACE_NETWORK_PREFIX):
            continue
        if await _network_has_deployments(docker_client, network_name):
            continue

        try:
            network = await docker_client.networks.get(network_name)
        except aiodocker.DockerError:
            continue

        try:
            await network.disconnect({"Container": probe_id, "Force": True})
        except aiodocker.DockerError as error:
            if error.status not in (404, 409):
                logger.warning(
                    f"[DeployMonitor] Failed to detach probe from {network_name}: {error}"
                )
                continue

        if not await _network_has_deployments(docker_client, network_name):
            await _remove_network_if_empty(docker_client, network_name)


async def _check_status(
    deployment: Deployment,
    docker_client: aiodocker.Docker,
    redis_pool: ArqRedis,
    probe_id: str | None,
):
    """Checks the status of a single deployment's container."""
    if (
        deployment.id in deployment_probe_state
        and deployment_probe_state[deployment.id]["probe_active"]
    ):
        return None

    log_prefix = f"[DeployMonitor:{deployment.id}]"

    # Timeout check
    try:
        settings = get_settings()
        now_utc = datetime.now(timezone.utc)
        created_at = (
            deployment.created_at.replace(tzinfo=timezone.utc)
            if deployment.created_at.tzinfo is None
            else deployment.created_at
        )
        if (now_utc - created_at).total_seconds() > settings.deployment_timeout:
            await redis_pool.enqueue_job(
                "fail_deployment", deployment.id, "Deployment timeout"
            )
            logger.warning(f"{log_prefix} Deployment timed out; failure job enqueued.")
            await _cleanup_deployment(deployment.id)
            return None
    except Exception:
        logger.error(f"{log_prefix} Error while evaluating timeout.", exc_info=True)

    if deployment.id not in deployment_probe_state:
        try:
            container = await docker_client.containers.get(deployment.container_id)
            deployment_probe_state[deployment.id] = {
                "container": container,
                "probe_active": True,
            }
        except Exception:
            await redis_pool.enqueue_job(
                "fail_deployment", deployment.id, "Container not found"
            )
            return
    else:
        deployment_probe_state[deployment.id]["probe_active"] = True
        container = deployment_probe_state[deployment.id]["container"]

    # Probe check
    try:
        logger.info(f"{log_prefix} Probing container {deployment.container_id}")
        container_info = await container.show()
        status = container_info["State"]["Status"]

        if status == "exited":
            exit_code = container_info["State"].get("ExitCode", -1)
            reason = f"Container exited with code {exit_code}"
            await redis_pool.enqueue_job("fail_deployment", deployment.id, reason)
            logger.warning(
                f"{log_prefix} Deployment failed (failure job enqueued): {reason}"
            )
            await _cleanup_deployment(deployment.id)

        elif status == "running":
            networks = container_info.get("NetworkSettings", {}).get("Networks", {})
            labels = container_info.get("Config", {}).get("Labels", {}) or {}
            workspace_network = labels.get("devpush.workspace_network")
            container_ip = None
            if workspace_network:
                await _ensure_probe_on_network(
                    docker_client, probe_id, workspace_network
                )
                container_ip = networks.get(workspace_network, {}).get("IPAddress")
            if not container_ip:
                # LEGACY(network): fallback for deployments created before edge/workspace networks.
                container_ip = networks.get("devpush_runner", {}).get("IPAddress")
            if container_ip and await _http_probe(container_ip, 8000):
                await redis_pool.enqueue_job("finalize_deployment", deployment.id)
                logger.info(
                    f"{log_prefix} Deployment ready (finalization job enqueued)."
                )
                await _cleanup_deployment(deployment.id)
            return workspace_network

    except Exception as e:
        logger.error(
            f"{log_prefix} Unexpected error while checking status.", exc_info=True
        )
        await redis_pool.enqueue_job("fail_deployment", deployment.id, str(e))
        await _cleanup_deployment(deployment.id)
        return None
    finally:
        if deployment.id in deployment_probe_state:
            deployment_probe_state[deployment.id]["probe_active"] = False
    return None


# Cleanup function
async def _cleanup_deployment(deployment_id: str):
    """Cleans up a deployment from the status dictionary."""
    if deployment_id in deployment_probe_state:
        del deployment_probe_state[deployment_id]


async def monitor():
    """Monitors the status of deployments."""
    logger.info("Deployment monitor started")
    settings = get_settings()
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    redis_pool = await create_pool(redis_settings)

    async with AsyncSessionLocal() as db:
        async with aiodocker.Docker(url=settings.docker_host) as docker_client:
            schema_ready = False
            while True:
                try:
                    # Ensure schema exists to avoid logging spam before migrations
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
                            Deployment.status == "in_progress",
                            Deployment.container_status == "running",
                        )
                    )
                    deployments_to_check = result.scalars().all()

                    if deployments_to_check:
                        probe_id = await _get_service_container_id(
                            docker_client, "worker-monitor"
                        )
                        tasks = [
                            _check_status(
                                deployment, docker_client, redis_pool, probe_id
                            )
                            for deployment in deployments_to_check
                        ]
                        await asyncio.gather(*tasks)
                        await _detach_probe_from_unused_networks(
                            docker_client, probe_id
                        )
                    else:
                        probe_id = await _get_service_container_id(
                            docker_client, "worker-monitor"
                        )
                        await _detach_probe_from_unused_networks(
                            docker_client, probe_id
                        )

                except exc.SQLAlchemyError as e:
                    logger.error(f"Database error in monitor loop: {e}. Reconnecting.")
                    await db.close()
                    db = AsyncSessionLocal()
                except Exception:
                    logger.error("Critical error in monitor main loop", exc_info=True)

                await asyncio.sleep(2)


if __name__ == "__main__":
    import asyncio

    asyncio.run(monitor())
