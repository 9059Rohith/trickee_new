import {
  addPlannerStop,
  isPastPlannerDate,
  monthCells,
  movePlannerStop,
  removePlannerStop,
  updatePlannerStop,
} from "../plannerForm";

const stop = (label: string) => ({
  label,
  requested_arrival_local: "09:00",
  status: "resolved",
});

describe("planner calendar and stop editing", () => {
  it("builds a stable six-week month grid across month boundaries", () => {
    const cells = monthCells("2026-09-10");
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ iso: "2026-08-30", day: 30, inMonth: false });
    expect(cells[2]).toEqual({ iso: "2026-09-01", day: 1, inMonth: true });
    expect(cells[41]).toEqual({ iso: "2026-10-10", day: 10, inMonth: false });
  });

  it("disables dates before the local today without disabling today", () => {
    expect(isPastPlannerDate("2026-09-09", "2026-09-10")).toBe(true);
    expect(isPastPlannerDate("2026-09-10", "2026-09-10")).toBe(false);
  });

  it("adds, removes, and reorders stops while enforcing one to ten", () => {
    expect(removePlannerStop([stop("Only")], 0)).toEqual([stop("Only")]);
    expect(movePlannerStop([stop("A"), stop("B"), stop("C")], 2, -1).map(item => item.label)).toEqual(["A", "C", "B"]);
    const ten = Array.from({ length: 10 }, (_, index) => stop(`S${index}`));
    expect(addPlannerStop(ten)).toHaveLength(10);
    expect(addPlannerStop([stop("A")])).toEqual([
      stop("A"),
      { label: "", requested_arrival_local: null, status: "needs_confirmation" },
    ]);
  });

  it("updates one field without losing a map-selected coordinate", () => {
    const stops = [{
      ...stop("Office"),
      coordinates: { lat: 21.17, lng: 72.83 },
      resolved_location: { source: "user_map_pin", coordinates: { lat: 21.17, lng: 72.83 } },
    }];
    expect(updatePlannerStop(stops, 0, { requested_arrival_local: "09:30" })[0]).toEqual({
      ...stops[0], requested_arrival_local: "09:30",
    });
  });
});
