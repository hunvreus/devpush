from starlette_wtf import StarletteForm
from wtforms import HiddenField, StringField, SubmitField
from wtforms.validators import DataRequired, Length, Regexp, ValidationError, Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies import get_translation as _, get_lazy_translation as _l
from models import Database, Project, ProjectDatabase, Team


class DatabaseCreateForm(StarletteForm):
    name = StringField(
        _l("Database name"),
        validators=[
            DataRequired(),
            Length(min=1, max=100),
            Regexp(
                r"^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$",
                message=_l(
                    "Database names can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen."
                ),
            ),
        ],
    )
    submit = SubmitField(_l("Create database"))

    def __init__(self, *args, db: AsyncSession, team: Team, **kwargs):
        super().__init__(*args, **kwargs)
        self.db = db
        self.team = team

    async def async_validate_name(self, field):
        if self.db and self.team:
            result = await self.db.execute(
                select(Database).where(
                    func.lower(Database.name) == field.data.lower(),
                    Database.team_id == self.team.id,
                )
            )
            if result.scalar_one_or_none():
                raise ValidationError(
                    _(
                        "A database with this name already exists in this team or is reserved."
                    )
                )


class DatabaseDeleteForm(StarletteForm):
    name = HiddenField(_l("Database name"), validators=[DataRequired()])
    confirm = StringField(_l("Confirmation"), validators=[DataRequired()])
    submit = SubmitField(_l("Delete"), name="delete_database")

    def validate_confirm(self, field):
        if field.data != self.name.data:  # type: ignore
            raise ValidationError(_("Database name confirmation did not match."))


class ProjectDatabaseCreateForm(StarletteForm):
    association_id = HiddenField()
    project_id = StringField(_l("Project"), validators=[DataRequired()])
    environment_id = StringField(_l("Environment"), validators=[Optional()])

    def __init__(
        self,
        *args,
        database: Database,
        projects: list[Project],
        associations: list["ProjectDatabase"],
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.database = database
        self.projects = projects
        self.associations = associations
        self._projects_by_id = {project.id: project for project in projects}
        self._associations_by_id = {
            str(association.id): association for association in associations
        }
        self._selected_project = None
        self.association = None

    def validate_association_id(self, field):
        if not field.data:
            return
        association = self._associations_by_id.get(field.data)
        if not association:
            raise ValidationError(_("Association not found."))
        if association.database_id != self.database.id:
            raise ValidationError(_("Association not found."))
        self.association = association

    def validate_project_id(self, field):
        project = self._projects_by_id.get(field.data)
        if not project:
            raise ValidationError(_("Project not found."))
        self._selected_project = project

    def validate_environment_id(self, field):
        if not self._selected_project and self.project_id.data:
            self._selected_project = self._projects_by_id.get(self.project_id.data)
        if not self._selected_project:
            return
        if field.data and not self._selected_project.get_environment_by_id(field.data):
            raise ValidationError(_("Environment not found."))
        environment_id = field.data or None
        association_id = self.association_id.data
        for association in self.associations:
            if association.project_id != self.project_id.data:
                continue
            if association.environment_id != environment_id:
                continue
            if association_id and str(association.id) == association_id:
                continue
            raise ValidationError(
                _("This project is already linked to this database.")
            )


class ProjectDatabaseDeleteForm(StarletteForm):
    association_id = HiddenField(_l("Association ID"), validators=[DataRequired()])
    confirm = StringField(_l("Confirmation"), validators=[DataRequired()])

    def __init__(self, *args, associations: list["ProjectDatabase"], **kwargs):
        super().__init__(*args, **kwargs)
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
