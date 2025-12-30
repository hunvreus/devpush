from fastapi import Request, Depends, HTTPException, status
from fastapi.responses import (
    RedirectResponse as FastAPIRedirect,
    Response as FastAPIResponse,
)
from starlette.background import BackgroundTask
from authlib.integrations.starlette_client import OAuth
from fastapi.templating import Jinja2Templates
from jinja2 import pass_context
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from authlib.jose import jwt
from functools import lru_cache
import humanize
from datetime import datetime, timezone
from redis.asyncio import Redis
from arq.connections import ArqRedis

from config import get_settings, Settings
from db import get_db
from models import User, Project, Deployment, Team, TeamMember
from services.github import GitHubService
from services.github_installation import GitHubInstallationService


@lru_cache
def get_github_service() -> GitHubService:
    settings = get_settings()
    return GitHubService(
        client_id=settings.github_app_client_id,
        client_secret=settings.github_app_client_secret,
        app_id=settings.github_app_id,
        private_key=settings.github_app_private_key,
    )


@lru_cache
def get_github_installation_service() -> GitHubInstallationService:
    return GitHubInstallationService(get_github_service())


@lru_cache
def get_github_oauth_client() -> OAuth:
    settings = get_settings()
    oauth = OAuth()
    oauth.register(
        "github",
        client_id=settings.github_app_client_id,
        client_secret=settings.github_app_client_secret,
        access_token_url="https://github.com/login/oauth/access_token",
        authorize_url="https://github.com/login/oauth/authorize",
        api_base_url="https://api.github.com/",
        client_kwargs={"scope": "user:email"},
    )
    return oauth


async def get_github_primary_email(oauth_client: OAuth, token: dict) -> str | None:
    """Get user's primary verified email from GitHub."""
    try:
        if not oauth_client.github:
            return None

        response = await oauth_client.github.get("user/emails", token=token)
        emails = response.json()

        primary_email = next(
            (e for e in emails if e.get("primary") and e.get("verified")), None
        )
        return primary_email["email"] if primary_email else None
    except Exception:
        return None


@lru_cache
def get_google_oauth_client() -> OAuth:
    settings = get_settings()
    if not settings.google_client_id or not settings.google_client_secret:
        return None

    oauth = OAuth()
    oauth.register(
        "google",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )
    return oauth


async def get_google_user_info(oauth_client: OAuth, token: dict) -> dict | None:
    """Get user info from Google."""
    try:
        if not oauth_client.google:
            return None

        response = await oauth_client.google.get(
            "https://www.googleapis.com/oauth2/v1/userinfo", token=token
        )
        return response.json()
    except Exception:
        return None


@lru_cache
def get_redis_client() -> Redis:
    settings = get_settings()
    return Redis.from_url(settings.redis_url, decode_responses=True)


def get_job_queue(request: Request) -> ArqRedis:
    return request.app.state.redis_pool


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redirect_on_fail: bool = True,
) -> User:
    """Get the current user object, redirect to login if not authenticated."""
    session = request.cookies.get("auth_token")
    if not session:
        if redirect_on_fail:
            raise HTTPException(
                status.HTTP_303_SEE_OTHER,
                headers={"Location": "/auth/login"},
                detail="Authentication required",
            )
        else:
            return None

    try:
        data = decode_jwt_claims(session, settings, required_type="auth_token")
        user_id = data["sub"]
    except Exception:
        if redirect_on_fail:
            raise HTTPException(
                status.HTTP_303_SEE_OTHER,
                headers={"Location": "/auth/logout"},
                detail="Authentication required",
            )
        else:
            return None

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        if redirect_on_fail:
            raise HTTPException(
                status.HTTP_303_SEE_OTHER,
                headers={"Location": "/auth/logout"},
                detail="Authentication required",
            )
        else:
            return None
    issued_at = datetime.fromtimestamp(int(data["iat"]), tz=timezone.utc).replace(
        tzinfo=None
    )
    if user.tokens_invalid_before and issued_at < user.tokens_invalid_before:
        if redirect_on_fail:
            raise HTTPException(
                status.HTTP_303_SEE_OTHER,
                headers={"Location": "/auth/logout"},
                detail="Authentication required",
            )
        else:
            return None
    return user


def decode_jwt_claims(
    token: str,
    settings: Settings,
    required_type: str | None = None,
    leeway_seconds: int = 60,
):
    claims = jwt.decode(
        token,
        settings.secret_key,
        claims_options={
            "exp": {"essential": True},
            "iat": {"essential": True},
        },
    )
    claims.validate(leeway=leeway_seconds)
    if required_type and claims.get("type") != required_type:
        raise ValueError("Invalid token type")
    return claims


def get_translation(key: str, **kwargs) -> str:
    """Simple translation helper.

    Supports gettext-style ``%(name)s`` placeholders so you can write
    _( "Delete \"%(name)s\"?", name=project.name )
    now and later replace this stub with real gettext without changing
    templates or routes.
    """
    if not kwargs:
        return key

    # 1. Try gettext-style placeholders: %(key)s
    try:
        return key % kwargs  # type: ignore[arg-type]
    except (TypeError, ValueError):
        # 2. Fallback to str.format style placeholders: {key}
        return key.format(**kwargs)


def get_lazy_translation(key: str, **kwargs):
    """Lazy translation helper for form definitions.

    Returns a string-like object that defers translation until needed.
    Perfect for form field labels and validator messages.
    """

    class LazyString(str):
        def __new__(cls):
            return str.__new__(cls, get_translation(key, **kwargs))

    return LazyString()


def flash(
    request: Request,
    title: str,
    category: str = "info",
    description: str | None = None,
    action: dict | None = None,
    cancel: dict | None = None,
    attrs: dict | None = None,
):
    if "_messages" not in request.session:
        request.session["_messages"] = []

    message = {
        "title": title,
        "category": category,
        "description": description,
    }
    if action:
        message["action"] = action
    if cancel:
        message["cancel"] = cancel
    if attrs:
        message["attrs"] = attrs

    request.session["_messages"].append(message)


@pass_context
def get_flashed_messages(ctx):
    request = ctx.get("request")
    if request and hasattr(request, "session"):
        return request.session.pop("_messages", [])
    return []


async def get_team_by_slug(
    team_slug: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> tuple[Team, TeamMember]:
    result = await db.execute(
        select(Team, TeamMember)
        .join(TeamMember)
        .where(
            Team.slug == team_slug,
            TeamMember.user_id == current_user.id,
            TeamMember.role.in_(["owner", "member"]),
        )
        .limit(1)
    )
    team_and_membership = result.first()
    if not team_and_membership:
        raise HTTPException(status_code=404, detail="Team not found or access denied")

    team, team_member = team_and_membership
    return team, team_member


async def get_team_by_id(
    team_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> tuple[Team, TeamMember]:
    result = await db.execute(
        select(Team, TeamMember)
        .join(TeamMember)
        .where(
            Team.id == team_id,
            TeamMember.user_id == current_user.id,
            TeamMember.role.in_(["owner", "member"]),
        )
        .limit(1)
    )
    team_and_membership = result.first()
    if not team_and_membership:
        raise HTTPException(status_code=404, detail="Team not found or access denied")

    team, team_member = team_and_membership
    return team, team_member


async def get_project_by_name(
    project_name: str,
    db: AsyncSession = Depends(get_db),
    team_and_membership: tuple[Team, TeamMember] = Depends(get_team_by_slug),
) -> Project:
    team, membership = team_and_membership

    result = await db.execute(
        select(Project)
        .where(
            Project.name == project_name,
            Project.team_id == team.id,
            Project.status != "deleted",
        )
        .limit(1)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def get_optional_project_by_name(
    project_name: str | None = None,
    db: AsyncSession = Depends(get_db),
    team_and_membership: tuple[Team, TeamMember] = Depends(get_team_by_slug),
) -> Project | None:
    if not project_name:
        return None

    return await get_project_by_name(project_name, db, team_and_membership)


async def get_project_by_id(
    project_id: str, db: AsyncSession = Depends(get_db)
) -> Project:
    result = await db.execute(
        select(Project)
        .where(
            Project.id == project_id,
            Project.status != "deleted",
        )
        .limit(1)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def get_deployment_by_id(
    deployment_id: str, db: AsyncSession = Depends(get_db)
) -> Deployment:
    result = await db.execute(
        select(Deployment)
        .options(selectinload(Deployment.aliases))
        .where(Deployment.id == deployment_id)
        .limit(1)
    )
    deployment = result.scalar_one_or_none()
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return deployment


def is_superadmin(user: User) -> bool:
    return user.id == 1


async def get_role(
    request: Request,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    current_user: User = Depends(get_current_user),
    team_and_membership: tuple[Team, TeamMember] = Depends(get_team_by_slug),
    project: Project | None = Depends(get_optional_project_by_name),
) -> str:
    """Get the role of the current user for the given team and project."""
    team, membership = team_and_membership

    if (
        membership.role == "member"
        and project
        and project.created_by_user_id == current_user.id
    ):
        return "creator"

    return membership.role


def get_access(
    role: str,
    permission: str,
) -> bool:
    if not (
        role in ("owner", "admin", "creator", "member")
        and permission in ("owner", "admin", "creator", "member")
    ):
        return False

    LEVELS = {
        "owner": 0,
        "admin": 1,
        "creator": 2,
        "member": 3,
    }

    return LEVELS[role] <= LEVELS[permission]


def RedirectResponseX(
    url: str,
    status_code: int = status.HTTP_307_TEMPORARY_REDIRECT,
    headers: dict[str, str] | None = None,
    request: Request | None = None,
):
    """
    Drop-in replacement for FastAPI RedirectResponse.
    • If `request` is an HTMX call ⇒ send HX-Redirect header.
    • Otherwise ⇒ delegate to FastAPI's RedirectResponse.
    """

    if request is not None and request.headers.get("HX-Request"):
        return FastAPIResponse(
            status_code=200,
            headers={"HX-Redirect": str(url), **(headers or {})},
        )
    return FastAPIRedirect(url=url, status_code=status_code, headers=headers)


def time_ago_filter(value):
    """Convert a datetime or ISO string to a human readable time ago."""
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return humanize.naturaltime(value)


settings = get_settings()
templates = Jinja2Templates(
    directory="templates", auto_reload=settings.env == "development"
)
templates.env.globals["_"] = get_translation
templates.env.globals["app_name"] = settings.app_name
templates.env.globals["app_description"] = settings.app_description
templates.env.globals["get_flashed_messages"] = get_flashed_messages
templates.env.globals["toaster_header"] = settings.toaster_header
templates.env.filters["time_ago"] = time_ago_filter
templates.env.globals["get_access"] = get_access
templates.env.globals["is_superadmin"] = is_superadmin


def TemplateResponse(
    request: Request,
    name: str,
    context: dict | None = None,
    status_code: int = 200,
    headers: dict | None = None,
    media_type: str | None = None,
    background: BackgroundTask | None = None,
):
    if request.headers.get("HX-Request"):
        """Render template wrapped in fragment layout for HTMX"""
        context = context or {}

        # Render the fragment template first
        template = templates.get_template(name)
        content = template.render(request=request, is_fragment=True, **context)

        # Return wrapped in fragment layout
        return templates.TemplateResponse(
            request=request,
            name="layouts/fragment.html",
            context={"content": content, **context},
            status_code=status_code,
            headers=headers,
            media_type=media_type,
            background=background,
        )
    else:
        """Regular template response"""
        return templates.TemplateResponse(
            request=request,
            name=name,
            context=context or {},
            status_code=status_code,
            headers=headers,
            media_type=media_type,
            background=background,
        )
