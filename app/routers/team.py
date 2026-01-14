import os
from fastapi import APIRouter, Depends, Request, Query, HTTPException
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from arq.connections import ArqRedis
import logging
from typing import Any
from authlib.jose import jwt
from datetime import timedelta
import resend

from models import (
    Project,
    Deployment,
    User,
    Team,
    TeamMember,
    TeamInvite,
    Storage,
    StorageProject,
    utc_now,
)
from dependencies import (
    get_current_user,
    get_team_by_slug,
    get_job_queue,
    flash,
    get_translation as _,
    TemplateResponse,
    templates,
    get_role,
    get_access,
    get_storage_by_name,
    RedirectResponseX,
)
from config import get_settings, Settings
from db import get_db
from utils.pagination import paginate
from utils.team import get_latest_teams
from forms.team import (
    TeamDeleteForm,
    TeamGeneralForm,
    TeamCreateForm,
    TeamMemberAddForm,
    TeamMemberRemoveForm,
    TeamMemberRoleForm,
)
from forms.storage import (
    StorageCreateForm,
    StorageDeleteForm,
    StorageProjectForm,
    StorageProjectRemoveForm,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.api_route("/new-team", methods=["GET", "POST"], name="new_team")
async def new_team(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    form: Any = await TeamCreateForm.from_formdata(request)

    if request.method == "POST" and await form.validate_on_submit():
        team = Team(name=form.name.data, created_by_user_id=current_user.id)
        db.add(team)
        await db.flush()
        db.add(TeamMember(team_id=team.id, user_id=current_user.id, role="owner"))
        await db.commit()
        return Response(
            status_code=200,
            headers={
                "HX-Redirect": str(request.url_for("team_index", team_slug=team.slug))
            },
        )

    return TemplateResponse(
        request=request,
        name="team/partials/_dialog-new-team-form.html",
        context={"form": form},
    )


@router.get("/{team_slug}", name="team_index")
async def team_index(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    team_and_membership: tuple[Team, TeamMember] = Depends(get_team_by_slug),
    role: str = Depends(get_role),
):
    team, membership = team_and_membership

    projects_result = await db.execute(
        select(Project)
        .where(Project.team_id == team.id, Project.status != "deleted")
        .order_by(Project.updated_at.desc())
        .limit(6)
    )
    projects = projects_result.scalars().all()

    deployments_result = await db.execute(
        select(Deployment)
        .options(selectinload(Deployment.aliases))
        .join(Project)
        .where(Project.team_id == team.id, Project.status != "deleted")
        .order_by(Deployment.created_at.desc())
        .limit(10)
    )
    deployments = deployments_result.scalars().all()

    latest_teams = await get_latest_teams(
        db=db, current_user=current_user, current_team=team
    )

    return TemplateResponse(
        request=request,
        name="team/pages/index.html",
        context={
            "current_user": current_user,
            "team": team,
            "role": role,
            "projects": projects,
            "deployments": deployments,
            "latest_teams": latest_teams,
        },
    )


@router.get("/{team_slug}/projects", name="team_projects")
async def team_projects(
    request: Request,
    page: int = Query(1, ge=1),
    current_user: User = Depends(get_current_user),
    role: str = Depends(get_role),
    team_and_membership: tuple[Team, TeamMember] = Depends(get_team_by_slug),
    db: AsyncSession = Depends(get_db),
):
    team, membership = team_and_membership

    latest_teams = await get_latest_teams(
        db=db, current_user=current_user, current_team=team
    )

    per_page = 25

    query = (
        select(Project)
        .where(Project.team_id == team.id, Project.status != "deleted")
        .order_by(Project.updated_at.desc())
    )

    pagination = await paginate(db, query, page, per_page)

    return TemplateResponse(
        request=request,
        name="team/pages/projects.html",
        context={
            "current_user": current_user,
            "team": team,
            "role": role,
            "latest_teams": latest_teams,
            "projects": pagination.get("items"),
            "pagination": pagination,
        },
    )


@router.api_route("/{team_slug}/storage", methods=["GET", "POST"], name="team_storage")
async def team_storage(
    request: Request,
    page: int = Query(1, ge=1),
    storage_search: str | None = Query(None),
    storage_type: str | None = Query(None),
    fragment: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    role: str = Depends(get_role),
    team_and_membership: tuple[Team, TeamMember] = Depends(get_team_by_slug),
    job_queue: ArqRedis = Depends(get_job_queue),
    db: AsyncSession = Depends(get_db),
):
    team, membership = team_and_membership

    form: Any = await StorageCreateForm.from_formdata(request, db=db, team=team)

    if request.method == "POST":
        if await form.validate_on_submit():
            storage = Storage(
                name=form.name.data,
                type=form.type.data,
                status="pending",
                team_id=team.id,
                created_by_user_id=current_user.id,
            )
            db.add(storage)
            await db.commit()
            try:
                await job_queue.enqueue_job("provision_storage", storage.id)
            except Exception as exc:
                logger.error(
                    "Failed to enqueue provisioning for storage %s: %s",
                    storage.id,
                    exc,
                )
            flash(request, _("Storage created."), "success")

            return RedirectResponseX(
                request.url_for("team_storage", team_slug=team.slug),
                status_code=200,
                request=request,
            )

        return TemplateResponse(
            request=request,
            name="team/partials/_dialog-new-storage-form.html",
            context={
                "team": team,
                "form": form,
            },
        )

    latest_teams = await get_latest_teams(
        db=db, current_user=current_user, current_team=team
    )

    per_page = 25

    allowed_types = {"database", "volume", "kv", "queue"}
    storage_type = storage_type if storage_type in allowed_types else None

    query = select(Storage).where(
        Storage.team_id == team.id,
        Storage.status != "deleted",
    )
    if not get_access(role, "admin"):
        query = query.where(Storage.created_by_user_id == current_user.id)
    if storage_type and storage_type != "all":
        query = query.where(Storage.type == storage_type)
    if storage_search:
        query = query.where(Storage.name.ilike(f"%{storage_search}%"))

    query = query.options(
        selectinload(Storage.project_links).selectinload(StorageProject.project)
    ).order_by(Storage.updated_at.desc())

    pagination = await paginate(db, query, page, per_page)

    projects = await db.execute(
        select(Project)
        .where(Project.team_id == team.id, Project.status != "deleted")
        .order_by(Project.name.asc())
    )
    projects = projects.scalars().all()

    storage_count_query = select(func.count(Storage.id)).where(
        Storage.team_id == team.id,
        Storage.status != "deleted",
    )
    if not get_access(role, "admin"):
        storage_count_query = storage_count_query.where(
            Storage.created_by_user_id == current_user.id
        )
    storage_count_result = await db.execute(storage_count_query)
    storage_count = storage_count_result.scalar_one() or 0

    if request.headers.get("HX-Request") and fragment == "storage-content":
        return TemplateResponse(
            request=request,
            name="team/partials/_storage-list.html",
            context={
                "current_user": current_user,
                "team": team,
                "role": role,
                "projects": projects,
                "form": form,
                "pagination": pagination,
                "storages": pagination.get("items"),
                "storage_search": storage_search,
                "storage_type": storage_type,
                "storage_count": storage_count,
            },
        )

    return TemplateResponse(
        request=request,
        name="team/pages/storage.html",
        context={
            "current_user": current_user,
            "team": team,
            "role": role,
            "latest_teams": latest_teams,
            "projects": projects,
            "form": form,
            "pagination": pagination,
            "storages": pagination.get("items"),
            "storage_search": storage_search,
            "storage_type": storage_type,
            "storage_count": storage_count,
        },
    )


@router.api_route(
    "/{team_slug}/storage/{storage_name}",
    methods=["GET", "POST"],
    name="team_storage_item",
)
async def team_storage_item(
    request: Request,
    fragment: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    role: str = Depends(get_role),
    team_and_membership: tuple[Team, TeamMember] = Depends(get_team_by_slug),
    storage: Storage = Depends(get_storage_by_name),
    job_queue: ArqRedis = Depends(get_job_queue),
    db: AsyncSession = Depends(get_db),
):
    team, membership = team_and_membership

    is_admin = get_access(role, "admin")
    is_storage_creator = storage.created_by_user_id == current_user.id
    if not is_admin and not is_storage_creator:
        raise HTTPException(status_code=404, detail="Storage not found")

    delete_form: Any = await StorageDeleteForm.from_formdata(request)

    if request.method == "POST" and fragment == "danger":
        if not get_access(role, "admin"):
            flash(
                request,
                _("You don't have permission to delete storage."),
                "warning",
            )
        elif await delete_form.validate_on_submit():
            storage.status = "deleted"
            await db.commit()
            if storage.type in ("database", "volume"):
                try:
                    await job_queue.enqueue_job("deprovision_storage", storage.id)
                except Exception as exc:
                    logger.error(
                        "Failed to enqueue deprovisioning for storage %s: %s",
                        storage.id,
                        exc,
                    )
            flash(request, _("Storage deleted."), "success")
            return RedirectResponse(
                url=str(request.url_for("team_storage", team_slug=team.slug)),
                status_code=303,
            )

    projects_query = (
        select(Project)
        .where(Project.team_id == team.id, Project.status != "deleted")
        .order_by(Project.name.asc())
    )
    if not is_admin:
        projects_query = projects_query.where(
            Project.created_by_user_id == current_user.id
        )
    projects_result = await db.execute(projects_query)
    projects = projects_result.scalars().all()

    associations_query = (
        select(StorageProject)
        .join(Project)
        .where(
            StorageProject.storage_id == storage.id,
            Project.team_id == team.id,
            Project.status != "deleted",
        )
        .options(selectinload(StorageProject.project))
        .order_by(Project.name.asc())
    )
    if not is_admin:
        associations_query = associations_query.where(
            Project.created_by_user_id == current_user.id
        )
    associations_result = await db.execute(associations_query)
    associations = associations_result.scalars().all()
    available_projects = [
        project
        for project in projects
        if project.id not in {association.project_id for association in associations}
    ]
    default_project = available_projects[0] if available_projects else None

    association_form: Any = await StorageProjectForm.from_formdata(
        request, storage=storage, projects=projects, associations=associations
    )
    remove_association_form: Any = await StorageProjectRemoveForm.from_formdata(
        request, associations=associations
    )

    if request.method == "GET" and fragment == "environment_select":
        project_id = request.query_params.get("project_id")
        selected_project = next(
            (project for project in projects if project.id == project_id), None
        )
        if not selected_project:
            flash(
                request,
                _("You don't have permission to update storage associations."),
                "warning",
            )
            return Response(status_code=403)
        association_form.project_id.data = project_id
        association_form.storage_id.data = storage.id
        return TemplateResponse(
            request=request,
            name="team/partials/_storage-select-environments.html",
            context={
                "current_user": current_user,
                "team": team,
                "role": role,
                "storage": storage,
                "associations": associations,
                "association_form": association_form,
                "selected_project": selected_project,
                "is_active": False,
            },
        )

    if request.method == "POST" and fragment == "association":
        if not is_admin and not is_storage_creator:
            flash(
                request,
                _("You don't have permission to update storage associations."),
                "warning",
            )
        elif await association_form.validate_on_submit():
            association_id = association_form.association_id.data
            association_by_id = {
                str(association.id): association for association in associations
            }
            if association_id:
                association = association_by_id.get(str(association_id))
                if association:
                    association.environment_ids = (
                        association_form.environment_ids.data or []
                    )
                    flash(request, _("Association updated."), "success")
                    await db.commit()
                else:
                    flash(request, _("Association not found."), "error")
                    await db.rollback()
            elif association_form.association:
                association_form.association.environment_ids = (
                    association_form.environment_ids.data or []
                )
                flash(request, _("Association updated."), "success")
                await db.commit()
            else:
                existing_result = await db.execute(
                    select(StorageProject).where(
                        StorageProject.project_id == association_form.project_id.data,
                        StorageProject.storage_id == storage.id,
                    )
                )
                existing_association = existing_result.scalar_one_or_none()
                if existing_association:
                    existing_association.environment_ids = (
                        association_form.environment_ids.data or []
                    )
                    flash(request, _("Association updated."), "success")
                else:
                    association = StorageProject(
                        project_id=association_form.project_id.data,
                        storage_id=storage.id,
                        environment_ids=association_form.environment_ids.data or [],
                    )
                    db.add(association)
                    flash(request, _("Project linked to storage."), "success")
                await db.commit()
            associations_result = await db.execute(associations_query)
            associations = associations_result.scalars().all()
            available_projects = [
                project
                for project in projects
                if project.id
                not in {association.project_id for association in associations}
            ]
            default_project = available_projects[0] if available_projects else None
            association_form = await StorageProjectForm.from_formdata(
                request,
                storage=storage,
                projects=projects,
                associations=associations,
            )
            remove_association_form = await StorageProjectRemoveForm.from_formdata(
                request,
                associations=associations,
            )
            if request.headers.get("HX-Request"):
                return TemplateResponse(
                    request=request,
                    name="team/partials/_storage-associations.html",
                    context={
                        "current_user": current_user,
                        "team": team,
                        "role": role,
                        "storage": storage,
                        "projects": projects,
                        "associations": associations,
                        "association_form": association_form,
                        "remove_association_form": remove_association_form,
                        "available_projects": available_projects,
                        "default_project": default_project,
                    },
                )
            return RedirectResponse(
                url=str(
                    request.url_for(
                        "team_storage_item",
                        team_slug=team.slug,
                        storage_name=storage.name,
                    )
                ),
                status_code=303,
            )
        if request.headers.get("HX-Request"):
            return TemplateResponse(
                request=request,
                name="team/partials/_storage-associations.html",
                context={
                    "current_user": current_user,
                    "team": team,
                    "role": role,
                    "storage": storage,
                    "projects": projects,
                    "associations": associations,
                    "association_form": association_form,
                    "remove_association_form": remove_association_form,
                    "available_projects": available_projects,
                    "default_project": default_project,
                },
            )

    if request.method == "POST" and fragment == "delete_association":
        if not is_admin and not is_storage_creator:
            flash(
                request,
                _("You don't have permission to update storage associations."),
                "warning",
            )
        elif await remove_association_form.validate_on_submit():
            association = remove_association_form.association
            await db.delete(association)
            await db.commit()
            associations_result = await db.execute(associations_query)
            associations = associations_result.scalars().all()
            available_projects = [
                project
                for project in projects
                if project.id
                not in {association.project_id for association in associations}
            ]
            default_project = available_projects[0] if available_projects else None
            association_form = await StorageProjectForm.from_formdata(
                request,
                storage=storage,
                projects=projects,
                associations=associations,
            )
            remove_association_form = await StorageProjectRemoveForm.from_formdata(
                request,
                associations=associations,
            )
            flash(request, _("Association removed."), "success")
            if request.headers.get("HX-Request"):
                return TemplateResponse(
                    request=request,
                    name="team/partials/_storage-associations.html",
                    context={
                        "current_user": current_user,
                        "team": team,
                        "role": role,
                        "storage": storage,
                        "projects": projects,
                        "associations": associations,
                        "association_form": association_form,
                        "remove_association_form": remove_association_form,
                        "available_projects": available_projects,
                        "default_project": default_project,
                    },
                )
            return RedirectResponse(
                url=str(
                    request.url_for(
                        "team_storage_item",
                        team_slug=team.slug,
                        storage_name=storage.name,
                    )
                ),
                status_code=303,
            )
        if request.headers.get("HX-Request"):
            return TemplateResponse(
                request=request,
                name="team/partials/_storage-associations.html",
                context={
                    "current_user": current_user,
                    "team": team,
                    "role": role,
                    "storage": storage,
                    "projects": projects,
                    "associations": associations,
                    "association_form": association_form,
                    "remove_association_form": remove_association_form,
                    "available_projects": available_projects,
                    "default_project": default_project,
                },
            )

    latest_teams = await get_latest_teams(
        db=db, current_user=current_user, current_team=team
    )

    return TemplateResponse(
        request=request,
        name="team/pages/storage-item.html",
        context={
            "current_user": current_user,
            "team": team,
            "role": role,
            "storage": storage,
            "delete_form": delete_form,
            "associations": associations,
            "association_form": association_form,
            "remove_association_form": remove_association_form,
            "projects": projects,
            "available_projects": available_projects,
            "default_project": default_project,
            "latest_teams": latest_teams,
        },
    )


@router.get(
    "/{team_slug}/storage/{storage_id}/status",
    name="team_storage_status",
)
async def team_storage_status(
    request: Request,
    storage_id: str,
    current_user: User = Depends(get_current_user),
    role: str = Depends(get_role),
    team_and_membership: tuple[Team, TeamMember] = Depends(get_team_by_slug),
    db: AsyncSession = Depends(get_db),
):
    team, membership = team_and_membership
    is_admin = get_access(role, "admin")

    query = (
        select(Storage)
        .where(
            Storage.id == storage_id,
            Storage.team_id == team.id,
            Storage.status != "deleted",
        )
    )
    if not is_admin:
        query = query.where(Storage.created_by_user_id == current_user.id)

    result = await db.execute(query)
    storage = result.scalar_one_or_none()
    if not storage:
        raise HTTPException(status_code=404, detail="Storage not found")

    return TemplateResponse(
        request=request,
        name="team/partials/_storage-status.html",
        context={
            "current_user": current_user,
            "team": team,
            "role": role,
            "storage": storage,
        },
    )


@router.api_route(
    "/{team_slug}/settings", methods=["GET", "POST"], name="team_settings"
)
async def team_settings(
    request: Request,
    fragment: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    role: str = Depends(get_role),
    team_and_membership: tuple[Team, TeamMember] = Depends(get_team_by_slug),
    db: AsyncSession = Depends(get_db),
    job_queue: ArqRedis = Depends(get_job_queue),
    settings: Settings = Depends(get_settings),
):
    team, membership = team_and_membership

    if not get_access(role, "admin"):
        flash(
            request,
            _("You don't have permission to access team settings."),
            "warning",
        )
        return RedirectResponse(
            url=str(request.url_for("team_index", team_slug=team.slug)),
            status_code=302,
        )

    # Delete
    delete_team_form = None
    if get_access(role, "owner"):
        # Prevent deleting default teams
        result = await db.execute(select(User).where(User.default_team_id == team.id))
        is_default_team = result.scalar_one_or_none()
        if not is_default_team:
            delete_team_form: Any = await TeamDeleteForm.from_formdata(
                request, team=team
            )
            if request.method == "POST" and fragment == "danger":
                if await delete_team_form.validate_on_submit():
                    try:
                        delete_team_form.status = "deleted"
                        await db.commit()

                        # Team is marked as deleted, actual cleanup is delegated to a job
                        await job_queue.enqueue_job("delete_team", team.id)

                        flash(
                            request,
                            _('Team "%(name)s" has been marked for deletion.')
                            % {"name": team.name},
                            "success",
                        )
                        return RedirectResponse("/", status_code=303)
                    except Exception as e:
                        await db.rollback()
                        logger.error(
                            f'Error marking team "{team.name}" as deleted: {str(e)}'
                        )
                        flash(
                            request,
                            _("An error occurred while marking the team for deletion."),
                            "error",
                        )

    # General
    general_form: Any = await TeamGeneralForm.from_formdata(
        request,
        data={
            "name": team.name,
            "slug": team.slug,
        },
        db=db,
        team=team,
    )

    if fragment == "general":
        if request.method == "POST" and await general_form.validate_on_submit():
            # Name
            team.name = general_form.name.data or ""

            # Slug
            old_slug = team.slug
            team.slug = general_form.slug.data or ""

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

                    target_filename = f"team_{team.id}.webp"
                    target_filepath = os.path.join(avatar_dir, target_filename)

                    await avatar_file.seek(0)
                    img = Image.open(avatar_file.file)

                    if img.mode != "RGBA":
                        img = img.convert("RGBA")

                    max_size = (512, 512)
                    img.thumbnail(max_size)

                    img.save(target_filepath, "WEBP", quality=85)

                    team.has_avatar = True
                    team.updated_at = utc_now()
                except Exception as e:
                    logger.error(f"Error processing avatar: {str(e)}")
                    flash(request, _("Avatar could not be updated."), "error")

            # Avatar deletion
            if general_form.delete_avatar.data:
                try:
                    avatar_dir = os.path.join(settings.upload_dir, "avatars")
                    filename = f"team_{team.id}.webp"
                    filepath = os.path.join(avatar_dir, filename)

                    if os.path.exists(filepath):
                        os.remove(filepath)

                    team.has_avatar = False
                    team.updated_at = utc_now()
                except Exception as e:
                    logger.error(f"Error deleting avatar: {str(e)}")
                    flash(request, _("Avatar could not be removed."), "error")

            await db.commit()
            flash(request, _("General settings updated."), "success")

            # Redirect if the name has changed
            if old_slug != team.slug:
                new_url = request.url_for("team_settings", team_slug=team.slug)

                if request.headers.get("HX-Request"):
                    return Response(
                        status_code=200, headers={"HX-Redirect": str(new_url)}
                    )
                else:
                    return RedirectResponse(new_url, status_code=303)

        if request.headers.get("HX-Request"):
            return TemplateResponse(
                request=request,
                name="team/partials/_settings-general.html",
                context={
                    "current_user": current_user,
                    "general_form": general_form,
                    "team": team,
                },
            )

    # Members
    add_member_form: Any = await TeamMemberAddForm.from_formdata(
        request, db=db, team=team
    )

    if fragment == "add_member":
        if await add_member_form.validate_on_submit():
            invite = TeamInvite(
                team_id=team.id,
                email=add_member_form.email.data.strip().lower(),
                role=add_member_form.role.data,
                inviter_id=current_user.id,
            )
            db.add(invite)
            await db.commit()
            _send_member_invite(request, invite, team, current_user, settings)

    remove_member_form: Any = await TeamMemberRemoveForm.from_formdata(request)

    if fragment == "delete_member":
        if await remove_member_form.validate_on_submit():
            try:
                user = await db.scalar(
                    select(User).where(User.email == remove_member_form.email.data)
                )
                if not user:
                    flash(request, _("User not found."), "error")
                else:
                    member = await db.scalar(
                        select(TeamMember).where(
                            TeamMember.team_id == team.id,
                            TeamMember.user_id
                            == user.id,  # Compare with user.id, not email
                        )
                    )
                    if member:
                        await db.delete(member)
                        await db.commit()
                        flash(
                            request,
                            _(
                                'Member "%(name)s" removed.',
                                name=user.name or user.username,
                            ),
                            "success",
                        )
                    else:
                        flash(request, _("Member not found."), "error")
            except ValueError as e:
                flash(request, str(e), "error")

    member_role_form: Any = await TeamMemberRoleForm.from_formdata(
        request, db=db, team=team
    )

    if fragment == "member_role":
        if await member_role_form.validate_on_submit():
            member = await db.scalar(
                select(TeamMember).where(
                    TeamMember.team_id == team.id,
                    TeamMember.user_id == int(member_role_form.user_id.data),  # type: ignore
                )
            )
            if member:
                member.role = member_role_form.role.data
                await db.commit()
                flash(request, _("Member role updated."), "success")
            else:
                flash(request, _("Member not found."), "error")

    if fragment == "resend_member_invite":
        invite_id = request.query_params.get("invite_id")
        invite = await db.scalar(
            select(TeamInvite).where(
                TeamInvite.id == invite_id, TeamInvite.team_id == team.id
            )
        )
        if not invite:
            flash(request, _("Invite not found."), "error")
            return Response(status_code=400, content="Invite not found.")

        _send_member_invite(request, invite, team, current_user, settings)
        return templates.TemplateResponse(
            request=request,
            name="layouts/fragment.html",
            context={"content": ""},
            status_code=200,
        )

    if fragment == "revoke_member_invite":
        invite_id = request.query_params.get("invite_id")
        invite = await db.scalar(
            select(TeamInvite).where(
                TeamInvite.id == invite_id, TeamInvite.team_id == team.id
            )
        )
        if not invite:
            flash(request, _("Invite not found."), "error")
            return Response(status_code=400, content="Invite not found.")

        await db.delete(invite)
        await db.commit()
        flash(request, _("Invite to %(email)s revoked.", email=invite.email), "success")

    members = await db.execute(
        select(TeamMember)
        .where(TeamMember.team_id == team.id)
        .options(selectinload(TeamMember.user))
    )
    members = members.scalars().all()

    member_invites = await db.execute(
        select(TeamInvite).where(
            TeamInvite.team_id == team.id,
            TeamInvite.expires_at > utc_now(),
            TeamInvite.status == "pending",
        )
    )
    member_invites = member_invites.scalars().all()

    owner_count = await db.scalar(
        select(func.count(TeamMember.id)).where(
            TeamMember.team_id == team.id,
            TeamMember.role == "owner",
        )
    )

    if fragment in (
        "add_member",
        "delete_member",
        "revoke_member_invite",
        "member_role",
    ) and request.headers.get("HX-Request"):
        return TemplateResponse(
            request=request,
            name="team/partials/_settings-members.html",
            context={
                "current_user": current_user,
                "team": team,
                "members": members,
                "member_invites": member_invites,
                "add_member_form": add_member_form,
                "remove_member_form": remove_member_form,
                "member_role_form": member_role_form,
                "owner_count": owner_count,
            },
        )

    latest_teams = await get_latest_teams(
        db=db, current_user=current_user, current_team=team
    )

    return TemplateResponse(
        request=request,
        name="team/pages/settings.html",
        context={
            "current_user": current_user,
            "team": team,
            "role": role,
            "delete_team_form": delete_team_form,
            "general_form": general_form,
            "members": members,
            "add_member_form": add_member_form,
            "remove_member_form": remove_member_form,
            "member_role_form": member_role_form,
            "member_invites": member_invites,
            "owner_count": owner_count,
            "latest_teams": latest_teams,
        },
    )


def _send_member_invite(
    request: Request,
    invite: TeamInvite,
    team: Team,
    current_user: User,
    settings: Settings,
):
    expires_at = utc_now() + timedelta(days=30)
    token_payload = {
        "email": invite.email,
        "invite_id": invite.id,
        "team_id": team.id,
        "exp": int(expires_at.timestamp()),
        "iat": int(utc_now().timestamp()),
        "type": "team_invite",
    }
    invite_token = jwt.encode({"alg": "HS256"}, token_payload, settings.secret_key)
    invite_token_str = (
        invite_token.decode("utf-8")
        if isinstance(invite_token, bytes)
        else invite_token
    )
    invite_link = str(
        request.url_for("auth_email_verify").include_query_params(
            token=invite_token_str
        )
    )

    resend.api_key = settings.resend_api_key

    try:
        resend.Emails.send(
            {
                "from": f"{settings.email_sender_name} <{settings.email_sender_address}>",
                "to": [invite.email],
                "subject": _(
                    'You have been invited to join the "%(team_name)s" team',
                    team_name=team.name,
                ),
                "html": templates.get_template("email/team-invite.html").render(
                    {
                        "request": request,
                        "email": invite.email,
                        "invite_link": invite_link,
                        "inviter_name": current_user.name,
                        "team_name": team.name,
                        "email_logo": settings.email_logo
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
                'Email invitation to join the "%(team_name)s" team sent to %(email)s.',
                team_name=team.name,
                email=invite.email,
            ),
            "success",
        )

    except Exception as e:
        logger.error(f"Failed to send email: {str(e)}")
        flash(
            request,
            _(
                "Uh oh, something went wrong. We couldn't send an email invitation to %(email)s. Please try again.",
                email=invite.email,
            ),
            "error",
        )
