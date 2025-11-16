import re
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Allowlist


def _empty_entry() -> dict[str, Any]:
    return {
        "signature": None,
        "emails": set(),
        "domains": set(),
        "regex": [],
    }


_cache: dict[str, Any] = _empty_entry()


async def _load_rules(db: AsyncSession | None) -> dict[str, Any]:
    if not db:
        return _empty_entry()

    result = await db.execute(
        select(func.count(Allowlist.id), func.max(Allowlist.updated_at))
    )
    total_entries, latest_updated = result.one()
    signature = (
        int(total_entries or 0),
        latest_updated.isoformat() if latest_updated else None,
    )

    if _cache.get("signature") == signature:
        return _cache

    entries_result = await db.execute(select(Allowlist.type, Allowlist.value))
    emails: set[str] = set()
    domains: set[str] = set()
    regex_patterns: list[re.Pattern[str]] = []

    for row in entries_result.all():
        rule_type = row[0]
        value_raw = (row[1] or "").strip()
        if not value_raw:
            continue

        if rule_type == "email":
            emails.add(value_raw.lower())
        elif rule_type == "domain":
            domains.add(value_raw.lower())
        else:
            try:
                regex_patterns.append(re.compile(value_raw, re.IGNORECASE))
            except re.error:
                continue

    updated_entry = {
        "signature": signature,
        "emails": emails,
        "domains": domains,
        "regex": regex_patterns,
    }
    _cache.update(updated_entry)
    return _cache


async def is_email_allowed(email: str, db: AsyncSession | None) -> bool:
    if not db:
        return True

    cache = await _load_rules(db)
    if not (cache["emails"] or cache["domains"] or cache["regex"]):
        return True

    email_lower = (email or "").strip().lower()
    if not email_lower or "@" not in email_lower:
        return False
    domain = email_lower.split("@")[-1]

    if email_lower in cache["emails"]:
        return True

    if domain in cache["domains"]:
        return True

    if any(regex.search(email_lower) for regex in cache["regex"]):
        return True

    return False


async def notify_denied(email: str, provider: str, request, webhook_url: str):
    if not webhook_url:
        return
    try:
        payload = {
            "email": email,
            "provider": provider,
            "ip": getattr(getattr(request, "client", None), "host", None),
            "user_agent": request.headers.get("user-agent")
            if getattr(request, "headers", None)
            else None,
        }
        async with httpx.AsyncClient(timeout=3) as client:
            await client.post(webhook_url, json=payload)
    except Exception:
        pass
