import logging
from arq import cron
from arq.connections import RedisSettings
from workers.tasks.deployment import (
    start_deployment,
    finalize_deployment,
    fail_deployment,
    delete_container,
    cleanup_inactive_containers,
)
from workers.tasks.project import delete_project
from workers.tasks.reconcile import reconcile_deployments_tick
from workers.tasks.storage import provision_storage, deprovision_storage, reset_storage
from workers.tasks.team import delete_team
from workers.tasks.user import delete_user
from workers.tasks.registry import (
    pull_runner_image,
    pull_all_runner_images,
    clear_runner_image,
    clear_all_runner_images,
)

from config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()


def _build_reconcile_cron() -> list:
    interval = max(1, settings.reconcile_interval_seconds)
    if interval < 60 and 60 % interval == 0:
        seconds = set(range(0, 60, interval))
        return [cron(reconcile_deployments_tick, second=seconds)]
    minutes = max(1, interval // 60)
    if interval % 60 != 0:
        logger.warning(
            "RECONCILE_INTERVAL_SECONDS=%s is not a clean minute; rounding to %s minute(s).",
            interval,
            minutes,
        )
    minute_values = set(range(0, 60, minutes))
    return [cron(reconcile_deployments_tick, minute=minute_values, second=0)]


class WorkerSettings:
    functions = [
        start_deployment,
        finalize_deployment,
        fail_deployment,
        delete_user,
        delete_team,
        delete_project,
        cleanup_inactive_containers,
        delete_container,
        provision_storage,
        deprovision_storage,
        reset_storage,
        pull_runner_image,
        pull_all_runner_images,
        clear_runner_image,
        clear_all_runner_images,
        reconcile_deployments_tick,
    ]
    cron_jobs = _build_reconcile_cron()
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 8
    job_timeout_seconds = settings.job_timeout_seconds
    job_completion_wait_seconds = settings.job_completion_wait_seconds
    max_tries = settings.job_max_tries
    health_check_interval = 65  # Greater than 60s to avoid health check timeout
    allow_abort_jobs = True
