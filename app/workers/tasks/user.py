import logging
from sqlalchemy import select, delete, update

from db import AsyncSessionLocal
from models import TeamMember, TeamInvite, User, UserIdentity
from workers.tasks.team import delete_team

logger = logging.getLogger(__name__)


async def delete_user(ctx, user_id: int):
    """Delete a user and all their related resources."""
    logger.info(f"[DeleteUser:{user_id}] Starting delete for user")

    async with AsyncSessionLocal() as db:
        try:
            # Get the user
            user_result = await db.execute(select(User).where(User.id == user_id))
            user = user_result.scalar_one_or_none()
            if not user:
                logger.error(f"[DeleteUser:{user_id}] User not found")
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
                        f"[DeleteUser:{user_id}] Skipping team {team_id} as user is not the sole owner"
                    )

            # Cleanup teams that would be left ownerless
            for team_id in teams_to_delete:
                logger.info(
                    f"[DeleteUser:{user_id}] Deleting team {team_id} as user is sole owner"
                )
                await delete_team(ctx, team_id)

            # Clear default team for any other user pointing to a deleted team
            if teams_to_delete:
                await db.execute(
                    update(User)
                    .where(User.default_team_id.in_(teams_to_delete))
                    .values(default_team_id=None)
                )

            # Cleanup remaining user data
            logger.info(f"[DeleteUser:{user_id}] Deleting remaining user data")
            await db.execute(delete(TeamMember).where(TeamMember.user_id == user_id))
            await db.execute(delete(TeamInvite).where(TeamInvite.inviter_id == user_id))
            await db.execute(delete(TeamInvite).where(TeamInvite.email == user.email))
            await db.execute(
                delete(UserIdentity).where(UserIdentity.user_id == user_id)
            )

            # Finally, delete the user
            logger.info(f"[DeleteUser:{user_id}] Deleting user record")
            await db.execute(delete(User).where(User.id == user_id))

            await db.commit()
            logger.info(f"[DeleteUser:{user_id}] Successfully deleted user")

        except Exception as e:
            logger.error(f"[DeleteUser:{user_id}] Task failed: {e}", exc_info=True)
            await db.rollback()
            raise
