import json
import re
from datetime import datetime, timezone

LEVEL_ALIASES = {
    "debug": "DEBUG",
    "info": "INFO",
    "success": "SUCCESS",
    "warn": "WARNING",
    "warning": "WARNING",
    "error": "ERROR",
    "fatal": "CRITICAL",
    "critical": "CRITICAL",
}

LEVEL_PATTERN = re.compile(
    r"""(?ix)
    (?:
        (?:^|\s)\[(?P<bracketed>debug|info|success|warn|warning|error|fatal|critical)\]  # [ERROR]
        |
        (?:^|\s)(?P<colon>debug|info|success|warn|warning|error|fatal|critical):         # ERROR:
        |
        (?:^|\s)(?P<dash>debug|info|success|warn|warning|error|fatal|critical)(?=\s+-\s) # ERROR -
        |
        ["']?level["']?\s*[=:]\s*["']?(?P<kv>debug|info|success|warn|warning|error|fatal|critical)["']?  # level=error, "level":"error"
    )
    """
)


def _get_level_from_text(log_line: str) -> str:
    """Extract log level from plain text log line."""
    match = LEVEL_PATTERN.search(log_line)
    if match:
        level = (
            match.group("bracketed")
            or match.group("colon")
            or match.group("dash")
            or match.group("kv")
        )
        if level:
            return LEVEL_ALIASES[level.lower()]
    return "INFO"


def parse_structured_log(log_line: str) -> tuple[str, str]:
    """Parse a log line, handling JSON structured logs.

    Returns (message, level) tuple.
    """
    if not log_line or not log_line.strip().startswith("{"):
        return log_line, _get_level_from_text(log_line)

    try:
        data = json.loads(log_line)
    except (json.JSONDecodeError, ValueError):
        return log_line, _get_level_from_text(log_line)

    if not isinstance(data, dict):
        return log_line, _get_level_from_text(log_line)

    msg = data.get("msg") or data.get("message") or data.get("body") or ""
    level_raw = data.get("level") or data.get("levelname") or data.get("severity") or ""

    if not msg:
        return log_line, _get_level_from_text(log_line)

    level = LEVEL_ALIASES.get(level_raw.lower(), "INFO") if level_raw else "INFO"
    return msg, level


def _get_level(log_line: str) -> str:
    """Get log level from log line (handles JSON and plain text)."""
    _, level = parse_structured_log(log_line)
    return level


def parse_log(log: str):
    """Parse log line into timestamp, timestamp_iso, message, and level."""
    timestamp, separator, message = log.partition(" ")
    level = _get_level(message)

    return {
        "timestamp": timestamp if separator else None,
        "timestamp_iso": iso_nano_to_iso(timestamp) if separator else None,
        "message": message if separator else timestamp,
        "level": level,
    }


def iso_nano_to_iso(ts: str) -> str:
    """Convert RFC3339-nano string (with offset) to ISO-8601 UTC string (millis)."""
    if not ts:
        return ""
    dt_aware = datetime.fromisoformat(ts)
    dt_utc = dt_aware.astimezone(timezone.utc)
    return dt_utc.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def epoch_nano_to_iso(ns: str | int) -> str:
    """Convert epoch nanoseconds to ISO-8601 UTC string (millis)."""
    dt = datetime.fromtimestamp(int(ns) / 1e9, tz=timezone.utc)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
