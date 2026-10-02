"""Fleet-owner GPS intelligence, scoped to the authenticated owner's fleet."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import MobileTripSession, TripFeature, TripFinalization, TripPrediction, User, Vehicle
from app.schemas.api import ok
from app.services.auth import get_current_user
from app.services.gps_prediction_service import get_vehicle_gps_summary

router = APIRouter(prefix="/owner", tags=["fleet-owner"])


@router.get("/summary")
def owner_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in {"admin", "fleet_admin", "owner"}:
        raise HTTPException(403, "Fleet owner role required")
    if not current_user.fleet_id:
        raise HTTPException(400, "User has no fleet")

    vehicles = (
        db.query(Vehicle)
        .filter(Vehicle.fleet_id == current_user.fleet_id, Vehicle.is_active.is_(True))
        .order_by(Vehicle.vehicle_code)
        .all()
    )
    rows = []
    totals = {"distance_km": 0.0, "route_energy_kwh": 0.0, "trips": 0}
    for vehicle in vehicles:
        summary = get_vehicle_gps_summary(db, vehicle.id)
        completed_trips = (
            db.query(MobileTripSession)
            .filter(
                MobileTripSession.vehicle_id == vehicle.id,
                MobileTripSession.ended_at.isnot(None),
            )
            .order_by(MobileTripSession.ended_at.desc())
            .all()
        )
        ended = len(completed_trips)
        totals["trips"] += ended
        distance = 0.0
        energy_wh = 0.0
        latest_final_summary = None
        for trip in completed_trips:
            feature = db.query(TripFeature).filter(TripFeature.trip_id == trip.id).first()
            trip_prediction = (
                db.query(TripPrediction)
                .filter(TripPrediction.trip_id == trip.id)
                .order_by(TripPrediction.created_at.desc())
                .first()
            )
            finalization = db.query(TripFinalization).filter(TripFinalization.trip_id == trip.id).first()
            final_summary = finalization.summary or {} if finalization and finalization.state == "completed" else {}
            if latest_final_summary is None and final_summary:
                latest_final_summary = final_summary
            distance += (feature.distance_km if feature else final_summary.get("distance_km")) or 0
            energy_wh += (
                trip_prediction.route_energy_wh if trip_prediction else (final_summary.get("energy") or {}).get("route_energy_wh")
            ) or 0
        energy_kwh = energy_wh / 1000.0
        prediction = summary.get("latest_prediction")
        if prediction is None and latest_final_summary:
            final_energy = latest_final_summary.get("energy") or {}
            prediction = {
                "wh_per_km": final_energy.get("wh_per_km"),
                "route_energy_wh": final_energy.get("route_energy_wh"),
                "demand_score": final_energy.get("demand_score"),
                "soc_consumed_pct": (latest_final_summary.get("soc") or {}).get("estimated_consumed_pct"),
                "confidence": final_energy.get("confidence_numeric"),
                "source": final_energy.get("source"),
                "estimated": bool(final_energy.get("estimated", True)),
            }
        estimated_range = summary.get("estimated_range_km")
        if estimated_range is None and summary.get("soc", {}).get("is_recent") and latest_final_summary:
            estimated_range = (latest_final_summary.get("range") or {}).get("estimated_remaining_km")
        totals["distance_km"] += distance
        totals["route_energy_kwh"] += energy_kwh
        rows.append({
            "vehicle_id": vehicle.id,
            "vehicle_code": vehicle.vehicle_code,
            "spec_incomplete": vehicle.spec_incomplete,
            "completed_trips": ended,
            "distance_km": round(distance, 2),
            "route_energy_kwh": round(energy_kwh, 3),
            "latest_prediction": prediction,
            "soc": summary.get("soc"),
            "estimated_range_km": estimated_range,
            "range_available": estimated_range is not None,
        })

    return ok({
        "fleet_id": current_user.fleet_id,
        "totals": {
            "vehicles": len(rows),
            "trips": totals["trips"],
            "distance_km": round(totals["distance_km"], 2),
            "route_energy_kwh": round(totals["route_energy_kwh"], 3),
        },
        "vehicles": rows,
        "calculation_basis": "GPS + vehicle specifications",
        "range_policy": "Remaining range is only shown with a recent SOC reading.",
    })
