from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from typing import Callable, Protocol

import httpx

from app.config import get_settings


PLACES_TEXT_ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
PLACES_NEARBY_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby"
ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes"


class HttpClient(Protocol):
    def __enter__(self): ...
    def __exit__(self, exc_type, exc, traceback): ...
    def post(self, url: str, *, json: dict, headers: dict[str, str]): ...


def _evidence(source: str, degraded_reason: str | None = None) -> dict:
    return {
        "source": source,
        "evidence_at": datetime.now(timezone.utc).isoformat(),
        "confidence": 0.0 if degraded_reason else 0.85,
        "degraded_reason": degraded_reason,
    }


def _lat_lng(value: dict) -> dict[str, float] | None:
    try:
        lat = float(value["latitude"] if "latitude" in value else value["lat"])
        lng = float(value["longitude"] if "longitude" in value else value["lng"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180 and math.isfinite(lat) and math.isfinite(lng)):
        return None
    return {"lat": lat, "lng": lng}


class DailyPlanTools:
    """Bounded Google mobility adapters. Provider failure always returns explicit null facts."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        timeout_seconds: float | None = None,
        cache_seconds: int | None = None,
        client_factory: Callable[[float], HttpClient] | None = None,
    ) -> None:
        settings = get_settings()
        self.api_key = settings.google_maps_api_key if api_key is None else api_key
        self.timeout_seconds = timeout_seconds or settings.external_api_timeout_seconds
        self.cache_seconds = cache_seconds or settings.external_api_cache_seconds
        self.client_factory = client_factory or (lambda timeout: httpx.Client(timeout=timeout))
        self._cache: dict[tuple, tuple[float, dict | list]] = {}

    def _cached(self, key: tuple):
        saved_at, value = self._cache.get(key, (0.0, None))
        return value if value is not None and time.monotonic() - saved_at < self.cache_seconds else None

    def _remember(self, key: tuple, value):
        self._cache[key] = (time.monotonic(), value)
        return value

    def resolve_destination(self, query: str) -> dict:
        normalized = " ".join(query.split())[:160]
        if not self.api_key:
            return {"query": normalized, "name": None, "coordinates": None, **_evidence("unavailable", "google_places_not_configured")}
        key = ("place", normalized.casefold())
        if cached := self._cached(key):
            return {**cached, "cache_hit": True}
        try:
            headers = {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": self.api_key,
                "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
            }
            with self.client_factory(self.timeout_seconds) as client:
                response = client.post(PLACES_TEXT_ENDPOINT, json={"textQuery": normalized, "maxResultCount": 1, "languageCode": "en"}, headers=headers)
                response.raise_for_status()
                place = (response.json().get("places") or [None])[0]
            coordinates = _lat_lng((place or {}).get("location") or {})
            if not place or not coordinates:
                raise ValueError("missing place")
            display = place.get("displayName") or {}
            result = {
                "query": normalized,
                "place_id": place.get("id"),
                "name": display.get("text") or place.get("formattedAddress"),
                "formatted_address": place.get("formattedAddress"),
                "coordinates": coordinates,
                **_evidence("google_places"),
            }
            return self._remember(key, result)
        except httpx.TimeoutException:
            reason = "google_places_timeout"
        except httpx.HTTPStatusError as exc:
            reason = "google_places_quota" if exc.response.status_code == 429 else "google_places_http_error"
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            reason = "google_places_unavailable"
        return {"query": normalized, "name": None, "coordinates": None, **_evidence("unavailable", reason)}

    def plan_route_leg(self, origin: dict[str, float], destination: dict[str, float], departure_at: datetime) -> dict:
        if not self.api_key:
            return {"distance_m": None, "duration_s": None, "traffic_delay_s": None, **_evidence("unavailable", "google_routes_not_configured")}
        if departure_at.tzinfo is None or departure_at.utcoffset() is None:
            return {"distance_m": None, "duration_s": None, "traffic_delay_s": None, **_evidence("unavailable", "departure_timezone_required")}
        key = ("route", round(origin["lat"], 4), round(origin["lng"], 4), round(destination["lat"], 4), round(destination["lng"], 4), int(departure_at.timestamp() // 300))
        if cached := self._cached(key):
            return {**cached, "cache_hit": True}
        payload = {
            "origin": {"location": {"latLng": {"latitude": origin["lat"], "longitude": origin["lng"]}}},
            "destination": {"location": {"latLng": {"latitude": destination["lat"], "longitude": destination["lng"]}}},
            "travelMode": "DRIVE", "routingPreference": "TRAFFIC_AWARE",
            "departureTime": departure_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        headers = {"Content-Type": "application/json", "X-Goog-Api-Key": self.api_key, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline"}
        try:
            with self.client_factory(self.timeout_seconds) as client:
                response = client.post(ROUTES_ENDPOINT, json=payload, headers=headers)
                response.raise_for_status()
                route = (response.json().get("routes") or [None])[0]
            if not route:
                raise ValueError("missing route")
            duration_s = int(round(float(str(route["duration"]).removesuffix("s"))))
            static_s = int(round(float(str(route.get("staticDuration", route["duration"])).removesuffix("s"))))
            result = {
                "distance_m": int(route["distanceMeters"]), "duration_s": duration_s,
                "traffic_delay_s": max(0, duration_s - static_s),
                "encoded_polyline": (route.get("polyline") or {}).get("encodedPolyline"),
                **_evidence("google_routes"),
            }
            return self._remember(key, result)
        except httpx.TimeoutException:
            reason = "google_routes_timeout"
        except httpx.HTTPStatusError as exc:
            reason = "google_routes_quota" if exc.response.status_code == 429 else "google_routes_http_error"
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            reason = "google_routes_unavailable"
        return {"distance_m": None, "duration_s": None, "traffic_delay_s": None, **_evidence("unavailable", reason)}

    def find_route_chargers(self, center: dict[str, float], radius_m: int = 5000) -> list[dict]:
        if not self.api_key:
            return []
        radius_m = max(100, min(int(radius_m), 50_000))
        key = ("chargers", round(center["lat"], 3), round(center["lng"], 3), radius_m)
        if cached := self._cached(key):
            return [{**item, "cache_hit": True} for item in cached]
        payload = {"includedTypes": ["electric_vehicle_charging_station"], "maxResultCount": 10, "rankPreference": "DISTANCE", "locationRestriction": {"circle": {"center": {"latitude": center["lat"], "longitude": center["lng"]}, "radius": float(radius_m)}}}
        headers = {"Content-Type": "application/json", "X-Goog-Api-Key": self.api_key, "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.formattedAddress,places.googleMapsUri"}
        try:
            with self.client_factory(self.timeout_seconds) as client:
                response = client.post(PLACES_NEARBY_ENDPOINT, json=payload, headers=headers)
                response.raise_for_status()
                places = response.json().get("places") or []
            results = []
            for place in places[:10]:
                coordinates = _lat_lng(place.get("location") or {})
                if not coordinates:
                    continue
                results.append({"place_id": place.get("id"), "name": (place.get("displayName") or {}).get("text"), "formatted_address": place.get("formattedAddress"), "coordinates": coordinates, "google_maps_uri": place.get("googleMapsUri"), "power_kw": None, "availability_confirmed": False, **_evidence("google_places")})
            return self._remember(key, results)
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            return []


def estimate_leg_energy(*, distance_m: int | None, starting_soc_pct: float | None, usable_kwh: float | None, wh_per_km: float | None, rate_source: str = "deterministic_wh_per_km") -> dict:
    if usable_kwh is None or usable_kwh <= 0:
        reason = "usable_capacity_unavailable"
    elif starting_soc_pct is None or not 0 <= starting_soc_pct <= 100:
        reason = "starting_soc_unavailable"
    elif distance_m is None or distance_m < 0:
        reason = "route_distance_unavailable"
    elif wh_per_km is None or wh_per_km <= 0:
        reason = "energy_rate_unavailable"
    else:
        energy_wh = round(distance_m / 1000 * wh_per_km, 2)
        arrival_soc = round(max(0.0, starting_soc_pct - energy_wh / (usable_kwh * 1000) * 100), 2)
        confidence = 0.75 if rate_source.startswith("gps_prediction:") else 0.55
        return {"energy_wh": energy_wh, "arrival_soc_pct": arrival_soc, "wh_per_km": wh_per_km, "energy_source": rate_source, "confidence": confidence, "degraded_reason": None}
    return {"energy_wh": None, "arrival_soc_pct": None, "energy_source": "unavailable", "confidence": 0.0, "degraded_reason": reason}


def evaluate_charging_opportunity(*, charger: dict, current_soc_pct: float, battery_capacity_kwh: float, dwell_minutes: float) -> dict:
    place_confirmed = charger.get("source") == "google_places"
    availability_confirmed = charger.get("availability_confirmed") is True
    power = charger.get("power_kw")
    reasons = []
    if not availability_confirmed:
        reasons.append("availability_unconfirmed")
    if not isinstance(power, (int, float)) or power <= 0:
        reasons.append("charger_power_unconfirmed")
        gain = None
    else:
        gain = round(min(100 - current_soc_pct, power * max(0, dwell_minutes) / 60 * 0.9 / battery_capacity_kwh * 100), 1)
    recommended = bool(place_confirmed and availability_confirmed and gain is not None and gain > 0 and dwell_minutes >= 10)
    return {"place_confirmed": place_confirmed, "availability_confirmed": availability_confirmed, "estimated_soc_gain_pct": gain, "recommended": recommended, "reasons": reasons, "confidence": 0.9 if recommended else 0.35}


daily_plan_tools = DailyPlanTools()
