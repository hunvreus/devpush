import os
import time
import asyncio
from sqlalchemy import select, delete, true, update
import aiodocker
import logging

from models import (
    Project,
    Deployment,
    Domain,
    Alias,
    Team,
    TeamMember,
    TeamInvite,
    User,
    UserIdentity,
)
from config import get_settings
from db import AsyncSessionLocal

logger = logging.getLogger(__name__)


async def cleanup_user(ctx, user_id: int):
    """Delete a user and all their related resources."""
    logger.info(f"[CleanupUser:{user_id}] Starting cleanup for user")

    async with AsyncSessionLocal() as db:
        try:
            # Get the user
            user_result = await db.execute(select(User).where(User.id == user_id))
            user = user_result.scalar_one_or_none()
            if not user:
                logger.error(f"[CleanupUser:{user_id}] User not found")
                return

            # Find all teams the user is a member of
            member_of_result = await db.execute(
                select(TeamMember.team_id).where(TeamMember.user_id == user_id)
            )
            member_of_team_ids = member_of_result.scalars().all()

            teams_to_delete = []
            for team_id in member_of_team_ids:
                # Check if the user is the sole owner of this team
                owners_result = await db.execute(
                    select(TeamMember.user_id).where(
                        TeamMember.team_id == team_id, TeamMember.role == "owner"
                    )
                )
                owners = owners_result.scalars().all()
                if len(owners) == 1 and owners[0] == user_id:
                    teams_to_delete.append(team_id)
                else:
                    logger.info(
                        f"[CleanupUser:{user_id}] Skipping team {team_id} as user is not the sole owner"
                    )

            # Cleanup teams that would be left ownerless
            for team_id in teams_to_delete:
                logger.info(
                    f"[CleanupUser:{user_id}] Deleting team {team_id} as user is sole owner"
                )
                await cleanup_team(ctx, team_id)

            # Clear default team for any other user pointing to a deleted team
            if teams_to_delete:
                await db.execute(
                    update(User)
                    .where(User.default_team_id.in_(teams_to_delete))
                    .values(default_team_id=None)
                )

            # Cleanup remaining user data
            logger.info(f"[CleanupUser:{user_id}] Deleting remaining user data")
            await db.execute(delete(TeamMember).where(TeamMember.user_id == user_id))
            await db.execute(delete(TeamInvite).where(TeamInvite.inviter_id == user_id))
            await db.execute(delete(TeamInvite).where(TeamInvite.email == user.email))
            await db.execute(
                delete(UserIdentity).where(UserIdentity.user_id == user_id)
            )

            # Finally, delete the user
            logger.info(f"[CleanupUser:{user_id}] Deleting user record")
            await db.execute(delete(User).where(User.id == user_id))

            await db.commit()
            logger.info(f"[CleanupUser:{user_id}] Successfully cleaned up user")

        except Exception as e:
            logger.error(f"[CleanupUser:{user_id}] Task failed: {e}", exc_info=True)
            await db.rollback()
            raise


async def cleanup_team(ctx, team_id: str):
    """Delete a team and related resources (e.g. projects, deployments, aliases) in batches."""
    logger.info(f"[CleanupTeam:{team_id}] Starting cleanup for team")

    async with AsyncSessionLocal() as db:
        try:
            # Get the team and all its projects
            team_result = await db.execute(select(Team).where(Team.id == team_id))
            team = team_result.scalar_one_or_none()

            if not team:
                logger.error(f"[CleanupTeam:{team_id}] Team not found")
                return

            projects_result = await db.execute(
                select(Project).where(Project.team_id == team_id)
            )
            projects = projects_result.scalars().all()

            # Sequentially clean up each project
            for project in projects:
                logger.info(
                    f"[CleanupTeam:{team_id}] Deleting project {project.id} ('{project.name}')"
                )
                project.status = "deleted"
                await db.commit()
                await cleanup_project(ctx, project.id)

            # Delete related team data
            logger.info(
                f"[CleanupTeam:{team_id}] Deleting associated team members and invites"
            )
            await db.execute(delete(TeamMember).where(TeamMember.team_id == team_id))
            await db.execute(delete(TeamInvite).where(TeamInvite.team_id == team_id))

            # Clear default team for any other user pointing to this team
            await db.execute(
                update(User)
                .where(User.default_team_id == team_id)
                .values(default_team_id=None)
            )

            # Delete the team itself
            logger.info(f"[CleanupTeam:{team_id}] Deleting team record")
            await db.execute(delete(Team).where(Team.id == team_id))

            await db.commit()
            logger.info(f"[CleanupTeam:{team_id}] Successfully cleaned up team")

        except Exception as e:
            logger.error(f"[CleanupTeam:{team_id}] Task failed: {e}", exc_info=True)
            await db.rollback()
            raise


async def cleanup_project(ctx, project_id: str, batch_size: int = 100):
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
                    deployments_result = await db.execute(
                        select(Deployment)
                        .where(Deployment.project_id == project_id)
                        .limit(batch_size)
                    )
                    deployments = deployments_result.scalars().all()

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
                    settings.traefik_dir, f"project_{project_id}.yml"
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

                # 2. Delete domains associated with this project
                try:
                    domains_deleted_result = await db.execute(
                        delete(Domain).where(Domain.project_id == project_id)
                    )
                    total_domains = domains_deleted_result.rowcount
                    logger.info(
                        f"[CleanupProject:{project_id}] Removed {total_domains} domains"
                    )
                except Exception as e:
                    logger.error(
                        f"[CleanupProject:{project_id}] Failed to delete domains: {e}"
                    )
                    await db.rollback()
                    raise

                # 3. Delete the project
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
