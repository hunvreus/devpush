from starlette_wtf import StarletteForm
from wtforms import HiddenField, StringField, SubmitField
from wtforms.validators import DataRequired, ValidationError

from dependencies import get_translation as _, get_lazy_translation as _l


class AdminUserDeleteForm(StarletteForm):
    user_id = HiddenField(_l("User ID"), validators=[DataRequired()])
    email = HiddenField(_l("Email"), validators=[DataRequired()])
    confirm = StringField(_l("Confirmation"), validators=[DataRequired()])
    submit = SubmitField(_l("Delete"), name="admin_delete_user")

    def validate_confirm(self, field):
        if field.data != self.email.data:  # type: ignore
            raise ValidationError(_("Email confirmation did not match."))
