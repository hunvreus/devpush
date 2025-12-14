import json
import os
import logging
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    app_name: str = "/dev/push"
    app_description: str = (
        "An open-source platform to build and deploy any app from GitHub."
    )
    url_scheme: str = "https"
    app_hostname: str = ""
    deploy_domain: str = ""
    github_app_id: str = ""
    github_app_name: str = ""
    github_app_private_key: str = ""
    github_app_webhook_secret: str = ""
    github_app_client_id: str = ""
    github_app_client_secret: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    resend_api_key: str = ""
    email_logo: str = ""
    email_sender_name: str = "/dev/push"
    email_sender_address: str = ""
    secret_key: str = ""
    encryption_key: str = ""
    postgres_db: str = "devpush"
    postgres_user: str = "devpush-app"
    postgres_password: str = ""
    redis_url: str = "redis://redis:6379"
    docker_host: str = "tcp://docker-proxy:2375"
    data_dir: str = "/var/lib/devpush"
    app_dir: str = "/opt/devpush"
    upload_dir: str = ""
    traefik_dir: str = ""
    env_file: str = ""
    config_file: str = ""
    version_file: str = ""
    default_cpus: float | None = None
    max_cpus: float | None = None
    default_memory_mb: int | None = None
    max_memory_mb: int | None = None
    presets: list[dict] = []
    images: list[dict] = []
    job_timeout: int = 320
    job_completion_wait: int = 300
    deployment_timeout: int = 300
    container_delete_grace_seconds: int = 3
    db_echo: bool = False
    log_level: str = "WARNING"
    env: str = "production"
    access_denied_message: str = "Sign-in not allowed for this email."
    access_denied_webhook: str = ""
    login_header: str = ""
    toaster_header: str = ""
    server_ip: str = "127.0.0.1"

    model_config = SettingsConfigDict(extra="ignore")

    @property
    def allow_custom_cpu(self) -> bool:
        return self.default_cpus is not None and self.max_cpus is not None

    @property
    def allow_custom_memory(self) -> bool:
        return self.default_memory_mb is not None and self.max_memory_mb is not None


@lru_cache
def get_settings():
    settings = Settings()

    # Set URL scheme based on environment
    settings.url_scheme = "http" if settings.env == "development" else "https"

    # CPU default/max normalization
    if settings.default_cpus is not None and settings.default_cpus <= 0:
        logger.warning("DEFAULT_CPUS must be > 0; ignoring and treating as unlimited.")
        settings.default_cpus = None
    if settings.max_cpus is not None and settings.max_cpus <= 0:
        logger.warning("MAX_CPUS must be > 0; ignoring.")
        settings.max_cpus = None
    if settings.default_cpus is None and settings.max_cpus is not None:
        logger.warning("MAX_CPUS is set but DEFAULT_CPUS is not; ignoring MAX_CPUS.")
        settings.max_cpus = None
    if settings.allow_custom_cpu:
        default_cpus = settings.default_cpus
        max_cpus = settings.max_cpus
        if (
            default_cpus is not None
            and max_cpus is not None
            and default_cpus > max_cpus
        ):
            logger.warning(
                "DEFAULT_CPUS is greater than MAX_CPUS; clamping default to max."
            )
            settings.default_cpus = max_cpus

    # Memory default/max normalization
    if settings.default_memory_mb is not None and settings.default_memory_mb <= 0:
        logger.warning(
            "DEFAULT_MEMORY_MB must be > 0; ignoring and treating as unlimited."
        )
        settings.default_memory_mb = None
    if settings.max_memory_mb is not None and settings.max_memory_mb <= 0:
        logger.warning("MAX_MEMORY_MB must be > 0; ignoring.")
        settings.max_memory_mb = None
    if settings.default_memory_mb is None and settings.max_memory_mb is not None:
        logger.warning(
            "MAX_MEMORY_MB is set but DEFAULT_MEMORY_MB is not; ignoring MAX_MEMORY_MB."
        )
        settings.max_memory_mb = None
    if settings.allow_custom_memory:
        default_memory_mb = settings.default_memory_mb
        max_memory_mb = settings.max_memory_mb
        if (
            default_memory_mb is not None
            and max_memory_mb is not None
            and default_memory_mb > max_memory_mb
        ):
            logger.warning(
                "DEFAULT_MEMORY_MB is greater than MAX_MEMORY_MB; clamping default to max."
            )
            settings.default_memory_mb = max_memory_mb

    # Directories/files normalization
    if not settings.upload_dir:
        settings.upload_dir = os.path.join(settings.data_dir, "upload")
    if not settings.traefik_dir:
        settings.traefik_dir = os.path.join(settings.data_dir, "traefik")
    if not settings.env_file:
        settings.env_file = os.path.join(settings.data_dir, ".env")
    if not settings.config_file:
        settings.config_file = os.path.join(settings.data_dir, "config.json")
    if not settings.version_file:
        settings.version_file = os.path.join(settings.data_dir, "version.json")

    # Load presets/images from files
    presets_file = Path("settings/presets.json")
    images_file = Path("settings/images.json")
    try:
        settings.presets = json.loads(presets_file.read_text(encoding="utf-8"))
        settings.images = json.loads(images_file.read_text(encoding="utf-8"))
    except Exception:
        settings.presets = []
        settings.images = []

    return settings
