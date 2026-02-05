from fastapi import APIRouter, Request, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from dependencies import (
    get_current_user,
    get_google_oauth_client,
    get_google_user_info,
    flash,
    get_db,
    get_translation as _,
)
from models import User, UserIdentity
from utils.user import get_user_by_provider
from utils.urls import safe_redirect, get_relative_url, get_app_base_url, get_absolute_url

router = APIRouter(prefix="/api/google")


@router.get("/authorize", name="google_authorize")
async def google_authorize(
    request: Request,
    next: str | None = None,
    current_user: User = Depends(get_current_user),
    oauth_client=Depends(get_google_oauth_client),
    client_origin: str | None = None,
):
    """Authorize Google OAuth for account linking"""
    if not oauth_client or not oauth_client.google:
        flash(request, _("Google OAuth not configured."), "error")
        redirect_url = safe_redirect(
            request,
            next_value=next,
            referer=request.headers.get("Referer"),
        )
        return RedirectResponse(redirect_url, status_code=303)

    redirect_url = safe_redirect(
        request,
        next_value=next,
        referer=request.headers.get("Referer"),
    )
    request.session["redirect_after_google"] = redirect_url
    if client_origin:
        request.session["google_link_client_origin"] = client_origin

    return await oauth_client.google.authorize_redirect(
        request,
        str(
            get_absolute_url(
                request, "google_authorize_callback", client_origin=client_origin
            )
        ),
    )


@router.get("/authorize/callback", name="google_authorize_callback")
async def google_authorize_callback(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    oauth_client=Depends(get_google_oauth_client),
):
    """Handle Google OAuth callback for account linking"""

    redirect_url = safe_redirect(
        request,
        next_value=request.session.pop("redirect_after_google", "/"),
        referer=None,
    )

    if not oauth_client or not oauth_client.google:
        flash(request, _("Google OAuth not configured."), "error")
        return RedirectResponse(redirect_url, status_code=303)

    try:
        request.session.pop("google_link_client_origin", None)
        token = await oauth_client.google.authorize_access_token(request)
        google_user_info = await get_google_user_info(oauth_client, token)

        if not google_user_info:
            flash(request, _("Failed to get user info from Google"), "error")
            return RedirectResponse(redirect_url, status_code=303)

        existing_user = await get_user_by_provider(db, "google", google_user_info["id"])
        if existing_user and existing_user.id != current_user.id:
            flash(
                request,
                _("This Google account is already linked to another user"),
                "error",
            )
            return RedirectResponse(redirect_url, status_code=303)

        result = await db.execute(
            select(UserIdentity).where(
                UserIdentity.user_id == current_user.id,
                UserIdentity.provider == "google",
            )
        )
        google_identity = result.scalar_one_or_none()

        if google_identity:
            google_identity.access_token = token["access_token"]
            google_identity.provider_metadata = {
                "email": google_user_info["email"],
                "name": google_user_info.get("name"),
                "picture": google_user_info.get("picture"),
            }
        else:
            google_identity = UserIdentity(
                user_id=current_user.id,
                provider="google",
                provider_user_id=google_user_info["id"],
                access_token=token["access_token"],
                provider_metadata={
                    "email": google_user_info["email"],
                    "name": google_user_info.get("name"),
                    "picture": google_user_info.get("picture"),
                },
            )
            db.add(google_identity)

        await db.commit()
        flash(request, _("Google account connected successfully!"), "success")

    except Exception as e:
        flash(request, _("Error connecting Google account."), "error")

    return RedirectResponse(redirect_url, status_code=303)


@router.get("/manage/authorization", name="google_manage_authorization")
async def google_manage_authorization(
    request: Request,
    next: str | None = None,
    current_user: User = Depends(get_current_user),
):
    """Manage authorized Google connections"""
    return RedirectResponse(
        "https://myaccount.google.com/connections",
        status_code=303,
    )
