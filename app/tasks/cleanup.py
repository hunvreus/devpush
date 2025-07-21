import os
import time
import asyncio
from sqlalchemy import select, delete, true
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
import aiodocker
import logging

from models import Project, Deployment, Alias
from config import get_settings

logger = logging.getLogger(__name__)


async def cleanup_team(ctx, team_id: str):
    """Delete a team and related resources (e.g. projects, deployments, aliases) in batches."""
    return


async def cleanup_project(ctx, project_id: str, batch_size: int = 100):
    """Delete a project and related resources (e.g. containers, aliases, deployments) in batches."""
    settings = get_settings()

    database_url = f"postgresql+asyncpg://{settings.postgres_user}:{settings.postgres_password}@pgsql:5432/{settings.postgres_db}"
    engine = create_async_engine(database_url, echo=settings.db_echo)
    AsyncSessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with AsyncSessionLocal() as db:
        async with aiodocker.Docker(url=settings.docker_host) as docker_client:
            try:
                result = await db.execute(
                    select(Project).where(Project.id == project_id)
                )
                project = result.scalar_one_or_none()

                if not project:
                    logger.error(f"[CleanupProject:{project_id}] Project not found")
                    raise Exception(f"Project {project_id} not found")

                if project.status != "deleted":
                    logger.error(
                        f"[CleanupProject:{project_id}] Project is not marked as deleted"
                    )
                    raise Exception(f"Project {project_id} is not marked as deleted")

                logger.info(
                    f'[CleanupProject:{project_id}] Starting cleanup for project "{project.name}"'
                )
                start_time = time.time()
                total_deployments = 0
                total_aliases = 0
                total_containers = 0

                while True:
                    # Get a batch of deployments
                    result = await db.execute(
                        select(Deployment)
                        .where(Deployment.project_id == project_id)
                        .limit(batch_size)
                    )
                    deployments = result.scalars().all()

                    if not deployments:
                        logger.info(
                            f"[CleanupProject:{project_id}] No more deployments to process"
                        )
                        break

                    deployment_ids = [deployment.id for deployment in deployments]

                    # Remove containers
                    for deployment in deployments:
                        if deployment.container_id:
                            try:
                                container = await docker_client.containers.get(
                                    deployment.container_id
                                )
                                await container.delete(force=True)
                                total_containers += 1
                                logger.debug(
                                    f"[CleanupProject:{project_id}] Removed container {deployment.container_id}"
                                )
                            except aiodocker.DockerError as e:
                                if e.status == 404:
                                    logger.warning(
                                        f"[CleanupProject:{project_id}] Container {deployment.container_id} not found"
                                    )
                                else:
                                    logger.error(
                                        f"[CleanupProject:{project_id}] Failed to remove container {deployment.container_id}: {e}"
                                    )
                            except Exception as e:
                                logger.error(
                                    f"[CleanupProject:{project_id}] Failed to remove container {deployment.container_id}: {e}"
                                )

                    try:
                        # Delete aliases
                        result = await db.execute(
                            delete(Alias).where(Alias.deployment_id.in_(deployment_ids))
                        )
                        total_aliases += result.rowcount

                        # Delete deployments
                        result = await db.execute(
                            delete(Deployment).where(Deployment.id.in_(deployment_ids))
                        )
                        total_deployments += result.rowcount

                        await db.commit()
                        logger.info(
                            f"[CleanupProject:{project_id}] Processed batch of {len(deployment_ids)} deployments"
                        )

                    except Exception as e:
                        logger.error(
                            f"[CleanupProject:{project_id}] Failed to commit batch: {e}"
                        )
                        await db.rollback()
                        await asyncio.sleep(1)
                        continue

                # No more deployments:
                # 1. Remove Traefik config file
                project_config_file_path = os.path.join(
                    "/traefik_configs", f"project_{project_id}.yml"
                )
                if os.path.exists(project_config_file_path):
                    try:
                        os.remove(project_config_file_path)
                        logger.info(
                            f"[CleanupProject:{project_id}] Removed Traefik config file"
                        )
                    except Exception as e:
                        logger.error(
                            f"[CleanupProject:{project_id}] Failed to remove Traefik config: {e}"
                        )

                # 2. Delete the project
                try:
                    await db.execute(delete(Project).where(Project.id == project_id))
                    await db.commit()

                    duration = time.time() - start_time
                    logger.info(
                        f"[CleanupProject:{project_id}] Completed cleanup for {project.name} in {duration:.2f}s:\n"
                        f"- {total_deployments} deployments removed\n"
                        f"- {total_aliases} aliases removed\n"
                        f"- {total_containers} containers removed"
                    )
                except Exception as e:
                    logger.error(
                        f"[CleanupProject:{project_id}] Failed to delete project: {e}"
                    )
                    await db.rollback()
                    raise

            except Exception as e:
                logger.error(f"[CleanupProject:{project_id}] Task failed: {e}")
                await db.rollback()
                raise


async def cleanup_inactive_deployments(
    ctx, project_id: str, remove_containers: bool = True
):
    """Stop/remove containers for deployments no longer referenced by aliases."""
    settings = get_settings()

    database_url = f"postgresql+asyncpg://{settings.postgres_user}:{settings.postgres_password}@pgsql:5432/{settings.postgres_db}"
    engine = create_async_engine(database_url, echo=settings.db_echo)
    AsyncSessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with AsyncSessionLocal() as db:
        async with aiodocker.Docker(url=settings.docker_host) as docker_client:
            try:
                # Get project
                result = await db.execute(
                    select(Project).where(Project.id == project_id)
                )
                project = result.scalar_one_or_none()

                if not project:
                    logger.warning(
                        f"[InactiveDeploymentsCleanup:{project_id}] Project not found"
                    )
                    return

                if project.status == "deleted":
                    logger.info(
                        f"[InactiveDeploymentsCleanup:{project_id}] Project deleted, skipping"
                    )
                    return

                logger.info(
                    f"[InactiveDeploymentsCleanup:{project_id}] Starting cleanup for {project.name}"
                )

                # Get active deployment IDs
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

                logger.debug(
                    f"[InactiveDeploymentsCleanup:{project_id}] Active deployments: {active_deployment_ids}"
                )

                # Get inactive deployments with containers
                inactive_result = await db.execute(
                    select(Deployment).where(
                        Deployment.project_id == project_id,
                        Deployment.container_id.isnot(None),
                        Deployment.container_status == "running",
                        Deployment.status == "completed",
                        Deployment.id.notin_(active_deployment_ids)
                        if active_deployment_ids
                        else true(),
                    )
                )
                inactive_deployments = inactive_result.scalars().all()

                stopped_count = 0
                removed_count = 0

                for deployment in inactive_deployments:
                    logger.info(
                        f"[InactiveDeploymentsCleanup:{project_id}] Processing inactive deployment {deployment.id}"
                    )
                    try:
                        if deployment.container_id is None:
                            logger.warning(
                                f"[InactiveDeploymentsCleanup:{project_id}] Deployment {deployment.id} has no container"
                            )
                            continue

                        container = await docker_client.containers.get(
                            deployment.container_id
                        )

                        # Stop container
                        await container.stop()
                        deployment.container_status = "stopped"
                        stopped_count += 1
                        logger.info(
                            f"[InactiveDeploymentsCleanup:{project_id}] Stopped container {deployment.container_id}"
                        )

                        # Remove if requested
                        if remove_containers:
                            await container.delete()
                            deployment.container_status = "removed"
                            removed_count += 1
                            logger.info(
                                f"[InactiveDeploymentsCleanup:{project_id}] Removed container {deployment.container_id}"
                            )

                    except aiodocker.DockerError as error:
                        if error.status == 404:
                            logger.warning(
                                f"[InactiveDeploymentsCleanup:{project_id}] Container {deployment.container_id} not found"
                            )
                            deployment.container_status = None
                        else:
                            logger.error(
                                f"[InactiveDeploymentsCleanup:{project_id}] Docker error: {error}"
                            )
                    except Exception as error:
                        logger.error(
                            f"[InactiveDeploymentsCleanup:{project_id}] Error processing container: {error}"
                        )

                # Commit status updates
                if stopped_count > 0 or removed_count > 0:
                    try:
                        await db.commit()
                        logger.info(
                            f"[InactiveDeploymentsCleanup:{project_id}] Stopped: {stopped_count}, Removed: {removed_count}"
                        )
                    except Exception as e:
                        logger.error(
                            f"[InactiveDeploymentsCleanup:{project_id}] Failed to commit: {e}"
                        )
                        await db.rollback()
                else:
                    logger.info(
                        f"[InactiveDeploymentsCleanup:{project_id}] No inactive containers found"
                    )

            except Exception as error:
                logger.error(
                    f"[InactiveDeploymentsCleanup:{project_id}] Task failed: {error}"
                )
                await db.rollback()
                raise
