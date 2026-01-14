import logging
from sqlalchemy import select, delete, update

from db import AsyncSessionLocal
from models import Project, Storage, Team, TeamInvite, TeamMember, User
from workers.tasks.project import delete_project
from workers.tasks.storage import deprovision_storage

logger = logging.getLogger(__name__)


async def delete_team(ctx, team_id: str):
    """Delete a team and related resources (e.g. projects, deployments, aliases) in batches."""
    logger.info(f"[DeleteTeam:{team_id}] Starting delete for team")

    async with AsyncSessionLocal() as db:
        try:
            # Get the team and all its projects
            team_result = await db.execute(select(Team).where(Team.id == team_id))
            team = team_result.scalar_one_or_none()

            if not team:
                logger.error(f"[DeleteTeam:{team_id}] Team not found")
                return

            projects_result = await db.execute(
                select(Project).where(Project.team_id == team_id)
            )
            projects = projects_result.scalars().all()

            # Sequentially clean up each project
            for project in projects:
                logger.info(
                    f"[DeleteTeam:{team_id}] Deleting project {project.id} ('{project.name}')"
                )
                project.status = "deleted"
                await db.commit()
                await delete_project(ctx, project.id)

            # Deprovision team storage
            storage_ids_result = await db.execute(
                select(Storage.id).where(Storage.team_id == team_id)
            )
            storage_ids = storage_ids_result.scalars().all()
            for storage_id in storage_ids:
                logger.info(
                    f"[DeleteTeam:{team_id}] Deprovisioning storage {storage_id}"
                )
                await deprovision_storage(ctx, storage_id)

            # Delete related team data
            logger.info(
                f"[DeleteTeam:{team_id}] Deleting associated team members and invites"
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
            logger.info(f"[DeleteTeam:{team_id}] Deleting team record")
            await db.execute(delete(Team).where(Team.id == team_id))

            await db.commit()
            logger.info(f"[DeleteTeam:{team_id}] Successfully deleted team")

        except Exception as e:
            logger.error(f"[DeleteTeam:{team_id}] Task failed: {e}", exc_info=True)
            await db.rollback()
            raise
