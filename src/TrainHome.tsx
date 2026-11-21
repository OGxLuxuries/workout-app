import { useState } from "react";
import type { FormEvent } from "react";
import {
  catalog,
  preferencesInput,
  type Routine,
  type TrainingPreferences,
  type WorkoutEntry,
} from "../shared/workspace";
import { newDraft, fromRoutine, type Draft } from "./Session";
import { Library, titleFor, useResource } from "./Research";
import { request, type Metrics, type WorkspaceHome } from "./workspace-api";

type PlanSession = {
  name: string;
  exerciseIds: string[];
  sets: number;
  repTarget?: number;
  meters?: number;
};
type Program = {
  id: string;
  name: string;
  goal: string;
  level: string;
  equipment: string;
  sessions: PlanSession[];
};
export const programs: Program[] = [
  {
    id: "foundation",
    name: "Strength foundation",
    goal: "Strength",
    level: "Beginner",
    equipment: "Dumbbells",
    sessions: [
      {
        name: "Press and brace",
        exerciseIds: ["builtin:dumbbell-press", "builtin:plank"],
        sets: 3,
        repTarget: 10,
      },
      {
        name: "Row and press",
        exerciseIds: ["builtin:dumbbell-row", "builtin:dumbbell-press"],
        sets: 3,
        repTarget: 10,
      },
    ],
  },
  {
    id: "three-day",
    name: "Three-day barbell practice",
    goal: "Strength",
    level: "Intermediate",
    equipment: "Barbell",
    sessions: [
      {
        name: "Squat and bench",
        exerciseIds: ["builtin:back-squat", "builtin:bench-press"],
        sets: 3,
        repTarget: 6,
      },
      {
        name: "Pull and press",
        exerciseIds: ["builtin:deadlift", "builtin:overhead-press"],
        sets: 3,
        repTarget: 5,
      },
      {
        name: "Press practice",
        exerciseIds: ["builtin:bench-press", "builtin:back-squat"],
        sets: 3,
        repTarget: 8,
      },
    ],
  },
  {
    id: "no-equipment",
    name: "Bodyweight basics",
    goal: "General fitness",
    level: "Beginner",
    equipment: "Bodyweight",
    sessions: [
      {
        name: "Press and core",
        exerciseIds: ["builtin:push-up", "builtin:plank"],
        sets: 2,
        repTarget: 10,
      },
      {
        name: "Squat and core",
        exerciseIds: ["builtin:air-squat", "builtin:plank"],
        sets: 3,
        repTarget: 12,
      },
    ],
  },
  {
    id: "conditioning",
    name: "Aerobic base",
    goal: "Conditioning",
    level: "Beginner",
    equipment: "Any",
    sessions: [
      {
        name: "Short walk",
        exerciseIds: ["builtin:walk"],
        sets: 1,
        meters: 1200,
      },
      {
        name: "Steady walk",
        exerciseIds: ["builtin:walk"],
        sets: 1,
        meters: 1500,
      },
      {
        name: "Long walk",
        exerciseIds: ["builtin:walk"],
        sets: 1,
        meters: 1800,
      },
    ],
  },
];
export function suggestedRoutine(routine: Routine, history: WorkoutEntry[]) {
  const recent = history
    .filter((item) => item.details?.routineId === routine.id)
    .slice(0, 2);
  if (recent.length !== 2) return null;
  let updated = false;
  const movements = routine.movements.map((move) => {
    if (
      move.type !== "weight_reps" ||
      !move.sets.some((s) => !s.warmup && (s.weightKg ?? 0) > 0)
    )
      return move;
    const ready = recent.every((item) => {
      const actual = item.details?.movements.find((e) => e.id === move.id);
      return move.sets.every(
        (target, index) =>
          target.warmup ||
          !!(
            actual?.sets[index] &&
            (actual.sets[index].reps ?? 0) >= (target.reps ?? 1) &&
            (actual.sets[index].weightKg ?? 0) >= (target.weightKg ?? 0)
          ),
      );
    });
    if (!ready) return move;
    updated = true;
    const increment = move.equipment === "dumbbell" ? 1 : 2.5;
    return {
      ...move,
      sets: move.sets.map((s) =>
        s.warmup || !s.weightKg
          ? s
          : { ...s, weightKg: s.weightKg + increment },
      ),
    };
  });
  return updated ? { ...routine, movements } : null;
}
function programRoutines(program: Program): Routine[] {
  return program.sessions.map((session, index) => ({
    id: crypto.randomUUID(),
    title: program.name + " · " + (index + 1) + ". " + session.name,
    movements: session.exerciseIds.map((id) => {
      const exercise = catalog.find((item) => item.id === id)!;
      return {
        ...exercise,
        rowId: crypto.randomUUID(),
        group: null,
        restSeconds: null,
        sets: Array.from({ length: session.sets }, () => ({
          id: crypto.randomUUID(),
          reps:
            exercise.type === "weight_reps" || exercise.type === "reps_only"
              ? (session.repTarget ?? 8)
              : null,
          weightKg: null,
          seconds: exercise.type === "duration" ? 30 : null,
          meters:
            exercise.type === "distance" ? (session.meters ?? 1200) : null,
          warmup: false,
        })),
      };
    }),
  }));
}
export function TrainHome({
  home,
  unit,
  history,
  start,
  repeat,
  refresh,
}: {
  home: WorkspaceHome;
  unit: string;
  history: WorkoutEntry[];
  start: (draft: Draft) => void;
  repeat: (w: WorkoutEntry) => void;
  refresh: () => void;
}) {
  const [view, setView] = useState<"Routines" | "Library" | "Programs">(
    "Routines",
  );
  const [goal, setGoal] = useState(""),
    [level, setLevel] = useState(""),
    [equipment, setEquipment] = useState(""),
    [days, setDays] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [guided, setGuided] = useState(false);
  const filtered = programs.filter(
    (p) =>
      (!goal || p.goal === goal) &&
      (!level || p.level === level) &&
      (!equipment || p.equipment === equipment) &&
      (!days || p.sessions.length === +days),
  );
  const recommendation = guided ? filtered[0] : null;
  function plain() {
    return newDraft(unit, home.settings.distance);
  }
  async function removeRoutine(id: string) {
    try {
      await request("/routines/delete", { id });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="train-stack">
      <section className="training-hero train-intro">
        <div>
          <span className="hero-kicker">Workout log</span>
          <h1>Ready to train?</h1>
          <button className="primary cta" onClick={() => start(plain())}>
            Start workout
          </button>
          {history[0] && (
            <button className="outline" onClick={() => repeat(history[0])}>
              Repeat last workout
            </button>
          )}
        </div>
      </section>
      <nav className="segment" aria-label="Train views">
        {(["Routines", "Library", "Programs"] as const).map((v) => (
          <button
            key={v}
            aria-current={view === v ? "page" : undefined}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </nav>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {view === "Routines" && (
        <section className="card workspace-form">
          <div className="section-heading">
            <h3>My routines</h3>
            <button
              className="outline"
              onClick={() => start({ ...plain(), routineEditor: true })}
            >
              New routine
            </button>
          </div>
          {!home.routines.length && (
            <p className="muted">
              Start a routine here or turn a workout into one from History.
            </p>
          )}
          {home.routines.map((r) => {
            const suggestion = suggestedRoutine(r, history);
            return (
              <div className="workspace-list-row" key={r.id}>
                <div>
                  <strong>{r.title}</strong>
                  <p className="muted">
                    {r.movements.map((x) => x.title).join(" · ")}
                  </p>
                </div>
                <div className="workspace-actions">
                  <button
                    className="primary"
                    onClick={() =>
                      start(fromRoutine(r, unit, home.settings.distance))
                    }
                  >
                    Start routine
                  </button>
                  {suggestion && (
                    <button
                      className="outline"
                      onClick={() =>
                        start(
                          fromRoutine(suggestion, unit, home.settings.distance),
                        )
                      }
                    >
                      Use suggested increase
                    </button>
                  )}
                  <button
                    className="text-button"
                    onClick={() =>
                      start(fromRoutine(r, unit, home.settings.distance, true))
                    }
                  >
                    Edit
                  </button>
                  <button
                    className="text-button danger-text"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Delete this routine? Past workouts will remain.",
                        )
                      )
                        void removeRoutine(r.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}
      {view === "Library" && (
        <Library
          home={home}
          unit={unit}
          choose={(id) => {
            const e = home.catalog.find((item) => item.id === id);
            if (e)
              start({
                ...plain(),
                exercises: [
                  {
                    ...e,
                    rowId: crypto.randomUUID(),
                    sets: [
                      {
                        id: crypto.randomUUID(),
                        complete: false,
                        warmup: false,
                        weight: "",
                        reps: "",
                      },
                    ],
                  },
                ],
              });
          }}
        />
      )}
      {view === "Programs" && (
        <section className="card workspace-form">
          <h3>Find a program</h3>
          {[
            {
              label: "Goal",
              value: goal,
              set: setGoal,
              options: ["Strength", "General fitness", "Conditioning"],
            },
            {
              label: "Experience",
              value: level,
              set: setLevel,
              options: ["Beginner", "Intermediate"],
            },
            {
              label: "Equipment",
              value: equipment,
              set: setEquipment,
              options: ["Dumbbells", "Barbell", "Bodyweight", "Any"],
            },
            {
              label: "Sessions per week",
              value: days,
              set: setDays,
              options: ["2", "3"],
            },
          ].map((x) => (
            <label key={x.label}>
              {x.label}
              <select value={x.value} onChange={(e) => x.set(e.target.value)}>
                <option value="">Any</option>
                {x.options.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          ))}
          <button
            className="outline"
            aria-pressed={guided}
            onClick={() => setGuided(!guided)}
          >
            {guided ? "Browse all matches" : "Suggest a program"}
          </button>
          {!filtered.length && (
            <p className="muted">No programs match those preferences.</p>
          )}
          {(recommendation ? [recommendation] : filtered).map((p) => (
            <details
              key={p.id + guided}
              open={guided || undefined}
              className="workspace-list-row"
            >
              <summary>
                {p.name} · {p.sessions.length} days/week
              </summary>
              <p>
                {p.goal} · {p.level} · {p.equipment}
              </p>
              <ol>
                {p.sessions.map((session) => (
                  <li key={session.name}>
                    <strong>{session.name}</strong>
                    <p>
                      {session.exerciseIds
                        .map((id) => catalog.find((x) => x.id === id)?.title)
                        .join(", ")}
                      {" · " + session.sets + " sets per exercise"}
                      {session.repTarget &&
                        " · Target " +
                          session.repTarget +
                          " reps for lifting and bodyweight sets"}
                    </p>
                  </li>
                ))}
              </ol>
              <button
                className="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await request("/routines/program", {
                      routines: programRoutines(p),
                    });
                    refresh();
                    setView("Routines");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save program routines
              </button>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}

export function AccountWorkspace({
  home,
  owner,
  unit,
  refresh,
  setWeightUnit,
  setDistanceUnit,
}: {
  home: WorkspaceHome;
  owner: string;
  unit: string;
  refresh: () => void;
  setWeightUnit: (unit: string) => Promise<void>;
  setDistanceUnit: (unit: string) => void;
}) {
  const [prefs, setPrefs] = useState<TrainingPreferences>(home.settings),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await request("/preferences", preferencesInput.parse(prefs));
      if (prefs.distance !== home.settings.distance)
        setDistanceUnit(prefs.distance);
    }, "Preferences saved.");
  }
  return (
    <div className="train-stack">
      {notice && (
        <p className="alert success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <form className="card workspace-form" onSubmit={submit}>
        <h3>Training preferences</h3>
        <label>
          Weight
          <select
            aria-label="Weight unit"
            value={unit}
            disabled={busy}
            onChange={(e) =>
              void run(
                () => setWeightUnit(e.target.value),
                "Weight unit saved.",
              )
            }
          >
            <option value="lbs">Pounds</option>
            <option value="kg">Kilograms</option>
          </select>
        </label>
        <label>
          Distance
          <select
            value={prefs.distance}
            onChange={(e) =>
              setPrefs({
                ...prefs,
                distance: e.target.value as TrainingPreferences["distance"],
              })
            }
          >
            <option value="km">Kilometers</option>
            <option value="mi">Miles</option>
          </select>
        </label>
        <label>
          Body measurements
          <select
            value={prefs.measurement}
            onChange={(e) =>
              setPrefs({
                ...prefs,
                measurement: e.target
                  .value as TrainingPreferences["measurement"],
              })
            }
          >
            <option value="cm">Centimeters</option>
            <option value="in">Inches</option>
          </select>
        </label>
        <label>
          Time zone
          <input
            required
            value={prefs.timezone}
            onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })}
          />
        </label>
        <label>
          Default rest (seconds)
          <input
            type="number"
            min={0}
            max={1800}
            required
            value={prefs.rest}
            onChange={(e) => setPrefs({ ...prefs, rest: +e.target.value })}
          />
        </label>
        <button className="primary" disabled={busy}>
          Save preferences
        </button>
      </form>
      <section className="card workspace-form">
        <h3>Comparison sharing</h3>
        <p className="muted">
          These settings include metrics from private workouts in the selected
          view.
        </p>
        {(["person", "group"] as const).flatMap((scope) =>
          (scope === "person" ? home.people : home.groups).map((target) => {
            const permission = home.permissions.find(
              (p) => p.scope === scope && p.target_id === target.id,
            );
            return (
              <div className="workspace-list-row" key={scope + target.id}>
                <span>{target.name}</span>
                <div className="workspace-actions">
                  <select
                    aria-label={"Metrics sharing with " + target.name}
                    value={
                      !permission ? "off" : permission.named ? "named" : "on"
                    }
                    disabled={busy}
                    onChange={(e) => {
                      const choice = e.target.value;
                      void run(
                        () =>
                          request("/groups/consent", {
                            scope,
                            targetId: target.id,
                            share: choice !== "off",
                            named: choice === "named",
                          }),
                        "Sharing updated.",
                      );
                    }}
                  >
                    <option value="off">Private</option>
                    <option value="on">
                      {scope === "group"
                        ? "Group median only"
                        : "Share metrics"}
                    </option>
                    {scope === "group" && (
                      <option value="named">Median and named standings</option>
                    )}
                  </select>
                </div>
              </div>
            );
          }),
        )}
        {!home.groups.length && !home.people.length && (
          <p className="muted">
            Invite someone to a group to compare progress.
          </p>
        )}
      </section>
    </div>
  );
}

export function Recap({
  entry,
  unit,
  open,
}: {
  entry: WorkoutEntry;
  unit: string;
  open: () => void;
}) {
  const progress = useResource<Metrics>("/metrics");
  const records =
    progress.value?.records.filter(
      (record) => record.workoutId === entry.workout.id && !record.benchmark,
    ) ?? [];
  return (
    <section className="card workspace-form">
      <h3>{titleFor(entry)}</h3>
      <p>
        {entry.workout.exercises.length} exercises ·{" "}
        {entry.workout.exercises.reduce((count, e) => count + e.sets.length, 0)}{" "}
        sets saved
      </p>
      {records.length > 0 && (
        <ul className="records-list">
          {records.map((record) => (
            <li key={record.variant + record.metric}>
              <span>Personal record · {record.title}</span>
              <strong>
                {Math.round(
                  (record.value / (unit === "lbs" ? 0.45359237 : 1)) * 100,
                ) / 100}{" "}
                {unit}
              </strong>
              <small>{record.metric}</small>
            </li>
          ))}
        </ul>
      )}
      <button className="outline" onClick={open}>
        View in Progress ({unit})
      </button>
    </section>
  );
}
