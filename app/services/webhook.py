import hmac
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

import httpx

from models import Deployment, Project

if TYPE_CHECKING:
    from models import TeamWebhook
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

WEBHOOK_EVENTS = ["started", "succeeded", "failed", "canceled"]


def _build_deployment_payload(
    project: Project,
    deployment: Deployment,
    event: str,
    url_scheme: str,
    deploy_domain: str,
) -> dict:
    """Build the webhook payload for a deployment event."""
    environment = project.get_environment_by_id(deployment.environment_id)

    return {
        "event": f"deployment.{event}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "project": {
            "id": project.id,
            "name": project.name,
            "slug": project.slug,
            "repo_full_name": project.repo_full_name,
        },
        "deployment": {
            "id": deployment.id,
            "status": deployment.status,
            "conclusion": deployment.conclusion,
            "branch": deployment.branch,
            "commit_sha": deployment.commit_sha,
            "commit_message": (deployment.commit_meta or {}).get("message", ""),
            "commit_author": (deployment.commit_meta or {}).get("author", ""),
            "environment": {
                "id": deployment.environment_id,
                "name": environment.get("name") if environment else None,
                "slug": environment.get("slug") if environment else None,
            },
            "trigger": deployment.trigger,
            "url": f"{url_scheme}://{deployment.slug}.{deploy_domain}"
            if deploy_domain
            else None,
            "created_at": deployment.created_at.isoformat()
            if deployment.created_at
            else None,
            "concluded_at": deployment.concluded_at.isoformat()
            if deployment.concluded_at
            else None,
        },
    }


async def _deliver_webhook(
    url: str,
    payload: dict,
    event: str,
    delivery_id: str,
    secret: str | None = None,
) -> bool:
    """Deliver a webhook to a URL.

    Returns True if delivery was successful, False otherwise.
    """
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "devpush-webhook/1.0",
        "X-DevPush-Event": f"deployment.{event}",
        "X-DevPush-Delivery": delivery_id,
    }

    payload_bytes = json.dumps(payload, separators=(",", ":")).encode()

    if secret:
        signature = hmac.new(secret.encode(), payload_bytes, hashlib.sha256).hexdigest()
        headers["X-DevPush-Signature"] = f"sha256={signature}"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                url,
                content=payload_bytes,
                headers=headers,
            )
            if response.status_code >= 400:
                logger.warning(
                    f"Webhook delivery failed to {url}: HTTP {response.status_code}"
                )
                return False
            else:
                logger.info(
                    f"Webhook delivered to {url}: event={event}, status={response.status_code}"
                )
                return True
    except Exception as e:
        logger.warning(f"Webhook delivery failed to {url}: {e}")
        return False


async def send_deployment_webhook(
    project: Project,
    deployment: Deployment,
    event: str,
    url_scheme: str = "https",
    deploy_domain: str = "",
    db: "AsyncSession | None" = None,
) -> None:
    """Send webhook notifications for a deployment event.

    This sends notifications to:
    1. Project-level webhook (if configured in project.config)
    2. Team-level webhooks (if any are configured and apply to this project)

    Args:
        project: The project the deployment belongs to
        deployment: The deployment that triggered the event
        event: The event type (started, succeeded, failed, canceled)
        url_scheme: URL scheme for deployment URLs (http/https)
        deploy_domain: The deployment domain for constructing URLs
        db: Optional database session for fetching team webhooks
    """
    payload = _build_deployment_payload(
        project, deployment, event, url_scheme, deploy_domain
    )

    # Send to project-level webhook (backward compatible)
    config = project.config or {}
    webhook_url = config.get("webhook_url")
    if webhook_url:
        webhook_events = config.get("webhook_events") or WEBHOOK_EVENTS
        if event in webhook_events:
            webhook_secret = config.get("webhook_secret")
            await _deliver_webhook(
                url=webhook_url,
                payload=payload,
                event=event,
                delivery_id=deployment.id,
                secret=webhook_secret,
            )

    # Send to team-level webhooks
    if db:
        await send_team_webhooks(
            db=db,
            team_id=project.team_id,
            project_id=project.id,
            event=event,
            payload=payload,
            delivery_id=deployment.id,
        )


async def send_team_webhooks(
    db: "AsyncSession",
    team_id: str,
    project_id: str,
    event: str,
    payload: dict,
    delivery_id: str,
) -> None:
    """Send webhook notifications to all applicable team webhooks.

    Args:
        db: Database session
        team_id: The team ID
        project_id: The project ID
        event: The event type
        payload: The webhook payload
        delivery_id: Unique delivery ID
    """
    from sqlalchemy import select
    from models import TeamWebhook

    # Get all active team webhooks
    result = await db.execute(
        select(TeamWebhook).where(
            TeamWebhook.team_id == team_id,
            TeamWebhook.status == "active",
        )
    )
    webhooks = result.scalars().all()

    for webhook in webhooks:
        # Check if webhook applies to this project
        if not webhook.applies_to_project(project_id):
            continue

        # Check if webhook is configured for this event
        webhook_events = webhook.events or WEBHOOK_EVENTS
        if event not in webhook_events:
            continue

        # Deliver the webhook
        await _deliver_webhook(
            url=webhook.url,
            payload=payload,
            event=event,
            delivery_id=f"{delivery_id}-{webhook.id[:8]}",
            secret=webhook.secret,
        )
