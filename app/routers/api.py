"""API router for deploy tokens (inbound deployment webhooks)."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, HTTPException, Header
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from arq.connections import ArqRedis

from db import get_db
from dependencies import get_job_queue
from models import DeployToken, Project, Deployment, utc_now

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["api"])


@router.post("/deploy", name="api_deploy")
async def trigger_deploy(
    request: Request,
    authorization: str | None = Header(None),
    x_deploy_token: str | None = Header(None, alias="X-Deploy-Token"),
    db: AsyncSession = Depends(get_db),
    job_queue: ArqRedis = Depends(get_job_queue),
):
    """Trigger a deployment using a deploy token.

    This endpoint allows external systems to trigger deployments via API.

    Authorization can be provided via:
    - Authorization header: `Bearer dp_xxxxx`
    - X-Deploy-Token header: `dp_xxxxx`

    Optional request body (JSON):
    ```json
    {
        "branch": "main",
        "environment_id": "prod",
        "commit_sha": "abc123..."
    }
    ```

    If branch/commit are not provided, the latest commit from the environment's
    configured branch will be used.
    """
    # Extract token from headers
    raw_token = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization[7:]
    elif x_deploy_token:
        raw_token = x_deploy_token

    if not raw_token:
        raise HTTPException(
            status_code=401,
            detail="Missing deploy token. Provide via Authorization header (Bearer token) or X-Deploy-Token header.",
        )

    if not raw_token.startswith("dp_"):
        raise HTTPException(
            status_code=401,
            detail="Invalid token format. Token should start with 'dp_'.",
        )

    # Hash the token to look it up
    token_hash = DeployToken.hash_token(raw_token)

    # Find the deploy token
    result = await db.execute(
        select(DeployToken)
        .options(selectinload(DeployToken.project))
        .where(
            DeployToken._token == token_hash,
            DeployToken.status == "active",
        )
    )
    deploy_token = result.scalar_one_or_none()

    if not deploy_token:
        raise HTTPException(status_code=401, detail="Invalid or revoked deploy token.")

    project = deploy_token.project
    if not project or project.status != "active":
        raise HTTPException(status_code=404, detail="Project not found or inactive.")

    # Parse request body
    body = {}
    try:
        if await request.body():
            body = await request.json()
    except Exception:
        pass

    # Determine environment
    environment_id = body.get("environment_id") or deploy_token.environment_id
    if not environment_id:
        # Default to production
        environment_id = "prod"

    # Check if token can deploy to this environment
    if not deploy_token.can_deploy_environment(environment_id):
        raise HTTPException(
            status_code=403,
            detail=f"Token not authorized to deploy to environment '{environment_id}'.",
        )

    # Get environment config
    environment = project.get_environment_by_id(environment_id)
    if not environment:
        raise HTTPException(
            status_code=404,
            detail=f"Environment '{environment_id}' not found.",
        )

    # Determine branch
    branch = body.get("branch") or environment.get("branch")
    if not branch:
        raise HTTPException(
            status_code=400,
            detail="No branch specified and environment has no default branch.",
        )

    # Determine commit (optional - if not provided, will fetch latest)
    commit_sha = body.get("commit_sha")

    # Update last used timestamp
    deploy_token.last_used_at = utc_now()
    await db.commit()

    # Create deployment
    deployment = Deployment(
        project=project,
        environment_id=environment_id,
        branch=branch,
        commit_sha=commit_sha or "",  # Will be filled by deploy task if empty
        trigger="api",
    )
    if commit_sha:
        deployment.commit_sha = commit_sha
    else:
        # Need to fetch the latest commit
        from services.github_installation import GithubInstallationService
        from dependencies import get_github_installation_service

        github_service = get_github_installation_service()
        try:
            token = await github_service.get_installation_token(
                db, project.github_installation_id
            )
            if token:
                commit_info = await github_service.get_latest_commit(
                    token, project.repo_full_name, branch
                )
                if commit_info:
                    deployment.commit_sha = commit_info.get("sha", "")
                    deployment.commit_meta = {
                        "message": commit_info.get("commit", {})
                        .get("message", "")
                        .split("\n")[0],
                        "author": commit_info.get("commit", {})
                        .get("author", {})
                        .get("name", ""),
                    }
        except Exception as e:
            logger.warning(f"Failed to fetch commit info: {e}")

    if not deployment.commit_sha:
        raise HTTPException(
            status_code=400,
            detail="Could not determine commit SHA. Please provide commit_sha in request body.",
        )

    db.add(deployment)
    await db.commit()

    # Queue deployment job
    await job_queue.enqueue_job("deploy_start", deployment.id)

    logger.info(
        f"Deployment triggered via API: project={project.name}, "
        f"env={environment_id}, branch={branch}, deployment={deployment.id}"
    )

    return JSONResponse(
        status_code=202,
        content={
            "message": "Deployment queued",
            "deployment": {
                "id": deployment.id,
                "project_id": project.id,
                "project_name": project.name,
                "environment_id": environment_id,
                "environment_name": environment.get("name"),
                "branch": branch,
                "commit_sha": deployment.commit_sha,
                "status": deployment.status,
                "url": f"/api/deployments/{deployment.id}",
            },
        },
    )


@router.get("/deployments/{deployment_id}", name="api_deployment_status")
async def get_deployment_status(
    deployment_id: str,
    authorization: str | None = Header(None),
    x_deploy_token: str | None = Header(None, alias="X-Deploy-Token"),
    db: AsyncSession = Depends(get_db),
):
    """Get deployment status.

    Requires a valid deploy token that has access to the deployment's project.
    """
    # Extract token from headers
    raw_token = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization[7:]
    elif x_deploy_token:
        raw_token = x_deploy_token

    if not raw_token:
        raise HTTPException(status_code=401, detail="Missing deploy token.")

    if not raw_token.startswith("dp_"):
        raise HTTPException(status_code=401, detail="Invalid token format.")

    token_hash = DeployToken.hash_token(raw_token)

    # Find the deploy token
    result = await db.execute(
        select(DeployToken).where(
            DeployToken._token == token_hash,
            DeployToken.status == "active",
        )
    )
    deploy_token = result.scalar_one_or_none()

    if not deploy_token:
        raise HTTPException(status_code=401, detail="Invalid or revoked deploy token.")

    # Get deployment
    result = await db.execute(
        select(Deployment)
        .options(selectinload(Deployment.project))
        .where(Deployment.id == deployment_id)
    )
    deployment = result.scalar_one_or_none()

    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found.")

    # Check token has access to this project
    if deployment.project_id != deploy_token.project_id:
        raise HTTPException(
            status_code=403, detail="Token not authorized for this project."
        )

    environment = deployment.project.get_environment_by_id(deployment.environment_id)

    return {
        "id": deployment.id,
        "project_id": deployment.project_id,
        "project_name": deployment.project.name,
        "environment_id": deployment.environment_id,
        "environment_name": environment.get("name") if environment else None,
        "branch": deployment.branch,
        "commit_sha": deployment.commit_sha,
        "status": deployment.status,
        "conclusion": deployment.conclusion,
        "trigger": deployment.trigger,
        "created_at": deployment.created_at.isoformat()
        if deployment.created_at
        else None,
        "concluded_at": deployment.concluded_at.isoformat()
        if deployment.concluded_at
        else None,
        "url": deployment.url,
    }
