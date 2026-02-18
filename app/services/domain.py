import dns.resolver
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import Settings
from models import Deployment


class DomainService:
    def __init__(self, settings: Settings):
        self.server_ip = settings.server_ip
        self.deploy_domain = settings.deploy_domain

    def _is_apex_domain(self, hostname: str) -> bool:
        """Check if domain is apex (no subdomain)"""
        parts = hostname.split(".")
        return len(parts) == 2

    async def verify_domain(
        self,
        hostname: str,
        project_id: str,
        environment_id: str,
        db: AsyncSession,
    ) -> tuple[bool, str, str | None]:
        try:
            has_succeeded_deployment = (
                await db.execute(
                    select(Deployment.id).where(
                        Deployment.project_id == project_id,
                        Deployment.environment_id == environment_id,
                        Deployment.conclusion == "succeeded",
                    )
                )
            ).scalars().first() is not None
            if not has_succeeded_deployment:
                return (
                    False,
                    "Deployment required",
                    f'No successful deployment found for environment "{environment_id}". Deploy this environment first, then verify again.',
                )

            if self._is_apex_domain(hostname):
                # Apex domain: check A record points to server IP
                a_records = dns.resolver.resolve(hostname, "A")
                a_record_ips = [str(record) for record in a_records]

                if self.server_ip not in a_record_ips:
                    return (
                        False,
                        "A record mismatch",
                        f"A record points to {', '.join(a_record_ips)}, expected {self.server_ip}. "
                        f"Add an A record pointing to {self.server_ip} or use ANAME/ALIAS if your DNS provider supports it.",
                    )
            else:
                # Subdomain: allow CNAME to deploy domain or A record to server IP.
                try:
                    cname_records = dns.resolver.resolve(hostname, "CNAME")
                    cname_target = str(cname_records[0]).rstrip(".")

                    # Check if CNAME points to our deploy domain
                    if not cname_target.endswith(f".{self.deploy_domain}"):
                        return (
                            False,
                            "CNAME target mismatch",
                            f"CNAME points to {cname_target}, expected to point to a subdomain of {self.deploy_domain}. "
                            f"Use a CNAME record pointing to your environment alias or an A record to {self.server_ip}.",
                        )
                except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
                    try:
                        a_records = dns.resolver.resolve(hostname, "A")
                        a_record_ips = [str(record) for record in a_records]
                        if self.server_ip in a_record_ips:
                            return True, "Domain verified successfully", None
                        return (
                            False,
                            "A record mismatch",
                            f"A record points to {', '.join(a_record_ips)}, expected {self.server_ip}. "
                            f"Use a CNAME record pointing to your environment alias or an A record to {self.server_ip}.",
                        )
                    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
                        return (
                            False,
                            "DNS record not found",
                            f"No CNAME or A record found for {hostname}. "
                            f"Use a CNAME record pointing to your environment alias or an A record to {self.server_ip}.",
                        )

            return True, "Domain verified successfully", None

        except Exception as e:
            return False, "Verification failed", str(e)
