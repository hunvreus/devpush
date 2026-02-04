import logging
from datetime import datetime, timezone

import aiodocker
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from models import Deployment

logger = logging.getLogger(__name__)

# Keep in sync with models.Deployment.observed_status enum values.
OBSERVED_STATUSES = {"running", "exited", "dead", "paused", "not_found"}


async def reconcile_deployments(
    db: AsyncSession,
    docker_client: aiodocker.Docker,
    deployment_ids: list[str] | None = None,
    full_scan: bool = False,
) -> dict[str, int]:
    now = datetime.now(timezone.utc)
    counts = {"processed": 0, "observed": 0, "missing": 0}

    query = select(Deployment)
    if deployment_ids:
        query = query.where(Deployment.id.in_(deployment_ids))
    elif full_scan:
        query = query.where(Deployment.container_id.isnot(None))
    else:
        query = query.where(
            or_(
                Deployment.container_status.in_(["running", "stopped"]),
                Deployment.observed_status == "running",
            )
        )

    result = await db.execute(query)
    deployments = result.scalars().all()
    if not deployments:
        logger.info("Reconcile: no deployments found to process.")
        return counts

    try:
        containers = await docker_client.containers.list(
            all=True, filters={"label": ["devpush.deployment_id"]}
        )
    except aiodocker.DockerError as error:
        logger.error("Failed to list devpush containers: %s", error)
        return counts

    container_by_deployment: dict[str, str] = {}
    container_by_id: dict[str, str] = {}

    for info in containers:
        container_id = None
        labels = {}
        if hasattr(info, "show"):
            details = await info.show()
            container_id = details.get("Id")
            labels = (
                details.get("Config", {}).get("Labels")
                or details.get("Labels")
                or {}
            )
        else:
            container_id = info.get("Id")
            labels = info.get("Labels") or {}

        deployment_id = labels.get("devpush.deployment_id")
        if deployment_id and container_id:
            container_by_deployment[deployment_id] = container_id
        if container_id:
            container_by_id[container_id] = container_id

    for deployment in deployments:
        counts["processed"] += 1
        container_id = None
        if deployment.container_id and deployment.container_id in container_by_id:
            container_id = deployment.container_id
        else:
            container_id = container_by_deployment.get(deployment.id)

        if not container_id:
            deployment.observed_status = "not_found"
            deployment.observed_at = now.replace(tzinfo=None)
            deployment.observed_missing_count = (deployment.observed_missing_count or 0) + 1
            counts["missing"] += 1
            logger.info(
                "Reconcile: deployment %s container not found (missing_count=%s).",
                deployment.id,
                deployment.observed_missing_count,
            )
            continue

        try:
            container = await docker_client.containers.get(container_id)
            details = await container.show()
        except aiodocker.DockerError as error:
            if getattr(error, "status", None) == 404:
                deployment.observed_status = "not_found"
                deployment.observed_at = now.replace(tzinfo=None)
                deployment.observed_missing_count = (
                    deployment.observed_missing_count or 0
                ) + 1
                counts["missing"] += 1
                logger.info(
                    "Reconcile: deployment %s container 404 (missing_count=%s).",
                    deployment.id,
                    deployment.observed_missing_count,
                )
                continue
            logger.warning("Failed to inspect container %s: %s", container_id, error)
            deployment.observed_status = "not_found"
            deployment.observed_at = now.replace(tzinfo=None)
            deployment.observed_missing_count = (deployment.observed_missing_count or 0) + 1
            counts["missing"] += 1
            logger.info(
                "Reconcile: deployment %s container inspect failed (missing_count=%s).",
                deployment.id,
                deployment.observed_missing_count,
            )
            continue

        state = details.get("State", {})
        status = state.get("Status")
        if status not in OBSERVED_STATUSES:
            logger.warning(
                "Unknown container status '%s' for deployment %s",
                status,
                deployment.id,
            )
            status = "not_found"

        deployment.observed_status = status
        deployment.observed_exit_code = state.get("ExitCode")
        deployment.observed_at = now.replace(tzinfo=None)
        deployment.observed_last_seen_at = now.replace(tzinfo=None)
        deployment.observed_missing_count = 0
        counts["observed"] += 1
        logger.info(
            "Reconcile: deployment %s observed_status=%s exit_code=%s.",
            deployment.id,
            deployment.observed_status,
            deployment.observed_exit_code,
        )

    await db.commit()
    logger.info(
        "Reconcile: updated observed state for %s deployment(s).",
        len(deployments),
    )
    return counts
