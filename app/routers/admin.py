import logging
import os
import re
from pathlib import Path
from fastapi import APIRouter, Request, Depends, Query
import json
import httpx
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
    PresetForm,
    RegistryActionForm,
    RegistrySlugForm,
    RunnerForm,
    RunnerToggleForm,
    PresetToggleForm,
)
from utils.registry import (
    load_catalog,
    load_overrides,
    save_overrides,
    normalize_overrides,
    load_registry_settings,
    build_registry_sources,
    CatalogSetting,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin")

USERS_PER_PAGE = 10
ALLOWLIST_PER_PAGE = 10
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

    action = None
    if request.method == "POST":
        form_data = await request.form()
        action = form_data.get("action")

    add_allowlist_form = await AllowlistAddForm.from_formdata(request)
    delete_allowlist_form = await AllowlistDeleteForm.from_formdata(request)
    import_allowlist_form = await AllowlistImportForm.from_formdata(request)
    registry_action_form = await RegistryActionForm.from_formdata(request)
    runner_form = await RunnerForm.from_formdata(request)
    preset_form = await PresetForm.from_formdata(request)
    runner_toggle_form = await RunnerToggleForm.from_formdata(request)
    preset_toggle_form = await PresetToggleForm.from_formdata(request)
    registry_slug_form = await RegistrySlugForm.from_formdata(request)

    registry_dir = Path(settings.data_dir) / "registry"
    catalog_path = registry_dir / "catalog.json"
    overrides_path = registry_dir / "overrides.json"

    registry_catalog = load_catalog(catalog_path) if catalog_path.exists() else None
    registry_overrides = load_overrides(overrides_path) if overrides_path.exists() else {}
    if registry_catalog and overrides_path.exists():
        registry_runners, registry_presets = load_registry_settings(
            catalog_path, overrides_path
        )
    else:
        registry_runners, registry_presets = [], []


    # Registry actions
    if action and action.startswith("registry_"):
        if request.method == "POST":
            if action in {"registry_sync_catalog", "registry_pull_all", "registry_remove_all"}:
                if not await registry_action_form.validate_on_submit():
                    flash(request, _("Invalid registry request."), "error")
                    return RedirectResponse("/admin", status_code=303)
            elif action == "registry_toggle_runner":
                if not await runner_toggle_form.validate_on_submit():
                    flash(request, _("Invalid runner update."), "error")
                    return RedirectResponse("/admin", status_code=303)
            elif action == "registry_toggle_preset":
                if not await preset_toggle_form.validate_on_submit():
                    flash(request, _("Invalid preset update."), "error")
                    return RedirectResponse("/admin", status_code=303)
            elif action in {"registry_update_runner", "registry_add_runner"}:
                if not await runner_form.validate_on_submit():
                    flash(request, _("Invalid runner details."), "error")
                    return RedirectResponse("/admin", status_code=303)
            elif action in {"registry_update_preset", "registry_add_preset"}:
                if not await preset_form.validate_on_submit():
                    flash(request, _("Invalid preset details."), "error")
                    return RedirectResponse("/admin", status_code=303)
            elif action in {
                "registry_reset_runner",
                "registry_reset_preset",
                "registry_pull_runner",
                "registry_remove_runner",
            }:
                if not await registry_slug_form.validate_on_submit():
                    flash(request, _("Invalid registry action."), "error")
                    return RedirectResponse("/admin", status_code=303)
            else:
                if not await registry_action_form.validate_on_submit():
                    flash(request, _("Invalid registry request."), "error")
                    return RedirectResponse("/admin", status_code=303)

            overrides = None
            if action in {
                "registry_update_runner",
                "registry_toggle_runner",
                "registry_reset_runner",
                "registry_add_runner",
                "registry_update_preset",
                "registry_toggle_preset",
                "registry_reset_preset",
                "registry_add_preset",
            }:
                try:
                    overrides = normalize_overrides(load_overrides(overrides_path))
                except Exception as exc:
                    flash(
                        request,
                        _("Failed to load registry overrides."),
                        "error",
                        str(exc),
                    )
                    return RedirectResponse("/admin", status_code=303)

            if action == "registry_sync_catalog":
                catalog_url = settings.registry_catalog_url
                if not catalog_url:
                    flash(
                        request,
                        _("Registry catalog URL is not configured."),
                        "error",
                    )
                    return RedirectResponse("/admin", status_code=303)
                try:
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        response = await client.get(catalog_url)
                        response.raise_for_status()
                        raw = response.json()
                    catalog = CatalogSetting.model_validate(raw)
                    if not catalog.meta.source:
                        catalog.meta.source = "registry"
                    registry_dir.mkdir(parents=True, exist_ok=True)
                    catalog_path.write_text(
                        json.dumps(catalog.model_dump(), indent=2, sort_keys=True)
                        + "\n",
                        encoding="utf-8",
                    )
                    flash(request, _("Catalog synced successfully."), "success")
                except Exception as exc:
                    flash(request, _("Failed to sync catalog."), "error", str(exc))

            elif action == "registry_update_runner":
                slug = (runner_form.slug.data or "").strip()
                overrides["runners"][slug] = {
                    "slug": slug,
                    "name": (runner_form.name.data or "").strip(),
                    "category": (runner_form.category.data or "").strip() or None,
                    "image": (runner_form.image.data or "").strip(),
                    "enabled": bool(runner_form.enabled.data),
                }
                save_overrides(overrides_path, overrides)
                flash(request, _("Runner override saved."), "success")

            elif action == "registry_toggle_runner":
                slug = (runner_toggle_form.slug.data or "").strip()
                enabled = bool(runner_toggle_form.enabled.data)
                current = overrides["runners"].get(slug)
                if isinstance(current, dict):
                    current["enabled"] = enabled
                    overrides["runners"][slug] = current
                else:
                    overrides["runners"][slug] = {"enabled": enabled}
                save_overrides(overrides_path, overrides)
                flash(request, _("Runner updated."), "success")

            elif action == "registry_reset_runner":
                slug = (registry_slug_form.slug.data or "").strip()
                if slug and slug in overrides["runners"]:
                    overrides["runners"].pop(slug, None)
                    save_overrides(overrides_path, overrides)
                    flash(request, _("Runner override removed."), "success")

            elif action == "registry_add_runner":
                slug = (runner_form.slug.data or "").strip()
                overrides["runners"][slug] = {
                    "slug": slug,
                    "name": (runner_form.name.data or "").strip(),
                    "category": (runner_form.category.data or "").strip() or None,
                    "image": (runner_form.image.data or "").strip(),
                    "enabled": bool(runner_form.enabled.data),
                }
                save_overrides(overrides_path, overrides)
                flash(request, _("Custom runner added."), "success")

            elif action == "registry_update_preset":
                slug = (preset_form.slug.data or "").strip()
                config = {
                    "runner": (preset_form.runner.data or "").strip(),
                    "build_command": (preset_form.build_command.data or "").strip(),
                    "pre_deploy_command": (preset_form.pre_deploy_command.data or "").strip(),
                    "start_command": (preset_form.start_command.data or "").strip(),
                    "logo": (preset_form.logo.data or "").strip(),
                }
                root_directory = (preset_form.root_directory.data or "").strip()
                if root_directory:
                    config["root_directory"] = root_directory
                if preset_form.detection.data:
                    config["detection"] = json.loads(preset_form.detection.data)

                overrides["presets"][slug] = {
                    "slug": slug,
                    "name": (preset_form.name.data or "").strip(),
                    "category": (preset_form.category.data or "").strip() or None,
                    "config": config,
                    "enabled": bool(preset_form.enabled.data),
                }
                save_overrides(overrides_path, overrides)
                flash(request, _("Preset override saved."), "success")

            elif action == "registry_toggle_preset":
                slug = (preset_toggle_form.slug.data or "").strip()
                enabled = bool(preset_toggle_form.enabled.data)
                current = overrides["presets"].get(slug)
                if isinstance(current, dict):
                    current["enabled"] = enabled
                    overrides["presets"][slug] = current
                else:
                    overrides["presets"][slug] = {"enabled": enabled}
                save_overrides(overrides_path, overrides)
                flash(request, _("Preset updated."), "success")

            elif action == "registry_reset_preset":
                slug = (registry_slug_form.slug.data or "").strip()
                if slug and slug in overrides["presets"]:
                    overrides["presets"].pop(slug, None)
                    save_overrides(overrides_path, overrides)
                    flash(request, _("Preset override removed."), "success")

            elif action == "registry_add_preset":
                slug = (preset_form.slug.data or "").strip()
                config = {
                    "runner": (preset_form.runner.data or "").strip(),
                    "build_command": (preset_form.build_command.data or "").strip(),
                    "pre_deploy_command": (preset_form.pre_deploy_command.data or "").strip(),
                    "start_command": (preset_form.start_command.data or "").strip(),
                    "logo": (preset_form.logo.data or "").strip(),
                }
                root_directory = (preset_form.root_directory.data or "").strip()
                if root_directory:
                    config["root_directory"] = root_directory
                if preset_form.detection.data:
                    config["detection"] = json.loads(preset_form.detection.data)

                overrides["presets"][slug] = {
                    "slug": slug,
                    "name": (preset_form.name.data or "").strip(),
                    "category": (preset_form.category.data or "").strip() or None,
                    "config": config,
                    "enabled": bool(preset_form.enabled.data),
                }
                save_overrides(overrides_path, overrides)
                flash(request, _("Custom preset added."), "success")

            elif action == "registry_pull_runner":
                slug = (registry_slug_form.slug.data or "").strip()
                if slug:
                    await queue.enqueue_job("pull_runner_image", slug)
                    flash(request, _("Runner pull queued."), "success")

            elif action == "registry_pull_all":
                await queue.enqueue_job("pull_all_runner_images")
                flash(request, _("Runner pull queued."), "success")

            elif action == "registry_remove_runner":
                slug = (registry_slug_form.slug.data or "").strip()
                if slug:
                    await queue.enqueue_job("remove_runner_image", slug)
                    flash(request, _("Runner image removal queued."), "success")

            elif action == "registry_remove_all":
                await queue.enqueue_job("remove_all_runner_images")
                flash(request, _("Runner image removal queued."), "success")

            if not request.headers.get("HX-Request"):
                return RedirectResponse("/admin", status_code=303)

    # Add allowlist rule
    if action == "add_allowlist":
        if request.method == "POST":
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

        allowlist_pagination = await get_allowlist_pagination(
            db, allowlist_page, allowlist_search
        )

        if request.headers.get("HX-Request"):
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

    # Delete allowlist rule
    if action == "delete_allowlist":
        if request.method == "POST":
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

        allowlist_pagination = await get_allowlist_pagination(
            db, allowlist_page, allowlist_search
        )

        if request.headers.get("HX-Request"):
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

    # Import allowlist
    if action == "import_allowlist":
        if request.method == "POST":
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

        allowlist_pagination = await get_allowlist_pagination(
            db, allowlist_page, allowlist_search
        )

        if request.headers.get("HX-Request"):
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

    # Delete user
    delete_user_form = await AdminUserDeleteForm.from_formdata(request)

    if action == "delete_user":
        if request.method == "POST":
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

        users_pagination = await get_users_pagination(db, users_page, users_search)

        if request.headers.get("HX-Request"):
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

    # System
    version_info = None
    try:
        if os.path.exists(settings.version_file):
            with open(settings.version_file, encoding="utf-8") as f:
                version_info = json.load(f)
    except Exception:
        version_info = None

    if request.headers.get("HX-Request") and fragment == "system":
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
            name="admin/partials/_new-version.html",
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

    if request.headers.get("HX-Request"):
        if fragment == "allowlist-content":
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
        elif fragment == "users-content":
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
        elif fragment == "registry-check":
            remote_version = None
            remote_error = None
            local_version = None
            try:
                catalog = load_catalog(catalog_path)
                local_version = catalog.meta.version
            except Exception as exc:
                remote_error = str(exc)

            if settings.registry_catalog_url:
                try:
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        response = await client.get(settings.registry_catalog_url)
                        response.raise_for_status()
                        raw = response.json()
                    remote_catalog = CatalogSetting.model_validate(raw)
                    remote_version = remote_catalog.meta.version
                except Exception as exc:
                    remote_error = str(exc)

            return TemplateResponse(
                request=request,
                name="admin/partials/_settings-registry-check.html",
                context={
                    "current_user": current_user,
                    "registry_form": registry_action_form,
                    "registry_slug_form": registry_slug_form,
                    "runner_form": runner_form,
                    "preset_form": preset_form,
                    "runner_toggle_form": runner_toggle_form,
                    "preset_toggle_form": preset_toggle_form,
                    "registry_local_version": local_version,
                    "registry_remote_version": remote_version,
                    "registry_error": remote_error,
                },
            )

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
            "registry_form": registry_action_form,
            "registry_slug_form": registry_slug_form,
            "runner_form": runner_form,
            "preset_form": preset_form,
            "runner_toggle_form": runner_toggle_form,
            "preset_toggle_form": preset_toggle_form,
            "registry_catalog": registry_catalog,
            "registry_overrides": registry_overrides,
            "registry_sources": build_registry_sources(
                registry_catalog, registry_overrides
            )
            if registry_catalog and overrides_path.exists()
            else {"runners": {}, "presets": {}},
            "registry_runners": registry_runners,
            "registry_presets": registry_presets,
            "registry_catalog_url": settings.registry_catalog_url,
        },
    )
