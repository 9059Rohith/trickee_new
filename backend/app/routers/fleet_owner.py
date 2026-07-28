"""Fleet-owner GPS intelligence, scoped to the authenticated owner's fleet."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import MobileTripSession, TripFeature, TripPrediction, User, Vehicle
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
        prediction = summary.get("latest_prediction")
        completed = (
            db.query(MobileTripSession)
            .filter(
                MobileTripSession.vehicle_id == vehicle.id,
                MobileTripSession.status == "completed",
            )
            .count()
        )
        totals["trips"] += completed
        features = (
            db.query(TripFeature)
            .join(MobileTripSession, TripFeature.trip_id == MobileTripSession.id)
            .filter(MobileTripSession.vehicle_id == vehicle.id)
            .all()
        )
        predictions = db.query(TripPrediction).filter(TripPrediction.vehicle_id == vehicle.id).all()
        distance = sum(item.distance_km or 0 for item in features)
        energy_kwh = sum(item.route_energy_wh or 0 for item in predictions) / 1000.0
        totals["distance_km"] += distance
        totals["route_energy_kwh"] += energy_kwh
        rows.append({
            "vehicle_id": vehicle.id,
            "vehicle_code": vehicle.vehicle_code,
            "spec_incomplete": vehicle.spec_incomplete,
            "completed_trips": completed,
            "distance_km": round(distance, 2),
            "route_energy_kwh": round(energy_kwh, 3),
            "latest_prediction": prediction,
            "soc": summary.get("soc"),
            "estimated_range_km": summary.get("estimated_range_km"),
            "range_available": summary.get("range_available", False),
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
