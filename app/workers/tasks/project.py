import logging
import os
import time

import aiodocker
from sqlalchemy import select, delete

from config import get_settings
from db import AsyncSessionLocal
from models import Alias, Deployment, Domain, Project, StorageProject

logger = logging.getLogger(__name__)


async def delete_project(ctx, project_id: str, batch_size: int = 100):
    """Delete a project and related resources (e.g. containers, aliases, deployments) in batches."""
    settings = get_settings()

    async with AsyncSessionLocal() as db:
        async with aiodocker.Docker(url=settings.docker_host) as docker_client:
            try:
                project_result = await db.execute(
                    select(Project).where(Project.id == project_id)
                )
                project = project_result.scalar_one_or_none()

                if not project:
                    logger.error(f"[DeleteProject:{project_id}] Project not found")
                    raise Exception(f"Project {project_id} not found")

                if project.status != "deleted":
                    logger.error(
                        f"[DeleteProject:{project_id}] Project is not marked as deleted"
                    )
                    raise Exception(f"Project {project_id} is not marked as deleted")

                logger.info(
                    f'[DeleteProject:{project_id}] Starting delete for project "{project.name}"'
                )
                start_time = time.time()
                total_deployments = 0
                total_aliases = 0
                total_containers = 0

                while True:
                    # Get a batch of deployments
                    deployments_result = await db.execute(
                        select(Deployment)
                        .where(Deployment.project_id == project_id)
                        .limit(batch_size)
                    )
                    deployments = deployments_result.scalars().all()

                    if not deployments:
                        logger.info(
                            f"[DeleteProject:{project_id}] No more deployments to process"
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
                                    f"[DeleteProject:{project_id}] Removed container {deployment.container_id}"
                                )
                            except aiodocker.DockerError as e:
                                if e.status == 404:
                                    logger.warning(
                                        f"[DeleteProject:{project_id}] Container {deployment.container_id} not found"
                                    )
                                else:
                                    logger.error(
                                        f"[DeleteProject:{project_id}] Failed to remove container {deployment.container_id}: {e}"
                                    )
                            except Exception as e:
                                logger.error(
                                    f"[DeleteProject:{project_id}] Failed to remove container {deployment.container_id}: {e}"
                                )

                    try:
                        # Delete aliases
                        aliases_deleted_result = await db.execute(
                            delete(Alias).where(Alias.deployment_id.in_(deployment_ids))
                        )
                        total_aliases += aliases_deleted_result.rowcount

                        # Delete deployments
                        deployments_deleted_result = await db.execute(
                            delete(Deployment).where(Deployment.id.in_(deployment_ids))
                        )
                        total_deployments += deployments_deleted_result.rowcount

                        await db.commit()
                        logger.info(
                            f"[DeleteProject:{project_id}] Processed batch of {len(deployment_ids)} deployments"
                        )

                    except Exception as e:
                        logger.error(
                            f"[DeleteProject:{project_id}] Failed to commit batch: {e}"
                        )
                        await db.rollback()
                        # TODO: continue creates infinite retry on persistent errors;
                        # consider letting exception bubble up to ARQ retry instead
                        continue

                # No more deployments:
                # 1. Remove Traefik config file
                project_config_file_path = os.path.join(
                    settings.traefik_dir, f"project_{project_id}.yml"
                )
                if os.path.exists(project_config_file_path):
                    try:
                        os.remove(project_config_file_path)
                        logger.info(
                            f"[DeleteProject:{project_id}] Removed Traefik config file"
                        )
                    except Exception as e:
                        logger.error(
                            f"[DeleteProject:{project_id}] Failed to remove Traefik config: {e}"
                        )

                # 2. Delete domains associated with this project
                try:
                    domains_deleted_result = await db.execute(
                        delete(Domain).where(Domain.project_id == project_id)
                    )
                    total_domains = domains_deleted_result.rowcount
                    logger.info(
                        f"[DeleteProject:{project_id}] Removed {total_domains} domains"
                    )
                except Exception as e:
                    logger.error(
                        f"[DeleteProject:{project_id}] Failed to delete domains: {e}"
                    )
                    await db.rollback()
                    raise

                # 3. Delete storage associations for this project
                try:
                    storage_links_deleted_result = await db.execute(
                        delete(StorageProject).where(
                            StorageProject.project_id == project_id
                        )
                    )
                    total_storage_links = storage_links_deleted_result.rowcount
                    logger.info(
                        f"[DeleteProject:{project_id}] Removed {total_storage_links} storage associations"
                    )
                except Exception as e:
                    logger.error(
                        f"[DeleteProject:{project_id}] Failed to delete storage associations: {e}"
                    )
                    await db.rollback()
                    raise

                # 4. Delete the project
                try:
                    await db.execute(delete(Project).where(Project.id == project_id))
                    await db.commit()

                    duration = time.time() - start_time
                    logger.info(
                        f"[DeleteProject:{project_id}] Completed delete for {project.name} in {duration:.2f}s:\n"
                        f"- {total_deployments} deployments removed\n"
                        f"- {total_aliases} aliases removed\n"
                        f"- {total_containers} containers removed"
                    )
                except Exception as e:
                    logger.error(
                        f"[DeleteProject:{project_id}] Failed to delete project: {e}"
                    )
                    await db.rollback()
                    raise

            except Exception as e:
                logger.error(f"[DeleteProject:{project_id}] Task failed: {e}")
                await db.rollback()
                raise
