from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import re

from models import User, UserIdentity


def sanitize_username(username: str) -> str:
    sanitized = re.sub(r"[^\w-]", "-", username.lower())
    return re.sub(r"-+", "-", sanitized).strip("-")


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(
        select(User).where(func.lower(User.email) == func.lower(email.strip()))
    )
    return result.scalar_one_or_none()


async def get_user_by_provider(
    db: AsyncSession, provider: str, provider_user_id: str
) -> User | None:
    result = await db.execute(
        select(User)
        .join(UserIdentity)
        .where(
            UserIdentity.provider == provider,
            UserIdentity.provider_user_id == provider_user_id,
        )
    )
    return result.scalar_one_or_none()


async def get_user_github_token(db: AsyncSession, user: User) -> str | None:
    result = await db.execute(
        select(UserIdentity).where(
            UserIdentity.user_id == user.id, UserIdentity.provider == "github"
        )
    )
    github_identity = result.scalar_one_or_none()
    return github_identity.access_token if github_identity else None
