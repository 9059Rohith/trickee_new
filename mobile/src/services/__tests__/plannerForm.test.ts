import {
  addPlannerDays,
  addPlannerStop,
  canShiftPlannerMonth,
  ensurePlannerStopIds,
  isPastPlannerDate,
  monthCells,
  movePlannerStop,
  plannerTimeParts,
  plannerDateHeading,
  removePlannerStop,
  setPlannerStopTime,
  toPlannerTime,
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

  it("keeps every parsed stop and its time independently addressable", () => {
    const stops = ensurePlannerStopIds([
      { ...stop("Office"), requested_arrival_local: "09:00" },
      { ...stop("Client"), requested_arrival_local: "12:30" },
      { ...stop("Warehouse"), requested_arrival_local: "16:00" },
      { ...stop("Home"), requested_arrival_local: "19:00" },
    ], index => `stop-${index + 1}`);

    expect(stops.map(item => [item.local_id, item.label, item.requested_arrival_local])).toEqual([
      ["stop-1", "Office", "09:00"],
      ["stop-2", "Client", "12:30"],
      ["stop-3", "Warehouse", "16:00"],
      ["stop-4", "Home", "19:00"],
    ]);
  });

  it("changes only the selected stop time", () => {
    const stops = ensurePlannerStopIds([
      { ...stop("Office"), requested_arrival_local: "09:00" },
      { ...stop("Client"), requested_arrival_local: "12:30" },
    ], index => `stop-${index + 1}`);

    expect(setPlannerStopTime(stops, "stop-2", "13:15").map(item => item.requested_arrival_local)).toEqual([
      "09:00",
      "13:15",
    ]);
  });

  it("preserves stop and time association after reorder and deletion", () => {
    const stops = ensurePlannerStopIds([
      { ...stop("Office"), requested_arrival_local: "09:00" },
      { ...stop("Client"), requested_arrival_local: "12:30" },
      { ...stop("Home"), requested_arrival_local: "19:00" },
    ], index => `stop-${index + 1}`);

    const moved = movePlannerStop(stops, 2, -1);
    const withoutOffice = removePlannerStop(moved, 0);
    expect(withoutOffice.map(item => [item.local_id, item.label, item.requested_arrival_local])).toEqual([
      ["stop-3", "Home", "19:00"],
      ["stop-2", "Client", "12:30"],
    ]);
  });

  it("converts the reusable clock picker without changing the stored HH:MM contract", () => {
    expect(plannerTimeParts("00:00")).toEqual({ hour: 12, minute: 0, period: "AM" });
    expect(plannerTimeParts("12:30")).toEqual({ hour: 12, minute: 30, period: "PM" });
    expect(plannerTimeParts("19:45")).toEqual({ hour: 7, minute: 45, period: "PM" });
    expect(toPlannerTime({ hour: 7, minute: 45, period: "PM" })).toBe("19:45");
    expect(toPlannerTime({ hour: 12, minute: 5, period: "AM" })).toBe("00:05");
  });

  it("offers safe date shortcuts and prevents navigation into past-only months", () => {
    expect(addPlannerDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(canShiftPlannerMonth("2026-09-11", -1, "2026-09-11")).toBe(false);
    expect(canShiftPlannerMonth("2026-10-01", -1, "2026-09-11")).toBe(true);
  });

  it("uses the selected service date in the confirmed-plan heading", () => {
    expect(plannerDateHeading("2026-09-11", "2026-09-11")).toBe("Today's plan");
    expect(plannerDateHeading("2026-09-12", "2026-09-11")).toBe("Tomorrow's plan");
    expect(plannerDateHeading("2026-09-14", "2026-09-11")).toBe("Plan for 14 September");
  });
});
