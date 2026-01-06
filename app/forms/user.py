from starlette_wtf import StarletteForm
from wtforms import (
    StringField,
    SubmitField,
    BooleanField,
    FileField,
    HiddenField,
    SelectField,
)
from wtforms.validators import ValidationError, DataRequired, Length, Regexp, Email
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies import get_translation as _, get_lazy_translation as _l
from models import User


class UserGeneralForm(StarletteForm):
    name = StringField(_l("Display name"), validators=[Length(max=256)])
    username = StringField(
        _l("Username"),
        validators=[
            DataRequired(),
            Length(min=1, max=50),
            Regexp(
                r"^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$",
                message=_l(
                    "Usernames can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen."
                ),
            ),
        ],
    )
    avatar = FileField(_l("Avatar"))
    delete_avatar = BooleanField(_l("Delete avatar"), default=False)

    def __init__(self, *args, db: AsyncSession, user: User, **kwargs):
        super().__init__(*args, **kwargs)
        self.db = db
        self.user = user

    async def async_validate_username(self, field):
        if self.db and self.user:
            if self.user.username != field.data:
                result = await self.db.execute(
                    select(User).where(
                        func.lower(User.username) == field.data.lower(),
                        User.status != "deleted",
                        User.id != self.user.id,
                    )
                )
                if result.scalar_one_or_none():
                    raise ValidationError(
                        _("A user with this username already exists.")
                    )

    def validate_avatar(self, field):
        if field.data:
            if field.data.content_type not in [
                "image/jpeg",
                "image/png",
                "image/gif",
                "image/webp",
            ]:
                raise ValidationError(
                    _(
                        "Invalid file type. Only JPEG, PNG, GIF and WebP images are allowed."
                    )
                )
            if field.data.size > 10 * 1024 * 1024:  # 10MB
                raise ValidationError(
                    _("File size exceeds the maximum allowed (10MB).")
                )


class UserEmailForm(StarletteForm):
    email = StringField(
        _l("Email address"),
        validators=[
            DataRequired(),
            Email(message=_l("Invalid email address")),
            Length(max=320),
        ],
    )
    submit = SubmitField(_l("Save"), name="save_email")


class UserDeleteForm(StarletteForm):
    email = HiddenField(_l("Email"), validators=[DataRequired()])
    confirm = StringField(_l("Confirmation"), validators=[DataRequired()])
    submit = SubmitField(_l("Delete"), name="delete_user")

    def validate_confirm(self, field):
        if field.data != self.email.data:  # type: ignore
            raise ValidationError(_("Email confirmation did not match."))


class UserOAuthAccessRevokeForm(StarletteForm):
    provider = SelectField(
        _l("Provider"),
        default="",
        choices=["github", "google"],
    )
    submit = SubmitField(_l("Disconnect"))
