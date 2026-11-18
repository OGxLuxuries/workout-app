import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Icon } from "./workout-ui";
import {
  catalog,
  metricKey,
  movementTypes,
  muscles,
  setInput,
  trainingDay,
  trainingTime,
  validMovement,
  validRoutineMovement,
  type CatalogExercise,
  type Movement,
  type Routine,
  type SavedWorkout,
  type SetValues,
  type TrainingPreferences,
  type WorkoutEntry,
} from "../shared/workspace";
import { equipmentOptions, manualPrefix } from "../shared/training";
import { request, type SaveInput, type TrainingGroup } from "./workspace-api";

const POUNDS = 0.45359237;
const MILE = 1609.344;
const display = (value: number) => String(Math.round(value * 100) / 100);
const distanceFactor = (unit?: string) => (unit === "mi" ? MILE : 1000);
const weightFactor = (unit: string) => (unit === "lbs" ? POUNDS : 1);
const storedFields = {
  weight: "weightKg",
  reps: "reps",
  seconds: "seconds",
  distance: "meters",
} as const;
type Plan = {
  weight?: string;
  reps?: string;
  seconds?: string;
  distance?: string;
};
export type DraftSet = Plan & {
  id?: string;
  warmup: boolean;
  complete: boolean;
  planned?: Plan;
  savedWeightKg?: number | null;
  savedMeters?: number | null;
};
type DraftExercise = {
  id: string | null;
  title: string;
  equipment: string | null;
  type: string | null;
  muscle?: CatalogExercise["muscle"];
  rowId?: string;
  note?: string;
  group?: string | null;
  restSeconds?: number | null;
  sets: DraftSet[];
};
export type Draft = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  unit: string;
  distanceUnit?: string;
  exercises: DraftExercise[];
  restsUntil: number;
  pausedRest?: number;
  title?: string;
  note?: string;
  gym?: string;
  audience?: SavedWorkout["audience"];
  groupId?: string | null;
  routineId?: string;
  editRevision?: number;
  routineEditor?: boolean;
  exportToStrava?: boolean;
};
const emptySet = (): DraftSet => ({
  id: crypto.randomUUID(),
  reps: "",
  weight: "",
  warmup: false,
  complete: false,
});
export const newDraft = (unit: string, distanceUnit?: string): Draft => ({
  id: crypto.randomUUID(),
  startedAt: new Date().toISOString(),
  unit,
  distanceUnit,
  exercises: [],
  restsUntil: 0,
});
export function normalizeDraft(draft: Draft): Draft {
  return {
    ...draft,
    exercises: draft.exercises.map((exercise) => {
      const builtIn = exercise.id
        ? undefined
        : catalog.find(
            (x) =>
              x.title.toLowerCase() === exercise.title.toLowerCase() &&
              x.equipment === exercise.equipment,
          );
      return {
        ...exercise,
        id: exercise.id ?? builtIn?.id ?? "custom:" + crypto.randomUUID(),
        rowId: exercise.rowId ?? crypto.randomUUID(),
        sets: exercise.sets.map((set) => ({
          ...set,
          id: set.id ?? crypto.randomUUID(),
        })),
      };
    }),
  };
}
export function changeDraftUnits(
  draft: Draft,
  unit: string,
  distanceUnit: string,
): Draft {
  const fromWeight = weightFactor(draft.unit) / weightFactor(unit);
  const fromDistance =
    distanceFactor(draft.distanceUnit) / distanceFactor(distanceUnit);
  const quantity = (value: string | undefined, factor: number) =>
    value?.trim() && Number.isFinite(+value)
      ? String(Math.round(+value * factor * 1e5) / 1e5)
      : value;
  const convert = (set: Plan): Plan => ({
    ...set,
    weight: quantity(set.weight, fromWeight),
    distance: quantity(set.distance, fromDistance),
  });
  return {
    ...draft,
    unit,
    distanceUnit,
    exercises: draft.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => {
        const canonical = { weightKg: s.savedWeightKg, meters: s.savedMeters };
        const before = planFromSet(canonical, draft);
        const after = planFromSet(canonical, { ...draft, unit, distanceUnit });
        const converted = convert(s);
        const planned = s.planned && convert(s.planned);
        return {
          ...s,
          ...converted,
          weight:
            s.savedWeightKg != null && s.weight === before.weight
              ? after.weight
              : converted.weight,
          distance:
            s.savedMeters != null && s.distance === before.distance
              ? after.distance
              : converted.distance,
          planned: planned && {
            ...planned,
            weight:
              s.savedWeightKg != null && s.planned?.weight === before.weight
                ? after.weight
                : planned.weight,
            distance:
              s.savedMeters != null && s.planned?.distance === before.distance
                ? after.distance
                : planned.distance,
          },
        };
      }),
    })),
  };
}
const movementType = (type: string | null): CatalogExercise["type"] =>
  movementTypes.find((t) => t === type) ??
  (type === "assisted_weight_reps" ? "assisted" : "weight_reps");
const equipment = (value: string | null) =>
  equipmentOptions.find((e) => e === value) ?? "other";

function planFromSet(
  set: {
    reps?: number | null;
    weightKg?: number | null;
    seconds?: number | null;
    meters?: number | null;
  },
  d: Draft,
): Plan {
  return {
    reps: set.reps?.toString() ?? "",
    weight:
      set.weightKg == null ? "" : display(set.weightKg / weightFactor(d.unit)),
    seconds: set.seconds?.toString() ?? "",
    distance:
      set.meters == null
        ? ""
        : display(set.meters / distanceFactor(d.distanceUnit)),
  };
}
function fromMovement(m: Movement, d: Draft, copied: boolean): DraftExercise {
  return {
    id: m.id,
    title: m.title,
    equipment: m.equipment,
    type: m.type,
    muscle: m.muscle,
    rowId: copied ? crypto.randomUUID() : m.rowId,
    note: m.note,
    group: m.group,
    restSeconds: m.restSeconds,
    sets: m.sets.map((set) => {
      const values = planFromSet(set, d);
      return {
        ...emptySet(),
        id: copied ? crypto.randomUUID() : set.id,
        warmup: set.warmup,
        complete: !copied,
        savedWeightKg: set.weightKg,
        savedMeters: set.meters,
        ...(copied ? { planned: values } : values),
      };
    }),
  };
}
export function fromRoutine(
  routine: Routine,
  unit: string,
  distance: string,
  editor = false,
) {
  const draft = newDraft(unit, distance);
  return {
    ...draft,
    title: routine.title,
    routineId: routine.id,
    routineEditor: editor,
    exercises: routine.movements.map((m) => fromMovement(m, draft, !editor)),
  };
}
export function fromHistory(
  entry: WorkoutEntry,
  unit: string,
  distance: string,
  mode: "repeat" | "edit" | "routine",
): Draft {
  const draft = newDraft(unit, distance);
  const editing = mode === "edit";
  const saved = entry.details;
  return normalizeDraft({
    ...draft,
    id: editing ? entry.workout.id.slice(manualPrefix.length) : draft.id,
    title: saved?.title,
    note: editing ? saved?.note : undefined,
    gym: editing ? saved?.gym : undefined,
    startedAt: editing ? entry.workout.start_time : draft.startedAt,
    finishedAt: editing ? entry.workout.end_time : undefined,
    editRevision: editing ? entry.revision : undefined,
    audience: editing ? saved?.audience : undefined,
    groupId: editing ? saved?.groupId : undefined,
    routineEditor: mode === "routine",
    exercises:
      saved?.movements.map((m) => fromMovement(m, draft, mode === "repeat")) ??
      entry.workout.exercises
        .filter((x) => x.sets.length)
        .slice(0, 32)
        .map((x) => ({
          id: x.exercise_template_id,
          title: x.title,
          equipment: x.equipment,
          type: x.exercise_type,
          sets: x.sets.slice(0, 50).map((s) => {
            const values = planFromSet(
              { reps: s.reps, weightKg: s.weight_kg },
              draft,
            );
            return {
              ...emptySet(),
              warmup: s.type === "warmup",
              complete: mode !== "repeat",
              savedWeightKg: s.weight_kg,
              ...(mode === "repeat" ? { planned: values } : values),
            };
          }),
        })),
  });
}
function moveDraft(
  exercise: DraftExercise,
  draft: Draft,
  planned = false,
): Movement {
  const m: Movement = {
    id: exercise.id ?? "custom:" + crypto.randomUUID(),
    rowId: exercise.rowId ?? crypto.randomUUID(),
    title: exercise.title,
    equipment: equipment(exercise.equipment),
    type: movementType(exercise.type),
    muscle: exercise.muscle,
    note: exercise.note || undefined,
    group: exercise.group ?? null,
    restSeconds: exercise.restSeconds ?? null,
    sets: exercise.sets
      .filter((s) => planned || s.complete)
      .map((s) => ({
        id: s.id ?? crypto.randomUUID(),
        weightKg: s.weight?.trim()
          ? (s.savedWeightKg ??
            Math.round(+s.weight * weightFactor(draft.unit) * 1e5) / 1e5)
          : null,
        reps: s.reps?.trim() ? +s.reps : null,
        seconds: s.seconds?.trim() ? +s.seconds : null,
        meters: s.distance?.trim()
          ? (s.savedMeters ??
            Math.round(+s.distance * distanceFactor(draft.distanceUnit) * 100) /
              100)
          : null,
        warmup: s.warmup,
      })),
  };
  for (const set of m.sets) {
    if (m.type !== "weight_reps" && m.type !== "assisted") set.weightKg = null;
    if (m.type === "duration" || m.type === "distance") set.reps = null;
    if (m.type !== "distance") set.meters = null;
    if (m.type !== "duration" && m.type !== "distance") set.seconds = null;
  }
  return m;
}
const fieldDefinitions = (
  type: CatalogExercise["type"],
  unit: string,
  distance: string,
) => {
  const weight = {
    key: "weight" as const,
    label:
      type === "assisted"
        ? "Assistance (" + unit + ")"
        : "Weight (" + unit + ")",
    mode: "decimal" as const,
  };
  const reps = {
    key: "reps" as const,
    label: "Reps",
    mode: "numeric" as const,
  };
  const seconds = {
    key: "seconds" as const,
    label: "Seconds",
    mode: "numeric" as const,
  };
  if (type === "distance")
    return [
      {
        key: "distance" as const,
        label: "Distance (" + distance + ")",
        mode: "decimal" as const,
      },
      seconds,
    ];
  if (type === "duration") return [seconds];
  if (type === "reps_only") return [reps];
  return [weight, reps];
};
const clock = (seconds: number) =>
  Math.floor(Math.max(0, seconds) / 60) +
  ":" +
  String(Math.max(0, seconds) % 60).padStart(2, "0");
function previousSet(
  exercise: DraftExercise,
  index: number,
  history: WorkoutEntry[],
  draft: Draft,
): Plan {
  for (const item of history) {
    if (item.workout.id === manualPrefix + draft.id) continue;
    const match = item.workout.exercises.find(
      (x) =>
        x.exercise_template_id === exercise.id &&
        x.equipment === exercise.equipment &&
        x.exercise_type === exercise.type,
    );
    if (!match) continue;
    const s = match.sets.find((s) => s.index === index);
    if (!s || s.type === "warmup") continue;
    const extra = item.details?.movements[match.index]?.sets[s.index];
    const plan = planFromSet(
      {
        reps: s.reps,
        weightKg: s.weight_kg,
        seconds: extra?.seconds,
        meters: extra?.meters,
      },
      draft,
    );
    const result = moveDraft(
      { ...exercise, sets: [{ ...plan, complete: true, warmup: false }] },
      draft,
    );
    if (validMovement(result)) return plan;
  }
  return {};
}

export function Session({
  draft,
  change,
  save,
  saveRoutine,
  addCustom,
  options,
  history,
  settings,
  groups,
  busy,
  stravaConnected,
}: {
  draft: Draft;
  change: (d: Draft | null) => void;
  save: (p: SaveInput) => Promise<void>;
  saveRoutine: (r: Routine) => Promise<void>;
  addCustom: (e: CatalogExercise) => Promise<void>;
  options: CatalogExercise[];
  history: WorkoutEntry[];
  settings: TrainingPreferences;
  groups: TrainingGroup[];
  busy: boolean;
  stravaConnected: boolean;
}) {
  const [picker, setPicker] = useState(!draft.exercises.length);
  const [search, setSearch] = useState("");
  const [gear, setGear] = useState("");
  const [muscle, setMuscle] = useState("");
  const [mode, setMode] = useState<CatalogExercise["type"]>("weight_reps");
  const [custom, setCustom] = useState(false);
  const [review, setReview] = useState(false);
  const [updateRoutine, setUpdateRoutine] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const [drag, setDrag] = useState<number | null>(null);
  const [references, setReferences] = useState<
    Record<string, Record<number, SetValues>>
  >({});
  const variants = JSON.stringify(
    [
      ...new Set(
        draft.exercises.map((e) => metricKey(e.id ?? "", e.equipment, e.type)),
      ),
    ].sort(),
  );
  useEffect(() => {
    const keys = JSON.parse(variants) as string[];
    if (!keys.length || draft.routineEditor) return;
    let stale = false;
    void request<{ previous: Record<string, Record<number, SetValues>> }>(
      "/workouts/previous",
      { variants: keys, exclude: draft.id },
    )
      .then((result) => {
        if (!stale) setReferences(result.previous);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [variants, draft.id, draft.routineEditor]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const changeExercise = (i: number, e: DraftExercise) =>
    change({
      ...draft,
      exercises: draft.exercises.map((value, index) =>
        index === i ? e : value,
      ),
    });
  const distance = draft.distanceUnit ?? "km";
  const completed = draft.exercises.reduce(
    (sum, x) => sum + x.sets.filter((s) => s.complete).length,
    0,
  );
  const omitted = draft.exercises.reduce(
    (sum, x) => sum + x.sets.filter((s) => !s.complete).length,
    0,
  );
  const rest =
    draft.pausedRest ?? Math.max(0, Math.ceil((draft.restsUntil - now) / 1000));
  const interval = (seconds: number) => {
    const timestamp = Date.now();
    setNow(timestamp);
    change({
      ...draft,
      pausedRest: undefined,
      restsUntil: seconds > 0 ? timestamp + seconds * 1000 : 0,
    });
  };
  function adjustRest(seconds: number) {
    const next = Math.max(0, rest + seconds);
    if (draft.pausedRest !== undefined && next > 0)
      change({ ...draft, pausedRest: next });
    else interval(next);
  }
  const volume = draft.exercises
    .filter((x) => x.type === "weight_reps")
    .reduce(
      (sum, x) =>
        sum +
        x.sets
          .filter((s) => s.complete && !s.warmup)
          .reduce((n, s) => n + +s.weight! * +s.reps!, 0),
      0,
    );
  const recent = new Set(
    history
      .slice(0, 5)
      .flatMap((w) => w.workout.exercises.map((e) => e.exercise_template_id)),
  );
  const results = options
    .filter(
      (x) =>
        (!gear || x.equipment === gear) &&
        (!muscle || x.muscle === muscle) &&
        x.title.toLowerCase().includes(search.toLowerCase().trim()),
    )
    .sort(
      (a, b) =>
        Number(recent.has(b.id)) - Number(recent.has(a.id)) ||
        a.title.localeCompare(b.title),
    );
  const add = (exercise: CatalogExercise) => {
    change({
      ...draft,
      exercises: [
        ...draft.exercises,
        { ...exercise, rowId: crypto.randomUUID(), sets: [emptySet()] },
      ],
    });
    setPicker(false);
    setSearch("");
    setCustom(false);
  };
  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= draft.exercises.length || from === to) return;
    const exercises = [...draft.exercises];
    const [value] = exercises.splice(from, 1);
    exercises.splice(to, 0, value);
    change({ ...draft, exercises });
  };
  function pair(index: number, other: number) {
    const exercise = draft.exercises[index],
      partner = draft.exercises[other];
    if (!partner) {
      changeExercise(index, { ...exercise, group: null });
      return;
    }
    const group = partner.group ?? exercise.group ?? crypto.randomUUID();
    change({
      ...draft,
      exercises: draft.exercises.map((item, i) =>
        i === index ||
        i === other ||
        (exercise.group && item.group === exercise.group)
          ? { ...item, group }
          : item,
      ),
    });
  }
  function prepare() {
    setError("");
    if (!completed) {
      setError("Complete at least one set before finishing.");
      return;
    }
    if (!draft.title?.trim())
      change({
        ...draft,
        title:
          "Workout · " +
          new Date(draft.startedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
      });
    setReview(true);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const movements = draft.exercises
        .map((movement) => moveDraft(movement, draft, draft.routineEditor))
        .filter((x) => x.sets.length);
      if (
        !movements.length ||
        !movements.every(
          draft.routineEditor ? validRoutineMovement : validMovement,
        )
      )
        throw new Error("Review the set values before saving.");
      if (draft.routineEditor) {
        await saveRoutine({
          id: draft.routineId ?? draft.id,
          title: draft.title?.trim() || "Routine",
          movements,
        });
        return;
      }
      const workout: SaveInput["workout"] = {
        title: draft.title!.trim(),
        note: draft.note?.trim() || undefined,
        gym: draft.gym?.trim() || undefined,
        startedAt: draft.startedAt,
        finishedAt: draft.finishedAt ?? new Date().toISOString(),
        audience: draft.audience ?? "private",
        groupId: draft.groupId ?? null,
        movements,
        routineId: draft.routineId,
      };
      await save({
        id: draft.id,
        mutationId: crypto.randomUUID(),
        expectedRevision: draft.editRevision ?? 0,
        workout,
        routine:
          updateRoutine && draft.routineId
            ? { id: draft.routineId, title: draft.title!.trim(), movements }
            : undefined,
        exportToStrava: draft.exportToStrava,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }
  return (
    <div className="train-stack">
      <div className="session-top">
        <div>
          <h1>
            {draft.routineEditor
              ? "Build routine"
              : draft.editRevision !== undefined
                ? "Edit workout"
                : "Workout in progress"}
          </h1>
          {!draft.routineEditor && (
            <p className="muted">
              {completed} completed sets · {display(volume)} {draft.unit} volume
            </p>
          )}
        </div>
        {!draft.routineEditor && (
          <strong>
            {clock(
              Math.floor(
                ((draft.finishedAt ? Date.parse(draft.finishedAt) : now) -
                  Date.parse(draft.startedAt)) /
                  1000,
              ),
            )}
          </strong>
        )}
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {review || draft.routineEditor ? (
        <form className="card workspace-form" onSubmit={submit}>
          <h3>
            {draft.routineEditor ? "Routine information" : "Workout review"}
          </h3>
          <label>
            Title
            <input
              required
              maxLength={100}
              value={draft.title ?? ""}
              onChange={(e) => change({ ...draft, title: e.target.value })}
            />
          </label>
          {!draft.routineEditor && (
            <>
              <label>
                Notes
                <input
                  maxLength={2500}
                  value={draft.note ?? ""}
                  onChange={(e) => change({ ...draft, note: e.target.value })}
                />
              </label>
              <label>
                Gym
                <input
                  maxLength={100}
                  value={draft.gym ?? ""}
                  onChange={(e) => change({ ...draft, gym: e.target.value })}
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  max={trainingDay(new Date(), settings.timezone)}
                  value={trainingDay(draft.startedAt, settings.timezone)}
                  onChange={(e) => {
                    if (e.target.value) {
                      const previous = new Date(draft.startedAt);
                      const time = previous.toLocaleTimeString("en-GB", {
                        timeZone: settings.timezone,
                        hourCycle: "h23",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      });
                      const startedAt = trainingTime(
                        e.target.value,
                        settings.timezone,
                        time,
                      );
                      const span =
                        (draft.finishedAt
                          ? Date.parse(draft.finishedAt)
                          : Date.now()) - previous.getTime();
                      change({
                        ...draft,
                        startedAt,
                        finishedAt: new Date(
                          Date.parse(startedAt) + Math.max(0, span),
                        ).toISOString(),
                      });
                    }
                  }}
                />
              </label>
              <label>
                Who can see this workout
                <select
                  value={draft.audience ?? "private"}
                  onChange={(e) =>
                    change({
                      ...draft,
                      audience: e.target.value as SavedWorkout["audience"],
                      groupId: null,
                    })
                  }
                >
                  <option value="private">Only me</option>
                  <option value="connections">Mutual connections</option>
                  <option value="group">One group</option>
                </select>
              </label>
              {draft.audience === "group" && (
                <label>
                  Group
                  <select
                    required
                    value={draft.groupId ?? ""}
                    onChange={(e) =>
                      change({ ...draft, groupId: e.target.value })
                    }
                  >
                    <option value="">Select a group</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {draft.routineId && (
                <label className="workspace-checkbox">
                  <input
                    type="checkbox"
                    checked={updateRoutine}
                    onChange={(e) => setUpdateRoutine(e.target.checked)}
                  />
                  Update this routine's set values
                </label>
              )}
              {stravaConnected && draft.editRevision === undefined && (
                <label className="workspace-checkbox">
                  <input
                    type="checkbox"
                    checked={!!draft.exportToStrava}
                    onChange={(e) =>
                      change({ ...draft, exportToStrava: e.target.checked })
                    }
                  />
                  Send the workout title and duration to Strava
                </label>
              )}
              {omitted > 0 && (
                <p className="muted">
                  {omitted} incomplete{" "}
                  {omitted === 1 ? "set will" : "sets will"} be left out.
                </p>
              )}
            </>
          )}
          <div className="workspace-actions">
            <button className="primary" disabled={busy}>
              {busy
                ? "Saving…"
                : draft.routineEditor
                  ? "Save routine"
                  : "Save workout"}
            </button>
            {review && (
              <button
                type="button"
                className="outline"
                onClick={() => setReview(false)}
              >
                Back to sets
              </button>
            )}
          </div>
        </form>
      ) : null}
      {!review && (
        <>
          {draft.exercises.map((exercise, i) => (
            <section
              className="card set-card"
              key={exercise.rowId ?? i}
              onDragOver={(e) => {
                if (drag !== null) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null) reorder(drag, i);
                setDrag(null);
              }}
            >
              <header>
                <div>
                  <h3>{exercise.title}</h3>
                  <small>
                    {exercise.equipment ?? "Unspecified"}
                    {exercise.group && " · Superset"}
                  </small>
                </div>
                <div className="workspace-actions">
                  <button
                    className="icon-button"
                    aria-label={"Move " + exercise.title + " up"}
                    disabled={!i}
                    onClick={() => reorder(i, i - 1)}
                    draggable
                    onDragStart={() => setDrag(i)}
                    onDragEnd={() => setDrag(null)}
                  >
                    ↑
                  </button>
                  <button
                    className="icon-button"
                    aria-label={"Move " + exercise.title + " down"}
                    disabled={i === draft.exercises.length - 1}
                    onClick={() => reorder(i, i + 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="icon-button"
                    aria-label={"Remove " + exercise.title}
                    onClick={() =>
                      change({
                        ...draft,
                        exercises: draft.exercises.filter(
                          (_, index) => index !== i,
                        ),
                      })
                    }
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              </header>
              <details className="movement-options">
                <summary>Exercise options</summary>
                <div className="workspace-form">
                  <label>
                    Note
                    <input
                      maxLength={800}
                      value={exercise.note ?? ""}
                      onChange={(e) =>
                        changeExercise(i, { ...exercise, note: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Rest in seconds
                    <input
                      type="number"
                      min={0}
                      max={1800}
                      placeholder={String(settings.rest)}
                      value={exercise.restSeconds ?? ""}
                      onChange={(e) =>
                        changeExercise(i, {
                          ...exercise,
                          restSeconds:
                            e.target.value === "" ? null : +e.target.value,
                        })
                      }
                    />
                  </label>
                  {draft.exercises.length > 1 && (
                    <label>
                      Superset with
                      <select
                        value={String(
                          draft.exercises.findIndex(
                            (m, index) =>
                              index !== i &&
                              !!m.group &&
                              m.group === exercise.group,
                          ),
                        )}
                        onChange={(e) => pair(i, +e.target.value)}
                      >
                        <option value="-1">No pairing</option>
                        {draft.exercises.map((x, index) =>
                          index === i ? null : (
                            <option key={x.rowId ?? index} value={index}>
                              {x.title}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}
                </div>
              </details>
              {exercise.sets.map((set, j) => {
                const reference =
                  references[
                    metricKey(
                      exercise.id ?? "",
                      exercise.equipment,
                      exercise.type,
                    )
                  ]?.[j];
                const prev = reference
                  ? planFromSet(reference, draft)
                  : previousSet(exercise, j, history, draft);
                const fields = fieldDefinitions(
                  movementType(exercise.type),
                  draft.unit,
                  distance,
                );
                const edit = (next: DraftSet, start = false) => {
                  const length = exercise.restSeconds ?? settings.rest;
                  if (start && length > 0) setNow(Date.now());
                  change({
                    ...draft,
                    ...(start && length > 0
                      ? {
                          restsUntil: Date.now() + length * 1000,
                          pausedRest: undefined,
                        }
                      : {}),
                    exercises: draft.exercises.map((x, n) =>
                      i === n
                        ? {
                            ...x,
                            sets: x.sets.map((value, position) =>
                              position === j ? next : value,
                            ),
                          }
                        : x,
                    ),
                  });
                };
                const complete = () => {
                  if (set.complete) {
                    edit({ ...set, complete: false });
                    return;
                  }
                  const filled = { ...set };
                  for (const { key } of fields)
                    filled[key] =
                      set[key]?.trim() || set.planned?.[key] || prev[key] || "";
                  if (!set.weight?.trim() && !set.planned?.weight)
                    filled.savedWeightKg = reference?.weightKg;
                  if (!set.distance?.trim() && !set.planned?.distance)
                    filled.savedMeters = reference?.meters;
                  const value = moveDraft(
                    { ...exercise, sets: [{ ...filled, complete: true }] },
                    draft,
                  );
                  if (!validMovement(value)) {
                    const invalid =
                      fields.find(({ key }) => {
                        const stored = storedFields[key];
                        const input = value.sets[0][stored];
                        return !setInput.shape[stored].safeParse(input).success;
                      }) ??
                      fields.find(({ key }) => !filled[key]) ??
                      fields[0];
                    document
                      .getElementById("set-" + set.id + "-" + invalid.key)
                      ?.focus();
                    setError(
                      "Enter a valid " +
                        invalid.label.toLowerCase() +
                        " for this set.",
                    );
                    return;
                  }
                  setError("");
                  edit({ ...filled, complete: true }, !set.warmup);
                };
                return (
                  <div
                    key={set.id ?? j}
                    className={
                      "session-set " +
                      (set.complete && !draft.routineEditor ? "set-done" : "")
                    }
                  >
                    <button
                      className="set-kind"
                      aria-label={"Set " + (j + 1) + " warmup"}
                      aria-pressed={set.warmup}
                      onClick={() => edit({ ...set, warmup: !set.warmup })}
                    >
                      {set.warmup ? "W" : j + 1}
                    </button>
                    {fields.map((field) => (
                      <label key={field.key}>
                        <span>{field.label}</span>
                        <input
                          id={"set-" + set.id + "-" + field.key}
                          aria-label={
                            field.label +
                            " for " +
                            exercise.title +
                            " set " +
                            (j + 1)
                          }
                          inputMode={field.mode}
                          maxLength={12}
                          placeholder={
                            set.planned?.[field.key] || prev[field.key] || "—"
                          }
                          value={set[field.key] ?? ""}
                          onChange={(e) =>
                            edit({
                              ...set,
                              [field.key]: e.target.value.replace(",", "."),
                              savedWeightKg:
                                field.key === "weight"
                                  ? undefined
                                  : set.savedWeightKg,
                              savedMeters:
                                field.key === "distance"
                                  ? undefined
                                  : set.savedMeters,
                              complete: set.complete && e.target.value !== "",
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !draft.routineEditor) {
                              e.preventDefault();
                              complete();
                            }
                          }}
                        />
                        {!!prev[field.key] && (
                          <small>Last {prev[field.key]}</small>
                        )}
                      </label>
                    ))}
                    {!draft.routineEditor && (
                      <button
                        className="set-check"
                        aria-label={
                          (set.complete ? "Uncheck " : "Complete ") +
                          exercise.title +
                          " set " +
                          (j + 1)
                        }
                        aria-pressed={set.complete}
                        onClick={complete}
                      >
                        <Icon name="check" size={19} />
                      </button>
                    )}
                    <button
                      className="icon-button"
                      aria-label={
                        "Remove set " + (j + 1) + " for " + exercise.title
                      }
                      disabled={exercise.sets.length < 2}
                      onClick={() =>
                        changeExercise(i, {
                          ...exercise,
                          sets: exercise.sets.filter((_, n) => j !== n),
                        })
                      }
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                );
              })}
              <button
                className="outline add-set"
                disabled={exercise.sets.length >= 50}
                onClick={() =>
                  changeExercise(i, {
                    ...exercise,
                    sets: [...exercise.sets, emptySet()],
                  })
                }
              >
                Add set
              </button>
            </section>
          ))}
          {picker ? (
            <section
              className="card workspace-form"
              aria-label="Exercise picker"
            >
              <div className="section-heading">
                <h3>Add exercise</h3>
                <button
                  aria-label="Close exercise picker"
                  className="icon-button"
                  onClick={() => {
                    setPicker(false);
                    setCustom(false);
                  }}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
              <label>
                {custom ? "Exercise name" : "Search exercises"}
                <input
                  value={search}
                  maxLength={100}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="workspace-actions">
                <select
                  aria-label="Equipment filter"
                  value={gear}
                  onChange={(e) => setGear(e.target.value)}
                >
                  <option value="">All equipment</option>
                  {equipmentOptions.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <select
                  aria-label="Muscle filter"
                  value={muscle}
                  onChange={(e) => setMuscle(e.target.value)}
                >
                  <option value="">All muscles</option>
                  {muscles.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </div>
              {custom ? (
                <>
                  <label>
                    How sets are measured
                    <select
                      value={mode}
                      onChange={(e) =>
                        setMode(e.target.value as CatalogExercise["type"])
                      }
                    >
                      {movementTypes.map((t) => (
                        <option key={t} value={t}>
                          {t.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !search.trim()}
                    onClick={async () => {
                      const item: CatalogExercise = {
                        id: "custom:" + crypto.randomUUID(),
                        title: search.trim(),
                        equipment: equipment(gear),
                        type: mode,
                        muscle: muscles.find((tag) => tag === muscle),
                      };
                      try {
                        await addCustom(item);
                        add(item);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Create and add
                  </button>
                </>
              ) : (
                <>
                  <div className="exercise-results">
                    {results.map((x) => (
                      <button
                        className="exercise-result"
                        key={x.id}
                        onClick={() => add(x)}
                      >
                        <span>
                          <strong>{x.title}</strong>
                          <small>
                            {x.equipment}
                            {recent.has(x.id) ? " · Recent" : ""}
                          </small>
                        </span>
                        <Icon name="plus" size={16} />
                      </button>
                    ))}
                  </div>
                  {!results.length && (
                    <p className="muted">No matching exercises.</p>
                  )}
                  <button
                    className="text-button"
                    onClick={() => setCustom(true)}
                  >
                    Create custom exercise
                  </button>
                </>
              )}
            </section>
          ) : (
            <button
              className="outline add-exercise"
              disabled={draft.exercises.length >= 32}
              onClick={() => setPicker(true)}
            >
              <Icon name="plus" size={18} />
              Add exercise
            </button>
          )}
          {!draft.routineEditor && (
            <div className="finish-panel">
              <div className="rest-timer" aria-label="Rest timer">
                <span>{rest > 0 ? "Rest " + clock(rest) : "Rest timer"}</span>
                {rest > 0 ? (
                  <>
                    <button
                      className="text-button"
                      onClick={() => adjustRest(-15)}
                    >
                      −15 sec
                    </button>
                    <button
                      className="text-button"
                      onClick={() => adjustRest(15)}
                    >
                      +15 sec
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        draft.pausedRest !== undefined
                          ? interval(rest)
                          : change({
                              ...draft,
                              pausedRest: rest,
                              restsUntil: 0,
                            })
                      }
                    >
                      {draft.pausedRest !== undefined ? "Resume" : "Pause"}
                    </button>
                    <button className="text-button" onClick={() => interval(0)}>
                      Skip
                    </button>
                  </>
                ) : (
                  <button
                    className="text-button"
                    onClick={() => interval(settings.rest || 90)}
                  >
                    Start rest
                  </button>
                )}
              </div>
              <button
                className="primary wide"
                disabled={busy}
                onClick={prepare}
              >
                Finish workout
              </button>
            </div>
          )}
        </>
      )}
      <div className="discard-row">
        {discard ? (
          <>
            <button
              className="text-button danger-text"
              disabled={busy}
              onClick={() => change(null)}
            >
              Discard
            </button>
            <button className="text-button" onClick={() => setDiscard(false)}>
              Keep draft
            </button>
          </>
        ) : (
          <button
            className="text-button muted"
            onClick={() => setDiscard(true)}
          >
            Discard draft
          </button>
        )}
      </div>
    </div>
  );
}
