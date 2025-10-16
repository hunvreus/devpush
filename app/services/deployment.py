import os
import yaml
import logging
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from redis.asyncio import Redis
from arq.connections import ArqRedis
from arq.jobs import Job

from models import Deployment, Alias, Project, User, Domain
from utils.environment import get_environment_for_branch
from config import Settings

logger = logging.getLogger(__name__)


class DeploymentService:
    def __init__(self):
        pass

    async def update_traefik_config(
        self,
        project: Project,
        db: AsyncSession,
        settings: Settings,
    ) -> None:
        """Update Traefik config for a project including domains."""
        path = os.path.join(settings.traefik_config_dir, f"project_{project.id}.yml")

        # Get aliases
        result = await db.execute(
            select(Alias)
            .join(Deployment, Alias.deployment_id == Deployment.id)
            .filter(
                Deployment.project_id == project.id,
                Deployment.conclusion == "succeeded",
            )
        )
        aliases = result.scalars().all()

        # Get active domains
        domains_result = await db.execute(
            select(Domain).where(
                Domain.project_id == project.id, Domain.status == "active"
            )
        )
        domains = domains_result.scalars().all()

        # Remove config if no aliases or domains
        if not aliases and not domains and os.path.exists(path):
            os.remove(path)
            return

        routers = {}
        services = {}
        middlewares = {}

        # Aliases
        for a in aliases:
            router_config = {
                "rule": f"Host(`{a.subdomain}.{settings.deploy_domain}`)",
                "service": f"deployment-{a.deployment_id}@docker",
                "entryPoints": ["web", "websecure"]
                if settings.url_scheme == "https"
                else ["web"],
            }
            if settings.url_scheme == "https":
                router_config["tls"] = {"certResolver": "le"}
            routers[f"router-alias-{a.id}"] = router_config

        # Domains
        for domain in domains:
            env_alias = next(
                (
                    a
                    for a in aliases
                    if a.type == "environment_id" and a.value == domain.environment_id
                ),
                None,
            )

            if not env_alias:
                continue

            if domain.type == "route":
                router_config = {
                    "rule": f"Host(`{domain.hostname}`)",
                    "service": f"deployment-{env_alias.deployment_id}@docker",
                    "entryPoints": ["web", "websecure"]
                    if settings.url_scheme == "https"
                    else ["web"],
                }
                if settings.url_scheme == "https":
                    router_config["tls"] = {"certResolver": "le"}
                routers[f"router-domain-{domain.id}"] = router_config

            elif domain.type in ["301", "302", "307", "308"]:
                middleware_name = f"redirect-{domain.id}"

                router_cfg = {
                    "rule": f"Host(`{domain.hostname}`)",
                    "service": "noop@internal",
                    "middlewares": [middleware_name],
                    "entryPoints": ["web", "websecure"]
                    if settings.url_scheme == "https"
                    else ["web"],
                }
                routers[f"router-redirect-{domain.id}"] = router_cfg

                middlewares[middleware_name] = {
                    "redirectRegex": {
                        "regex": f"^https?://{domain.hostname}/(.*)",
                        "replacement": f"https://{env_alias.subdomain}.{settings.deploy_domain}/$1",
                        "permanent": domain.type in ["301", "308"],
                    }
                }

        # Write config
        os.makedirs(settings.traefik_config_dir, exist_ok=True)
        config = {"http": {"routers": routers}}
        if services:
            config["http"]["services"] = services
        if middlewares:
            config["http"]["middlewares"] = middlewares

        with open(path, "w") as f:
            yaml.dump(config, f, sort_keys=False, indent=2)

    async def create(
        self,
        project: Project,
        branch: str,
        commit: dict,
        db: AsyncSession,
        redis_client: Redis,
        job_queue: ArqRedis,
        trigger: str = "user",
        current_user: User | None = None,
    ) -> Deployment:
        """Create a new deployment."""

        environment = get_environment_for_branch(branch, project.active_environments)
        if not environment:
            raise ValueError("No environment found for this branch.")

        deployment = Deployment(
            project=project,
            environment_id=environment.get("id", ""),
            branch=branch,
            commit_sha=commit["sha"],
            commit_meta={
                "author": commit["author"]["login"],
                "message": commit["commit"]["message"],
                "date": datetime.fromisoformat(
                    commit["commit"]["author"]["date"].replace("Z", "+00:00")
                ).isoformat(),
            },
            trigger=trigger,
            created_by_user_id=current_user.id
            if trigger == "user" and current_user
            else None,
        )
        db.add(deployment)
        await db.commit()

        job = await job_queue.enqueue_job("deploy_start", deployment.id)
        deployment.job_id = job.job_id
        await db.commit()

        await redis_client.xadd(
            f"stream:project:{project.id}:updates",
            fields={
                "event_type": "deployment_creation",
                "project_id": project.id,
                "deployment_id": deployment.id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

        logger.info(
            f"Deployment {deployment.id} created and queued for "
            f"project {project.name} ({project.id}) to environment {environment.get('name')} ({environment.get('id')})"
        )

        return deployment

    async def cancel(
        self,
        project: Project,
        deployment: Deployment,
        job_queue: ArqRedis,
        redis_client: Redis,
        db: AsyncSession,
    ) -> Alias:
        """Cancel a deployment."""
        logger.info(
            f"Attempting to cancel deployment {deployment.id} with job_id: {deployment.job_id}"
        )

        if not deployment.job_id:
            logger.warning(f"Deployment {deployment.id} has no job_id to cancel")

        job = Job(job_id=deployment.job_id, redis=job_queue)

        # Check if job exists and get its status
        try:
            job_info = await job.info()
            logger.info(f"Job info for deployment {deployment.id}: {job_info}")
        except Exception as e:
            logger.error(f"Error getting job info for deployment {deployment.id}: {e}")

        abort_result = await job.abort()
        logger.info(f"Abort result for deployment {deployment.id}: {abort_result}")

        if abort_result:
            deployment.status = "completed"
            deployment.conclusion = "canceled"
            await db.commit()

            logger.info(f"Deployment {deployment.id} canceled.")

            fields = {
                "event_type": "deployment_status_update",
                "project_id": project.id,
                "deployment_id": deployment.id,
                "deployment_status": "canceled",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            await redis_client.xadd(
                f"stream:project:{project.id}:deployment:{deployment.id}:status",
                fields,
            )
            await redis_client.xadd(f"stream:project:{project.id}:updates", fields)
        else:
            logger.error(f"Error aborting deployment {deployment.id}.")
            raise Exception("Error aborting deployment.")

        return deployment

    async def rollback(
        self,
        environment: dict,
        project: Project,
        db: AsyncSession,
        redis_client: Redis,
        settings: Settings,
    ) -> Alias:
        """Rollback an environment to its previous deployment."""
        subdomain = (
            project.slug
            if environment["id"] == "prod"
            else f"{project.slug}-env-{environment['slug']}"
        )

        alias = (
            await db.execute(select(Alias).where(Alias.subdomain == subdomain))
        ).scalar_one_or_none()

        if not alias or not alias.previous_deployment_id:
            raise ValueError("No previous deployment to roll back to.")

        alias.deployment_id, alias.previous_deployment_id = (
            alias.previous_deployment_id,
            alias.deployment_id,
        )
        await db.commit()

        await self.update_traefik_config(project, db, settings)

        await redis_client.xadd(
            f"stream:project:{project.id}:updates",
            fields={
                "event_type": "deployment_rollback",
                "environment_id": environment["id"],
                "deployment_id": alias.deployment_id,
                "previous_deployment_id": alias.previous_deployment_id or "",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

        return alias

    # async def promote(
    #     self,
    #     environment: dict,
    #     deployment: Deployment,
    #     project: Project,
    #     db: AsyncSession,
    #     redis_client: Redis,
    #     settings: Settings,
    # ) -> Alias:
    #     """Promote a deployment as current for an environment."""
    #     subdomain = (
    #         project.slug
    #         if environment["id"] == "prod"
    #         else f"{project.slug}-env-{environment['slug']}"
    #     )

    #     alias = (
    #         await db.execute(select(Alias).where(Alias.subdomain == subdomain))
    #     ).scalar_one_or_none()

    #     if not alias:
    #         raise ValueError("No alias found for this environment.")

    #     alias.deployment_id, alias.previous_deployment_id = (
    #         deployment.id,
    #         alias.deployment_id,
    #     )
    #     await db.commit()

    #     await self.update_traefik_config(project, db, settings)

    #     await redis_client.xadd(
    #         f"stream:project:{project.id}:updates",
    #         fields={
    #             "event_type": "deployment_promotion",
    #             "environment_id": environment["id"],
    #             "deployment_id": alias.deployment_id,
    #             "previous_deployment_id": alias.previous_deployment_id or "",
    #             "timestamp": datetime.now(timezone.utc).isoformat(),
    #         },
    #     )

    #     return alias
