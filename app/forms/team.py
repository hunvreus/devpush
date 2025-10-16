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
from models import TeamMember, User, Team, TeamInvite, utc_now

FORBIDDEN_TEAM_SLUGS = [
    "admin",
    "api",
    "assets",
    "auth",
    "deployment-not-found",
    "health",
    "new-team",
    "upload",
    "user",
]


class NewTeamForm(StarletteForm):
    name = StringField(_l("Name"), validators=[DataRequired(), Length(min=1, max=100)])
    submit = SubmitField(_l("Create team"))


class TeamGeneralForm(StarletteForm):
    name = StringField(
        _l("Display name"), validators=[DataRequired(), Length(min=1, max=100)]
    )
    slug = StringField(
        _l("Slug"),
        validators=[
            DataRequired(),
            Length(min=1, max=100),
            Regexp(
                r"^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$",
                message=_l(
                    "Team names can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen."
                ),
            ),
        ],
    )
    avatar = FileField(_l("Avatar"))
    delete_avatar = BooleanField(_l("Delete avatar"), default=False)

    def __init__(self, *args, db: AsyncSession, team: Team, **kwargs):
        super().__init__(*args, **kwargs)
        self.db = db
        self.team = team

    async def async_validate_slug(self, field):
        if field.data in FORBIDDEN_TEAM_SLUGS:
            raise ValidationError(_("This slug is reserved."))

        if self.db and self.team:
            result = await self.db.execute(
                select(Team).where(
                    func.lower(Team.slug) == field.data.lower(),
                    Team.status != "deleted",
                    Team.id != self.team.id,
                )
            )
            if result.scalar_one_or_none():
                raise ValidationError(_("A team with this slug already exists."))

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


class TeamDeleteForm(StarletteForm):
    slug = HiddenField(_l("Team slug"), validators=[DataRequired()])
    confirm = StringField(_l("Confirmation"), validators=[DataRequired()])
    submit = SubmitField(_l("Delete"), name="delete_team")

    def validate_confirm(self, field):
        if field.data != self.slug.data:  # type: ignore
            raise ValidationError(_("Team slug confirmation did not match."))


class TeamAddMemberForm(StarletteForm):
    email = StringField(
        _l("Email"),
        validators=[
            DataRequired(),
            Email(message=_l("Invalid email address")),
        ],
    )
    role = SelectField(
        _l("Role"),
        choices=[
            ("admin", "Admin"),
            ("member", "Member"),
        ],
        default="member",
    )
    submit = SubmitField(_l("Invite"))

    def __init__(self, *args, team: Team, db: AsyncSession, **kwargs):
        super().__init__(*args, **kwargs)
        self.team = team
        self.db = db

    async def async_validate_email(self, field):
        if not self.db or not self.team:
            return

        email = field.data.strip().lower()
        existing_member = await self.db.scalar(
            select(TeamMember)
            .join(User)
            .where(TeamMember.team_id == self.team.id, func.lower(User.email) == email)
        )
        if existing_member:
            raise ValidationError(
                _("%(email)s is already a member of the team.", email=field.data)
            )

        pending_invite = await self.db.scalar(
            select(TeamInvite).where(
                TeamInvite.team_id == self.team.id,
                func.lower(TeamInvite.email) == email,
                TeamInvite.status == "pending",
            )
        )
        if pending_invite and pending_invite.expires_at > utc_now():
            raise ValidationError(
                _("Invitation already sent to %(email)s.", email=field.data)
            )


class TeamDeleteMemberForm(StarletteForm):
    email = HiddenField(
        validators=[
            DataRequired(),
            Email(message=_l("Invalid email address")),
        ]
    )
    confirm = StringField(
        _l("Confirmation"),
        validators=[
            DataRequired(),
            Email(message=_l("Invalid email address")),
        ],
    )
    submit = SubmitField(_l("Delete"))

    def validate_confirm(self, field):
        if field.data != self.email.data:  # type: ignore
            raise ValidationError(_("Member email confirmation did not match."))


class TeamMemberRoleForm(StarletteForm):
    user_id = HiddenField(validators=[DataRequired()])
    role = SelectField(
        _l("Role"),
        choices=[
            ("owner", "Owner"),
            ("admin", "Admin"),
            ("member", "Member"),
        ],
        default="member",
    )
    submit = SubmitField(_l("Update role"))

    def __init__(self, *args, team: Team, db: AsyncSession, **kwargs):
        super().__init__(*args, **kwargs)
        self.team = team
        self.db = db

    async def async_validate_role(self, field):
        if not self.db or not self.team:
            return

        member = await self.db.scalar(
            select(TeamMember).where(
                TeamMember.team_id == self.team.id,
                TeamMember.user_id == int(self.user_id.data),  # type: ignore
            )
        )

        if not member:
            raise ValidationError(_("Member not found."))

        if member.role == "owner" and field.data != "owner":
            other_owners_count = await self.db.scalar(
                select(func.count(TeamMember.id)).where(
                    TeamMember.team_id == self.team.id,
                    TeamMember.user_id != int(self.user_id.data),  # type: ignore
                    TeamMember.role == "owner",
                )
            )
            if other_owners_count == 0:
                raise ValidationError(_("There must be at least one owner."))


class TeamLeaveForm(StarletteForm):
    team_id = HiddenField(validators=[DataRequired()])
    submit = SubmitField(_l("Leave team"))


class TeamInviteAcceptForm(StarletteForm):
    invite_id = HiddenField(validators=[DataRequired()])
    submit = SubmitField(_l("Accept"))
