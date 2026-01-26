import logging
from arq.connections import RedisSettings
from workers.tasks.deployment import (
    start_deployment,
    reconcile_edge_network,
    finalize_deployment,
    fail_deployment,
    delete_container,
    cleanup_inactive_containers,
)
from workers.tasks.project import delete_project
from workers.tasks.storage import provision_storage, deprovision_storage
from workers.tasks.team import delete_team
from workers.tasks.user import delete_user

from config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()


async def startup(ctx):
    await reconcile_edge_network(ctx)


class WorkerSettings:
    functions = [
        start_deployment,
        reconcile_edge_network,
        finalize_deployment,
        fail_deployment,
        delete_user,
        delete_team,
        delete_project,
        cleanup_inactive_containers,
        delete_container,
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
    on_startup = startup
