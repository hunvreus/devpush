import re
import asyncio
from datetime import datetime, timezone
import aiodocker
import logging
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from typing import Any

from models import Deployment, Alias
from db import AsyncSessionLocal
from dependencies import (
    get_redis_client,
    get_github_installation_service,
)
from config import get_settings
from arq.connections import ArqRedis
from services.deployment import DeploymentService

logger = logging.getLogger(__name__)


async def _log_to_container(container, message, error=False):
    """Logs a message to the container."""
    fd = "2" if error else "1"
    exec = await container.exec(
        ["/bin/sh", "-c", f"echo '{message}' >> /proc/1/fd/{fd}"],
        user="appuser",
        stdout=False,
        stderr=False,
    )
    await exec.start(detach=True)


async def deploy_start(ctx, deployment_id: str):
    """Starts a deployment."""
    try:
        settings = get_settings()
        redis_client = get_redis_client()
        log_prefix = f"[DeployStart:{deployment_id}]"
        logger.info(f"{log_prefix} Starting deployment")

        github_installation_service = get_github_installation_service()

        async with AsyncSessionLocal() as db:
            deployment = (
                await db.execute(
                    select(Deployment)
                    .options(joinedload(Deployment.project))
                    .where(Deployment.id == deployment_id)
                )
            ).scalar_one()

            if deployment.project.status != "active":
                deployment.status = "skipped"
                deployment.conclusion = "skipped"
                deployment.concluded_at = datetime.now(timezone.utc)
                await db.commit()
                return

            container = None
            async with aiodocker.Docker(url=settings.docker_host) as docker_client:
                # Mark deployment as in-progress
                deployment.status = "in_progress"
                await db.commit()

                fields: Any = {
                    "event_type": "deployment_status_update",
                    "project_id": deployment.project_id,
                    "deployment_id": deployment.id,
                    "deployment_status": "in_progress",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }

                await redis_client.xadd(
                    f"stream:project:{deployment.project_id}:updates", fields
                )
                await redis_client.xadd(
                    f"stream:project:{deployment.project_id}:deployment:{deployment.id}:status",
                    fields,
                )

                # Prepare environment variables
                env_vars_dict = {
                    var["key"]: var["value"] for var in (deployment.env_vars or [])
                }
                # env_vars_dict["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"

                # Prepare commands
                commands = []

                # Step 1: Clone the repository
                commands.append(
                    f"echo 'Cloning {deployment.repo_full_name} (Branch: {deployment.branch}, Commit: {deployment.commit_sha[:7]})'"
                )
                github_installation = (
                    await github_installation_service.get_or_refresh_installation(
                        deployment.project.github_installation_id, db
                    )
                )
                commands.append(
                    "git init -q && "
                    f"git fetch -q --depth 1 https://x-access-token:{github_installation.token}@github.com/{deployment.repo_full_name}.git {deployment.commit_sha} && "
                    f"git checkout -q FETCH_HEAD"
                )

                # Step 2: Install dependencies
                if deployment.config.get("build_command"):
                    commands.append("echo 'Installing dependencies...'")
                    commands.append(deployment.config.get("build_command"))

                # Step 3: Run pre-deploy command
                if deployment.config.get("pre_deploy_command"):
                    commands.append("echo 'Running pre-deploy command...'")
                    commands.append(deployment.config.get("pre_deploy_command"))

                # Step 4: Start the application
                commands.append("echo 'Starting application...'")
                commands.append(deployment.config.get("start_command"))

                # Setup container configuration
                container_name = f"runner-{deployment.id[:7]}"
                router = f"deployment-{deployment.id}"

                labels = {
                    "traefik.enable": "true",
                    f"traefik.http.routers.{router}.rule": f"Host(`{deployment.slug}.{settings.deploy_domain}`)",
                    f"traefik.http.routers.{router}.service": f"{router}@docker",
                    f"traefik.http.routers.{router}.priority": "10",
                    f"traefik.http.services.{router}.loadbalancer.server.port": "8000",
                    "traefik.docker.network": "devpush_runner",
                    "deployment_id": deployment.id,
                    "project_id": deployment.project_id,
                    "environment_id": deployment.environment_id,
                    "branch": deployment.branch,
                }

                if settings.url_scheme == "https":
                    labels.update(
                        {
                            f"traefik.http.routers.{router}.entrypoints": "websecure",
                            f"traefik.http.routers.{router}.tls": "true",
                            f"traefik.http.routers.{router}.tls.certresolver": "le",
                        }
                    )
                else:
                    labels[f"traefik.http.routers.{router}.entrypoints"] = "web"

                # Get resource limits from config
                try:
                    cpus = float(deployment.config.get("cpus") or settings.default_cpus)
                    memory_mb = int(
                        deployment.config.get("memory") or settings.default_memory_mb
                    )
                except (ValueError, TypeError):
                    cpus = settings.default_cpus
                    memory_mb = settings.default_memory_mb
                    logger.warning(
                        f"{log_prefix} Invalid CPU/memory values in config, using defaults."
                    )

                image = deployment.config.get("image")

                root_directory = deployment.config.get("root_directory") or "/app"


                # Create and start container
                container = await docker_client.containers.create_or_replace(
                    name=container_name,
                    config={
                        "Image": f"runner-{image}",
                        "Cmd": ["/bin/sh", "-c", " && ".join(commands)],
                        "Env": [f"{k}={v}" for k, v in env_vars_dict.items()],
                        "WorkingDir": root_directory,
                        "Labels": labels,
                        "NetworkingConfig": {"EndpointsConfig": {"devpush_runner": {}}},
                        "HostConfig": {
                            **({"Cpus": cpus} if cpus > 0 else {}),
                            **(
                                {"Memory": memory_mb * 1024 * 1024}
                                if memory_mb > 0
                                else {}
                            ),
                            "SecurityOpt": ["no-new-privileges:true"],
                            "LogConfig": {
                                "Type": "loki",
                                "Config": {
                                    "loki-url": "http://127.0.0.1:3100/loki/api/v1/push",
                                    "loki-batch-size": "200",
                                    "labels": "deployment_id,project_id,environment_id,branch",
                                },
                            },
                        },
                    },
                )

                await container.start()

                # Save container info
                deployment.container_id = container.id
                deployment.container_status = "running"
                await db.commit()
                logger.info(
                    f"{log_prefix} Container {container.id} started. Monitoring..."
                )

    except asyncio.CancelledError:
        # TODO: check if it works and refactor
        logger.info(f"{log_prefix} Deployment canceled.")

        if container:
            try:
                await container.kill()
                await container.delete(force=True)
            except Exception as e:
                logger.error(f"{log_prefix} Error cleaning up container: {e}")

            try:
                async with AsyncSessionLocal() as db:
                    deployment = await db.get(Deployment, deployment_id)
                    if deployment:
                        deployment.conclusion = "canceled"
                        deployment.concluded_at = datetime.now(timezone.utc)
                        await db.commit()
            except Exception as e:
                logger.error(f"{log_prefix} Error updating deployment status: {e}")

    except Exception as e:
        deployment_queue: ArqRedis = ctx["redis"]
        await deployment_queue.enqueue_job("deploy_fail", deployment_id, reason=str(e))
        logger.info(f"{log_prefix} Deployment startup failed.", exc_info=True)


async def deploy_finalize(ctx, deployment_id: str):
    """Finalizes a deployment, setting up aliases and updating Traefik config."""
    settings = get_settings()
    redis_client = get_redis_client()
    log_prefix = f"[DeployFinalize:{deployment_id}]"
    logger.info(f"{log_prefix} Finalizing deployment")

    async with AsyncSessionLocal() as db:
        deployment = None
        try:
            deployment = (
                await db.execute(
                    select(Deployment)
                    .options(joinedload(Deployment.project))
                    .where(Deployment.id == deployment_id)
                )
            ).scalar_one()

            # Update the deployment status
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            deployment.status = "completed"
            deployment.conclusion = "succeeded"
            deployment.project.updated_at = now
            deployment.concluded_at = now
            await db.commit()

            # Log a success message
            async with aiodocker.Docker(url=settings.docker_host) as docker_client:
                container = await docker_client.containers.get(deployment.container_id)
                await _log_to_container(
                    container,
                    f"Success: Deployment is available at {deployment.url}",
                )

            # Setup branch domains
            # (won't prevent collisions, but good enough)
            sanitized_branch = re.sub(r"[^a-zA-Z0-9-]", "-", deployment.branch).lower()
            branch_subdomain = f"{deployment.project.slug}-branch-{sanitized_branch}"

            try:
                await Alias.update_or_create(
                    db,
                    subdomain=branch_subdomain,
                    deployment_id=deployment.id,
                    type="branch",
                    value=deployment.branch,
                )
            except Exception as e:
                logger.warning(f"{log_prefix} Failed to setup branch alias: {e}")

            # Environment aliases
            if deployment.environment_id == "prod":
                env_subdomain = deployment.project.slug
            else:
                environment = deployment.project.get_environment_by_id(
                    deployment.environment_id
                )
                env_subdomain = (
                    f"{deployment.project.slug}-env-{environment.get('slug')}"
                )
            env_id_subdomain = (
                f"{deployment.project.slug}-env-id-{deployment.environment_id}"
            )

            try:
                await Alias.update_or_create(
                    db,
                    subdomain=env_subdomain,
                    deployment_id=deployment.id,
                    type="environment",
                    value=deployment.environment_id,
                    environment_id=deployment.environment_id,
                )
                await Alias.update_or_create(
                    db,
                    subdomain=env_id_subdomain,
                    deployment_id=deployment.id,
                    type="environment_id",
                    value=deployment.environment_id,
                    environment_id=deployment.environment_id,
                )

            except Exception as e:
                logger.error(f"{log_prefix} Failed to setup environment alias: {e}")

            await db.commit()

            # Update Traefik dynamic config
            try:
                await DeploymentService().update_traefik_config(
                    deployment.project, db, settings
                )
            except Exception as e:
                logger.error(f"{log_prefix} Failed to update Traefik config: {e}")

            # Cleanup inactive deployments
            deployment_queue: ArqRedis = ctx["redis"]
            await deployment_queue.enqueue_job(
                "cleanup_inactive_deployments", deployment.project_id
            )
            logger.info(
                f"{log_prefix} Inactive deployments cleanup job queued for project {deployment.project_id}."
            )

            # Send messags to Redis streams
            fields = {
                "event_type": "deployment_status_update",
                "project_id": deployment.project_id,
                "deployment_id": deployment.id,
                "deployment_status": deployment.conclusion,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            await redis_client.xadd(
                f"stream:project:{deployment.project_id}:deployment:{deployment.id}:status",
                fields,
            )
            await redis_client.xadd(
                f"stream:project:{deployment.project_id}:updates", fields
            )

        except Exception:
            logger.error(f"{log_prefix} Error finalizing deployment.", exc_info=True)


async def deploy_fail(ctx, deployment_id: str, reason: str = None):
    """Handles a failed deployment, cleaning up resources."""
    log_prefix = f"[DeployFail:{deployment_id}]"
    logger.info(f"{log_prefix} Handling failed deployment. Reason: {reason}")
    settings = get_settings()
    redis_client = get_redis_client()

    async with AsyncSessionLocal() as db:
        deployment = (
            await db.execute(
                select(Deployment)
                .options(joinedload(Deployment.project))
                .where(Deployment.id == deployment_id)
            )
        ).scalar_one()

        if deployment.container_id and deployment.container_status not in (
            "removed",
            "stopped",
        ):
            try:
                async with aiodocker.Docker(url=settings.docker_host) as docker_client:
                    container = await docker_client.containers.get(
                        deployment.container_id
                    )
                    await container.kill()
                    await container.delete(force=True)
                deployment.container_status = "removed"
                logger.info(
                    f"{log_prefix} Cleaned up failed container {deployment.container_id}"
                )

            except Exception:
                logger.warning(
                    f"{log_prefix} Could not cleanup container {deployment.container_id}.",
                    exc_info=True,
                )

        deployment.status = "completed"
        deployment.conclusion = "failed"
        deployment.project.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        deployment.concluded_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.commit()

        fields = {
            "event_type": "deployment_status_update",
            "project_id": deployment.project_id,
            "deployment_id": deployment.id,
            "deployment_status": "failed",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await redis_client.xadd(
            f"stream:project:{deployment.project_id}:deployment:{deployment.id}:status",
            fields,
        )
        await redis_client.xadd(
            f"stream:project:{deployment.project_id}:updates", fields
        )
        logger.error(f"{log_prefix} Deployment failed and cleaned up.")
