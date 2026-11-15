import { describe, it, expect } from "vitest";
import {
  dayStart,
  localDay,
  weekly,
  progress,
  covered,
  rankPlayers,
} from "../shared/scoring";
import { validatePage, compareVersion, type Workout } from "../shared/import";
export const workout = (
  id = "w1",
  start = "2026-10-26T16:00:00Z",
  weight = 100,
): Workout => ({
  id,
  start_time: start,
  end_time: start.replace("16:", "17:"),
  updated_at: "2026-11-01T12:00:00Z",
  exercises: [
    {
      index: 0,
      exercise_template_id: "bench",
      title: "Bench Press",
      equipment: "barbell",
      exercise_type: "weight_reps",
      sets: [{ index: 0, type: "normal", weight_kg: weight, reps: 10 }],
    },
  ],
});
const choices = [{ id: "bench", equipment: "barbell", type: "weight_reps" }];
const ranges = [{ start: "2026-10-01T00:00:00Z", end: "2026-11-13T00:00:00Z" }];
describe("scoring", () => {
  it("ranks all four players and ties scores at display precision", () => {
    const players = [
      { name: "Oliver", last: { improvement: 8 } },
      { name: "Tashi", last: { improvement: 12.501 } },
      { name: "Jason", last: { improvement: 12.504 } },
      { name: "Blake", last: { improvement: -1 } },
    ];
    expect(
      rankPlayers(players)?.map(({ player, rank }) => [player.name, rank]),
    ).toEqual([
      ["Tashi", 1],
      ["Jason", 1],
      ["Oliver", 3],
      ["Blake", 4],
    ]);
    expect(
      rankPlayers([
        ...players.slice(0, 3),
        { name: "Blake", last: { improvement: null } },
      ]),
    ).toBeNull();
  });
  it("shows provisional progress only through the latest successful import", () => {
    const result = progress(
      [workout(), workout("w2", "2026-11-02T16:00:00Z", 150)],
      [{ day: "2026-10-01", kg: 100 }],
      choices,
      "2026-10-26",
      "2026-11-02",
      [{ start: "2026-10-01T00:00:00Z", end: "2026-11-04T12:00:00Z" }],
      new Date("2026-11-05T12:00:00Z"),
    );
    expect(result.provisional).toBe(true);
    expect(result.improvement).toBe(50);
    expect(result.through).toBe("2026-11-04T12:00:00.000Z");
  });
  it("handles New York DST boundaries", () => {
    expect(dayStart("2026-11-01")).toBe("2026-11-01T04:00:00.000Z");
    expect(dayStart("2026-11-02")).toBe("2026-11-02T05:00:00.000Z");
    expect(localDay("2026-11-02T04:30:00Z")).toBe("2026-11-01");
  });
  it("uses effective body weight and the first full week baseline", () => {
    const r = progress(
      [workout(), workout("w2", "2026-11-02T16:00:00Z", 150)],
      [
        { day: "2026-10-01", kg: 100 },
        { day: "2026-11-02", kg: 120 },
      ],
      choices,
      "2026-10-26",
      "2026-11-02",
      ranges,
      new Date("2026-11-13"),
    );
    expect(r.baseline).toBe(10);
    expect(r.volume).toBe(12.5);
    expect(r.improvement).toBe(25);
  });
  it("does not rank incomplete data, zero baselines or baseline week", () => {
    const w = workout();
    expect(
      progress([w], [], choices, "2026-10-26", "2026-11-02", ranges)
        .improvement,
    ).toBeNull();
    expect(
      progress([], [], choices, "2026-10-26", "2026-11-02", ranges).improvement,
    ).toBeNull();
    expect(
      progress(
        [w],
        [{ day: "2026-10-01", kg: 100 }],
        choices,
        "2026-10-26",
        "2026-10-26",
        ranges,
      ).improvement,
    ).toBeNull();
    expect(
      weekly([w], [{ day: "2026-10-01", kg: 100 }], choices, "2026-10-26", [])
        .ready,
    ).toBe(false);
  });
  it("scores a fully covered empty week as minus 100 percent", () => {
    expect(
      progress(
        [workout()],
        [{ day: "2026-10-01", kg: 100 }],
        choices,
        "2026-10-26",
        "2026-11-02",
        ranges,
        new Date("2026-11-13"),
      ).improvement,
    ).toBe(-100);
  });
  it("excludes warmups, assisted, unknown and non-agreed variants", () => {
    const w = workout();
    w.exercises[0].sets[0].type = "warmup";
    expect(
      weekly(
        [w],
        [{ day: "2026-10-01", kg: 100 }],
        choices,
        "2026-10-26",
        ranges,
      ).volume,
    ).toBe(0);
    w.exercises[0].sets[0].type = "normal";
    w.exercises[0].equipment = "machine";
    expect(
      weekly(
        [w],
        [{ day: "2026-10-01", kg: 100 }],
        choices,
        "2026-10-26",
        ranges,
      ).volume,
    ).toBe(0);
    w.exercises[0].equipment = "barbell";
    w.exercises[0].exercise_type = "bodyweight_assisted";
    expect(weekly([w], [], choices, "2026-10-26", ranges).volume).toBe(0);
  });
  it("merges adjacent coverage but never fills gaps", () => {
    expect(
      covered("2026-01-01", "2026-01-03", [
        { start: "2026-01-01", end: "2026-01-02" },
        { start: "2026-01-02", end: "2026-01-03" },
      ]),
    ).toBe(true);
    expect(
      covered("2026-01-01", "2026-01-04", [
        { start: "2026-01-01", end: "2026-01-02" },
        { start: "2026-01-03", end: "2026-01-04" },
      ]),
    ).toBe(false);
  });
});
describe("agent output validation", () => {
  it("rejects notes, malformed records and duplicate IDs", () => {
    const p = {
      schemaVersion: 1,
      sourceUserId: "a",
      page: 1,
      pageCount: 1,
      workouts: [workout()],
    };
    expect(validatePage(p).workouts).toHaveLength(1);
    expect(() => validatePage({ ...p, notes: "private" })).toThrow();
    expect(() =>
      validatePage({ ...p, workouts: [workout(), workout()] }),
    ).toThrow();
    expect(() => validatePage({ ...p, page: 2 })).toThrow();
  });
  it("deduplicates and protects newer source data", () => {
    const w = workout();
    expect(compareVersion(w, w)).toBe("unchanged");
    expect(
      compareVersion(w, { ...w, updated_at: "2026-10-01T00:00:00Z" }),
    ).toBe("stale");
    expect(
      compareVersion(w, { ...w, updated_at: "2026-11-02T00:00:00Z" }),
    ).toBe("updated");
    expect(() => compareVersion(w, workout("w1", w.start_time, 200))).toThrow(
      "same source timestamp",
    );
  });
});
