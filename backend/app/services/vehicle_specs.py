"""Single completeness policy for inputs consumed by GPS energy predictions."""
from app.models.entities import Vehicle


REQUIRED_PREDICTION_SPEC_FIELDS = (
    "category",
    "make",
    "model",
    "usable_kwh",
    "battery_chemistry",
    "kerb_weight",
    "regen_available",
    "certified_range",
)


def is_prediction_spec_complete(vehicle: Vehicle) -> bool:
    for field_name in REQUIRED_PREDICTION_SPEC_FIELDS:
        value = getattr(vehicle, field_name, None)
        if value is None:
            return False
        if isinstance(value, str) and value.strip().lower() in {"", "unknown"}:
            return False
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value <= 0:
            return False
    return True
