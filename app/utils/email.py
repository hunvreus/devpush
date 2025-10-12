import resend
from config import Settings
from smtplib import SMTP
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

def send_email_by_resend(email: str, subject: str, data: str, settings: Settings):
    resend.api_key = settings.resend_api_key
    resend.Emails.send(
        {
            "from": f"{settings.email_sender_name} <{settings.email_sender_address}>",
            "to": [email],
            "subject": subject,
            "html": data
        }
    )

def send_email_by_smtp(email: str, subject: str, data: str, settings: Settings):
    msg = MIMEMultipart()
    msg['From'] = f"{settings.email_sender_name} <{settings.email_sender_address}>"
    msg['To'] = email
    msg['Subject'] = subject
    msg.attach(MIMEText(data, 'html'))
    with SMTP(settings.smtp_host, settings.smtp_port) as server:
        server.starttls()
        server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(msg)

def send_email(email: str, subject: str, data: str, settings: Settings):
    if all([settings.smtp_host, settings.smtp_port, settings.smtp_username, settings.smtp_password]):
        send_email_by_smtp(email, subject, data, settings)
    else:
        send_email_by_resend(email, subject, data, settings)
