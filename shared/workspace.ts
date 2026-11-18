import { z } from "zod";
import type { Workout } from "./import";
import { equipmentOptions } from "./training";

export const movementTypes = [
  "weight_reps",
  "reps_only",
  "duration",
  "distance",
  "assisted",
] as const;
export const muscles = [
  "chest",
  "back",
  "legs",
  "shoulders",
  "arms",
  "core",
  "full body",
  "cardio",
] as const;
export const exerciseInput = z.object({
  id: z.string().min(1).max(160),
  title: z.string().trim().min(1).max(100),
  equipment: z.enum(equipmentOptions),
  type: z.enum(movementTypes),
  muscle: z.enum(muscles).optional(),
  instructions: z.string().trim().max(1200).optional(),
});
export type CatalogExercise = z.infer<typeof exerciseInput>;
export const setInput = z.object({
  id: z.uuid(),
  reps: z.number().int().min(1).max(999).nullable(),
  weightKg: z.number().nonnegative().max(2500).nullable(),
  seconds: z.number().int().positive().max(86400).nullable(),
  meters: z.number().positive().max(1_000_000).nullable(),
  warmup: z.boolean(),
});
export const movementInput = exerciseInput.omit({ instructions: true }).extend({
  rowId: z.uuid(),
  note: z.string().trim().max(800).optional(),
  group: z.uuid().nullable(),
  restSeconds: z.number().int().min(0).max(1800).nullable(),
  sets: z.array(setInput).min(1).max(50),
});
export const stravaRunInput = z.object({
  unit: z.enum(["mi", "km"]),
  paceSeconds: z.number().int().positive().max(35999),
  splits: z
    .array(
      z.object({
        distance: z.number().positive().max(1),
        paceSeconds: z.number().int().positive().max(35999),
      }),
    )
    .min(1)
    .max(200),
});
export type StravaRun = z.infer<typeof stravaRunInput>;
export const runExercise = {
  id: "builtin:run",
  title: "Run",
  equipment: "other",
  type: "distance",
  muscle: "cardio",
} satisfies CatalogExercise;
export const workoutInput = z.object({
  title: z.string().trim().min(1).max(100),
  note: z.string().trim().max(2500).optional(),
  gym: z.string().trim().max(100).optional(),
  routineId: z.uuid().optional(),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }),
  audience: z.enum(["private", "connections", "group"]).default("private"),
  groupId: z.string().max(80).nullable().default(null),
  stravaRun: stravaRunInput.optional(),
  movements: z.array(movementInput).min(1).max(32),
});
export type TrainingWorkout = z.input<typeof workoutInput>;
export type SavedWorkout = z.output<typeof workoutInput>;
export type Movement = z.infer<typeof movementInput>;
export type TrainingSet = z.infer<typeof setInput>;
export const routineInput = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(100),
  movements: z.array(movementInput).min(1).max(32),
});
export type Routine = z.infer<typeof routineInput>;

export const preferencesInput = z.object({
  distance: z.enum(["km", "mi"]).default("km"),
  measurement: z.enum(["cm", "in"]).default("cm"),
  timezone: z
    .string()
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    })
    .default("America/New_York"),
  rest: z.number().int().min(0).max(1800).default(90),
});
export type TrainingPreferences = z.infer<typeof preferencesInput>;
export const defaults = preferencesInput.parse({});
export function trainingDay(value: string | Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type)?.value)
    .join("-");
}
export function trainingTime(day: string, timeZone: string, time = "00:00:00") {
  const target = Date.parse(day + "T" + time + "Z");
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  let guess = target;
  for (let step = 0; step < 3; step++) {
    const parts = new Map(
      formatter
        .formatToParts(new Date(guess))
        .map((part) => [part.type, Number(part.value)]),
    );
    const local = Date.UTC(
      parts.get("year")!,
      parts.get("month")! - 1,
      parts.get("day")!,
      parts.get("hour")!,
      parts.get("minute")!,
      parts.get("second")!,
    );
    if (local === target) break;
    guess += target - local;
  }
  return new Date(guess).toISOString();
}
export const measurementKinds = [
  "weight",
  "waist",
  "chest",
  "hips",
  "bodyFat",
  "neck",
  "upperArm",
  "thigh",
  "calf",
] as const;

export const catalog: CatalogExercise[] = [
  runExercise,
  {
    id: "builtin:bench-press",
    title: "Bench press",
    equipment: "barbell",
    type: "weight_reps",
    muscle: "chest",
    instructions:
      "Lie with feet planted. Lower the bar with control, then press it back up.",
  },
  {
    id: "builtin:dumbbell-press",
    title: "Dumbbell press",
    equipment: "dumbbell",
    type: "weight_reps",
    muscle: "chest",
    instructions:
      "Keep each wrist over its elbow. Press the weights up without letting them collide.",
  },
  {
    id: "builtin:back-squat",
    title: "Back squat",
    equipment: "barbell",
    type: "weight_reps",
    muscle: "legs",
    instructions:
      "Brace, bend the hips and knees together, and stand with your feet firmly planted.",
  },
  {
    id: "builtin:deadlift",
    title: "Deadlift",
    equipment: "barbell",
    type: "weight_reps",
    muscle: "back",
    instructions:
      "Start close to the bar, brace, and push through the floor while keeping the bar close.",
  },
  {
    id: "builtin:lat-pulldown",
    title: "Lat pulldown",
    equipment: "cable",
    type: "weight_reps",
    muscle: "back",
    instructions:
      "Pull the handle toward your upper chest and return it slowly.",
  },
  {
    id: "builtin:dumbbell-row",
    title: "Dumbbell row",
    equipment: "dumbbell",
    type: "weight_reps",
    muscle: "back",
    instructions:
      "Support your torso and pull your elbow back, then lower with control.",
  },
  {
    id: "builtin:leg-press",
    title: "Leg press",
    equipment: "machine",
    type: "weight_reps",
    muscle: "legs",
    instructions:
      "Keep your hips against the pad as you bend and extend your knees.",
  },
  {
    id: "builtin:overhead-press",
    title: "Overhead press",
    equipment: "barbell",
    type: "weight_reps",
    muscle: "shoulders",
    instructions:
      "Brace, press overhead, and lower the bar to the starting position.",
  },
  {
    id: "builtin:cable-curl",
    title: "Cable curl",
    equipment: "cable",
    type: "weight_reps",
    muscle: "arms",
    instructions: "Keep your upper arms still while bending your elbows.",
  },
  {
    id: "builtin:pull-up",
    title: "Pull-up",
    equipment: "bodyweight",
    type: "reps_only",
    muscle: "back",
    instructions:
      "Pull from a controlled hang and return to it between repetitions.",
  },
  {
    id: "builtin:assisted-pull-up",
    title: "Assisted pull-up",
    equipment: "machine",
    type: "assisted",
    muscle: "back",
    instructions:
      "Use the assistance pad and record the amount of assistance selected.",
  },
  {
    id: "builtin:push-up",
    title: "Push-up",
    equipment: "bodyweight",
    type: "reps_only",
    muscle: "chest",
    instructions:
      "Keep a straight line from shoulders to hips and press away from the floor.",
  },
  {
    id: "builtin:air-squat",
    title: "Air squat",
    equipment: "bodyweight",
    type: "reps_only",
    muscle: "legs",
    instructions:
      "Send your hips down between your feet and stand through the whole foot.",
  },
  {
    id: "builtin:plank",
    title: "Plank",
    equipment: "bodyweight",
    type: "duration",
    muscle: "core",
    instructions:
      "Brace with your elbows under your shoulders and record how long you hold.",
  },
  {
    id: "builtin:walk",
    title: "Walk",
    equipment: "other",
    type: "distance",
    muscle: "cardio",
    instructions:
      "Record the distance traveled and, if useful, how long it took.",
  },
  {
    id: "builtin:cycle",
    title: "Indoor cycling",
    equipment: "machine",
    type: "distance",
    muscle: "cardio",
    instructions:
      "Record the distance shown on the bike and the time spent pedaling.",
  },
];

export function metricKey(
  id: string,
  equipment: string | null,
  type: string | null,
) {
  return JSON.stringify([id, equipment, type]);
}

export function toLegacyWorkout(
  id: string,
  input: SavedWorkout,
  updatedAt: string,
): Workout {
  return {
    id,
    start_time: new Date(input.startedAt).toISOString(),
    end_time: new Date(input.finishedAt).toISOString(),
    updated_at: updatedAt,
    exercises: input.movements.map((movement, index) => ({
      index,
      exercise_template_id: movement.id,
      title: movement.title,
      equipment: movement.equipment,
      exercise_type: movement.type,
      sets: movement.sets.map((set, index) => ({
        index,
        type: set.warmup ? "warmup" : "normal",
        reps: set.reps,
        weight_kg:
          movement.type === "weight_reps" || movement.type === "assisted"
            ? set.weightKg
            : null,
      })),
    })),
  };
}

export type SetValues = Omit<TrainingSet, "id" | "warmup">;
const setValuesInput = setInput.omit({ id: true, warmup: true });
export function validSetValues(type: string | null, values: SetValues) {
  if (!setValuesInput.safeParse(values).success) return false;
  switch (type) {
    case "weight_reps":
    case "assisted":
      return values.reps !== null && values.weightKg !== null;
    case "reps_only":
      return values.reps !== null;
    case "duration":
      return values.seconds !== null;
    case "distance":
      return values.meters !== null;
    default:
      return false;
  }
}
export function validMovement(movement: Movement) {
  const ids = new Set<string>();
  return movement.sets.every((set) => {
    if (
      ids.has(set.id) ||
      !setInput.shape.id.safeParse(set.id).success ||
      typeof set.warmup !== "boolean"
    )
      return false;
    ids.add(set.id);
    return validSetValues(movement.type, set);
  });
}

export type WorkoutEntry = {
  source: "native" | "hevy";
  owner: string;
  workout: Workout;
  details: SavedWorkout | null;
  revision: number;
  annotation?: {
    title: string;
    note: string;
    gym: string;
    audience: "private" | "connections";
  } | null;
};

export function validRoutineMovement(movement: Movement) {
  if (movement.type !== "weight_reps") return validMovement(movement);
  return validMovement({
    ...movement,
    sets: movement.sets.map((set) => ({ ...set, weightKg: set.weightKg ?? 0 })),
  });
}

export function summarize(entries: WorkoutEntry[], variant?: string) {
  let sets = 0,
    reps = 0,
    volume = 0,
    top = 0,
    distance = 0,
    activeSeconds = 0,
    seconds = 0,
    sessions = 0,
    assistedReps = 0,
    bodyweightReps = 0;
  const muscles: Record<string, number> = {};
  for (const { workout, details } of entries) {
    let matched = false;
    for (const exercise of workout.exercises) {
      if (
        variant &&
        metricKey(
          exercise.exercise_template_id,
          exercise.equipment,
          exercise.exercise_type,
        ) !== variant
      )
        continue;
      matched = true;
      const movement = details?.movements[exercise.index];
      const muscle =
        movement?.muscle ??
        catalog.find((item) => item.id === exercise.exercise_template_id)
          ?.muscle ??
        "Unclassified";
      for (const set of exercise.sets) {
        if (set.type === "warmup") continue;
        sets++;
        muscles[muscle] = (muscles[muscle] ?? 0) + 1;
        reps += set.reps ?? 0;
        if (exercise.exercise_type === "reps_only")
          bodyweightReps += set.reps ?? 0;
        if (
          exercise.exercise_type === "assisted" ||
          exercise.exercise_type === "assisted_weight_reps"
        )
          assistedReps += set.reps ?? 0;
        if (
          exercise.exercise_type === "weight_reps" &&
          set.weight_kg &&
          set.reps
        ) {
          volume += set.weight_kg * set.reps;
          top = Math.max(top, set.weight_kg);
        }
        activeSeconds += movement?.sets[set.index]?.seconds ?? 0;
        distance += movement?.sets[set.index]?.meters ?? 0;
      }
    }
    if (matched || !variant) {
      sessions++;
      seconds += Math.max(
        0,
        (Date.parse(workout.end_time) - Date.parse(workout.start_time)) / 1000,
      );
    }
  }
  return {
    sets,
    reps,
    volume,
    top,
    seconds,
    sessions,
    activeSeconds,
    distance,
    assistedReps,
    bodyweightReps,
    muscles,
  };
}

export function personalRecords(entries: WorkoutEntry[]) {
  const best = new Map<string, number>();
  const records: {
    workoutId: string;
    title: string;
    variant: string;
    metric: string;
    value: number;
    at: string;
    benchmark: boolean;
  }[] = [];
  for (const { workout } of [...entries].sort(
    (a, b) =>
      a.workout.start_time.localeCompare(b.workout.start_time) ||
      a.workout.id.localeCompare(b.workout.id),
  )) {
    const session = new Map<
      string,
      { title: string; variant: string; metric: string; value: number }
    >();
    for (const e of workout.exercises) {
      if (e.exercise_type !== "weight_reps") continue;
      const variant = metricKey(
        e.exercise_template_id,
        e.equipment,
        e.exercise_type,
      );
      for (const s of e.sets) {
        if (s.type === "warmup" || !s.weight_kg || !s.reps) continue;
        const candidates: [string, number][] = [
          ["weight", s.weight_kg],
          ["volume", s.weight_kg * s.reps],
        ];
        if (s.reps <= 20)
          candidates.push([
            "estimated 1RM",
            s.reps === 1 ? s.weight_kg : s.weight_kg * (1 + s.reps / 30),
          ]);
        for (const [metric, value] of candidates) {
          const key = variant + metric;
          if (value > (session.get(key)?.value ?? 0))
            session.set(key, { title: e.title, variant, metric, value });
        }
      }
    }
    for (const [key, record] of session) {
      const prior = best.get(key);
      if (prior !== undefined && record.value <= prior) continue;
      best.set(key, record.value);
      records.push({
        ...record,
        workoutId: workout.id,
        at: workout.start_time,
        benchmark: prior === undefined,
      });
    }
  }
  return records.reverse();
}
