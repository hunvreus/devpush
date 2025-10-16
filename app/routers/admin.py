import logging
from fastapi import APIRouter, Request, Depends, Query
import json
import os
import httpx
from starlette.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from arq.connections import ArqRedis

from dependencies import (
    get_translation as _,
    flash,
    TemplateResponse,
    get_current_user,
    is_superadmin,
    get_job_queue,
)
from db import get_db
from models import User
from forms.admin import AdminUserDeleteForm

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin")


@router.api_route("", methods=["GET", "POST"], name="admin_settings")
async def admin_settings(
    request: Request,
    fragment: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    job_queue: ArqRedis = Depends(get_job_queue),
):
    if not is_superadmin(current_user):
        flash(
            request,
            _("You don't have permission to access the admin panel."),
            "warning",
        )
        return RedirectResponse("/", status_code=302)

    delete_form = await AdminUserDeleteForm.from_formdata(request)

    if fragment == "delete_user":
        if request.method == "POST" and await delete_form.validate_on_submit():
            try:
                # Parse user id as integer
                try:
                    user_id = int(delete_form.user_id.data)
                except (TypeError, ValueError):
                    flash(request, _("Invalid user id."), "error")
                    if request.headers.get("HX-Request"):
                        result = await db.execute(select(User).order_by(User.id.asc()))
                        users = result.scalars().all()
                        return TemplateResponse(
                            request=request,
                            name="admin/partials/_settings-users.html",
                            context={
                                "current_user": current_user,
                                "users": users,
                                "delete_form": delete_form,
                            },
                        )
                    return RedirectResponse("/admin", status_code=303)

                target_user = await db.get(User, user_id)

                if not target_user or target_user.status == "deleted":
                    flash(request, _("User not found."), "error")
                    return RedirectResponse("/admin", status_code=303)

                # Prevent deleting superadmin
                if target_user.id == 1:
                    flash(request, _("You cannot delete the superadmin."), "error")
                    return RedirectResponse("/admin", status_code=303)

                target_user.status = "deleted"
                await db.commit()

                # Delegate cleanup to background job
                await job_queue.enqueue_job("cleanup_user", target_user.id)

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
                flash(request, _("An error occurred while deleting the user."), "error")

            if not request.headers.get("HX-Request"):
                return RedirectResponse("/admin", status_code=303)

        for error in delete_form.confirm.errors:
            flash(request, error, "error")

        if request.headers.get("HX-Request"):
            result = await db.execute(select(User).order_by(User.id.asc()))
            users = result.scalars().all()
            return TemplateResponse(
                request=request,
                name="admin/partials/_settings-users.html",
                context={
                    "current_user": current_user,
                    "users": users,
                    "delete_form": delete_form,
                },
            )

    version_info = None
    try:
        version_path = "/var/lib/devpush/version.json"
        if os.path.exists(version_path):
            with open(version_path, "r") as f:
                version_info = json.load(f)
    except Exception:
        version_info = None

    if request.headers.get("HX-Request") and fragment == "system":
        latest_tag = None
        latest_url = None
        error = None

        if version_info and version_info.get("git_ref"):
            try:
                user_agent = f"devpush/{version_info.get('git_ref') or 'dev'} (+https://github.com/hunvreus/devpush)"
                headers = {
                    "Accept": "application/vnd.github+json",
                    "User-Agent": user_agent,
                }
                async with httpx.AsyncClient(timeout=3.0, headers=headers) as client:
                    request_latest_tag = await client.get(
                        "https://api.github.com/repos/hunvreus/devpush/tags",
                        params={"per_page": 1},
                    )
                    if request_latest_tag.status_code == 200:
                        data = request_latest_tag.json()
                        if isinstance(data, list) and len(data) > 0:
                            latest_tag = data[0].get("name")
                    elif request_latest_tag.status_code == 403:
                        raise Exception("GitHub API rate limit exceeded.")
                    else:
                        raise Exception(
                            f"GitHub API returned status code {request_latest_tag.status_code}"
                        )

                    if not latest_tag:
                        raise Exception("No latest tag found.")

            except Exception as e:
                flash(request, _("Could not retrieve latest version"), "error", str(e))

        return TemplateResponse(
            request=request,
            name="admin/partials/_new-version.html",
            context={
                "current_user": current_user,
                "version_info": version_info,
                "latest_tag": latest_tag,
                "latest_url": latest_url,
                "error": error,
            },
        )

    result = await db.execute(select(User).order_by(User.id.asc()))
    users = result.scalars().all()

    return TemplateResponse(
        request=request,
        name="admin/pages/settings.html",
        context={
            "current_user": current_user,
            "users": users,
            "delete_form": delete_form,
            "version_info": version_info,
        },
    )
