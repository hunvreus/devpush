import asyncio
import logging
from sqlalchemy import select, true
from sqlalchemy.orm import joinedload
from pathlib import Path
import shlex

from models import Alias, Deployment, Project
from db import AsyncSessionLocal
from dependencies import (
    get_redis_client,
    get_github_installation_service,
)
from config import get_settings
from arq.connections import ArqRedis
from services.deployment import DeploymentService
from services.kubernetes import KubernetesService
from services.registry import RegistryService
from services.loki import LokiService

logger = logging.getLogger(__name__)


async def _push_loki_log(
    loki: LokiService,
    deployment: Deployment,
    message: str,
    level: str | None = None,
) -> None:
    labels = {
        "project_id": deployment.project_id,
        "deployment_id": deployment.id,
        "environment_id": deployment.environment_id,
        "branch": deployment.branch,
        "stream": "stdout",
    }
    line = f"{level}: {message}" if level else message
    try:
        await loki.push_log(labels, line)
    except Exception as exc:
        logger.warning("Failed to push log to Loki: %s", exc)


async def start_deployment(ctx, deployment_id: str):
    """Starts a deployment."""
    workload_id: str | None = None
    loki: LokiService | None = None
    runtime: KubernetesService | None = None
    log_prefix = f"[DeployStart:{deployment_id}]"
    try:
        settings = get_settings()
        redis_client = get_redis_client()
        logger.info(f"{log_prefix} Starting deployment")
        runtime = KubernetesService(settings)

        github_installation_service = get_github_installation_service()

        async with AsyncSessionLocal() as db:
            deployment = (
                await db.execute(
                    select(Deployment)
                    .options(joinedload(Deployment.project).joinedload(Project.team))
                    .where(Deployment.id == deployment_id)
                )
            ).scalar_one()
            loki = LokiService()

            await DeploymentService.update_status(
                db,
                deployment,
                status="prepare",
                redis_client=redis_client,
            )

            env_vars_dict = DeploymentService().get_runtime_env_vars(deployment, settings)
            mounts = await DeploymentService().get_runtime_mounts(
                deployment, db, settings
            )
            commands: list[str] = []
            commands.append(
                f"echo 'Cloning {deployment.repo_full_name} (Branch: {deployment.branch}, Commit: {deployment.commit_sha[:7]})'"
            )
            github_installation = (
                await github_installation_service.get_or_refresh_installation(
                    deployment.project.github_installation_id, db
                )
            )
            env_vars_dict["DEVPUSH_GITHUB_TOKEN"] = github_installation.token
            commands.append(
                "git init -q && "
                "printf '%s\n' "
                "'#!/bin/sh' "
                '\'case "$1" in *Username*) echo "x-access-token";; *) echo "$DEVPUSH_GITHUB_TOKEN";; esac\' '
                "> /tmp/devpush-git-askpass && "
                "chmod 700 /tmp/devpush-git-askpass && "
                "export GIT_ASKPASS=/tmp/devpush-git-askpass GIT_TERMINAL_PROMPT=0 && "
                f"git fetch -q --depth 1 https://github.com/{deployment.repo_full_name}.git {deployment.commit_sha} && "
                "git checkout -q FETCH_HEAD && "
                "unset GIT_ASKPASS GIT_TERMINAL_PROMPT DEVPUSH_GITHUB_TOKEN && "
                "rm -f /tmp/devpush-git-askpass"
            )

            normalized_root_directory = (
                deployment.config.get("root_directory", "").strip().lstrip("./").strip("/")
            )
            if normalized_root_directory not in ("", ".", "./"):
                quoted_root_directory = shlex.quote(normalized_root_directory)
                commands.append(
                    f"echo 'Changing root directory to {normalized_root_directory}'"
                )
                commands.append(
                    f"test -d {quoted_root_directory} || {{ printf '\\033[31mError: root directory %s not found\\033[0m\\n' {quoted_root_directory} 1>&2; exit 1; }}"
                )
                commands.append(f"cd {quoted_root_directory}")

            if deployment.config.get("build_command"):
                commands.append("echo 'Installing dependencies...'")
                commands.append(f"( {deployment.config.get('build_command')} )")

            if deployment.config.get("pre_deploy_command"):
                commands.append("echo 'Running pre-deploy command...'")
                commands.append(f"( {deployment.config.get('pre_deploy_command')} )")

            commands.append("echo 'Starting application...'")
            commands.append(f"( {deployment.config.get('start_command')} )")

            config = deployment.config or {}
            cpus: float | None = settings.default_cpus
            memory_mb: int | None = settings.default_memory_mb

            if settings.allow_custom_cpu and config.get("cpus") is not None:
                max_cpus = settings.max_cpus
                assert max_cpus is not None
                try:
                    override_cpus = float(config.get("cpus"))
                except (ValueError, TypeError):
                    logger.warning(
                        f"{log_prefix} Invalid CPU override in config; using default."
                    )
                else:
                    if override_cpus > 0:
                        cpus = min(override_cpus, max_cpus)

            if settings.allow_custom_memory and config.get("memory") is not None:
                max_memory_mb = settings.max_memory_mb
                assert max_memory_mb is not None
                try:
                    override_memory_mb = int(config.get("memory"))
                except (ValueError, TypeError):
                    logger.warning(
                        f"{log_prefix} Invalid memory override in config; using default."
                    )
                else:
                    if override_memory_mb > 0:
                        memory_mb = min(override_memory_mb, max_memory_mb)

            runner_image = deployment.image
            if not runner_image:
                runner_slug = config.get("runner") or config.get("image")
                if not runner_slug:
                    raise ValueError("Runner not set in deployment config.")
                registry_state = RegistryService(
                    Path(settings.data_dir) / "registry"
                ).state
                runner_image = next(
                    (
                        runner.get("image")
                        for runner in registry_state.runners
                        if runner.get("slug") == runner_slug
                    ),
                    None,
                )
            if not runner_image:
                raise ValueError("Runner image not found for deployment.")

            await _push_loki_log(loki, deployment, "Preparing and starting container...")
            workload_id = await runtime.create_workload(
                deployment_id=deployment.id,
                project_id=deployment.project_id,
                environment_id=deployment.environment_id,
                hostname=deployment.hostname,
                image=runner_image,
                commands=commands,
                env_vars=env_vars_dict,
                mounts=mounts,
                cpus=cpus,
                memory_mb=memory_mb,
                labels={},
            )

            deployment.container_id = workload_id
            await DeploymentService.update_status(
                db,
                deployment,
                status="deploy",
                container_status="running",
                redis_client=redis_client,
            )
            logger.info(f"{log_prefix} Workload {workload_id} started. Monitoring...")

    except asyncio.CancelledError:
        logger.info(f"{log_prefix} Deployment canceled.")
        if workload_id:
            try:
                if runtime is None:
                    runtime = KubernetesService(settings)
                await runtime.kill_workload(workload_id)
                queue: ArqRedis = ctx["redis"]
                await queue.enqueue_job(
                    "delete_container",
                    deployment_id,
                    _defer_by=settings.container_delete_grace_seconds,
                )
            except Exception as e:
                logger.error(f"{log_prefix} Error cleaning up workload: {e}")

        try:
            async with AsyncSessionLocal() as db:
                deployment = await db.get(Deployment, deployment_id)
                if deployment:
                    await DeploymentService.update_status(
                        db,
                        deployment,
                        status="completed",
                        conclusion="canceled",
                        container_status="stopped",
                        redis_client=get_redis_client(),
                    )
        except Exception as e:
            logger.error(f"{log_prefix} Error updating deployment status: {e}")

    except Exception as e:
        queue: ArqRedis = ctx["redis"]
        await queue.enqueue_job(
            "fail_deployment",
            deployment_id,
            "deploy",
            f"Deployment failed unexpectedly: {e}",
        )
        logger.info(f"{log_prefix} Deployment startup failed.", exc_info=True)
    finally:
        if runtime:
            await runtime.close()
        if loki:
            await loki.client.aclose()


async def finalize_deployment(ctx, deployment_id: str):
    """Finalizes a deployment."""
    settings = get_settings()
    redis_client = get_redis_client()
    service = DeploymentService()
    log_prefix = f"[DeployFinalize:{deployment_id}]"
    logger.info(f"{log_prefix} Finalizing deployment")

    queue: ArqRedis | None = ctx.get("redis") if isinstance(ctx, dict) else None

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

            if deployment.conclusion == "canceled":
                logger.info(
                    "%s Deployment already canceled; skipping finalize.", log_prefix
                )
                return

            await DeploymentService().setup_aliases(deployment, db, settings)
            await db.commit()
            await DeploymentService().sync_project_routing(
                deployment.project,
                db,
                settings,
                include_deployment_ids={deployment.id},
            )

            await service.update_status(
                db,
                deployment,
                status="completed",
                conclusion="succeeded",
                error=None,
                redis_client=redis_client,
            )

            # Cleanup inactive deployments
            queue: ArqRedis = ctx["redis"]
            await queue.enqueue_job(
                "cleanup_inactive_containers", deployment.project_id
            )
            logger.info(
                f"{log_prefix} Inactive deployments cleanup job queued for project {deployment.project_id}."
            )

        except Exception:
            logger.error(f"{log_prefix} Error finalizing deployment.", exc_info=True)
            if queue:
                await queue.enqueue_job(
                    "fail_deployment",
                    deployment_id,
                    "finalize",
                    "Failed to finalize deployment (aliases/routing). The app may still be running.",
                )


async def fail_deployment(
    ctx, deployment_id: str, status: str, reason: str | None = None
):
    """Handles a failed deployment, cleaning up resources."""
    log_prefix = f"[DeployFail:{deployment_id}]"
    logger.info(f"{log_prefix} Handling failed deployment. Reason: {reason}")
    settings = get_settings()
    runtime = KubernetesService(settings)
    redis_client = get_redis_client()
    service = DeploymentService()
    try:
        async with AsyncSessionLocal() as db:
            deployment = (
                await db.execute(
                    select(Deployment)
                    .options(joinedload(Deployment.project))
                    .where(Deployment.id == deployment_id)
                )
            ).scalar_one()

            if deployment.conclusion == "canceled":
                logger.info(
                    "%s Deployment already canceled; skipping fail handler.", log_prefix
                )
                return
            if deployment.conclusion:
                logger.info(
                    "%s Deployment already concluded (%s); skipping fail handler.",
                    log_prefix,
                    deployment.conclusion,
                )
                return

            await service.update_status(
                db,
                deployment,
                status="fail",
                redis_client=redis_client,
            )

            if deployment.container_id and deployment.container_status not in (
                "removed",
                "stopped",
            ):
                try:
                    await runtime.kill_workload(deployment.container_id)
                    queue: ArqRedis = ctx["redis"]
                    await queue.enqueue_job(
                        "delete_container",
                        deployment.id,
                        _defer_by=settings.container_delete_grace_seconds,
                    )
                    logger.info(
                        f"{log_prefix} Cleaned up failed workload {deployment.container_id}"
                    )
                    await service.update_status(
                        db,
                        deployment,
                        container_status="stopped",
                        emit=False,
                    )
                except Exception:
                    logger.warning(
                        f"{log_prefix} Could not cleanup workload {deployment.container_id}.",
                        exc_info=True,
                    )

            await service.update_status(
                db,
                deployment,
                status="completed",
                conclusion="failed",
                error={"status": status, "message": reason or "Deployment failed"},
                redis_client=redis_client,
            )
            logger.error(f"{log_prefix} Deployment failed and cleaned up.")
    finally:
        await runtime.close()


async def delete_container(ctx, deployment_id: str):
    """Delete a deployment workload after a grace period."""
    log_prefix = f"[DeleteContainer:{deployment_id}]"
    logger.info(f"{log_prefix} Deleting workload")
    settings = get_settings()
    runtime = KubernetesService(settings)
    try:
        async with AsyncSessionLocal() as db:
            deployment = await db.get(Deployment, deployment_id)
            if not deployment or not deployment.container_id:
                logger.warning(f"{log_prefix} Deployment or workload not found")
                return

            try:
                await runtime.remove_workload(deployment.container_id)
                deployment.container_status = "removed"
                await db.commit()
            except Exception:
                logger.error(
                    f"[DeleteContainer:{deployment_id}] Error deleting workload.",
                    exc_info=True,
                )
    finally:
        await runtime.close()


async def cleanup_inactive_containers(
    ctx, project_id: str, remove_containers: bool = True
):
    """Stop/remove workloads for deployments no longer referenced by aliases."""
    settings = get_settings()
    runtime = KubernetesService(settings)
    try:
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(select(Project).where(Project.id == project_id))
                project = result.scalar_one_or_none()

                if not project:
                    logger.warning(f"[CleanupInactiveContainers:{project_id}] Project not found")
                    return

                if project.status == "deleted":
                    logger.info(
                        f"[CleanupInactiveContainers:{project_id}] Project deleted, skipping"
                    )
                    return

                logger.info(
                    f"[CleanupInactiveContainers:{project_id}] Starting cleanup for {project.name}"
                )

                active_result = await db.execute(
                    select(Alias.deployment_id)
                    .join(Deployment, Alias.deployment_id == Deployment.id)
                    .where(
                        Deployment.project_id == project_id,
                        Alias.deployment_id.isnot(None),
                    )
                    .union(
                        select(Alias.previous_deployment_id)
                        .join(Deployment, Alias.previous_deployment_id == Deployment.id)
                        .where(
                            Deployment.project_id == project_id,
                            Alias.previous_deployment_id.isnot(None),
                        )
                    )
                )
                active_deployment_ids = set(active_result.scalars().all())

                inactive_result = await db.execute(
                    select(Deployment).where(
                        Deployment.project_id == project_id,
                        Deployment.container_id.isnot(None),
                        Deployment.container_status == "running",
                        Deployment.status == "completed",
                        Deployment.id.notin_(active_deployment_ids) if active_deployment_ids else true(),
                    )
                )
                inactive_deployments = inactive_result.scalars().all()

                stopped_count = 0
                removed_count = 0
                for deployment in inactive_deployments:
                    if not deployment.container_id:
                        continue
                    try:
                        await runtime.kill_workload(deployment.container_id)
                        deployment.container_status = "stopped"
                        stopped_count += 1

                        if remove_containers:
                            await runtime.remove_workload(deployment.container_id)
                            deployment.container_status = "removed"
                            removed_count += 1
                    except Exception as error:
                        logger.error(
                            f"[CleanupInactiveContainers:{project_id}] Error processing workload {deployment.container_id}: {error}"
                        )

                if stopped_count > 0 or removed_count > 0:
                    await db.commit()
                    logger.info(
                        f"[CleanupInactiveContainers:{project_id}] Stopped: {stopped_count}, Removed: {removed_count}"
                    )
                else:
                    logger.info(
                        f"[CleanupInactiveContainers:{project_id}] No inactive workloads found"
                    )

            except Exception as error:
                logger.error(
                    f"[CleanupInactiveContainers:{project_id}] Task failed: {error}"
                )
                await db.rollback()
                raise
    finally:
        await runtime.close()
