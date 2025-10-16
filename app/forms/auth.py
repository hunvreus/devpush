from starlette_wtf import StarletteForm
from wtforms import StringField, SubmitField
from wtforms.validators import DataRequired, Email, Length

from dependencies import get_lazy_translation as _l


class EmailLoginForm(StarletteForm):
    email = StringField(
        _l("Email address"),
        filters=[lambda v: v.strip() if v else v, lambda v: v.lower() if v else v],
        validators=[
            DataRequired(),
            Email(message=_l("Invalid email address")),
            Length(max=320),
        ],
    )
    submit = SubmitField(_l("Continue with email"))
