from __future__ import annotations
from sqlalchemy import (
    BigInteger,
    Boolean,
    Enum as SQLAEnum,
    JSON,
    String,
    Text,
    ForeignKey,
    UniqueConstraint,
    event,
    select,
    update,
    func,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime, timezone, timedelta
import json
from secrets import token_hex
from cryptography.fernet import Fernet
from functools import lru_cache
import re
from typing import override

from db import Base
from config import get_settings
from utils.color import get_color
from utils.log import parse_log

FORBIDDEN_TEAM_SLUGS = [
    "admin",
    "api",
    "assets",
    "auth",
    "deployment-not-found",
    "health",
    "new-team",
    "setup",
    "upload",
    "user",
]


def utc_now() -> datetime:
    """Get current UTC time as timezone-naive datetime"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


@lru_cache
def get_fernet() -> Fernet:
    """Get Fernet instance using encryption key from settings"""
    settings = get_settings()
    return Fernet(settings.encryption_key)


class User(Base):
    __tablename__: str = "user"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(
        String(320), index=True, unique=True, nullable=False
    )
    username: Mapped[str] = mapped_column(
        String(50), index=True, unique=True, nullable=False
    )
    name: Mapped[str | None] = mapped_column(String(256), index=True, nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    has_avatar: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(
        SQLAEnum("active", "deleted", name="team_status"),
        nullable=False,
        default="active",
    )
    created_at: Mapped[datetime] = mapped_column(
        index=True, nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        index=True, nullable=False, default=utc_now, onupdate=utc_now
    )
    tokens_invalid_before: Mapped[datetime | None] = mapped_column(nullable=True)
    default_team_id: Mapped[str] = mapped_column(ForeignKey("team.id"), nullable=True)

    # Relationships
    default_team: Mapped["Team"] = relationship(foreign_keys=[default_team_id])
    identities: Mapped[list["UserIdentity"]] = relationship(back_populates="user")

    @override
    def __repr__(self):
        return f"<User {self.email}>"


class UserIdentity(Base):
    __tablename__: str = "user_identity"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), index=True)
    provider: Mapped[str] = mapped_column(
        SQLAEnum("github", "google", name="identity_provider"),
        nullable=False,
        index=True,
    )
    provider_user_id: Mapped[str | None] = mapped_column(
        String(100), nullable=True, index=True
    )
    _access_token: Mapped[str | None] = mapped_column(
        "access_token", String(2048), nullable=True
    )
    _refresh_token: Mapped[str | None] = mapped_column(
        "refresh_token", String(2048), nullable=True
    )
    token_expires_at: Mapped[datetime | None] = mapped_column(nullable=True)
    password_hash: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )  # Only for password provider
    provider_metadata: Mapped[dict | None] = mapped_column(
        JSON, nullable=True
    )  # Store provider-specific data
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)

    # Relationships
    user: Mapped[User] = relationship(back_populates="identities")

    __table_args__ = (
        UniqueConstraint(
            "provider", "provider_user_id", name="uq_identity_provider_user"
        ),
    )

    @property
    def access_token(self) -> str | None:
        if self._access_token:
            fernet = get_fernet()
            return fernet.decrypt(self._access_token.encode()).decode()
        return None

    @access_token.setter
    def access_token(self, value: str | None):
        if value:
            fernet = get_fernet()
            self._access_token = fernet.encrypt(value.encode()).decode()
        else:
            self._access_token = None

    @property
    def refresh_token(self) -> str | None:
        if self._refresh_token:
            fernet = get_fernet()
            return fernet.decrypt(self._refresh_token.encode()).decode()
        return None

    @refresh_token.setter
    def refresh_token(self, value: str | None):
        if value:
            fernet = get_fernet()
            self._refresh_token = fernet.encrypt(value.encode()).decode()
        else:
            self._refresh_token = None

    @override
    def __repr__(self):
        return f"<UserIdentity {self.provider}:{self.provider_user_id}>"


class Team(Base):
    __tablename__: str = "team"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: token_hex(16)
    )
    name: Mapped[str] = mapped_column(String(100), index=True)
    slug: Mapped[str] = mapped_column(String(40), nullable=True, unique=True)
    has_avatar: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(
        SQLAEnum("active", "deleted", name="team_status"),
        nullable=False,
        default="active",
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", use_alter=True, ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        index=True, nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        index=True, nullable=False, default=utc_now, onupdate=utc_now
    )

    # Relationships
    projects: Mapped[list["Project"]] = relationship(back_populates="team")
    created_by_user: Mapped[User | None] = relationship(
        foreign_keys=[created_by_user_id]
    )

    @property
    def color(self) -> str:
        return get_color(self.id)


@event.listens_for(Team, "after_insert")
def set_team_slug(mapper, connection, team):
    """Generate and set slug after team is inserted (and has an ID)."""
    if not team.slug:
        base_slug = team.name.lower()
        base_slug = base_slug.replace(" ", "-").replace("_", "-").replace(".", "-")
        base_slug = re.sub(r"[^a-z0-9-]", "", base_slug)
        base_slug = re.sub(r"-+", "-", base_slug)
        base_slug = base_slug[:40].strip("-")
        if not base_slug or base_slug in FORBIDDEN_TEAM_SLUGS:
            base_slug = f"team-{team.id}"[:40]

        new_slug = (
            base_slug
            if not connection.scalar(
                select(Team.slug).where(func.lower(Team.slug) == base_slug.lower())
            )
            else f"{base_slug[:32]}-{str(team.id)[:7]}"
        )

        connection.execute(update(Team).where(Team.id == team.id).values(slug=new_slug))
        team.slug = new_slug


class TeamMember(Base):
    __tablename__ = "team_member"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("team.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), index=True)
    role: Mapped[str] = mapped_column(
        SQLAEnum("owner", "admin", "member", name="team_member_role"),
        nullable=False,
        default="member",
    )
    created_at: Mapped[datetime] = mapped_column(default=utc_now)

    # Relationships
    team: Mapped[Team] = relationship()
    user: Mapped[User] = relationship()


class TeamInvite(Base):
    __tablename__ = "team_invite"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: token_hex(16)
    )
    team_id: Mapped[str] = mapped_column(ForeignKey("team.id"), index=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    role: Mapped[str] = mapped_column(
        SQLAEnum("owner", "admin", "member", name="team_invite_role"),
        nullable=False,
        default="member",
    )
    status: Mapped[str] = mapped_column(
        SQLAEnum("pending", "accepted", "revoked", name="team_invite_status"),
        nullable=False,
        default="pending",
    )
    inviter_id: Mapped[int] = mapped_column(ForeignKey("user.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(
        default=lambda: utc_now() + timedelta(days=30)
    )

    # Relationships
    team: Mapped[Team] = relationship()
    inviter: Mapped[User] = relationship()


class GithubInstallation(Base):
    __tablename__: str = "github_installation"

    installation_id: Mapped[int] = mapped_column(primary_key=True)
    _token: Mapped[str | None] = mapped_column("token", String(2048), nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(
        SQLAEnum("active", "deleted", "suspended", name="github_installation_status"),
        nullable=False,
        default="active",
    )

    # Relationships
    projects: Mapped[list["Project"]] = relationship(
        back_populates="github_installation"
    )

    @property
    def token(self) -> str | None:
        if self._token is None:
            return None
        fernet = get_fernet()
        return fernet.decrypt(self._token.encode()).decode()

    @token.setter
    def token(self, value: str):
        if not value:
            self._token = None
        else:
            fernet = get_fernet()
            self._token = fernet.encrypt(value.encode()).decode()

    @override
    def __repr__(self):
        return f"<GithubInstallation {self.installation_id}>"


class Project(Base):
    __tablename__: str = "project"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: token_hex(16)
    )
    name: Mapped[str] = mapped_column(String(100), index=True)
    has_avatar: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    repo_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    repo_full_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    repo_status: Mapped[str] = mapped_column(
        SQLAEnum(
            "active", "deleted", "removed", "transferred", name="project_github_status"
        ),
        nullable=False,
        default="active",
    )
    github_installation_id: Mapped[int] = mapped_column(
        ForeignKey("github_installation.installation_id"), nullable=False, index=True
    )
    environments: Mapped[list[dict[str, str]]] = mapped_column(
        JSON, nullable=False, default=list
    )
    _env_vars: Mapped[str] = mapped_column("env_vars", Text, nullable=False, default="")
    slug: Mapped[str] = mapped_column(String(40), nullable=True, unique=True)
    config: Mapped[dict[str, object]] = mapped_column(
        JSON, nullable=False, default=dict
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", use_alter=True, ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        index=True, nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        index=True, nullable=False, default=utc_now, onupdate=utc_now
    )
    status: Mapped[str] = mapped_column(
        SQLAEnum("active", "paused", "deleted", name="project_status"),
        nullable=False,
        default="active",
    )
    team_id: Mapped[str] = mapped_column(ForeignKey("team.id"), index=True)

    # Relationships
    github_installation: Mapped[GithubInstallation] = relationship(
        back_populates="projects"
    )
    deployments: Mapped[list["Deployment"]] = relationship(back_populates="project")
    team: Mapped[Team] = relationship(back_populates="projects")
    created_by_user: Mapped[User | None] = relationship(
        foreign_keys=[created_by_user_id]
    )
    domains: Mapped[list["Domain"]] = relationship(back_populates="project")

    __table_args__ = (UniqueConstraint("team_id", "name", name="uq_project_team_name"),)

    @property
    def env_vars(self) -> list[dict[str, str]]:
        if self._env_vars:
            fernet = get_fernet()
            decrypted = fernet.decrypt(self._env_vars.encode()).decode()
            return json.loads(decrypted)
        return []

    @env_vars.setter
    def env_vars(self, value: list[dict[str, str]]):
        json_str = json.dumps(value or [])
        fernet = get_fernet()
        self._env_vars = fernet.encrypt(json_str.encode()).decode()

    @property
    def hostname(self) -> str:
        settings = get_settings()
        return f"{self.slug}.{settings.deploy_domain}"

    @property
    def url(self) -> str:
        settings = get_settings()
        return f"{settings.url_scheme}://{self.hostname}"

    @property
    def color(self) -> str:
        return get_color(self.id)

    @override
    def __repr__(self):
        return f"<Project {self.name}>"

    def get_env_vars(self, environment: str) -> list[dict[str, str]]:
        """Flattened env vars for a specific environment."""
        env_vars = [var for var in self.env_vars if not var.get("environment")]
        for var in self.env_vars:
            if var.get("environment") == environment:
                env_vars = [v for v in env_vars if v["key"] != var["key"]]
                env_vars.append(var)
        return env_vars

    def has_active_environment_with_slug(
        self, slug: str, exclude_id: str | None = None
    ) -> bool:
        """Check if an active environment with given slug exists"""
        return any(
            environment
            for environment in self.active_environments
            if environment.get("slug") == slug
            and (exclude_id is None or environment.get("id") != exclude_id)
        )

    def create_environment(self, name: str, slug: str, **kwargs) -> dict:
        """Create a new environment with a unique ID"""
        if self.has_active_environment_with_slug(slug):
            raise ValueError(f"An active environment with slug '{slug}' already exists")

        env = {
            "id": token_hex(4),
            "name": name,
            "slug": slug,
            "status": "active",
            **kwargs,
        }
        environments = self.environments.copy()
        environments.append(env)
        self.environments = environments
        return env

    def update_environment(self, environment_id: str, values: dict) -> dict | None:
        """Update environment"""
        env = self.get_environment_by_id(environment_id)
        if not env:
            return None

        # Prevent production rename
        if environment_id == "prod" and (
            env.get("name") != values.get("name")
            or env.get("slug") != values.get("slug")
        ):
            raise ValueError("Cannot modify production environment")

        # If changing slug, check it's unique
        new_slug = values.get("slug")
        if (
            new_slug
            and new_slug != env.get("slug")
            and self.has_active_environment_with_slug(
                new_slug, exclude_id=environment_id
            )
        ):
            raise ValueError(
                f"An active environment with slug '{new_slug}' already exists"
            )

        # Update the environment
        env_index = next(
            i for i, e in enumerate(self.environments) if e["id"] == environment_id
        )
        old_slug = self.environments[env_index]["slug"]

        environments = self.environments.copy()
        environments[env_index] = {**environments[env_index], **values}
        self.environments = environments

        # Update env vars if slug changed
        if new_slug and new_slug != old_slug:
            env_vars = self.env_vars.copy()
            for var in env_vars:
                if var.get("environment") == old_slug:
                    var["environment"] = new_slug
            self.env_vars = env_vars

        return environments[env_index]

    def delete_environment(self, environment_id: str | None) -> bool:
        """Soft delete environment"""
        if not environment_id:
            return False

        if environment_id == "prod":
            raise ValueError("Cannot delete production environment")

        env = self.get_environment_by_id(environment_id)
        if not env:
            return False

        # Remove env vars for this environment
        env_vars = self.env_vars.copy()
        env_vars = [var for var in env_vars if var.get("environment") != env["slug"]]
        self.env_vars = env_vars

        # Mark environment as deleted
        env_index = next(
            i for i, e in enumerate(self.environments) if e["id"] == environment_id
        )
        environments = self.environments.copy()
        environments[env_index] = {**environments[env_index], "status": "deleted"}
        self.environments = environments
        return True

    @property
    def active_environments(self) -> list[dict]:
        """Get only active environments"""
        return [env for env in self.environments if env.get("status") == "active"]

    def get_environment_by_id(self, env_id: str) -> dict | None:
        """Get environment by ID"""
        return next((env for env in self.environments if env["id"] == env_id), None)

    def get_environment_by_slug(
        self, slug: str, active_only: bool = True
    ) -> dict | None:
        """Get environment by slug"""
        environments = self.active_environments if active_only else self.environments
        return next((env for env in environments if env["slug"] == slug), None)

    async def get_domain_by_id(self, db: AsyncSession, domain_id: int) -> dict | None:
        """Get domain by ID"""
        result = await db.execute(
            select(Domain).where(
                Domain.id == domain_id,
                Domain.project_id == self.id,
            )
        )
        return result.scalar_one_or_none()

    async def get_domain_by_hostname(
        self, db: AsyncSession, hostname: str
    ) -> dict | None:
        """Get domain by hostname"""
        result = await db.execute(
            select(Domain).where(
                Domain.hostname == hostname,
                Domain.project_id == self.id,
            )
        )
        return result.scalar_one_or_none()

    async def get_environment_aliases(self, db: AsyncSession) -> dict[str, "Alias"]:
        """Get environment aliases for this project"""
        result = await db.execute(
            select(Alias)
            .join(Deployment, Alias.deployment_id == Deployment.id)
            .where(Deployment.project_id == self.id, Alias.type == "environment")
        )
        aliases = result.scalars().all()
        return {alias.value: alias for alias in aliases}

    def get_environment_hostname(self, environment_slug: str) -> str:
        """Get environment hostname"""
        settings = get_settings()
        if environment_slug == "production":
            return self.hostname
        return f"{self.slug}-env-{environment_slug}.{settings.deploy_domain}"

    def get_environment_url(self, environment_slug: str) -> str:
        """Get environment URL"""
        settings = get_settings()
        return (
            f"{settings.url_scheme}://{self.get_environment_hostname(environment_slug)}"
        )

    def get_branch_hostname(self, branch: str) -> str:
        """Get branch hostname"""
        settings = get_settings()
        return f"{self.slug}-branch-{branch}.{settings.deploy_domain}"

    def get_branch_url(self, branch: str) -> str:
        """Get branch URL"""
        settings = get_settings()
        return f"{settings.url_scheme}://{self.get_branch_hostname(branch)}"


@event.listens_for(Project, "after_insert")
def set_project_slug(mapper, connection, project):
    """Generate and set slug after project is inserted (and has an ID)."""
    if not project.slug:
        team_slug = connection.scalar(
            select(Team.slug).where(Team.id == project.team_id)
        )
        base_slug = f"{project.name}-{team_slug}".lower()
        base_slug = base_slug.replace(" ", "-").replace("_", "-").replace(".", "-")
        base_slug = re.sub(r"[^a-z0-9-]", "", base_slug)
        base_slug = re.sub(r"-+", "-", base_slug)
        base_slug = base_slug[:40].strip("-")
        if not base_slug:
            base_slug = f"project-{project.id}"[:40]

        new_slug = (
            base_slug
            if not connection.scalar(
                select(Project.slug).where(Project.slug == base_slug)
            )
            else f"{base_slug[:32]}-{str(project.id)[:7]}"
        )

        connection.execute(
            update(Project).where(Project.id == project.id).values(slug=new_slug)
        )
        project.slug = new_slug


class Deployment(Base):
    __tablename__: str = "deployment"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: token_hex(16)
    )
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id"), index=True)
    repo_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    repo_full_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    environment_id: Mapped[str] = mapped_column(String(8), nullable=False)
    branch: Mapped[str] = mapped_column(String(255), index=True)
    commit_sha: Mapped[str] = mapped_column(String(40), index=True)
    commit_meta: Mapped[dict[str, object]] = mapped_column(
        JSON, nullable=False, default=dict
    )
    config: Mapped[dict[str, object]] = mapped_column(
        JSON, nullable=False, default=dict
    )
    _env_vars: Mapped[str] = mapped_column("env_vars", Text, nullable=False, default="")
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    container_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    container_status: Mapped[str | None] = mapped_column(
        SQLAEnum("running", "stopped", "removed", name="deployment_container_status"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        SQLAEnum("queued", "in_progress", "completed", name="deployment_status"),
        nullable=False,
        default="queued",
    )
    conclusion: Mapped[str] = mapped_column(
        SQLAEnum(
            "succeeded", "failed", "canceled", "skipped", name="deployment_conclusion"
        ),
        nullable=True,
    )
    trigger: Mapped[str] = mapped_column(
        SQLAEnum("webhook", "user", "api", name="deployment_trigger"),
        nullable=False,
        default="user",
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", use_alter=True, ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        index=True, nullable=False, default=utc_now
    )
    concluded_at: Mapped[datetime | None] = mapped_column(index=True, nullable=True)

    # Relationships
    project: Mapped[Project] = relationship(back_populates="deployments")
    aliases: Mapped[list["Alias"]] = relationship(
        back_populates="deployment", foreign_keys="Alias.deployment_id"
    )
    created_by_user: Mapped[User | None] = relationship(
        foreign_keys=[created_by_user_id]
    )

    def __init__(self, *args, project: "Project", environment_id: str, **kwargs):
        super().__init__(project=project, environment_id=environment_id, **kwargs)
        # Snapshot repo, config, environments and env_vars from project at time of creation
        self.repo_id = project.repo_id
        self.repo_full_name = project.repo_full_name
        self.config = project.config
        environment = project.get_environment_by_id(environment_id)
        self.env_vars = project.get_env_vars(environment["slug"]) if environment else []

    @property
    def environment(self) -> dict | None:
        """Get environment configuration"""
        return self.project.get_environment_by_id(self.environment_id)

    @property
    def env_vars(self) -> list[dict[str, str]]:
        if self._env_vars:
            fernet = get_fernet()
            decrypted = fernet.decrypt(self._env_vars.encode()).decode()
            return json.loads(decrypted)
        return []

    @env_vars.setter
    def env_vars(self, value: list[dict[str, str]] | None):
        json_str = json.dumps(value or [])
        fernet = get_fernet()
        self._env_vars = fernet.encrypt(json_str.encode()).decode()

    @property
    def slug(self) -> str:
        return f"{self.project.slug}-id-{self.id[:7]}"

    @property
    def hostname(self) -> str:
        settings = get_settings()
        return f"{self.slug}.{settings.deploy_domain}"

    @property
    def url(self) -> str:
        settings = get_settings()
        return f"{settings.url_scheme}://{self.hostname}"

    def __repr__(self):
        return f"<Deployment {self.id}>"

    def parse_logs(self):
        """Parse raw build logs into structured format."""
        if not self.build_logs:
            return []

        return [parse_log(log) for log in self.build_logs.splitlines()]

    @property
    def parsed_logs(self):
        return self.parse_logs()


class Alias(Base):
    __tablename__: str = "alias"

    id: Mapped[int] = mapped_column(primary_key=True)
    subdomain: Mapped[str] = mapped_column(String(63), nullable=False, unique=True)
    deployment_id: Mapped[str] = mapped_column(ForeignKey("deployment.id"), index=True)
    previous_deployment_id: Mapped[str | None] = mapped_column(
        ForeignKey("deployment.id"), index=True, nullable=True
    )
    type: Mapped[str] = mapped_column(
        SQLAEnum("branch", "environment", "environment_id", name="alias_type"),
        nullable=False,
    )
    value: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        index=True, nullable=False, default=utc_now, onupdate=utc_now
    )

    # Relationships
    deployment: Mapped[Deployment] = relationship(
        foreign_keys=[deployment_id], back_populates="aliases"
    )
    previous_deployment: Mapped[Deployment] = relationship(
        foreign_keys=[previous_deployment_id]
    )

    @property
    def hostname(self) -> str:
        settings = get_settings()
        return f"{self.subdomain}.{settings.deploy_domain}"

    @property
    def url(self) -> str:
        settings = get_settings()
        return f"{settings.url_scheme}://{self.hostname}"

    @classmethod
    async def update_or_create(
        cls,
        db: AsyncSession,
        subdomain: str,
        deployment_id: str,
        type: str,
        value: str | None = None,
        environment_id: str | None = None,
    ) -> dict[str, object]:
        """Update or create alias"""
        result_query = await db.execute(select(cls).where(cls.subdomain == subdomain))
        alias = result_query.scalar_one_or_none()

        result = {}
        result["alias"] = None

        if alias:
            if alias.deployment_id == deployment_id:
                result["alias"] = alias
                return result

            if type == "environment" and environment_id == "prod":
                alias.previous_deployment_id = alias.deployment_id
            else:
                alias.previous_deployment_id = None
            alias.deployment_id = deployment_id
        else:
            alias = cls(
                subdomain=subdomain,
                deployment_id=deployment_id,
                type=type,
                value=value,
            )
            db.add(alias)

        result["alias"] = alias
        return result

    @override
    def __repr__(self):
        return f"<Alias {self.subdomain}>"


class Domain(Base):
    __tablename__: str = "domain"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id"), index=True)
    hostname: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    type: Mapped[str] = mapped_column(
        SQLAEnum("route", "301", "302", "307", "308", name="domain_type"),
        nullable=False,
    )
    environment_id: Mapped[str | None] = mapped_column(String(8), nullable=True)
    status: Mapped[str] = mapped_column(
        SQLAEnum("pending", "active", "disabled", "failed", name="domain_status"),
        nullable=False,
        default="pending",
    )
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)

    # Relationships
    project: Mapped[Project] = relationship(back_populates="domains")

    @override
    def __repr__(self):
        return f"<Domain {self.hostname}>"


class Allowlist(Base):
    __tablename__: str = "allowlist"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(
        SQLAEnum("email", "domain", "pattern", name="allowlist_type"),
        nullable=False,
        index=True,
    )
    value: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        index=True, nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        index=True, nullable=False, default=utc_now, onupdate=utc_now
    )

    @override
    def __repr__(self):
        return f"<Allowlist {self.type}:{self.value}>"
