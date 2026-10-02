import { schedulePlanReminders } from "../dailyPlanNotifications";
import { scheduleHighPriorityReminder } from "../telemetryNative";

jest.mock("../telemetryNative", () => ({
  scheduleHighPriorityReminder: jest.fn(),
}));

const plan = {
  id: "plan-1",
  status: "confirmed" as const,
  service_date: "2026-09-09",
  timezone: "Asia/Kolkata",
  starting_soc_pct: 80,
  draft: { stops: [] },
  result: {
    legs: [
      {
        index: 0,
        destination: { name: "Office", query: "Office" },
        planned_departure_at: "2026-09-09T09:00:00.000Z",
        arrival_soc_pct: 72.25,
      },
      {
        index: 1,
        destination: { name: "Past stop", query: "Past stop" },
        planned_departure_at: "2026-09-09T07:00:00.000Z",
        arrival_soc_pct: 70,
      },
    ],
  },
};

describe("schedulePlanReminders", () => {
  beforeEach(() => jest.clearAllMocks());

  it("schedules only future high-priority reminders and reports skipped legs", async () => {
    const result = await schedulePlanReminders(
      plan as never,
      Date.parse("2026-09-09T08:00:00.000Z")
    );

    expect(result).toEqual({ scheduled: 1, skipped: 1 });
    expect(scheduleHighPriorityReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        occurrenceId: "plan-1-leg-0",
        title: "Leave soon for Office",
        planId: "plan-1",
      })
    );
  });

  it("does not claim success when native scheduling fails", async () => {
    (scheduleHighPriorityReminder as jest.Mock).mockRejectedValueOnce(
      new Error("High-priority notification permission is required.")
    );

    await expect(
      schedulePlanReminders(plan as never, Date.parse("2026-09-09T08:00:00.000Z"))
    ).rejects.toThrow("notification permission");
  });
});
