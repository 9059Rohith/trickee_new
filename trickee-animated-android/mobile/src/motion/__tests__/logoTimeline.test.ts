import { logoIsComplete, logoIsResolved, logoRoutePaths, logoStages, stageProgress } from "../logoTimeline";
import { motionColors, motionDurations } from "../tokens";

describe("web logo timing contract", () => {
  it("keeps the source reveal and exit milestones", () => {
    expect(motionDurations.introResolved).toBe(2600);
    expect(motionDurations.introHold + motionDurations.introExit).toBe(5050);
    expect(logoIsResolved(2599)).toBe(false);
    expect(logoIsResolved(2600)).toBe(true);
    expect(logoIsComplete(5049)).toBe(false);
    expect(logoIsComplete(5050)).toBe(true);
    expect(logoIsComplete(650, true)).toBe(true);
  });

  it("clamps every stage and preserves its start/end", () => {
    for (const [name, stage] of Object.entries(logoStages)) {
      const key = name as keyof typeof logoStages;
      expect(stageProgress(stage.start - 1, key)).toBe(0);
      expect(stageProgress(stage.start, key)).toBe(0);
      expect(stageProgress(stage.start + stage.duration / 2, key)).toBeCloseTo(0.5);
      expect(stageProgress(stage.start + stage.duration, key)).toBe(1);
      expect(stageProgress(stage.start + stage.duration + 1, key)).toBe(1);
    }
  });

  it("carries the exact web route geometry and brand colors", () => {
    expect(logoRoutePaths[0]).toContain("L249 334L160 195H250V333");
    expect(logoRoutePaths[1]).toContain("M251 121L280 154");
    expect(motionColors.yellow).toBe("#FFE000");
    expect(motionColors.cyan).toBe("#48DFF4");
  });
});
