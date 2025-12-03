from fastapi import APIRouter, Request, Depends
from fastapi.responses import RedirectResponse
import json
import os
import httpx
import secrets
import base64
import uuid

from config import get_settings, Settings
from dependencies import TemplateResponse, flash, get_translation as _
from forms.setup import DomainsSSLForm, GitHubAppForm, EmailForm

router = APIRouter(prefix="/setup", tags=["setup"])
SETUP_TEMP_DIR = "/tmp/devpush-setup"


def get_setup_data(request: Request) -> dict:
    return request.session.get("setup_data", {})


def save_setup_data(request: Request, data: dict):
    current = request.session.get("setup_data", {})
    current.update(data)
    request.session["setup_data"] = current


def get_current_step(request: Request) -> int:
    return request.session.get("setup_step", 1)


def set_current_step(request: Request, step: int):
    current_step = get_current_step(request)
    if current_step >= step:
        return
    request.session["setup_step"] = step


@router.get("", name="setup_redirect")
async def setup_redirect(request: Request):
    step = get_current_step(request)
    return RedirectResponse(f"/setup/step/{step}", status_code=303)


@router.api_route("/step/1", methods=["GET", "POST"], name="setup_step_1")
async def setup_step_1(
    request: Request,
    check_dns: str = "",
    settings: Settings = Depends(get_settings),
):
    """Setup step 1: Domains & SSL configuration."""
    form = await DomainsSSLForm.from_formdata(request)

    if request.method == "POST" and await form.validate_on_submit():
        data = {}
        for field_name, field in form._fields.items():
            if field.data and field_name != "csrf_token":
                data[field_name] = field.data

        save_setup_data(request, data)
        set_current_step(request, 2)

        flash(request, _("Domains & SSL configuration saved"), "success")
        return RedirectResponse("/setup/step/2", status_code=303)

    setup_data = get_setup_data(request)
    if setup_data:
        for field_name, field in form._fields.items():
            if field_name in setup_data:
                field.data = setup_data[field_name]

    # Pre-populate defaults
    if not form.server_ip.data:
        if settings.env == "development":
            form.server_ip.data = "127.0.0.1"
        else:
            if os.path.exists(settings.config_file):
                try:
                    with open(settings.config_file, encoding="utf-8") as f:
                        config = json.load(f)
                    if "public_ip" in config:
                        form.server_ip.data = config["public_ip"]
                except Exception:
                    pass

            if not form.server_ip.data:
                client_ip = (
                    request.headers.get("x-forwarded-for", "").split(",")[0].strip()
                )
                # Filter out private IPs
                if (
                    client_ip
                    and not client_ip.startswith("192.168.")
                    and not client_ip.startswith("10.")
                    and not client_ip.startswith("172.")
                ):
                    form.server_ip.data = client_ip

    if settings.env == "development":
        if not form.app_hostname.data:
            form.app_hostname.data = "localhost"
        if not form.deploy_domain.data:
            form.deploy_domain.data = "deploy.localhost"

    return TemplateResponse(
        request=request,
        name="setup/pages/domains.html",
        context={
            "form": form,
            "current_step": 1,
            "total_steps": 4,
            "saved_step": get_current_step(request),
            "environment": settings.env,
        },
    )


@router.api_route("/step/2", methods=["GET", "POST"], name="setup_step_2")
async def setup_step_2(
    request: Request,
    settings: Settings = Depends(get_settings),
):
    """Setup step 2: GitHub App configuration."""
    token = request.query_params.get("token")
    if token:
        token_path = os.path.join(SETUP_TEMP_DIR, f"github-{token}.json")
        if os.path.exists(token_path):
            try:
                with open(token_path) as f:
                    token_data = json.load(f)
                save_setup_data(request, token_data)
                os.remove(token_path)

                flash(request, _("GitHub App created successfully"), "success")

                app_name = token_data.get("github_app_name", "")
                owner_login = token_data.get("github_owner_login", "")
                owner_type = token_data.get("github_owner_type", "User")

                settings_url = (
                    f"https://github.com/organizations/{owner_login}/settings/apps/{app_name}"
                    if owner_type == "Organization" and owner_login
                    else f"https://github.com/settings/apps/{app_name}"
                )

                flash(
                    request,
                    _("Disable token expiration"),
                    description=_(
                        'Go to your GitHub App settings, find "Optional features" and disable "User-to-server token expiration" to prevent sessions from expiring every 8 hours.'
                    ),
                    category="warning",
                    cancel={"label": _("Close")},
                    action={
                        "label": _("Settings"),
                        "href": settings_url,
                        "attrs": {
                            "onclick": "event.stopPropagation();",
                            "target": "_blank",
                        },
                    },
                    attrs={"data-duration": "-1"},
                )

                hostname = request.url.hostname or ""
                if hostname in ("localhost", "127.0.0.1") or hostname.endswith(
                    ".localhost"
                ):
                    flash(
                        request,
                        _("Update webhook URL"),
                        description=_(
                            "Update the webhook URL in your GitHub App settings to a publicly accessible URL using a service like ngrok."
                        ),
                        category="warning",
                        cancel={"label": _("Close")},
                        action={
                            "label": _("Settings"),
                            "href": settings_url,
                            "attrs": {
                                "onclick": "event.stopPropagation();",
                                "target": "_blank",
                            },
                        },
                        attrs={"data-duration": "-1"},
                    )
            except Exception:
                pass

    form = await GitHubAppForm.from_formdata(request)

    if request.method == "POST" and await form.validate_on_submit():
        data = {
            "github_app_id": form.github_app_id.data,
            "github_app_name": form.github_app_name.data,
            "github_app_private_key": form.github_app_private_key.data,
            "github_app_webhook_secret": form.github_app_webhook_secret.data,
            "github_app_client_id": form.github_app_client_id.data,
            "github_app_client_secret": form.github_app_client_secret.data,
        }

        save_setup_data(request, data)
        set_current_step(request, 3)

        flash(request, _("GitHub App configuration saved"), "success")
        return RedirectResponse("/setup/step/3", status_code=303)

    setup_data = get_setup_data(request)
    if setup_data:
        for field_name, field in form._fields.items():
            if field_name in setup_data:
                field.data = setup_data[field_name]

    app_hostname = setup_data.get("app_hostname", "")
    server_ip = setup_data.get("server_ip", settings.server_ip)
    redirect_url = f"http://{server_ip}.traefik.me"
    if app_hostname in ("localhost", "") or app_hostname.endswith(".localhost"):
        app_base_url = "http://localhost"
        app_webhook_base_url = redirect_url
    else:
        app_base_url = f"https://{app_hostname}"
        app_webhook_base_url = app_base_url

    return TemplateResponse(
        request=request,
        name="setup/pages/github.html",
        context={
            "form": form,
            "server_ip": server_ip,
            "app_hostname": app_hostname,
            "app_base_url": app_base_url,
            "redirect_url": redirect_url,
            "app_webhook_base_url": app_webhook_base_url,
            "current_step": 2,
            "total_steps": 4,
            "saved_step": get_current_step(request),
        },
    )


@router.api_route("/step/3", methods=["GET", "POST"], name="setup_step_3")
async def setup_step_3(request: Request):
    """Setup step 3: Email configuration."""
    form = await EmailForm.from_formdata(request)

    if request.method == "POST" and await form.validate_on_submit():
        data = {
            "resend_api_key": form.resend_api_key.data,
            "email_sender_address": form.email_sender_address.data,
        }

        save_setup_data(request, data)
        set_current_step(request, 4)

        flash(request, _("Email configuration saved"), "success")
        return RedirectResponse("/setup/step/4", status_code=303)

    setup_data = get_setup_data(request)
    if setup_data:
        for field_name, field in form._fields.items():
            if field_name in setup_data:
                field.data = setup_data[field_name]

    return TemplateResponse(
        request=request,
        name="setup/pages/email.html",
        context={
            "form": form,
            "current_step": 3,
            "total_steps": 4,
            "saved_step": get_current_step(request),
        },
    )


@router.api_route("/step/4", methods=["GET", "POST"], name="setup_step_4")
async def setup_step_4(
    request: Request,
    settings: Settings = Depends(get_settings),
):
    """Setup step 4: Confirm configuration."""
    setup_data = get_setup_data(request)

    if request.method == "POST":
        try:
            existing_env = {}
            env_path = settings.env_file
            os.makedirs(os.path.dirname(env_path), exist_ok=True)
            if os.path.exists(env_path):
                with open(env_path, encoding="utf-8") as f:
                    for line in f:
                        if "=" in line:
                            key, value = line.strip().split("=", 1)
                            existing_env[key] = value.strip('"')

            env_lines = []

            # Secrets: preserve if present, otherwise generate
            if "SECRET_KEY" in existing_env:
                env_lines.append(f'SECRET_KEY="{existing_env["SECRET_KEY"]}"')
            else:
                env_lines.append(f'SECRET_KEY="{secrets.token_hex(32)}"')
            if "ENCRYPTION_KEY" in existing_env:
                env_lines.append(f'ENCRYPTION_KEY="{existing_env["ENCRYPTION_KEY"]}"')
            else:
                env_lines.append(
                    f'ENCRYPTION_KEY="{base64.urlsafe_b64encode(os.urandom(32)).decode()}"'
                )
            if "POSTGRES_PASSWORD" in existing_env:
                env_lines.append(
                    f'POSTGRES_PASSWORD="{existing_env["POSTGRES_PASSWORD"]}"'
                )
            else:
                env_lines.append(f'POSTGRES_PASSWORD="{secrets.token_urlsafe(24)}"')

            env_lines.append(f'SERVER_IP="{setup_data["server_ip"]}"')
            env_lines.append(f'APP_HOSTNAME="{setup_data["app_hostname"]}"')
            env_lines.append(f'DEPLOY_DOMAIN="{setup_data["deploy_domain"]}"')
            if settings.env != "development":
                env_lines.append(f'LE_EMAIL="{setup_data["le_email"]}"')
                env_lines.append(f'SSL_PROVIDER="{setup_data["ssl_provider"]}"')
            else:
                env_lines.append('ENV="development"')

            ssl_provider = setup_data.get("ssl_provider", "")
            if (
                settings.env != "development"
                and ssl_provider == "cloudflare"
                and setup_data.get("cloudflare_api_token")
            ):
                env_lines.append(
                    f'CF_DNS_API_TOKEN="{setup_data["cloudflare_api_token"]}"'
                )
            elif settings.env != "development" and ssl_provider == "route53":
                if setup_data.get("route53_access_key"):
                    env_lines.append(
                        f'AWS_ACCESS_KEY_ID="{setup_data["route53_access_key"]}"'
                    )
                if setup_data.get("route53_secret_key"):
                    env_lines.append(
                        f'AWS_SECRET_ACCESS_KEY="{setup_data["route53_secret_key"]}"'
                    )
                if setup_data.get("route53_region"):
                    env_lines.append(f'AWS_REGION="{setup_data["route53_region"]}"')
            elif settings.env != "development" and ssl_provider == "gcloud":
                if setup_data.get("gcloud_project"):
                    env_lines.append(f'GCE_PROJECT="{setup_data["gcloud_project"]}"')
                if setup_data.get("gcloud_service_account"):
                    gcloud_sa_path = os.path.join(settings.data_dir, "gcloud-sa.json")
                    with open(gcloud_sa_path, "w", encoding="utf-8") as f:
                        f.write(setup_data["gcloud_service_account"])
                    os.chmod(gcloud_sa_path, 0o600)
            elif (
                settings.env != "development"
                and ssl_provider == "digitalocean"
                and setup_data.get("digitalocean_token")
            ):
                env_lines.append(f'DO_AUTH_TOKEN="{setup_data["digitalocean_token"]}"')
            elif settings.env != "development" and ssl_provider == "azure":
                if setup_data.get("azure_client_id"):
                    env_lines.append(
                        f'AZURE_CLIENT_ID="{setup_data["azure_client_id"]}"'
                    )
                if setup_data.get("azure_client_secret"):
                    env_lines.append(
                        f'AZURE_CLIENT_SECRET="{setup_data["azure_client_secret"]}"'
                    )
                if setup_data.get("azure_tenant_id"):
                    env_lines.append(
                        f'AZURE_TENANT_ID="{setup_data["azure_tenant_id"]}"'
                    )
                if setup_data.get("azure_subscription_id"):
                    env_lines.append(
                        f'AZURE_SUBSCRIPTION_ID="{setup_data["azure_subscription_id"]}"'
                    )
                if setup_data.get("azure_resource_group"):
                    env_lines.append(
                        f'AZURE_RESOURCE_GROUP="{setup_data["azure_resource_group"]}"'
                    )

            env_lines.append(f'RESEND_API_KEY="{setup_data["resend_api_key"]}"')
            env_lines.append(
                f'EMAIL_SENDER_ADDRESS="{setup_data["email_sender_address"]}"'
            )
            env_lines.append(f'GITHUB_APP_ID="{setup_data["github_app_id"]}"')
            env_lines.append(f'GITHUB_APP_NAME="{setup_data["github_app_name"]}"')
            env_lines.append(
                f'GITHUB_APP_PRIVATE_KEY="{setup_data["github_app_private_key"]}"'
            )
            env_lines.append(
                f'GITHUB_APP_WEBHOOK_SECRET="{setup_data["github_app_webhook_secret"]}"'
            )
            env_lines.append(
                f'GITHUB_APP_CLIENT_ID="{setup_data["github_app_client_id"]}"'
            )
            env_lines.append(
                f'GITHUB_APP_CLIENT_SECRET="{setup_data["github_app_client_secret"]}"'
            )

            with open(env_path, "w", encoding="utf-8") as f:
                f.write("\n".join(env_lines) + "\n")
            os.chmod(env_path, 0o600)

            config = {}
            if os.path.exists(settings.config_file):
                with open(settings.config_file, encoding="utf-8") as f:
                    config = json.load(f)

            config["setup_complete"] = True
            if settings.env != "development":
                config["ssl_provider"] = setup_data["ssl_provider"]

            os.makedirs(os.path.dirname(settings.config_file), exist_ok=True)
            with open(settings.config_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)
            os.chmod(settings.config_file, 0o644)

            # Clear setup data, but keep app_hostname for the complete page
            app_hostname = setup_data.get("app_hostname")
            request.session.pop("setup_step", None)
            request.session.pop("setup_data", None)
            if app_hostname:
                request.session["app_hostname"] = app_hostname

            return RedirectResponse("/setup/complete", status_code=303)

        except Exception as e:
            flash(request, f"Setup failed: {str(e)}", "error")
            return RedirectResponse("/setup/step/4", status_code=303)

    return TemplateResponse(
        request=request,
        name="setup/pages/confirm.html",
        context={
            "setup_data": setup_data,
            "current_step": 4,
            "saved_step": get_current_step(request),
            "total_steps": 4,
            "environment": settings.env,
        },
    )


@router.get("/complete", name="setup_complete")
async def setup_complete(
    request: Request,
    settings: Settings = Depends(get_settings),
):
    """Show completion page."""

    # Validate setup is complete
    if not os.path.exists(settings.config_file):
        return RedirectResponse("/setup", status_code=303)

    with open(settings.config_file, encoding="utf-8") as f:
        config = json.load(f)
    if not config.get("setup_complete"):
        return RedirectResponse("/setup", status_code=303)

    # Get app_hostname from session (saved before clearing setup_data) or fall back to settings
    app_hostname = (
        request.session.get("app_hostname") or settings.app_hostname or "localhost"
    )
    target_url = f"{settings.url_scheme}://{app_hostname}"

    return TemplateResponse(
        request=request,
        name="setup/pages/complete.html",
        context={
            "app_hostname": app_hostname,
            "target_url": target_url,
            "environment": settings.env,
        },
    )


@router.get("/github/callback", name="setup_github_callback")
async def setup_github_callback(request: Request, code: str, state: str = ""):
    try:
        url = f"https://api.github.com/app-manifests/{code}/conversions"
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                headers={
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "devpush-setup",
                },
            )
            response.raise_for_status()
            result = response.json()

        owner = result.get("owner", {})
        owner_type = owner.get("type", "User")
        owner_login = owner.get("login", "")

        github_data = {
            "github_app_id": str(result["id"]),
            "github_app_name": result["name"],
            "github_app_private_key": result["pem"],
            "github_app_webhook_secret": result["webhook_secret"],
            "github_app_client_id": result["client_id"],
            "github_app_client_secret": result["client_secret"],
            "github_owner_type": owner_type,
            "github_owner_login": owner_login,
        }

        save_setup_data(request, github_data)

        # Save data to a temp file before redirecting (http://*.traefik.em -> http://{IP})
        os.makedirs(SETUP_TEMP_DIR, exist_ok=True)
        token = uuid.uuid4().hex
        token_path = os.path.join(SETUP_TEMP_DIR, f"github-{token}.json")
        with open(token_path, "w") as f:
            json.dump(github_data, f)

        redirect_path = f"/setup/step/2?token={token}"
        host = request.url.hostname or ""
        if host.endswith(".traefik.me"):
            server_ip = host.rsplit(".traefik.me", 1)[0]
            if server_ip:
                if server_ip == "127.0.0.1":
                    redirect_url = f"http://localhost{redirect_path}"
                else:
                    redirect_url = f"{request.url.scheme}://{server_ip}{redirect_path}"
                return RedirectResponse(redirect_url, status_code=303)
        return RedirectResponse(redirect_path, status_code=303)

    except Exception as e:
        flash(request, f"GitHub App creation failed: {str(e)}", "error")
        return RedirectResponse("/setup/step/2", status_code=303)
