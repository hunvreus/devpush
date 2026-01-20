import logging
import os
from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy.orm import joinedload
from starlette.responses import RedirectResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, insert
from arq.connections import ArqRedis
from typing import Any
from authlib.jose import jwt
from datetime import timedelta
import resend
import secrets

from config import Settings, get_settings
from dependencies import (
    get_translation as _,
    flash,
    TemplateResponse,
    templates,
    get_current_user,
    get_queue,
    RedirectResponseX,
    get_redis_client,
)
from db import get_db
from models import User, UserIdentity, Team, TeamMember, TeamInvite, utc_now
from forms.user import (
    UserDeleteForm,
    UserGeneralForm,
    UserEmailForm,
    UserOAuthAccessRevokeForm,
)
from forms.team import TeamLeaveForm, TeamInviteAcceptForm

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/user")


@router.api_route("/settings", methods=["GET", "POST"], name="user_settings")
async def user_settings(
    request: Request,
    fragment: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    queue: ArqRedis = Depends(get_queue),
    redis=Depends(get_redis_client),
):
    # Delete
    delete_form: Any = await UserDeleteForm.from_formdata(request, user=current_user)
    if request.method == "POST" and fragment == "danger":
        if await delete_form.validate_on_submit():
            try:
                # User is marked as deleted, actual cleanup is delegated to a job
                current_user.status = "deleted"
                await db.commit()

                await queue.enqueue_job("delete_user", current_user.id)

                flash(
                    request,
                    _(
                        'User "%(name)s" has been marked for deletion.',
                        name=current_user.name,
                    ),
                    "success",
                )

                return RedirectResponse("/auth/logout", status_code=303)
            except Exception as e:
                await db.rollback()
                logger.error(
                    f'Error marking user "{current_user.username}" as deleted: {str(e)}'
                )
                flash(
                    request,
                    _("An error occurred while marking the user for deletion."),
                    "error",
                )

        return RedirectResponse(
            url=str(request.url_for("user_settings")) + "#danger",
            status_code=303,
        )

    # General
    general_form: Any = await UserGeneralForm.from_formdata(
        request,
        data={"name": current_user.name, "username": current_user.username},
        db=db,
        user=current_user,
    )

    if fragment == "general":
        if request.method == "POST" and await general_form.validate_on_submit():
            # Name
            current_user.name = general_form.name.data or ""

            # Username
            old_username = current_user.username
            current_user.username = general_form.username.data or ""

            # Avatar upload
            avatar_file = general_form.avatar.data
            if (
                avatar_file
                and hasattr(avatar_file, "filename")
                and avatar_file.filename
            ):
                try:
                    from PIL import Image

                    avatar_dir = os.path.join(settings.upload_dir, "avatars")
                    os.makedirs(avatar_dir, exist_ok=True)

                    target_filename = f"user_{current_user.id}.webp"
                    target_filepath = os.path.join(avatar_dir, target_filename)

                    await avatar_file.seek(0)
                    img = Image.open(avatar_file.file)

                    if img.mode != "RGBA":
                        img = img.convert("RGBA")

                    max_size = (512, 512)
                    img.thumbnail(max_size)

                    img.save(target_filepath, "WEBP", quality=85)

                    current_user.has_avatar = True
                    current_user.updated_at = utc_now()
                except Exception as e:
                    logger.error(f"Error processing avatar: {str(e)}")
                    flash(request, _("Avatar could not be updated."), "error")

            # Avatar deletion
            if general_form.delete_avatar.data:
                try:
                    avatar_dir = os.path.join(settings.upload_dir, "avatars")
                    filename = f"user_{current_user.id}.webp"
                    filepath = os.path.join(avatar_dir, filename)

                    if os.path.exists(filepath):
                        os.remove(filepath)

                    current_user.has_avatar = False
                    current_user.updated_at = utc_now()
                except Exception as e:
                    logger.error(f"Error deleting avatar: {str(e)}")
                    flash(request, _("Avatar could not be removed."), "error")

            await db.commit()
            flash(request, _("General settings updated."), "success")

            # Redirect if the name has changed
            if old_username != current_user.username:
                new_url = request.url_for("user_settings")

                if request.headers.get("HX-Request"):
                    return Response(
                        status_code=200, headers={"HX-Redirect": str(new_url)}
                    )
                else:
                    return RedirectResponse(new_url, status_code=303)

        if request.headers.get("HX-Request"):
            return TemplateResponse(
                request=request,
                name="user/partials/_settings-general.html",
                context={
                    "current_user": current_user,
                    "general_form": general_form,
                },
            )

    # Email
    email_form: Any = await UserEmailForm.from_formdata(
        request, data={"email": current_user.email}
    )

    if fragment == "email":
        if request.method == "POST" and await email_form.validate_on_submit():
            new_email = email_form.email.data
            expires_at = utc_now() + timedelta(seconds=settings.magic_link_ttl_seconds)
            jti = secrets.token_urlsafe(32)
            token_payload = {
                "user_id": current_user.id,
                "new_email": new_email,
                "exp": int(expires_at.timestamp()),
                "iat": int(utc_now().timestamp()),
                "type": "email_change",
                "jti": jti,
            }

            change_token = jwt.encode(
                {"alg": "HS256"}, token_payload, settings.secret_key
            )
            change_token_str = (
                change_token.decode("utf-8")
                if isinstance(change_token, bytes)
                else change_token
            )

            verify_link = str(
                request.url_for("auth_email_verify").include_query_params(
                    token=change_token_str
                )
            )

            resend.api_key = settings.resend_api_key

            try:
                await redis.setex(
                    f"magic_link:email_change:{jti}",
                    settings.magic_link_ttl_seconds,
                    "1",
                )
                resend.Emails.send(
                    {
                        "from": f"{settings.email_sender_name} <{settings.email_sender_address}>",
                        "to": [new_email],
                        "subject": _("Verify your new email address"),
                        "html": templates.get_template(
                            "email/email-change.html"
                        ).render(
                            {
                                "request": request,
                                "email": new_email,
                                "verify_link": verify_link,
                                "magic_link_ttl_minutes": max(
                                    1, settings.magic_link_ttl_seconds // 60
                                ),
                                "email_logo": f"{settings.email_logo}"
                                or request.url_for("assets", path="logo-email.png"),
                                "app_name": settings.app_name,
                                "app_description": settings.app_description,
                                "app_url": f"{settings.url_scheme}://{settings.app_hostname}",
                            }
                        ),
                    }
                )
                flash(
                    request,
                    _(
                        "Verification email sent to %(email)s. Please check your inbox.",
                        email=new_email,
                    ),
                    "success",
                )
            except Exception as e:
                logger.error(f"Failed to send email change verification: {str(e)}")
                flash(
                    request,
                    _(
                        "Uh oh, something went wrong. We couldn't send a verification link to %(email)s. Please try again.",
                        email=new_email,
                    ),
                    "error",
                )

        if request.headers.get("HX-Request"):
            return TemplateResponse(
                request=request,
                name="user/partials/_settings-email.html",
                context={
                    "current_user": current_user,
                    "email_form": email_form,
                },
            )

    # Teams
    leave_team_form: Any = await TeamLeaveForm.from_formdata(request)

    if request.method == "POST" and fragment == "teams":
        if await leave_team_form.validate_on_submit():
            is_allowed_to_leave = True
            if leave_team_form.team_id.data == current_user.default_team_id:
                flash(request, _("You cannot leave your default team."), "error")
                is_allowed_to_leave = False
            else:
                result = await db.execute(
                    select(TeamMember).where(
                        TeamMember.team_id == leave_team_form.team_id.data,
                        TeamMember.user_id != current_user.id,
                        TeamMember.role == "owner",
                        TeamMember.status != "deleted",
                    )
                )
                other_owners = result.scalars().all()
                if len(other_owners) == 0:
                    flash(
                        request,
                        _(
                            "You cannot leave the team because you are the only member or the only owner. You can assign a new owner and leave, or delete the team."
                        ),
                        "error",
                    )
                    is_allowed_to_leave = False

            if is_allowed_to_leave:
                team = await db.get(Team, leave_team_form.team_id.data)
                if not team:
                    flash(request, _("Team not found."), "error")
                else:
                    result = await db.execute(
                        delete(TeamMember).where(
                            TeamMember.user_id == current_user.id,
                            TeamMember.team_id == leave_team_form.team_id.data,
                        )
                    )
                    await db.commit()

                    flash(
                        request,
                        _(
                            'You have left the "%(team)s" team.',
                            team=team.name,
                        ),
                        "success",
                    )

    result = await db.execute(
        select(Team, TeamMember.role)
        .join(TeamMember, Team.id == TeamMember.team_id)
        .where(Team.status != "deleted", TeamMember.user_id == current_user.id)
        .order_by(Team.updated_at.desc())
    )
    teams_and_roles = result.all()

    if request.headers.get("HX-Request") and fragment == "teams":
        return TemplateResponse(
            request=request,
            name="user/partials/_settings-teams.html",
            context={
                "current_user": current_user,
                "teams_and_roles": teams_and_roles,
                "leave_team_form": leave_team_form,
            },
        )

    # Authentication
    result = await db.execute(
        select(UserIdentity).where(UserIdentity.user_id == current_user.id)
    )
    identities = result.scalars().all()

    github_username = None
    google_email = None

    for identity in identities:
        if identity.provider == "github" and identity.provider_metadata:
            github_username = identity.provider_metadata.get("login")
        elif identity.provider == "google" and identity.provider_metadata:
            google_email = identity.provider_metadata.get("email")

    revoke_oauth_access_form: Any = await UserOAuthAccessRevokeForm.from_formdata(
        request
    )

    if request.method == "POST" and fragment == "revoke_oauth_access":
        if await revoke_oauth_access_form.validate_on_submit():
            provider = revoke_oauth_access_form.provider.data
            provider_name = "Google" if provider == "google" else "GitHub"

            try:
                result = await db.execute(
                    delete(UserIdentity).where(
                        UserIdentity.user_id == current_user.id,
                        UserIdentity.provider == provider,
                    )
                )
                await db.commit()

                if result.rowcount > 0:
                    flash(
                        request,
                        _(
                            "%(provider)s account disconnected successfully.",
                            provider=provider_name,
                        ),
                        "success",
                    )
                    # Update the appropriate variable
                    if provider == "github":
                        github_username = None
                    else:
                        google_email = None
                else:
                    flash(
                        request,
                        _("No %(provider)s account connected.", provider=provider_name),
                        "warning",
                    )
            except Exception:
                flash(
                    request,
                    _(
                        "Error disconnecting %(provider)s account.",
                        provider=provider_name,
                    ),
                    "error",
                )

        if request.headers.get("HX-Request"):
            return TemplateResponse(
                request=request,
                name="user/partials/_settings-authentication.html",
                context={
                    "revoke_oauth_access_form": revoke_oauth_access_form,
                    "current_user": current_user,
                    "github_username": github_username,
                    "google_email": google_email,
                },
            )

    return TemplateResponse(
        request=request,
        name="user/pages/settings.html",
        context={
            "current_user": current_user,
            "delete_form": delete_form,
            "general_form": general_form,
            "email_form": email_form,
            "github_username": github_username,
            "google_email": google_email,
            "teams_and_roles": teams_and_roles,
            "leave_team_form": leave_team_form,
            "revoke_oauth_access_form": revoke_oauth_access_form,
        },
    )


@router.api_route("/notifications", methods=["GET", "POST"], name="user_notifications")
async def user_notifications(
    request: Request,
    fragment: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    accept_invite_form: Any = await TeamInviteAcceptForm.from_formdata(request)

    if request.method == "POST" and fragment == "accept_invite":
        if await accept_invite_form.validate_on_submit():
            try:
                invite = await db.scalar(
                    select(TeamInvite)
                    .options(joinedload(TeamInvite.team))
                    .where(
                        TeamInvite.id == accept_invite_form.invite_id.data,
                        TeamInvite.status == "pending",
                        TeamInvite.email == current_user.email,
                    )
                )
                if not invite or invite.expires_at < utc_now():
                    flash(request, _("Invalid or expired invitation."), "error")
                    return templates.TemplateResponse(
                        request=request,
                        name="layouts/fragment.html",
                        context={"content": ""},
                        status_code=200,
                    )

                invite.status = "accepted"
                await db.execute(
                    insert(TeamMember).values(
                        team_id=invite.team_id,
                        user_id=current_user.id,
                        role=invite.role,
                    )
                )
                await db.commit()

                flash(
                    request,
                    _(
                        'You have accepted the invitation to join "%(team_name)s".',
                        team_name=invite.team.name,
                    ),
                    "success",
                )

                return RedirectResponseX(
                    str(request.url_for("team_index", team_slug=invite.team.slug)),
                    status_code=303,
                    request=request,
                )
            except Exception as e:
                logger.error(f"Error accepting invitation: {str(e)}")
                flash(
                    request,
                    _("An error occurred while accepting the invitation."),
                    "error",
                )
                await db.rollback()

    result = await db.execute(
        select(TeamInvite)
        .where(
            TeamInvite.email == current_user.email,
            TeamInvite.status == "pending",
        )
        .options(joinedload(TeamInvite.team))
        .options(joinedload(TeamInvite.inviter))
    )
    invites = result.scalars().all()

    if len(invites) == 0:
        return Response(status_code=204)

    return TemplateResponse(
        request=request,
        name="user/partials/_notifications.html",
        context={
            "current_user": current_user,
            "invites": invites,
            "accept_invite_form": accept_invite_form,
        },
    )
