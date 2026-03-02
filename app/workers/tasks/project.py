import logging
import time

from sqlalchemy import select, delete

from config import get_settings
from db import AsyncSessionLocal
from models import Alias, Deployment, Domain, Project, StorageProject
from services.kubernetes import KubernetesService

logger = logging.getLogger(__name__)


async def delete_project(ctx, project_id: str, batch_size: int = 100):
    """Delete a project and related resources in batches."""
    settings = get_settings()
    kubernetes_service = KubernetesService(settings)

    async with AsyncSessionLocal() as db:
        try:
            project_result = await db.execute(select(Project).where(Project.id == project_id))
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
            total_workloads = 0

            while True:
                deployments_result = await db.execute(
                    select(Deployment).where(Deployment.project_id == project_id).limit(batch_size)
                )
                deployments = deployments_result.scalars().all()

                if not deployments:
                    logger.info(f"[DeleteProject:{project_id}] No more deployments to process")
                    break

                deployment_ids = [deployment.id for deployment in deployments]

                for deployment in deployments:
                    if not deployment.container_id:
                        continue
                    try:
                        await kubernetes_service.remove_workload(deployment.container_id)
                        total_workloads += 1
                        logger.debug(
                            f"[DeleteProject:{project_id}] Removed workload {deployment.container_id}"
                        )
                    except Exception as error:
                        logger.warning(
                            f"[DeleteProject:{project_id}] Failed to remove workload {deployment.container_id}: {error}"
                        )

                try:
                    aliases_deleted_result = await db.execute(
                        delete(Alias).where(Alias.deployment_id.in_(deployment_ids))
                    )
                    total_aliases += aliases_deleted_result.rowcount

                    deployments_deleted_result = await db.execute(
                        delete(Deployment).where(Deployment.id.in_(deployment_ids))
                    )
                    total_deployments += deployments_deleted_result.rowcount

                    await db.commit()
                    logger.info(
                        f"[DeleteProject:{project_id}] Processed batch of {len(deployment_ids)} deployments"
                    )
                except Exception as error:
                    logger.error(
                        f"[DeleteProject:{project_id}] Failed to commit batch: {error}"
                    )
                    await db.rollback()
                    continue

            try:
                domains_deleted_result = await db.execute(
                    delete(Domain).where(Domain.project_id == project_id)
                )
                total_domains = domains_deleted_result.rowcount
                logger.info(f"[DeleteProject:{project_id}] Removed {total_domains} domains")
            except Exception as error:
                logger.error(
                    f"[DeleteProject:{project_id}] Failed to delete domains: {error}"
                )
                await db.rollback()
                raise

            try:
                storage_links_deleted_result = await db.execute(
                    delete(StorageProject).where(StorageProject.project_id == project_id)
                )
                total_storage_links = storage_links_deleted_result.rowcount
                logger.info(
                    f"[DeleteProject:{project_id}] Removed {total_storage_links} storage associations"
                )
            except Exception as error:
                logger.error(
                    f"[DeleteProject:{project_id}] Failed to delete storage associations: {error}"
                )
                await db.rollback()
                raise

            try:
                await db.execute(delete(Project).where(Project.id == project_id))
                await db.commit()

                duration = time.time() - start_time
                logger.info(
                    f"[DeleteProject:{project_id}] Completed delete for {project.name} in {duration:.2f}s:\n"
                    f"- {total_deployments} deployments removed\n"
                    f"- {total_aliases} aliases removed\n"
                    f"- {total_workloads} workloads removed"
                )
            except Exception as error:
                logger.error(
                    f"[DeleteProject:{project_id}] Failed to delete project: {error}"
                )
                await db.rollback()
                raise

        except Exception as error:
            logger.error(f"[DeleteProject:{project_id}] Task failed: {error}")
            await db.rollback()
            raise
