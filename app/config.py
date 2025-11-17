from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
import json
from pathlib import Path


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
    upload_dir: str = "/app/upload"
    traefik_config_dir: str = "/data/traefik"
    default_cpus: float = 0.5
    default_memory_mb: int = 2048
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


@lru_cache
def get_settings():
    settings = Settings()

    presets_file = Path("settings/presets.json")
    images_file = Path("settings/images.json")
    try:
        settings.presets = json.loads(presets_file.read_text(encoding="utf-8"))
        settings.images = json.loads(images_file.read_text(encoding="utf-8"))
    except Exception:
        settings.presets = []
        settings.images = []

    return settings
