import json
from starlette.requests import Request
from starlette_wtf import StarletteForm
from wtforms import HiddenField, StringField, SubmitField, SelectField
from wtforms.validators import DataRequired, Length, Regexp, ValidationError, Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies import get_translation as _, get_lazy_translation as _l
from models import Project, Storage, StorageProject, Team


def _parse_environment_ids(value):
    if value in (None, "", []):
        return []
    if isinstance(value, list):
        parsed = value
    else:
        try:
            parsed = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return None
    if parsed is None:
        return []
    if not isinstance(parsed, list):
        return None
    environment_ids = []
    for item in parsed:
        if item in (None, ""):
            continue
        if not isinstance(item, str):
            return None
        environment_ids.append(item)
    return list(dict.fromkeys(environment_ids))


class StorageCreateForm(StarletteForm):
    type = SelectField(
        _l("Type"),
        choices=[
            ("database", _("Database")),
            ("volume", _("Volume")),
        ],
    )
    name = StringField(
        _l("Name"),
        validators=[
            DataRequired(),
            Length(min=1, max=100),
            Regexp(
                r"^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$",
                message=_l(
                    "Storage names can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen."
                ),
            ),
        ],
    )
    submit = SubmitField(_l("Create storage"))
    environment_ids = StringField(_l("Environments"), validators=[Optional()])

    def __init__(
        self,
        request: Request,
        *args,
        db: AsyncSession,
        team: Team,
        project: Project | None = None,
        **kwargs,
    ):
        super().__init__(request, *args, **kwargs)
        self.db = db
        self.team = team
        self.project = project

    async def async_validate_name(self, field):
        if self.db and self.team:
            result = await self.db.execute(
                select(Storage).where(
                    func.lower(Storage.name) == field.data.lower(),
                    Storage.team_id == self.team.id,
                )
            )
            if result.scalar_one_or_none():
                raise ValidationError(
                    _(
                        "A storage with this name already exists in this team or is reserved."
                    )
                )

    def validate_environment_ids(self, field):
        if not self.project:
            return
        environment_ids = _parse_environment_ids(field.data)
        if environment_ids is None:
            raise ValidationError(_("Invalid environment selection."))
        field.data = environment_ids
        for environment_id in environment_ids:
            if not self.project.get_environment_by_id(environment_id):
                raise ValidationError(_("Environment not found."))


class StorageDeleteForm(StarletteForm):
    name = HiddenField(_l("Storage name"), validators=[DataRequired()])
    confirm = StringField(_l("Confirmation"), validators=[DataRequired()])
    submit = SubmitField(_l("Delete"), name="delete_storage")

    def validate_confirm(self, field):
        if field.data != self.name.data:  # type: ignore
            raise ValidationError(_("Storage name confirmation did not match."))


class StorageProjectForm(StarletteForm):
    association_id = HiddenField()
    storage_id = HiddenField(_l("Storage"), validators=[DataRequired()])
    project_id = StringField(_l("Project"), validators=[DataRequired()])
    environment_ids = StringField(_l("Environments"), validators=[Optional()])

    def __init__(
        self,
        request: Request,
        *args,
        storage: Storage | None = None,
        storages: list[Storage] | None = None,
        projects: list[Project],
        associations: list["StorageProject"],
        **kwargs,
    ):
        super().__init__(request, *args, **kwargs)
        self.storage = storage
        self.storages = storages or []
        self.projects = projects
        self.associations = associations
        self._projects_by_id = {project.id: project for project in projects}
        self._storages_by_id = {storage.id: storage for storage in self.storages}
        self._associations_by_id = {
            str(association.id): association for association in associations
        }
        self._selected_project = None
        self._selected_storage = None
        self.association = None
        if self.environment_ids.data in (None, ""):
            self.environment_ids.data = []

    def _parse_environment_ids(self, value):
        return _parse_environment_ids(value)

    def validate_association_id(self, field):
        if not field.data:
            return
        association = self._associations_by_id.get(field.data)
        if not association:
            raise ValidationError(_("Association not found."))
        if self.storage and association.storage_id != self.storage.id:
            raise ValidationError(_("Association not found."))
        self.association = association

    def validate_storage_id(self, field):
        if self.storage:
            if field.data != self.storage.id:
                raise ValidationError(_("Storage not found."))
        elif self._storages_by_id:
            storage = self._storages_by_id.get(field.data)
            if not storage:
                raise ValidationError(_("Storage not found."))
            self._selected_storage = storage
        else:
            raise ValidationError(_("Storage not found."))
        if self.association and field.data != self.association.storage_id:
            raise ValidationError(_("Storage cannot be changed."))

    def validate_project_id(self, field):
        project = self._projects_by_id.get(field.data)
        if not project:
            raise ValidationError(_("Project not found."))
        if self.association and field.data != self.association.project_id:
            raise ValidationError(_("Project cannot be changed."))
        self._selected_project = project

    def validate_environment_ids(self, field):
        if not self._selected_project and self.project_id.data:
            self._selected_project = self._projects_by_id.get(self.project_id.data)
        if not self._selected_project:
            return
        environment_ids = self._parse_environment_ids(field.data)
        if environment_ids is None:
            raise ValidationError(_("Invalid environment selection."))
        environment_ids = list(dict.fromkeys(environment_ids))
        field.data = environment_ids
        for environment_id in environment_ids:
            if not self._selected_project.get_environment_by_id(environment_id):
                raise ValidationError(_("Environment not found."))
        association_id = self.association_id.data
        for association in self.associations:
            if association.project_id != self.project_id.data:
                continue
            if association.storage_id != self.storage_id.data:
                continue
            if association_id and str(association.id) == association_id:
                continue
            raise ValidationError(
                _("This project is already connected to this storage.")
            )


class StorageProjectRemoveForm(StarletteForm):
    association_id = HiddenField(_l("Association ID"), validators=[DataRequired()])
    confirm = StringField(_l("Confirmation"), validators=[DataRequired()])

    def __init__(
        self, request: Request, *args, associations: list["StorageProject"], **kwargs
    ):
        super().__init__(request, *args, **kwargs)
        self.associations = associations
        self._associations_by_id = {
            str(association.id): association for association in associations
        }
        self.association = None

    def validate_association_id(self, field):
        association = self._associations_by_id.get(field.data)
        if not association:
            raise ValidationError(_("Association not found."))
        self.association = association

    def validate_confirm(self, field):
        if not self.association:
            return
        project_name = self.association.project.name if self.association.project else ""
        if field.data != project_name:
            raise ValidationError(_("Project name confirmation did not match."))
