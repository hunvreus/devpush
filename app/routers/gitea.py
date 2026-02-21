import logging
import hmac
import hashlib
from fastapi import APIRouter, Request, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from redis.asyncio import Redis
from arq.connections import ArqRedis

from dependencies import (
    get_current_user,
    TemplateResponse,
    flash,
    get_db,
    get_translation as _,
    get_redis_client,
    get_queue,
)
from models import User, GiteaConnection, Project
from services.gitea import GiteaService
from services.deployment import DeploymentService
from config import get_settings, Settings

router = APIRouter(prefix="/api/gitea")

logger = logging.getLogger(__name__)


@router.get("/repo-select", name="gitea_repo_select")
async def gitea_repo_select(
    request: Request,
    connection_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(GiteaConnection)
        .where(GiteaConnection.user_id == current_user.id)
        .order_by(GiteaConnection.created_at.desc())
    )
    connections = result.scalars().all()

    selected_connection = None
    if connections:
        if connection_id:
            selected_connection = next(
                (c for c in connections if c.id == connection_id), connections[0]
            )
        else:
            selected_connection = connections[0]

    repos: list[dict] = []
    base_url = ""
    if selected_connection:
        try:
            svc = GiteaService(selected_connection.base_url, selected_connection.token)
            repos = await svc.list_repos()
            base_url = selected_connection.base_url
        except Exception:
            logger.exception("Error fetching repositories from Gitea")
            flash(request, _("Error fetching repositories from Gitea."), "error")

    return TemplateResponse(
        request=request,
        name="gitea/partials/_repo-select.html",
        context={
            "current_user": current_user,
            "connections": connections,
            "selected_connection": selected_connection,
            "connection_id": selected_connection.id if selected_connection else None,
            "repos": repos,
            "base_url": base_url,
        },
    )


@router.get("/repo-list", name="gitea_repo_list")
async def gitea_repo_list(
    request: Request,
    connection_id: str | None = None,
    query: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repos: list[dict] = []
    base_url = ""

    try:
        conn_id = int(connection_id) if connection_id else None
    except (ValueError, TypeError):
        conn_id = None

    if not conn_id:
        return TemplateResponse(
            request=request,
            name="gitea/partials/_repo-select-list.html",
            context={"repos": repos, "connection_id": conn_id, "base_url": base_url},
        )

    try:
        conn = await db.scalar(
            select(GiteaConnection).where(
                GiteaConnection.id == conn_id,
                GiteaConnection.user_id == current_user.id,
            )
        )
        if not conn:
            return TemplateResponse(
                request=request,
                name="gitea/partials/_repo-select-list.html",
                context={"repos": repos, "connection_id": conn_id, "base_url": base_url},
            )

        svc = GiteaService(conn.base_url, conn.token)
        repos = await svc.list_repos(query=query)
        base_url = conn.base_url

    except Exception:
        logger.exception("Error fetching repositories from Gitea")
        flash(request, _("Error fetching repositories from Gitea."), "error")

    return TemplateResponse(
        request=request,
        name="gitea/partials/_repo-select-list.html",
        context={"repos": repos, "connection_id": conn_id, "base_url": base_url},
    )


async def _verify_gitea_webhook(
    request: Request, settings: Settings = Depends(get_settings)
) -> tuple[dict, str]:
    signature = request.headers.get("X-Gitea-Signature")
    event = request.headers.get("X-Gitea-Event")

    if not signature:
        raise HTTPException(status_code=401, detail="Missing signature")
    if not event:
        raise HTTPException(status_code=400, detail="Missing event type")
    if not settings.gitea_webhook_secret:
        raise HTTPException(status_code=500, detail="Gitea webhook secret not configured")

    payload = await request.body()
    expected = hmac.new(
        settings.gitea_webhook_secret.encode(), msg=payload, digestmod=hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="Invalid signature")

    data = await request.json()
    return data, event


@router.post("/webhook", name="gitea_webhook")
async def gitea_webhook(
    request: Request,
    webhook_data: tuple[dict, str] = Depends(_verify_gitea_webhook),
    db: AsyncSession = Depends(get_db),
    redis_client: Redis = Depends(get_redis_client),
    queue: ArqRedis = Depends(get_queue),
):
    try:
        data, event = webhook_data

        logger.info(f"Received Gitea webhook event: {event}")

        if event == "push":
            repo = data.get("repository", {})
            repo_id = repo.get("id")
            html_url = repo.get("html_url", "")
            base_url = html_url.rsplit("/", 2)[0] if "/" in html_url else html_url

            result = await db.execute(
                select(Project).where(
                    Project.repo_id == repo_id,
                    Project.repo_provider == "gitea",
                    Project.repo_base_url == base_url,
                    Project.status == "active",
                )
            )
            projects = result.scalars().all()

            if not projects:
                logger.info(f"No Gitea projects found for repo {repo_id}")
                return Response(status_code=200)

            ref = data.get("ref", "")
            branch = ref.replace("refs/heads/", "")
            head_commit = data.get("commits", [{}])[-1] if data.get("commits") else {}
            pusher = data.get("pusher", {})

            commit_data = {
                "sha": data.get("after", ""),
                "author": {"login": pusher.get("login", pusher.get("username", ""))},
                "commit": {
                    "message": head_commit.get("message", ""),
                    "author": {"date": head_commit.get("timestamp", "")},
                },
            }

            deployment_service = DeploymentService()

            for project in projects:
                try:
                    deployment = await deployment_service.create(
                        project=project,
                        branch=branch,
                        commit=commit_data,
                        db=db,
                        redis_client=redis_client,
                        trigger="webhook",
                    )
                    job = await queue.enqueue_job("start_deployment", deployment.id)
                    deployment.job_id = job.job_id
                    await db.commit()

                    logger.info(
                        f"Deployment {deployment.id} created for Gitea commit {commit_data['sha']} on project {project.name}"
                    )
                except Exception as e:
                    logger.error(
                        f"Failed to create deployment for project {project.name}: {e}",
                        exc_info=True,
                    )
                    continue

        return Response(status_code=200)

    except Exception as e:
        logger.error(f"Error processing Gitea webhook: {e}", exc_info=True)
        await db.rollback()
        return Response(status_code=500)
