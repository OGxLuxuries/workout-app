import type { Workout } from "./import";
export const ZONE = "America/New_York";
export function localDay(timestamp: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}
export function addDays(day: string, n: number) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function monday(day: string) {
  const dow = new Date(day + "T12:00:00Z").getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}
export function dayStart(day: string) {
  // Resolve New York midnight without assuming a fixed UTC offset across DST.
  const target = new Date(day + "T00:00:00Z").getTime();
  let instant = target + 5 * 3600000;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    const represented = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
      +p.second,
    );
    instant += target - represented;
  }
  return new Date(instant).toISOString();
}
export type BodyWeight = { day: string; kg: number };
export type Coverage = { start: string; end: string };
export type ExerciseChoice = { id: string; equipment: string; type: string };
export function covered(start: string, end: string, ranges: Coverage[]) {
  let cursor = Date.parse(start);
  const until = Date.parse(end);
  for (const r of [...ranges].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  )) {
    if (Date.parse(r.start) > cursor) break;
    cursor = Math.max(cursor, Date.parse(r.end));
    if (cursor >= until) return true;
  }
  return false;
}
export function weekly(
  workouts: Workout[],
  weights: BodyWeight[],
  choices: ExerciseChoice[],
  week: string,
  coverage: Coverage[],
  now = new Date(),
) {
  const endDay = addDays(week, 7),
    start = dayStart(week),
    end = dayStart(endDay);
  const provisional = now.getTime() < Date.parse(end);
  const through = provisional
    ? new Date(
        Math.min(
          now.getTime(),
          Math.max(0, ...coverage.map((r) => Date.parse(r.end))),
        ),
      ).toISOString()
    : end;
  const items = workouts.filter(
    (w) =>
      Date.parse(w.start_time) >= Date.parse(start) &&
      Date.parse(w.start_time) < Date.parse(provisional ? through : end),
  );
  let volume = 0,
    missingWeight = false;
  const sortedWeights = [...weights].sort((a, b) => b.day.localeCompare(a.day));
  for (const w of items) {
    const body = sortedWeights.find((b) => b.day <= localDay(w.start_time));
    for (const e of w.exercises) {
      if (
        e.exercise_type !== "weight_reps" ||
        !choices.some(
          (c) =>
            c.id === e.exercise_template_id &&
            c.equipment === e.equipment &&
            c.type === e.exercise_type,
        )
      )
        continue;
      for (const s of e.sets)
        if (s.type !== "warmup" && s.weight_kg && s.reps) {
          if (!body) {
            missingWeight = true;
            continue;
          }
          volume += (s.weight_kg * s.reps) / body.kg;
        }
    }
  }
  return {
    week,
    volume,
    frequency: items.length,
    provisional,
    through,
    ready:
      !missingWeight &&
      Date.parse(through) > Date.parse(start) &&
      covered(start, through, coverage),
    missingWeight,
  };
}
export function progress(
  workouts: Workout[],
  weights: BodyWeight[],
  choices: ExerciseChoice[],
  baselineWeek: string,
  week: string,
  ranges: Coverage[],
  now = new Date(),
) {
  const baseline = weekly(
      workouts,
      weights,
      choices,
      baselineWeek,
      ranges,
      now,
    ),
    current = weekly(workouts, weights, choices, week, ranges, now);
  const improvement =
    baseline.ready &&
    !baseline.provisional &&
    baseline.volume > 0 &&
    current.ready &&
    week > baselineWeek
      ? 100 * (current.volume / baseline.volume - 1)
      : null;
  return { ...current, baseline: baseline.volume, improvement };
}

export function rankPlayers<T extends { last: { improvement: number | null } }>(
  players: T[],
) {
  if (!players.length || players.some((p) => p.last.improvement === null))
    return null;
  const sorted = players
    .map((player) => ({
      player,
      score: Number(player.last.improvement!.toFixed(2)),
    }))
    .sort((a, b) => b.score - a.score);
  return sorted.map((entry, index) => ({
    ...entry,
    rank:
      index > 0 && entry.score === sorted[index - 1].score
        ? sorted.findIndex((candidate) => candidate.score === entry.score) + 1
        : index + 1,
  }));
}
