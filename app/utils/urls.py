from urllib.parse import unquote, urlparse

from fastapi import Request


def _validated_redirect_target(
    request: Request | None,
    candidate: str | None,
    allow_absolute: bool = False,
) -> str | None:
    """Validate a redirect target; allow same-origin absolute URLs only when enabled."""
    if not candidate:
        return None

    raw = candidate.strip()
    if not raw:
        return None

    decoded = unquote(raw)

    for value in (raw, decoded):
        if any(ch.isspace() for ch in value):
            return None
        if "\\" in value:
            return None
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
            return None

    parsed = urlparse(decoded)
    if parsed.scheme or parsed.netloc:
        if not allow_absolute or not request:
            return None
        if parsed.scheme not in ("http", "https"):
            return None
        if parsed.netloc != request.url.netloc:
            return None
        if not parsed.path.startswith("/"):
            return None
        redirect_path = parsed.path or "/"
        if parsed.query:
            redirect_path = f"{redirect_path}?{parsed.query}"
        if parsed.fragment:
            redirect_path = f"{redirect_path}#{parsed.fragment}"
        return redirect_path

    if not raw.startswith("/") or raw.startswith("//"):
        return None
    if not decoded.startswith("/") or decoded.startswith("//"):
        return None

    return raw


def safe_redirect(
    request: Request | None,
    next_value: str | None,
    referer: str | None,
    default: str = "/",
    prefer_next: bool = True,
) -> str:
    """Return a safe redirect target, prioritizing relative `next` over same-origin `referer`."""
    if prefer_next:
        primary = _validated_redirect_target(request, next_value, allow_absolute=False)
        if primary is not None:
            return primary
        candidate = referer
        allow_absolute = True
    else:
        candidate = referer
        allow_absolute = True

    if candidate is not None:
        secondary = _validated_redirect_target(
            request, candidate, allow_absolute=allow_absolute
        )
        if secondary is not None:
            return secondary

    fallback = _validated_redirect_target(request, next_value, allow_absolute=False)
    return fallback if fallback is not None else default
