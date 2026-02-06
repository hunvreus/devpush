import logging

import aiodocker

from config import get_settings
from db import AsyncSessionLocal
from services.reconcile import reconcile_deployments

logger = logging.getLogger(__name__)


async def reconcile_deployments_tick(ctx) -> None:
    settings = get_settings()
    redis_client = ctx.get("redis")
    async with AsyncSessionLocal() as db:
        async with aiodocker.Docker(url=settings.docker_host) as docker_client:
            counts = await reconcile_deployments(
                db,
                docker_client,
                redis_client=redis_client,
            )
    logger.info(
        "Reconcile tick completed processed=%s observed=%s missing=%s.",
        counts["processed"],
        counts["observed"],
        counts["missing"],
    )
