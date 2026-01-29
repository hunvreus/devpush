import json

from starlette_wtf import StarletteForm
from wtforms import (
    BooleanField,
    HiddenField,
    SelectField,
    StringField,
    SubmitField,
    TextAreaField,
)
from wtforms.validators import DataRequired, Length, Optional, ValidationError

from dependencies import get_translation as _, get_lazy_translation as _l


class AdminUserDeleteForm(StarletteForm):
    user_id = HiddenField(_l("User ID"), validators=[DataRequired()])
    email = HiddenField(_l("Email"), validators=[DataRequired()])
    confirm = StringField(_l("Confirmation"), validators=[DataRequired()])
    submit = SubmitField(_l("Delete"), name="admin_delete_user")

    def validate_confirm(self, field):
        if field.data != self.email.data:  # type: ignore
            raise ValidationError(_("Email confirmation did not match."))


class AllowlistAddForm(StarletteForm):
    type = SelectField(
        _l("Type"),
        choices=[
            ("email", _l("Email")),
            ("domain", _l("Domain")),
            ("pattern", _l("Pattern (regex)")),
        ],
        validators=[DataRequired()],
    )
    value = StringField(_l("Value"), validators=[DataRequired()])
    submit = SubmitField(_l("Add"), name="allowlist_add")


class AllowlistDeleteForm(StarletteForm):
    entry_id = HiddenField(_l("Entry ID"), validators=[DataRequired()])
    submit = SubmitField(_l("Delete"), name="allowlist_delete")


class AllowlistImportForm(StarletteForm):
    emails = TextAreaField(
        _l("Email addresses (one per line or comma-separated)"),
        validators=[DataRequired()],
    )
    submit = SubmitField(_l("Import"), name="allowlist_import")


class RegistryActionForm(StarletteForm):
    action = HiddenField(_l("Action"), validators=[DataRequired()])


class RunnerForm(StarletteForm):
    action = HiddenField(_l("Action"), validators=[DataRequired()])
    slug = StringField(_l("Slug"), validators=[DataRequired(), Length(max=255)])
    name = StringField(_l("Name"), validators=[DataRequired(), Length(max=255)])
    category = StringField(_l("Category"), validators=[Optional(), Length(max=255)])
    image = StringField(
        _l("Image"), validators=[DataRequired(), Length(max=512)]
    )
    enabled = BooleanField(_l("Enabled"))


class PresetForm(StarletteForm):
    action = HiddenField(_l("Action"), validators=[DataRequired()])
    slug = StringField(_l("Slug"), validators=[DataRequired(), Length(max=255)])
    name = StringField(_l("Name"), validators=[DataRequired(), Length(max=255)])
    category = StringField(_l("Category"), validators=[Optional(), Length(max=255)])
    runner = StringField(_l("Runner"), validators=[DataRequired(), Length(max=255)])
    build_command = TextAreaField(_l("Build command"), validators=[DataRequired()])
    pre_deploy_command = TextAreaField(_l("Pre-deploy command"), validators=[Optional()])
    start_command = TextAreaField(_l("Start command"), validators=[DataRequired()])
    root_directory = StringField(_l("Root directory"), validators=[Optional(), Length(max=255)])
    logo = TextAreaField(_l("Logo"), validators=[DataRequired()])
    detection = TextAreaField(_l("Detection (JSON)"), validators=[Optional()])
    enabled = BooleanField(_l("Enabled"))

    def validate_detection(self, field):
        if not field.data:
            return
        try:
            json.loads(field.data)
        except json.JSONDecodeError as exc:
            raise ValidationError(_("Invalid detection JSON.")) from exc


class RegistrySlugForm(StarletteForm):
    action = HiddenField(_l("Action"), validators=[DataRequired()])
    slug = HiddenField(_l("Slug"), validators=[DataRequired()])


class RunnerToggleForm(StarletteForm):
    action = HiddenField(_l("Action"), validators=[DataRequired()])
    slug = HiddenField(_l("Slug"), validators=[DataRequired()])
    enabled = BooleanField(_l("Enabled"))


class PresetToggleForm(StarletteForm):
    action = HiddenField(_l("Action"), validators=[DataRequired()])
    slug = HiddenField(_l("Slug"), validators=[DataRequired()])
    enabled = BooleanField(_l("Enabled"))
