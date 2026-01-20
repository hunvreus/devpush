import logging
from arq.connections import RedisSettings
from workers.tasks.deployment import (
    start_deployment,
    finalize_deployment,
    fail_deployment,
    cleanup_inactive_containers,
)
from workers.tasks.project import delete_project
from workers.tasks.storage import provision_storage, deprovision_storage
from workers.tasks.team import delete_team
from workers.tasks.user import delete_user

from config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()


class WorkerSettings:
    functions = [
        start_deployment,
        finalize_deployment,
        fail_deployment,
        delete_user,
        delete_team,
        delete_project,
        cleanup_inactive_containers,
        provision_storage,
        deprovision_storage,
    ]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 8
    job_timeout_seconds = settings.job_timeout_seconds
    job_completion_wait_seconds = settings.job_completion_wait_seconds
    max_tries = settings.job_max_tries
    health_check_interval = 65  # Greater than 60s to avoid health check timeout
    allow_abort_jobs = True
