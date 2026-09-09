from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


_SEGMENT_SPLIT = re.compile(r"\s*(?:,|;|\bthen\b)\s*", re.IGNORECASE)
_TIME_PATTERNS = (
    re.compile(
        r"\b(?:at|by)\s+(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*(?P<ampm>a\.?m\.?|p\.?m\.?)?\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?P<hour>\d{1,2}):(?P<minute>\d{2})\s*(?P<ampm>a\.?m\.?|p\.?m\.?)?\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?P<hour>\d{1,2})\s*(?P<ampm>a\.?m\.?|p\.?m\.?)\b",
        re.IGNORECASE,
    ),
)


@dataclass(frozen=True)
class ParsedStop:
    label: str
    requested_arrival_local: str | None
    status: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class ParsedDailyPlan:
    service_date: date
    timezone: str
    stops: tuple[ParsedStop, ...]
    parser_source: str
    warnings: list[str]

    def to_dict(self) -> dict:
        return {
            "service_date": self.service_date.isoformat(),
            "timezone": self.timezone,
            "stops": [stop.to_dict() for stop in self.stops],
            "parser_source": self.parser_source,
            "warnings": list(self.warnings),
        }


def _normalize_time(match: re.Match[str]) -> str | None:
    hour = int(match.group("hour"))
    minute = int(match.groupdict().get("minute") or 0)
    ampm = (match.groupdict().get("ampm") or "").lower().replace(".", "")
    if minute > 59:
        return None
    if ampm:
        if hour < 1 or hour > 12:
            return None
        if ampm == "pm" and hour != 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
    elif hour > 23:
        return None
    return f"{hour:02d}:{minute:02d}"


def _parse_segment(segment: str) -> ParsedStop | None:
    value = segment.strip(" .-")
    if not value:
        return None
    for pattern in _TIME_PATTERNS:
        match = pattern.search(value)
        if not match:
            continue
        normalized = _normalize_time(match)
        label = (value[: match.start()] + value[match.end() :]).strip(" .-")
        label = re.sub(r"\s+", " ", label)
        if not label:
            label = "Unnamed stop"
        return ParsedStop(
            label=label[:160],
            requested_arrival_local=normalized,
            status="unresolved" if normalized else "needs_confirmation",
        )
    return ParsedStop(
        label=re.sub(r"\s+", " ", value)[:160],
        requested_arrival_local=None,
        status="needs_confirmation",
    )


def parse_daily_plan(
    message: str,
    service_date: date,
    timezone_name: str,
    reference_date: date | None = None,
) -> ParsedDailyPlan:
    value = message.strip()
    if not value:
        raise ValueError("message must include at least one stop")
    if len(value) < 3 or len(value) > 2000:
        raise ValueError("message length must be between 3 and 2000 characters")
    try:
        timezone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("timezone must be a valid IANA timezone") from exc

    local_reference_date = reference_date or datetime.now(timezone).date()
    if re.search(r"\btomorrow\b", value, re.IGNORECASE):
        service_date = local_reference_date + timedelta(days=1)
    elif re.search(r"\btoday\b", value, re.IGNORECASE):
        service_date = local_reference_date

    stops = tuple(
        stop
        for segment in _SEGMENT_SPLIT.split(value)
        if (stop := _parse_segment(segment)) is not None
    )
    if not stops:
        raise ValueError("message must include at least one stop")
    warnings = [
        f"Add an arrival time for {stop.label}."
        for stop in stops
        if stop.requested_arrival_local is None
    ]
    return ParsedDailyPlan(
        service_date=service_date,
        timezone=timezone_name,
        stops=stops,
        parser_source="deterministic_schedule_parser",
        warnings=warnings,
    )
