from fastapi import APIRouter, Request, Depends
from fastapi.responses import RedirectResponse
import json
import os
import subprocess
from pathlib import Path
import httpx
import socket
import re

from config import get_settings, Settings
from dependencies import TemplateResponse, flash, get_translation as _
from forms.setup import DomainsSSLForm, GitHubAppForm, EmailForm

router = APIRouter(prefix="/setup", tags=["setup"])


def get_setup_data(request: Request) -> dict:
    return request.session.get("setup_data", {})


def save_setup_data(request: Request, data: dict):
    current = request.session.get("setup_data", {})
    current.update(data)
    request.session["setup_data"] = current


def get_current_step(request: Request) -> int:
    return request.session.get("setup_step", 1)


def set_current_step(request: Request, step: int):
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

    # DNS check
    if request.headers.get("HX-Request") and check_dns:
        form_data = await request.form()
        domain = form_data.get(check_dns, "")
        server_ip = form_data.get("server_ip", settings.server_ip)

        status = None
        message = ""

        if domain and domain.strip():
            domain_regex = r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$"
            if re.match(domain_regex, domain):
                try:
                    resolved_ips = socket.gethostbyname_ex(domain)[2]

                    if server_ip in resolved_ips:
                        status = "valid"
                        message = f"Resolves to {server_ip}"
                    else:
                        status = "invalid"
                        message = f"Resolves to {', '.join(resolved_ips)}"
                except socket.gaierror:
                    status = "invalid"
                    message = "Domain does not resolve"
                except Exception:
                    pass

        return TemplateResponse(
            request=request,
            name="setup/partials/_dns-status.html",
            context={"status": status, "message": message},
        )

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

    # Pre-populate server_ip if not already set
    if not form.server_ip.data:
        # Try to infer from X-Forwarded-For or client host
        client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if (
            not client_ip
            or client_ip.startswith("192.168.")
            or client_ip.startswith("10.")
            or client_ip.startswith("172.")
        ):
            client_ip = settings.server_ip
        form.server_ip.data = client_ip

    return TemplateResponse(
        request=request,
        name="setup/pages/domains.html",
        context={
            "form": form,
            "current_step": 1,
            "total_steps": 4,
        },
    )


@router.api_route("/step/2", methods=["GET", "POST"], name="setup_step_2")
async def setup_step_2(
    request: Request,
    settings: Settings = Depends(get_settings),
):
    """Setup step 2: GitHub App configuration."""

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

    return TemplateResponse(
        request=request,
        name="setup/pages/github.html",
        context={
            "form": form,
            "server_ip": setup_data.get("server_ip", settings.server_ip),
            "app_hostname": setup_data.get("app_hostname", ""),
            "current_step": 2,
            "total_steps": 4,
        },
    )


@router.api_route("/step/3", methods=["GET", "POST"], name="setup_step_3")
async def setup_step_3(request: Request):
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
        context={"form": form, "current_step": 3, "total_steps": 4},
    )


@router.api_route("/step/4", methods=["GET", "POST"], name="setup_step_4")
async def setup_step_4(request: Request):
    """Setup step 4: Confirm configuration."""

    setup_data = get_setup_data(request)

    if request.method == "POST":
        try:
            existing_env = {}
            env_path = "/home/devpush/devpush/.env"
            if os.path.exists(env_path):
                with open(env_path) as f:
                    for line in f:
                        if "=" in line:
                            key, value = line.strip().split("=", 1)
                            existing_env[key] = value.strip('"')

            env_lines = []

            for key in [
                "SECRET_KEY",
                "ENCRYPTION_KEY",
                "POSTGRES_PASSWORD",
            ]:
                if key in existing_env:
                    env_lines.append(f'{key}="{existing_env[key]}"')

            env_lines.append(f'SERVER_IP="{setup_data["server_ip"]}"')
            env_lines.append(f'APP_HOSTNAME="{setup_data["app_hostname"]}"')
            env_lines.append(f'DEPLOY_DOMAIN="{setup_data["deploy_domain"]}"')
            env_lines.append(f'LE_EMAIL="{setup_data["le_email"]}"')
            env_lines.append(f'SSL_PROVIDER="{setup_data["ssl_provider"]}"')

            ssl_provider = setup_data["ssl_provider"]
            if ssl_provider == "cloudflare" and setup_data.get("cloudflare_api_token"):
                env_lines.append(
                    f'CF_DNS_API_TOKEN="{setup_data["cloudflare_api_token"]}"'
                )
            elif ssl_provider == "route53":
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
            elif ssl_provider == "gcloud":
                if setup_data.get("gcloud_project"):
                    env_lines.append(f'GCE_PROJECT="{setup_data["gcloud_project"]}"')
                if setup_data.get("gcloud_service_account"):
                    gcloud_sa_path = "/srv/devpush/gcloud-sa.json"
                    with open(gcloud_sa_path, "w") as f:
                        f.write(setup_data["gcloud_service_account"])
                    os.chmod(gcloud_sa_path, 0o600)
            elif ssl_provider == "digitalocean" and setup_data.get(
                "digitalocean_token"
            ):
                env_lines.append(f'DO_AUTH_TOKEN="{setup_data["digitalocean_token"]}"')
            elif ssl_provider == "azure":
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

            with open(env_path, "w") as f:
                f.write("\n".join(env_lines) + "\n")
            os.chmod(env_path, 0o600)

            config_path = Path("/var/lib/devpush/config.json")
            config = {}
            if config_path.exists():
                config = json.loads(config_path.read_text())

            config["setup_complete"] = True
            config["ssl_provider"] = setup_data["ssl_provider"]

            config_path.parent.mkdir(parents=True, exist_ok=True)
            config_path.write_text(json.dumps(config, indent=2))
            config_path.chmod(0o644)

            request.session.pop("setup_data", None)
            request.session.pop("setup_step", None)

            restart_script = "/home/devpush/devpush/scripts/prod/restart.sh"
            subprocess.run(
                [restart_script, "--ssl-provider", setup_data["ssl_provider"]],
                check=True,
                cwd="/home/devpush/devpush",
            )

            return TemplateResponse(
                request=request,
                name="setup/pages/complete.html",
                context={"app_hostname": setup_data["app_hostname"]},
            )

        except Exception as e:
            flash(request, f"Setup failed: {str(e)}", "error")
            return RedirectResponse("/setup/step/4", status_code=303)

    return TemplateResponse(
        request=request,
        name="setup/pages/confirm.html",
        context={"setup_data": setup_data, "current_step": 4, "total_steps": 4},
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

        github_data = {
            "github_app_id": str(result["id"]),
            "github_app_name": result["name"],
            "github_app_private_key": result["pem"],
            "github_app_webhook_secret": result["webhook_secret"],
            "github_app_client_id": result["client_id"],
            "github_app_client_secret": result["client_secret"],
        }

        save_setup_data(request, github_data)

        flash(request, _("GitHub App created successfully"), "success")
        flash(
            request,
            _("Important: Disable token expiration"),
            category="warning",
            description=_(
                'Go to your GitHub App settings, find "Optional features" and disable "User-to-server token expiration" to prevent sessions from expiring every 8 hours.'
            ),
            cancel={"label": _("Dismiss")},
            attrs={"data-duration": "0"},
        )
        return RedirectResponse("/setup/step/2", status_code=303)

    except Exception as e:
        flash(request, f"GitHub App creation failed: {str(e)}", "error")
        return RedirectResponse("/setup/step/2", status_code=303)
