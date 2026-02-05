from urllib.parse import unquote, urlparse
from typing import Any, Union, List

from fastapi import Request
from starlette.datastructures import URL

from config import get_settings, Settings


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


class RelativeURL:
    """
    A wrapper around starlette.datastructures.URL that renders as a relative path
    (path + query) when converted to string.
    """
    def __init__(self, url: URL):
        self.url = url

    def include_query_params(self, **kwargs: Any) -> "RelativeURL":
        return RelativeURL(self.url.include_query_params(**kwargs))

    def replace_query_params(self, **kwargs: Any) -> "RelativeURL":
        return RelativeURL(self.url.replace_query_params(**kwargs))

    def remove_query_params(self, keys: Union[str, List[str]]) -> "RelativeURL":
        return RelativeURL(self.url.remove_query_params(keys))

    def __str__(self) -> str:
        return self.url.path + ("?" + self.url.query if self.url.query else "")

    def __repr__(self) -> str:
        return str(self)

    def __eq__(self, other: Any) -> bool:
        return str(self) == str(other)

    def __getattr__(self, name: str) -> Any:
        return getattr(self.url, name)


def get_relative_url(request: Request, name: str, **path_params: Any) -> RelativeURL:
    """
    Generates a relative URL for a named route.
    """
    return RelativeURL(request.url_for(name, **path_params))


def get_app_base_url(request: Request, client_origin: str | None = None) -> str:
    """
    Determines the application base URL (scheme + hostname), trying to resolve
    the public URL if running behind a proxy or in Codespaces.
    """
    settings = get_settings()

    # 1. Trust client_origin ONLY if we are in a local environment
    if client_origin and settings.app_hostname in ("localhost", "127.0.0.1"):
        return client_origin.rstrip("/")

    # 2. Trust APP_HOSTNAME if set and not generic localhost
    if settings.app_hostname and "localhost" not in settings.app_hostname and settings.app_hostname != "127.0.0.1":
        scheme = settings.url_scheme
        return f"{scheme}://{settings.app_hostname}"

    # 3. Try X-Forwarded-Host (standard for proxies like Traefik/Codespaces)
    forwarded_host = request.headers.get("x-forwarded-host")
    if forwarded_host:
        # Codespaces/Proxies usually set X-Forwarded-Proto too
        scheme = request.headers.get("x-forwarded-proto", settings.url_scheme)
        return f"{scheme}://{forwarded_host}"

    # 4. Fallback to request.base_url (which is absolute)
    return str(request.base_url).rstrip("/")


def get_absolute_url(
    request: Request, name: str, client_origin: str | None = None, **path_params: Any
) -> URL:
    """
    Generates an absolute URL for a named route, using the resolved base URL.
    Returns a starlette.datastructures.URL object.
    """
    base_url = get_app_base_url(request, client_origin=client_origin)
    relative_url = get_relative_url(request, name, **path_params)
    return URL(f"{base_url}{relative_url}")


def get_email_logo_url(
    request: Request, settings: Settings, client_origin: str | None = None
) -> str:
    """
    Determines the URL for the email logo.
    """
    email_logo = settings.email_logo
    if not email_logo:
        email_logo = str(
            get_absolute_url(
                request, "assets", client_origin=client_origin, path="logo-email.png"
            )
        )
    return email_logo
