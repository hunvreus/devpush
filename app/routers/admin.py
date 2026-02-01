import logging
import os
import re
import json
import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, Request, Depends, Query
from starlette.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from arq.connections import ArqRedis

from config import Settings, get_settings
from dependencies import (
    get_translation as _,
    flash,
    TemplateResponse,
    get_current_user,
    is_superadmin,
    get_queue,
)
from db import get_db
from models import User, Allowlist
from utils.pagination import paginate
from forms.admin import (
    AdminUserDeleteForm,
    AllowlistAddForm,
    AllowlistDeleteForm,
    AllowlistImportForm,
    RegistryImageActionForm,
    RegistryUpdateForm,
    RunnerToggleForm,
    PresetToggleForm,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin")

USERS_PER_PAGE = 1
ALLOWLIST_PER_PAGE = 2
EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DOMAIN_REGEX = re.compile(r"^(?!-)([a-z0-9-]+\.)+[a-z]{2,}$", re.IGNORECASE)


def normalize_allowlist_value(entry_type: str, value: str | None) -> str:
    value = value or ""
    if entry_type in {"email", "domain"}:
        return value.strip().strip("'\"").strip().lower()
    return value.strip()


def is_valid_allowlist_value(entry_type: str, value: str) -> bool:
    if entry_type == "email":
        return bool(value and EMAIL_REGEX.match(value))
    if entry_type == "domain":
        regex = re.compile(r"^(?!-)([a-z0-9-]+\.)+[a-z]{2,}$", re.IGNORECASE)
        return bool(value and regex.match(value))
    if entry_type == "pattern":
        if not value:
            return False
        try:
            re.compile(value)
            return True
        except re.error:
            return False
    return False


async def get_allowlist_pagination(
    db: AsyncSession,
    allowlist_page: int,
    allowlist_search: str | None = None,
):
    allowlist_query = select(Allowlist)
    if allowlist_search:
        allowlist_query = allowlist_query.where(
            Allowlist.value.ilike(f"%{allowlist_search}%")
        )
    allowlist_query = allowlist_query.order_by(Allowlist.created_at.desc())
    return await paginate(db, allowlist_query, allowlist_page, ALLOWLIST_PER_PAGE)


async def get_users_pagination(
    db: AsyncSession,
    users_page: int,
    users_search: str | None = None,
):
    users_query = select(User)
    if users_search:
        users_query = users_query.where(
            or_(
                User.email.ilike(f"%{users_search}%"),
                User.name.ilike(f"%{users_search}%"),
                User.username.ilike(f"%{users_search}%"),
            )
        )
    users_query = users_query.order_by(User.id.asc())
    return await paginate(db, users_query, users_page, USERS_PER_PAGE)


@router.api_route("", methods=["GET", "POST"], name="admin_settings")
async def admin_settings(
    request: Request,
    fragment: str | None = Query(None),
    action: str | None = Query(None),
    users_page: int = Query(1, ge=1),
    users_search: str | None = Query(None),
    allowlist_page: int = Query(1, ge=1),
    allowlist_search: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    queue: ArqRedis = Depends(get_queue),
    settings: Settings = Depends(get_settings),
):
    if not is_superadmin(current_user):
        flash(
            request,
            _("You don't have permission to access the admin panel."),
            "warning",
        )
        return RedirectResponse("/", status_code=302)

    # Registry
    runner_set_form = await RunnerToggleForm.from_formdata(request)
    preset_set_form = await PresetToggleForm.from_formdata(request)
    registry_image_form = await RegistryImageActionForm.from_formdata(request)
    registry_update_form = await RegistryUpdateForm.from_formdata(request)

    registry_state, registry_mtimes, changed_keys = settings._registry_service.load()
    if request.method == "GET" and any(changed_keys.values()):
        flash(request, _("Registry reloaded from disk."), "success")

    # Registry update
    if fragment == "registry":
        if request.method == "POST":
            if await registry_update_form.validate_on_submit():
                try:
                    await settings._registry_service.update_catalog(
                        settings.registry_catalog_url
                    )
                    registry_state = settings._registry_service.refresh()
                    settings.runners = registry_state.runners
                    settings.presets = registry_state.presets
                    flash(
                        request,
                        _(
                            "Catalog updated to %(version)s.",
                            version=registry_state.catalog.meta.version,
                        ),
                        "success",
                    )
                except Exception as exc:
                    flash(request, _("Failed to update catalog."), "error", str(exc))

        if request.headers.get("HX-Request"):
            registry_mtimes = (
                settings._registry_service.mtimes
                or settings._registry_service.get_mtimes()
            )
            registry_overrides_updated_at = (
                datetime.fromtimestamp(registry_mtimes["overrides"], tz=timezone.utc)
                if registry_mtimes.get("overrides")
                else None
            )
            return TemplateResponse(
                request=request,
                name="admin/partials/_settings-registry.html",
                context={
                    "current_user": current_user,
                    "registry_image_form": registry_image_form,
                    "runner_set_form": runner_set_form,
                    "preset_set_form": preset_set_form,
                    "registry_state": registry_state,
                    "registry_overrides_updated_at": registry_overrides_updated_at,
                },
            )

    # Registry check
    if request.headers.get("HX-Request") and fragment == "registry-check":
        local_version = (
            registry_state.catalog.meta.version if registry_state.catalog else None
        )
        remote_version = None
        if settings.registry_catalog_url:
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    response = await client.get(settings.registry_catalog_url)
                    response.raise_for_status()
                    data = response.json()
                    remote_version = data.get("meta", {}).get("version")
            except Exception as exc:
                flash(
                    request,
                    _("Failed to retrieve remote catalog."),
                    "error",
                    str(exc),
                )
        return TemplateResponse(
            request=request,
            name="admin/partials/_settings-registry-check.html",
            context={
                "current_user": current_user,
                "registry_update_form": registry_update_form,
                "registry_local_version": local_version,
                "registry_remote_version": remote_version,
            },
        )

    # Registry actions: set runner, set preset, pull image, clear image
    if action and action.startswith("registry-") and request.method == "POST":
        if action == "registry-set-runner":
            if not await runner_set_form.validate_on_submit():
                flash(request, _("Invalid runner update."), "error")
            else:
                slug = (runner_set_form.slug.data or "").strip()
                enabled = bool(runner_set_form.enabled.data)
                registry_state = settings._registry_service.set_runner(slug, enabled)
                settings.runners = registry_state.runners
                settings.presets = registry_state.presets
                flash(
                    request,
                    _(
                        "Runner %(slug)s %(enabled)s.",
                        slug=slug,
                        enabled=_("enabled") if enabled else _("disabled"),
                    ),
                    "success",
                )

        elif action == "registry-set-preset":
            if not await preset_set_form.validate_on_submit():
                flash(request, _("Invalid preset update."), "error")
            else:
                slug = (preset_set_form.slug.data or "").strip()
                enabled = bool(preset_set_form.enabled.data)
                registry_state = settings._registry_service.set_preset(slug, enabled)
                settings.runners = registry_state.runners
                settings.presets = registry_state.presets
                flash(
                    request,
                    _(
                        "Preset %(slug)s %(enabled)s.",
                        slug=slug,
                        enabled=_("enabled") if enabled else _("disabled"),
                    ),
                    "success",
                )

        elif action == "registry-pull":
            if not await registry_image_form.validate_on_submit():
                flash(request, _("Invalid registry action"), "error")
            else:
                slug = (registry_image_form.slug.data or "").strip()
                if slug:
                    await queue.enqueue_job("pull_runner_image", slug)
                    flash(
                        request,
                        _("Pulling image for %(slug)s.", slug=slug),
                        "success",
                    )
                else:
                    await queue.enqueue_job("pull_all_runner_images")
                    flash(request, _("Pulling all enabled runner images."), "success")

        elif action == "registry-clear":
            if not await registry_image_form.validate_on_submit():
                flash(request, _("Invalid registry action"), "error")
            else:
                slug = (registry_image_form.slug.data or "").strip()
                if slug:
                    await queue.enqueue_job("clear_runner_image", slug)
                    flash(
                        request,
                        _("Clearing image for %(slug)s.", slug=slug),
                        "success",
                    )
                else:
                    await queue.enqueue_job("clear_all_runner_images")
                    flash(request, _("Clearing all runner images."), "success")

        if request.headers.get("HX-Request"):
            return TemplateResponse(
                request=request,
                name="partials/_empty.html",
                context={"current_user": current_user},
            )
        else:
            return RedirectResponse("/admin#registry", status_code=303)

    # Allowlist
    add_allowlist_form = await AllowlistAddForm.from_formdata(request)
    delete_allowlist_form = await AllowlistDeleteForm.from_formdata(request)
    import_allowlist_form = await AllowlistImportForm.from_formdata(request)

    if fragment == "allowlist":
        if request.method == "POST":
            # Add allowlist rule
            if await add_allowlist_form.validate_on_submit():
                entry_type = add_allowlist_form.type.data
                normalized_value = normalize_allowlist_value(
                    entry_type, add_allowlist_form.value.data
                )

                if not normalized_value or not is_valid_allowlist_value(
                    entry_type, normalized_value
                ):
                    flash(
                        request,
                        _("Invalid allowlist value."),
                        "error",
                    )
                else:
                    existing_entry = await db.scalar(
                        select(Allowlist.id).where(
                            Allowlist.type == entry_type,
                            Allowlist.value == normalized_value,
                        )
                    )
                    if existing_entry:
                        flash(
                            request,
                            _("This allowlist entry already exists."),
                            "warning",
                        )
                    else:
                        try:
                            entry = Allowlist(type=entry_type, value=normalized_value)
                            db.add(entry)
                            await db.commit()
                            flash(
                                request,
                                _("Allowlist entry added successfully."),
                                "success",
                            )
                        except Exception as e:
                            await db.rollback()
                            logger.error(f"Error adding allowlist entry: {str(e)}")
                            flash(
                                request,
                                _("An error occurred while adding the entry."),
                                "error",
                            )
            else:
                flash(request, _("Invalid allowlist value."), "error")

            # Delete allowlist rule
            if await delete_allowlist_form.validate_on_submit():
                try:
                    entry_id = int(delete_allowlist_form.entry_id.data)
                    entry = await db.get(Allowlist, entry_id)
                    if entry:
                        await db.delete(entry)
                        await db.commit()
                        flash(
                            request,
                            _("Allowlist entry deleted successfully."),
                            "success",
                        )
                    else:
                        flash(request, _("Entry not found."), "error")
                except Exception as e:
                    await db.rollback()
                    logger.error(f"Error deleting allowlist entry: {str(e)}")
                    flash(
                        request,
                        _("An error occurred while deleting the entry."),
                        "error",
                    )

            # Import allowlist
            if await import_allowlist_form.validate_on_submit():
                try:
                    emails_text = import_allowlist_form.emails.data or ""
                    normalized_emails: list[str] = []

                    for line in emails_text.splitlines():
                        parts = line.split(",") if "," in line else [line]
                        for value in parts:
                            normalized = normalize_allowlist_value("email", value)
                            if normalized and is_valid_allowlist_value(
                                "email", normalized
                            ):
                                normalized_emails.append(normalized)

                    unique_emails = set(normalized_emails)
                    added_count = 0

                    if unique_emails:
                        existing_result = await db.execute(
                            select(Allowlist.value).where(
                                Allowlist.type == "email",
                                Allowlist.value.in_(unique_emails),
                            )
                        )
                        existing_emails = {row[0] for row in existing_result.all()}
                        new_emails = unique_emails - existing_emails

                        for email in new_emails:
                            db.add(Allowlist(type="email", value=email))

                        added_count = len(new_emails)
                        if added_count:
                            await db.commit()
                        else:
                            await db.rollback()

                    flash(
                        request,
                        _(
                            "%(count)s email(s) imported (invalid or duplicate entries were ignored).",
                            count=added_count,
                        ),
                        "success",
                    )
                except Exception as e:
                    await db.rollback()
                    logger.error(f"Error importing emails: {str(e)}")
                    flash(
                        request, _("An error occurred while importing emails."), "error"
                    )

            if request.headers.get("HX-Request"):
                allowlist_pagination = await get_allowlist_pagination(
                    db, allowlist_page, allowlist_search
                )

                return TemplateResponse(
                    request=request,
                    name="admin/partials/_settings-allowlist.html",
                    context={
                        "current_user": current_user,
                        "allowlist_entries": allowlist_pagination["items"],
                        "allowlist_pagination": allowlist_pagination,
                        "allowlist_search": allowlist_search,
                        "add_allowlist_form": add_allowlist_form,
                        "allowlist_delete_form": delete_allowlist_form,
                        "import_allowlist_form": import_allowlist_form,
                    },
                )

    if request.headers.get("HX-Request") and fragment == "allowlist-content":
        allowlist_pagination = await get_allowlist_pagination(
            db, allowlist_page, allowlist_search
        )

        return TemplateResponse(
            request=request,
            name="admin/partials/_settings-allowlist-content.html",
            context={
                "current_user": current_user,
                "allowlist_entries": allowlist_pagination["items"],
                "allowlist_pagination": allowlist_pagination,
                "allowlist_search": allowlist_search,
                "add_allowlist_form": add_allowlist_form,
                "allowlist_delete_form": delete_allowlist_form,
                "import_allowlist_form": import_allowlist_form,
            },
        )

    # Users
    delete_user_form = await AdminUserDeleteForm.from_formdata(request)

    if fragment == "users":
        if request.method == "POST":
            # Delete user
            if await delete_user_form.validate_on_submit():
                try:
                    target_user = await db.get(User, int(delete_user_form.user_id.data))

                    if not target_user or target_user.status == "deleted":
                        flash(request, _("User not found."), "error")
                        return RedirectResponse("/admin", status_code=303)

                    if is_superadmin(target_user):
                        flash(request, _("You cannot delete the superadmin."), "error")
                        return RedirectResponse("/admin", status_code=303)

                    # User is marked as deleted, actual cleanup is delegated to a job
                    target_user.status = "deleted"
                    await db.commit()

                    await queue.enqueue_job("delete_user", target_user.id)

                    flash(
                        request,
                        _(
                            'User "%(name)s" has been marked for deletion.',
                            name=target_user.name or target_user.username,
                        ),
                        "success",
                    )

                except Exception as e:
                    await db.rollback()
                    logger.error(f"Error deleting user: {str(e)}")
                    flash(
                        request,
                        _("An error occurred while deleting the user."),
                        "error",
                    )

                if not request.headers.get("HX-Request"):
                    return RedirectResponse("/admin", status_code=303)

            if request.headers.get("HX-Request"):
                users_pagination = await get_users_pagination(
                    db, users_page, users_search
                )

                return TemplateResponse(
                    request=request,
                    name="admin/partials/_settings-users.html",
                    context={
                        "current_user": current_user,
                        "users": users_pagination["items"],
                        "users_pagination": users_pagination,
                        "users_search": users_search,
                        "delete_user_form": delete_user_form,
                    },
                )

    if request.headers.get("HX-Request") and fragment == "users-content":
        users_pagination = await get_users_pagination(db, users_page, users_search)

        return TemplateResponse(
            request=request,
            name="admin/partials/_settings-users-content.html",
            context={
                "current_user": current_user,
                "users": users_pagination["items"],
                "users_pagination": users_pagination,
                "users_search": users_search,
                "delete_user_form": delete_user_form,
            },
        )

    # Installation
    version_info = None
    try:
        if os.path.exists(settings.version_file):
            with open(settings.version_file, encoding="utf-8") as f:
                version_info = json.load(f)
    except Exception:
        version_info = None

    # Installation check
    if request.headers.get("HX-Request") and fragment == "installation-check":
        latest_tag = None
        error = None

        current_ref = version_info.get("git_ref") if version_info else None

        if current_ref:
            try:
                user_agent = f"devpush/{current_ref or 'dev'} (+https://github.com/hunvreus/devpush)"
                headers = {
                    "Accept": "application/vnd.github+json",
                    "User-Agent": user_agent,
                }
                async with httpx.AsyncClient(timeout=3.0, headers=headers) as client:
                    per_page = 50
                    request_latest_tag = await client.get(
                        "https://api.github.com/repos/hunvreus/devpush/tags",
                        params={"per_page": per_page},
                    )
                    if request_latest_tag.status_code == 200:
                        data = request_latest_tag.json()
                        if isinstance(data, list):
                            for item in data:
                                name = item.get("name") or ""
                                if re.match(r"^v?\d+\.\d+\.\d+$", name):
                                    latest_tag = name
                                    break
                    elif request_latest_tag.status_code == 403:
                        raise Exception("GitHub API rate limit exceeded.")
                    else:
                        raise Exception(
                            f"GitHub API returned status code {request_latest_tag.status_code}"
                        )
            except Exception as e:
                flash(request, _("Could not retrieve latest version"), "error", str(e))

        if latest_tag and current_ref and latest_tag == current_ref:
            latest_tag = None

        return TemplateResponse(
            request=request,
            name="admin/partials/_settings-installation-check.html",
            context={
                "current_user": current_user,
                "version_info": version_info,
                "latest_tag": latest_tag,
                "error": error,
            },
        )

    allowlist_pagination = await get_allowlist_pagination(
        db, allowlist_page, allowlist_search
    )
    users_pagination = await get_users_pagination(db, users_page, users_search)
    registry_mtimes = (
        settings._registry_service.mtimes or settings._registry_service.get_mtimes()
    )
    registry_overrides_updated_at = (
        datetime.fromtimestamp(registry_mtimes["overrides"], tz=timezone.utc)
        if registry_mtimes.get("overrides")
        else None
    )

    if not request.headers.get("HX-Request"):
        return TemplateResponse(
            request=request,
            name="admin/pages/settings.html",
            context={
                "current_user": current_user,
                "users": users_pagination["items"],
                "users_pagination": users_pagination,
                "users_search": users_search,
                "delete_user_form": delete_user_form,
                "version_info": version_info,
                "allowlist_entries": allowlist_pagination["items"],
                "allowlist_pagination": allowlist_pagination,
                "allowlist_search": allowlist_search,
                "add_allowlist_form": add_allowlist_form,
                "allowlist_delete_form": delete_allowlist_form,
                "import_allowlist_form": import_allowlist_form,
                "registry_image_form": registry_image_form,
                "registry_update_form": registry_update_form,
                "runner_set_form": runner_set_form,
                "preset_set_form": preset_set_form,
                "registry_state": registry_state,
                "registry_overrides_updated_at": registry_overrides_updated_at,
            },
        )
