from starlette_wtf import StarletteForm
from wtforms import StringField, SelectField, TextAreaField
from wtforms.validators import DataRequired, Email, Regexp, Optional
from config import get_settings
from dependencies import get_lazy_translation as _l

PROVIDER_FIELDS = {
    "cloudflare": ["cloudflare_api_token"],
    "route53": ["route53_access_key", "route53_secret_key", "route53_region"],
    "gcloud": ["gcloud_project", "gcloud_service_account"],
    "digitalocean": ["digitalocean_token"],
    "azure": [
        "azure_client_id",
        "azure_client_secret",
        "azure_tenant_id",
        "azure_subscription_id",
        "azure_resource_group",
    ],
}


class DomainsSSLForm(StarletteForm):
    server_ip = StringField(
        "Server IP Address",
        validators=[
            DataRequired(),
            Regexp(
                r"^(\d{1,3}\.){3}\d{1,3}$",
                message="Invalid IP address format",
            ),
        ],
    )
    app_hostname = StringField(
        "Application Hostname",
        validators=[
            DataRequired(),
            Regexp(
                r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$",
                message="Invalid domain format",
            ),
        ],
    )
    deploy_domain = StringField(
        "Deploy Domain",
        validators=[
            DataRequired(),
            Regexp(
                r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$",
                message="Invalid domain format",
            ),
        ],
    )
    le_email = StringField("Let's Encrypt Email", validators=[DataRequired(), Email()])
    ssl_provider = SelectField(
        "SSL Provider",
        choices=[
            ("default", "Default (HTTP Challenge)"),
            ("cloudflare", "Cloudflare DNS"),
            ("route53", "AWS Route53"),
            ("gcloud", "Google Cloud DNS"),
            ("digitalocean", "DigitalOcean DNS"),
            ("azure", "Azure DNS"),
        ],
        validators=[DataRequired()],
    )
    cloudflare_api_token = StringField(
        "Cloudflare API Token",
        validators=[Optional()],
        description='<a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" class="link">Create an API token</a> with "Zone:DNS:Edit" permissions for your domain',
    )
    route53_access_key = StringField(
        "AWS Access Key ID",
        validators=[Optional()],
        description='<a href="https://console.aws.amazon.com/iam/home#/security_credentials" target="_blank" class="link">Create IAM access key</a> with "Route53:ChangeResourceRecordSets" permission',
    )
    route53_secret_key = StringField("AWS Secret Access Key", validators=[Optional()])
    route53_region = StringField(
        "AWS Region",
        validators=[Optional()],
        description="AWS region where your Route53 hosted zone is located (e.g., <code>us-east-1</code>, <code>eu-west-1</code>)",
    )
    gcloud_project = StringField(
        "Google Cloud Project ID",
        validators=[Optional()],
        description='<a href="https://console.cloud.google.com/projectselector2" target="_blank" class="link">Find your project ID</a> in Google Cloud Console',
    )
    gcloud_service_account = TextAreaField(
        "GCloud Service Account JSON",
        validators=[Optional()],
        description='<a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" class="link">Create a service account</a> with "DNS Administrator" role and download the JSON key file',
    )
    digitalocean_token = StringField(
        "DigitalOcean Token",
        validators=[Optional()],
        description='<a href="https://cloud.digitalocean.com/account/api/tokens" target="_blank" class="link">Generate a personal access token</a> with "read" and "write" scopes',
    )
    azure_client_id = StringField(
        "Azure Client ID",
        validators=[Optional()],
        description='<a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" class="link">Register an application</a> and copy the "Application (client) ID"',
    )
    azure_client_secret = StringField(
        "Azure Client Secret",
        validators=[Optional()],
        description='Create a client secret in your app registration\'s "Certificates & secrets" section',
    )
    azure_tenant_id = StringField(
        "Azure Tenant ID",
        validators=[Optional()],
        description='Found in "Azure Active Directory › Overview › Directory (tenant) ID"',
    )
    azure_subscription_id = StringField(
        "Azure Subscription ID",
        validators=[Optional()],
        description='<a href="https://portal.azure.com/#view/Microsoft_Azure_Billing/SubscriptionsBlade" target="_blank" class="link">Find your subscription ID</a> in the Subscriptions list',
    )
    azure_resource_group = StringField(
        "Azure Resource Group",
        validators=[Optional()],
        description="Name of the resource group containing your DNS zone",
    )

    async def validate(self, extra_validators=None):
        """Override validate to conditionally require SSL provider fields."""
        valid = await super().validate(extra_validators)

        settings = get_settings()
        if settings.env == "development":
            self.le_email.errors = []
            self.ssl_provider.errors = []
            return (
                len(self.server_ip.errors) == 0
                and len(self.app_hostname.errors) == 0
                and len(self.deploy_domain.errors) == 0
            )

        if not valid:
            return False

        ssl_provider = self.ssl_provider.data
        required_fields = PROVIDER_FIELDS.get(ssl_provider, [])

        for field_name in required_fields:
            field = getattr(self, field_name)
            if not field.data:
                field.errors.append(_l("This field is required"))
                valid = False

        return valid


class GitHubAppForm(StarletteForm):
    github_app_id = StringField("App ID", validators=[DataRequired()])
    github_app_name = StringField("App Name", validators=[DataRequired()])
    github_app_private_key = TextAreaField(
        "Private Key (PEM)", validators=[DataRequired()]
    )
    github_app_webhook_secret = StringField(
        "Webhook Secret", validators=[DataRequired()]
    )
    github_app_client_id = StringField("Client ID", validators=[DataRequired()])
    github_app_client_secret = StringField("Client Secret", validators=[DataRequired()])


class EmailForm(StarletteForm):
    resend_api_key = StringField(
        "Resend API Key",
        validators=[DataRequired()],
        description='<a href="https://resend.com/api-keys" target="_blank" class="link">Get your Resend API key</a>.',
    )
    email_sender_address = StringField(
        "Sender Email Address",
        validators=[DataRequired(), Email()],
        description='Sender email address. <a href="https://resend.com/domains" target="_blank" class="link">Domain must be verified in Resend</a>.',
    )
