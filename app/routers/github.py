import logging
import hmac
import hashlib
from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from redis.asyncio import Redis
from arq.connections import ArqRedis
import httpx
from datetime import datetime

from dependencies import (
    get_current_user,
    get_github_service,
    get_github_oauth_client,
    TemplateResponse,
    flash,
    get_db,
    get_translation as _,
    get_redis_client,
    get_queue,
)
from models import User, UserIdentity, GithubInstallation, Project
from services.github import GitHubService
from services.deployment import DeploymentService
from utils.user import get_user_github_token, get_user_by_provider
from config import get_settings, Settings

router = APIRouter(prefix="/api/github")

logger = logging.getLogger(__name__)


@router.get("/repo-select", name="github_repo_select")
async def github_repo_select(
    request: Request,
    account: str | None = None,
    current_user: User = Depends(get_current_user),
    github_service: GitHubService = Depends(get_github_service),
    db: AsyncSession = Depends(get_db),
):
    accounts = []
    selected_account = None
    has_github_oauth_token = False

    try:
        github_oauth_token = await get_user_github_token(db, current_user)
        if not github_oauth_token:
            has_github_oauth_token = False
        else:
            has_github_oauth_token = True
            installations = await github_service.get_user_installations(
                github_oauth_token
            )
            accounts = [
                installation["account"]["login"] for installation in installations
            ]
            selected_account = account or (accounts[0] if accounts else None)

    except Exception as e:
        if isinstance(e, httpx.HTTPStatusError) and e.response.status_code in [
            401,
            403,
        ]:
            has_github_oauth_token = False
        else:
            logger.error("Error fetching installations from GitHub", exc_info=True)
            flash(request, _("Error fetching installations from GitHub."), "error")

    return TemplateResponse(
        request=request,
        name="github/partials/_repo-select.html",
        context={
            "current_user": current_user,
            "accounts": accounts,
            "selected_account": selected_account,
            "has_github_oauth_token": has_github_oauth_token,
        },
    )


@router.get("/repo-list", name="github_repo_list")
async def github_repo_list(
    request: Request,
    current_user: User = Depends(get_current_user),
    github: GitHubService = Depends(get_github_service),
    account: str | None = None,
    query: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    repos: list[dict] = []

    try:
        github_oauth_token = await get_user_github_token(db, current_user)
        if not github_oauth_token or not account:
            return TemplateResponse(
                request=request,
                name="github/partials/_repo-select-list.html",
                context={"repos": repos},
            )

        installations = await github.get_user_installations(github_oauth_token)
        installation = next(
            (inst for inst in installations if inst["account"]["login"] == account),
            None,
        )

        if not installation:
            return TemplateResponse(
                request=request,
                name="github/partials/_repo-select-list.html",
                context={"repos": repos},
            )

        selection = installation.get("repository_selection")
        if selection == "selected":
            repos = await github.get_installation_repositories_for_user(
                github_oauth_token, installation["id"]
            )
            if query:
                q_lower = query.lower()
                repos = [
                    repo
                    for repo in repos
                    if q_lower in repo.get("name", "").lower()
                    or q_lower in repo.get("full_name", "").lower()
                ]
        else:
            repos = await github.search_user_repositories(
                github_oauth_token, account, query or ""
            )

        repos = [
            repo for repo in repos if repo.get("permissions", {}).get("push", False)
        ]
        if selection == "selected" and query:
            q_lower = query.lower()

            def sort_key(repo: dict):
                name = (repo.get("name") or "").lower()
                full_name = (repo.get("full_name") or "").lower()
                exact = int(name != q_lower and full_name != q_lower)
                starts = int(
                    not name.startswith(q_lower) and not full_name.startswith(q_lower)
                )
                return (exact, starts, len(name))

            repos = sorted(repos, key=sort_key)
    except Exception:
        logger.exception("Error fetching repositories from GitHub")
        flash(request, _("Error fetching repositories from GitHub."), "error")

    return TemplateResponse(
        request=request,
        name="github/partials/_repo-select-list.html",
        context={"repos": repos},
    )


@router.get("/authorize", name="github_authorize")
async def github_authorize(
    request: Request,
    next: str | None = None,
    current_user: User = Depends(get_current_user),
    oauth_client=Depends(get_github_oauth_client),
):
    """Authorize GitHub OAuth for account linking"""
    if not oauth_client.github:
        flash(request, _("GitHub OAuth not configured."), "error")
        redirect_url = next or request.headers.get("Referer", "/")
        return RedirectResponse(redirect_url, status_code=303)

    redirect_url = next or request.headers.get("Referer", "/")
    request.session["redirect_after_github"] = redirect_url

    return await oauth_client.github.authorize_redirect(
        request, request.url_for("github_authorize_callback")
    )


@router.get("/authorize/callback", name="github_authorize_callback")
async def github_authorize_callback(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    github_service: GitHubService = Depends(get_github_service),
    oauth_client=Depends(get_github_oauth_client),
):
    """Handle GitHub OAuth callback for account linking"""

    redirect_url = request.session.pop("redirect_after_github", "/")

    if not oauth_client.github:
        flash(request, _("GitHub OAuth not configured."), "error")
        return RedirectResponse(redirect_url, status_code=303)

    try:
        token = await oauth_client.github.authorize_access_token(request)
        response = await oauth_client.github.get("user", token=token)
        github_user = response.json()

        existing_user = await get_user_by_provider(db, "github", str(github_user["id"]))
        if existing_user and existing_user.id != current_user.id:
            flash(
                request,
                _("This GitHub account is already linked to another user"),
                "error",
            )
            return RedirectResponse(redirect_url, status_code=303)

        result = await db.execute(
            select(UserIdentity).where(
                UserIdentity.user_id == current_user.id,
                UserIdentity.provider == "github",
            )
        )
        github_identity = result.scalar_one_or_none()

        if github_identity:
            github_identity.access_token = token["access_token"]
            github_identity.provider_metadata = {
                "login": github_user["login"],
                "name": github_user.get("name"),
            }
        else:
            github_identity = UserIdentity(
                user_id=current_user.id,
                provider="github",
                provider_user_id=str(github_user["id"]),
                access_token=token["access_token"],
                provider_metadata={
                    "login": github_user["login"],
                    "name": github_user.get("name"),
                },
            )
            db.add(github_identity)

        await db.commit()
        flash(request, _("GitHub account connected successfully!"), "success")

    except Exception:
        flash(request, _("Error connecting GitHub account."), "error")

    return RedirectResponse(redirect_url, status_code=303)


@router.get("/install", name="github_install")
async def github_install(
    request: Request,
    next: str | None = None,
    settings: Settings = Depends(get_settings),
    current_user: User = Depends(get_current_user),
):
    """Install GitHub App on new organizations"""

    if not settings.github_app_id:
        flash(request, _("GitHub App not configured."), "error")
        redirect_url = next or request.headers.get("Referer", "/")
        return RedirectResponse(redirect_url, status_code=303)

    request.session["redirect_after_install"] = next or request.headers.get(
        "Referer", "/"
    )

    return RedirectResponse(
        f"https://github.com/apps/{settings.github_app_name}/installations/new",
        status_code=303,
    )


@router.get("/install/callback", name="github_install_callback")
async def github_install_callback(
    request: Request,
    installation_id: int,
    setup_action: str,
    current_user: User = Depends(get_current_user),
    github_service: GitHubService = Depends(get_github_service),
    db: AsyncSession = Depends(get_db),
):
    """Handle GitHub App installation callback"""
    redirect_url = request.session.pop("redirect_after_install", "/")

    if setup_action != "install":
        flash(request, _("GitHub App installation was not completed."), "warning")
        return RedirectResponse(redirect_url, status_code=303)

    try:
        # Make sure installation exists
        await github_service.get_installation(str(installation_id))

        result = await db.execute(
            select(GithubInstallation).where(
                GithubInstallation.installation_id == installation_id
            )
        )
        existing_installation = result.scalar_one_or_none()

        if existing_installation:
            existing_installation.status = "active"
            await db.commit()
            flash(
                request, _("GitHub App installation updated successfully!"), "success"
            )
        else:
            github_installation = GithubInstallation(
                installation_id=installation_id, status="active"
            )
            db.add(github_installation)
            await db.commit()
            flash(request, _("GitHub App installed successfully!"), "success")

    except Exception:
        flash(request, _("Error processing GitHub App installation."), "error")

    return RedirectResponse(redirect_url, status_code=303)


@router.get("/manage/authorization", name="github_manage_authorization")
async def github_manage_authorization(
    request: Request,
    next: str | None = None,
    current_user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """Manage authorized GitHub Apps (OAuth connections)"""

    if not settings.github_app_name:
        flash(request, _("GitHub App not configured."), "error")
        redirect_url = next or request.headers.get("Referer", "/")
        return RedirectResponse(redirect_url, status_code=303)

    return RedirectResponse(
        f"https://github.com/settings/connections/applications/{settings.github_app_client_id}",
        status_code=303,
    )


@router.get("/manage/installation", name="github_manage_installation")
async def github_manage_installation(
    request: Request,
    installation_id: int | None = None,
    next: str | None = None,
    settings: Settings = Depends(get_settings),
    current_user: User = Depends(get_current_user),
):
    """Manage installed GitHub Apps"""

    if not settings.github_app_name:
        flash(request, _("GitHub App not configured."), "error")
        redirect_url = next or request.headers.get("Referer", "/")
        return RedirectResponse(redirect_url, status_code=303)

    if installation_id:
        url = f"https://github.com/settings/installations/{installation_id}"
    else:
        url = "https://github.com/settings/installations"

    return RedirectResponse(url, status_code=303)


async def _verify_github_webhook(
    request: Request, settings: Settings = Depends(get_settings)
) -> tuple[dict, str]:
    """Dependency to verify GitHub webhook signature and return parsed JSON data."""

    signature = request.headers.get("X-Hub-Signature-256")
    event = request.headers.get("X-GitHub-Event")

    if not signature:
        raise HTTPException(status_code=401, detail="Missing signature")

    if not event:
        raise HTTPException(status_code=400, detail="Missing event type")

    payload = await request.body()
    secret = settings.github_app_webhook_secret.encode()
    hash_obj = hmac.new(secret, msg=payload, digestmod=hashlib.sha256)
    expected_signature = f"sha256={hash_obj.hexdigest()}"

    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(status_code=401, detail="Invalid signature")

    data = await request.json()

    return data, event


@router.post("/webhook", name="github_webhook")
async def github_webhook(
    request: Request,
    webhook_data: tuple[dict, str] = Depends(_verify_github_webhook),
    db: AsyncSession = Depends(get_db),
    redis_client: Redis = Depends(get_redis_client),
    queue: ArqRedis = Depends(get_queue),
):
    try:
        data, event = webhook_data

        logger.info(f"Received GitHub webhook event: {event}")

        match event:
            case "installation":
                if data["action"] in ["deleted", "suspended", "unsuspended"]:
                    # App uninstalled or suspended
                    status = (
                        "active" if data["action"] == "unsuspended" else data["action"]
                    )
                    await db.execute(
                        update(GithubInstallation)
                        .where(
                            GithubInstallation.installation_id
                            == data["installation"]["id"]
                        )
                        .values(status=status)
                    )
                    await db.commit()
                    logger.info(
                        f"Installation {data['installation']['id']} for {data['installation']['account']['login']} is {data['action']}"
                    )

                elif data["action"] == "created":
                    # App installed
                    installation_id = data["installation"]["id"]
                    github_service = get_github_service()
                    token_data = await github_service.get_installation_access_token(
                        installation_id
                    )
                    installation = GithubInstallation(
                        installation_id=installation_id,
                        token=token_data["token"],
                        token_expires_at=datetime.fromisoformat(
                            token_data["expires_at"].replace("Z", "+00:00")
                        ),
                    )
                    await db.merge(installation)
                    await db.commit()
                    logger.info(
                        f"Installation {installation_id} for {data['installation']['account']['login']} created"
                    )

            case "installation_target":
                if data["action"] == "renamed":
                    # Installation account is renamed (not used)
                    pass

            case "installation_repositories":
                if data["action"] == "removed":
                    # Repositories removed from installation
                    removed_repos = data["repositories_removed"]
                    repo_ids = [repo["id"] for repo in removed_repos]
                    await db.execute(
                        update(Project)
                        .where(Project.repo_id.in_(repo_ids))
                        .values(repo_status="removed")
                    )
                    await db.commit()
                    logger.info(
                        f"Repos removed from installation {data['installation']['id']} for {data['installation']['account']['login']}: {', '.join(map(str, repo_ids))}"
                    )

                elif data["action"] == "added":
                    # Repositories are added to installation
                    added_repos = data["repositories_added"]
                    repo_ids = [repo["id"] for repo in added_repos]
                    await db.execute(
                        update(Project)
                        .where(Project.repo_id.in_(repo_ids))
                        .values(repo_status="active")
                    )
                    await db.commit()
                    logger.info(
                        f"Repos added to installation: {', '.join(map(str, repo_ids))}"
                    )

            case "repository":
                if data["action"] in ["deleted", "transferred"]:
                    # Repository is deleted or transferred
                    await db.execute(
                        update(Project)
                        .where(Project.repo_id == data["repository"]["id"])
                        .values(repo_status=data["action"])
                    )
                    await db.commit()
                    logger.info(f"Repo {data['repository']['id']} is {data['action']}")

                if data["action"] == "renamed":
                    # Repository is renamed
                    await db.execute(
                        update(Project)
                        .where(Project.repo_id == data["repository"]["id"])
                        .values(repo_full_name=data["repository"]["full_name"])
                    )
                    await db.commit()
                    logger.info(
                        f"Repo {data['repository']['id']} renamed to {data['repository']['full_name']}"
                    )

            case "push":
                # Code pushed to a repository
                result = await db.execute(
                    select(Project).where(
                        Project.repo_id == data["repository"]["id"],
                        Project.status == "active",
                    )
                )
                projects = result.scalars().all()

                if not projects:
                    logger.info(
                        f"No projects found for repo {data['repository']['id']}"
                    )
                    return Response(status_code=200)

                branch = data["ref"].replace(
                    "refs/heads/", ""
                )  # Convert refs/heads/main to main
                commit_data = {
                    "sha": data["after"],
                    "author": {"login": data["pusher"]["name"]},
                    "commit": {
                        "message": data["head_commit"]["message"],
                        "author": {"date": data["head_commit"]["timestamp"]},
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
                        job = await queue.enqueue_job(
                            "start_deployment", deployment.id
                        )
                        deployment.job_id = job.job_id
                        await db.commit()

                        logger.info(
                            f"Deployment {deployment.id} created for commit {commit_data['sha']} on project {project.name}"
                        )
                    except Exception as e:
                        logger.error(
                            f"Failed to create deployment for project {project.name}: {str(e)}",
                            exc_info=True,
                        )
                        continue

            case "pull_request":
                # TODO: Add logic for PRs
                pass

        return Response(status_code=200)

    except Exception as e:
        logger.error(f"Error processing GitHub webhook: {str(e)}", exc_info=True)
        await db.rollback()
        return Response(status_code=500)
