from smtplib import SMTP
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import resend

from config import Settings


def send_email_by_resend(
    recipients: list[str], subject: str, data: str, settings: Settings
) -> None:
    resend.api_key = settings.resend_api_key
    resend.Emails.send(
        {
            "from": f"{settings.email_sender_name} <{settings.email_sender_address}>",
            "to": recipients,
            "subject": subject,
            "html": data,
        }
    )


def send_email_by_smtp(
    recipients: list[str], subject: str, data: str, settings: Settings
) -> None:
    msg = MIMEMultipart()
    msg["From"] = f"{settings.email_sender_name} <{settings.email_sender_address}>"
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.attach(MIMEText(data, "html"))
    with SMTP(settings.smtp_host, settings.smtp_port) as server:
        server.starttls()
        server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(msg, to_addrs=recipients)


def send_email(
    recipients: list[str], subject: str, data: str, settings: Settings
) -> None:
    if all(
        [
            settings.smtp_host,
            settings.smtp_port,
            settings.smtp_username,
            settings.smtp_password,
        ]
    ):
        send_email_by_smtp(recipients, subject, data, settings)
    else:
        send_email_by_resend(recipients, subject, data, settings)
