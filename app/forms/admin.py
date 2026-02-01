from starlette_wtf import StarletteForm
from wtforms import (
    BooleanField,
    HiddenField,
    SelectField,
    StringField,
    SubmitField,
    TextAreaField,
)
from wtforms.validators import DataRequired, Optional, ValidationError

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


class RegistryImageActionForm(StarletteForm):
    slug = HiddenField(_l("Slug"), validators=[Optional()])


class RegistryUpdateForm(StarletteForm):
    submit = SubmitField(_l("Update"))


class RunnerToggleForm(StarletteForm):
    slug = HiddenField(_l("Slug"), validators=[DataRequired()])
    enabled = BooleanField(_l("Enabled"))


class PresetToggleForm(StarletteForm):
    slug = HiddenField(_l("Slug"), validators=[DataRequired()])
    enabled = BooleanField(_l("Enabled"))
