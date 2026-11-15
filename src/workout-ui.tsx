import { useEffect, useState } from "react";
import type { Workout } from "../shared/import";
import { localDay, monday } from "../shared/scoring";
import {
  equipmentOptions,
  isManualWorkout,
  type LoggedWorkout,
  type TrainingEquipment,
} from "../shared/training";

const paths = {
  activity: "M3 12h4l3-7 4 14 3-7h4",
  train: "M7 8v8m10-8v8M4 10v4m16-4v4M7 12h10M2 12h2m16 0h2",
  compete:
    "M8 21h8m-4-4v4M7 4h10v7a5 5 0 0 1-10 0V4ZM7 6H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4",
  history: "M7 3h13v18H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 13h13M8 8h8m-8 4h5",
  profile:
    "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2m11-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  arrow: "M5 12h13m-6-6 6 6-6 6",
  plus: "M12 5v14M5 12h14",
  check: "m5 12 5 5 9-10",
  close: "m6 6 12 12M6 18 18 6",
  timer: "M10 2h4m-2 11 3-3m5 3a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  sync: "M20 11a8 8 0 0 0-14-5L3 9m0-5v5h5m-4 4a8 8 0 0 0 14 5l3-3m0 5v-5h-5",
  download: "M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4",
  search: "m20 20-4-4m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
} as const;
export function Icon({
  name,
  size = 22,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export type ExerciseOption = {
  id: string | null;
  title: string;
  equipment: string | null;
  type: string | null;
};
type DraftSet = {
  reps: string;
  weight: string;
  warmup: boolean;
  complete: boolean;
};
type DraftExercise = ExerciseOption & { sets: DraftSet[] };
export type Draft = {
  id: string;
  startedAt: string;
  unit: string;
  exercises: DraftExercise[];
  restsUntil: number;
  finishedAt?: string;
};
const storageKey = (id: string) => "workout-draft-v1:" + id;
export function readDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (raw) return JSON.parse(raw);
  } catch {
    /* Drafts are optional in browsers with blocked storage. */
  }
  return null;
}
export function storeDraft(id: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(storageKey(id), JSON.stringify(draft));
    else localStorage.removeItem(storageKey(id));
    return true;
  } catch {
    return false;
  }
}
export const newDraft = (unit: string): Draft => ({
  id: crypto.randomUUID(),
  startedAt: new Date().toISOString(),
  unit,
  exercises: [],
  restsUntil: 0,
});
const emptySet: DraftSet = {
  reps: "",
  weight: "",
  complete: false,
  warmup: false,
};
const presets: ExerciseOption[] = [
  ["Bench Press", "barbell"],
  ["Back Squat", "barbell"],
  ["Deadlift", "barbell"],
  ["Dumbbell Row", "dumbbell"],
  ["Lat Pulldown", "cable"],
  ["Leg Press", "machine"],
  ["Overhead Press", "barbell"],
  ["Pull-Up", "bodyweight"],
  ["Push-Up", "bodyweight"],
].map(([title, equipment]) => ({
  id: null,
  title,
  equipment,
  type: equipment === "bodyweight" ? "reps_only" : "weight_reps",
}));
const gearLabel = (value: string | null) =>
  value ? value.replaceAll("_", " ") : "Equipment unknown";
const clock = (seconds: number) => {
  const n = Math.max(0, seconds);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
const validSet = (s: DraftSet, unit: string) =>
  /^\d+$/.test(s.reps) &&
  +s.reps >= 1 &&
  +s.reps <= 999 &&
  (s.weight.trim() === "" ||
    (Number.isFinite(+s.weight) &&
      +s.weight >= 0 &&
      +s.weight * (unit === "lbs" ? 0.45359237 : 1) <= 2500));

export function Train({
  draft,
  update,
  start,
  commit,
  ownWorkouts,
  exerciseOptions,
  busy,
}: {
  draft: Draft | null;
  update: (draft: Draft | null) => void;
  start: (from?: Workout) => void;
  commit: (log: LoggedWorkout) => Promise<void>;
  ownWorkouts: Workout[];
  exerciseOptions: ExerciseOption[];
  busy: boolean;
}) {
  const [picker, setPicker] = useState(!!draft && !draft.exercises.length);
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState(false);
  const [equipment, setEquipment] = useState<TrainingEquipment>("other");
  const [discard, setDiscard] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!draft) return;
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [draft?.id]);

  if (!draft)
    return (
      <div className="train-stack">
        <section className="training-hero train-intro">
          <div>
            <span className="hero-kicker">
              <Icon name="train" size={17} /> Workout log
            </span>
            <h1>Ready to lift?</h1>
            <button
              className="primary cta"
              onClick={() => {
                start();
                setPicker(true);
              }}
            >
              <Icon name="plus" size={20} /> Start workout
            </button>
          </div>
        </section>
        {ownWorkouts[0] && (
          <section className="card repeat-card">
            <div className="row-icon">
              <Icon name="history" />
            </div>
            <div>
              <h3>Repeat last workout</h3>
              <p className="muted">
                {ownWorkouts[0].exercises.length} exercises · previous weights
                and reps
              </p>
            </div>
            <button
              className="outline"
              onClick={() => start(ownWorkouts[0])}
              aria-label="Repeat last workout"
            >
              <Icon name="arrow" />
            </button>
          </section>
        )}
      </div>
    );
  const workout = draft;
  const completed = workout.exercises
    .flatMap((e) => e.sets)
    .filter((s) => s.complete).length;
  const unfinished = workout.exercises.some((e) =>
    e.sets.some((s) => !s.complete),
  );
  const rest = Math.ceil((workout.restsUntil - now) / 1000);
  const changeExercise = (index: number, value: DraftExercise) =>
    update({
      ...workout,
      exercises: workout.exercises.map((e, i) => (i === index ? value : e)),
    });
  function addExercise(option: ExerciseOption) {
    const previous = ownWorkouts
      .flatMap((w) => w.exercises)
      .find((e) =>
        option.id
          ? e.exercise_template_id === option.id
          : e.title.toLowerCase() === option.title.toLowerCase() &&
            e.equipment === option.equipment,
      );
    const previousSet = previous?.sets.find(
      (s) => s.type !== "warmup" && s.reps,
    );
    const weight =
      previousSet?.weight_kg == null
        ? ""
        : String(
            Math.round(
              (previousSet.weight_kg /
                (workout.unit === "lbs" ? 0.45359237 : 1)) *
                100,
            ) / 100,
          );
    update({
      ...workout,
      exercises: [
        ...workout.exercises,
        {
          ...option,
          sets: [
            { ...emptySet, weight, reps: previousSet?.reps?.toString() ?? "" },
          ],
        },
      ],
    });
    setPicker(false);
    setCustom(false);
    setQuery("");
  }
  async function save() {
    const finishedAt = workout.finishedAt ?? new Date().toISOString();
    update({ ...workout, finishedAt });
    await commit({
      id: workout.id,
      startedAt: workout.startedAt,
      finishedAt,
      exercises: workout.exercises
        .filter((e) => e.sets.some((s) => s.complete))
        .map((e) => ({
          templateId: e.id,
          title: e.title,
          equipment:
            equipmentOptions.find((option) => option === e.equipment) ??
            "other",
          sets: e.sets
            .filter((s) => s.complete)
            .map((s) => ({
              reps: +s.reps,
              weightKg:
                s.weight === "" || e.type === "reps_only"
                  ? null
                  : +(
                      Number(s.weight) *
                      (workout.unit === "lbs" ? 0.45359237 : 1)
                    ).toFixed(5),
              warmup: s.warmup,
            })),
        })),
    });
  }
  const options = [
    ...exerciseOptions,
    ...presets.filter(
      (p) =>
        !exerciseOptions.some(
          (e) =>
            e.title.toLowerCase() === p.title.toLowerCase() &&
            e.equipment === p.equipment,
        ),
    ),
  ].filter((e) =>
    `${e.title} ${e.equipment ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <div className="train-stack">
      <div className="session-top">
        <div>
          <h1>Workout in progress</h1>
          <p className="muted">
            {completed} {completed === 1 ? "set" : "sets"} completed
          </p>
        </div>
        <div className="session-elapsed" aria-label="Workout time">
          <Icon name="timer" size={19} />
          {clock(
            Math.floor(
              (+(workout.finishedAt ? new Date(workout.finishedAt) : now) -
                Date.parse(workout.startedAt)) /
                1000,
            ),
          )}
        </div>
      </div>
      {workout.finishedAt ? (
        <section className="card">
          <h3>Finish saving your workout</h3>
          <p className="muted">Your completed sets are still on this device.</p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Retry save"}
          </button>
        </section>
      ) : (
        <>
          {workout.exercises.map((exercise, i) => (
            <section className="card set-card" key={i}>
              <header>
                <div>
                  <h3>{exercise.title}</h3>
                  <small>{gearLabel(exercise.equipment)}</small>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Remove ${exercise.title}`}
                  onClick={() =>
                    update({
                      ...workout,
                      exercises: workout.exercises.filter((_, n) => n !== i),
                    })
                  }
                >
                  <Icon name="close" size={18} />
                </button>
              </header>
              <div className="set-grid set-labels">
                <span>Set</span>
                <span>{workout.unit}</span>
                <span>Reps</span>
                <span>Done</span>
              </div>
              {exercise.sets.map((set, j) => {
                const editSet = (next: DraftSet, done = false) => {
                  update({
                    ...workout,
                    restsUntil: done ? Date.now() + 90000 : workout.restsUntil,
                    exercises: workout.exercises.map((e, k) =>
                      k !== i
                        ? e
                        : {
                            ...e,
                            sets: e.sets.map((s, n) => (n === j ? next : s)),
                          },
                    ),
                  });
                };
                return (
                  <div
                    key={j}
                    className={`set-grid set-line ${set.complete ? "set-done" : ""}`}
                  >
                    <button
                      className="set-kind"
                      aria-label={`Set ${j + 1} warmup`}
                      aria-pressed={set.warmup}
                      onClick={() => editSet({ ...set, warmup: !set.warmup })}
                    >
                      {set.warmup ? "W" : j + 1}
                    </button>
                    {exercise.type === "reps_only" ? (
                      <span className="no-weight">—</span>
                    ) : (
                      <input
                        aria-label={`Weight for ${exercise.title} set ${j + 1}`}
                        inputMode="decimal"
                        maxLength={8}
                        placeholder="–"
                        value={set.weight}
                        onChange={(e) =>
                          editSet({
                            ...set,
                            weight: e.target.value.replace(",", "."),
                            complete: false,
                          })
                        }
                      />
                    )}
                    <input
                      aria-label={`Reps for ${exercise.title} set ${j + 1}`}
                      inputMode="numeric"
                      maxLength={3}
                      placeholder="–"
                      value={set.reps}
                      onChange={(e) =>
                        editSet({
                          ...set,
                          reps: e.target.value,
                          complete: false,
                        })
                      }
                    />
                    <button
                      className="set-check"
                      aria-label={`${set.complete ? "Uncheck" : "Complete"} ${exercise.title} set ${j + 1}`}
                      aria-pressed={set.complete}
                      disabled={!set.complete && !validSet(set, workout.unit)}
                      onClick={() =>
                        editSet(
                          { ...set, complete: !set.complete },
                          !set.complete,
                        )
                      }
                    >
                      <Icon name="check" size={20} />
                    </button>
                  </div>
                );
              })}
              <button
                className="outline add-set"
                disabled={exercise.sets.length >= 20}
                onClick={() =>
                  changeExercise(i, {
                    ...exercise,
                    sets: [
                      ...exercise.sets,
                      {
                        ...emptySet,
                        reps: exercise.sets.at(-1)?.reps ?? "",
                        weight: exercise.sets.at(-1)?.weight ?? "",
                      },
                    ],
                  })
                }
              >
                <Icon name="plus" size={17} /> Add set
              </button>
            </section>
          ))}
          {picker && (
            <section
              className="card exercise-picker"
              aria-label="Exercise picker"
            >
              <header>
                <h3>Add exercise</h3>
                <button
                  className="icon-button"
                  aria-label="Close exercise picker"
                  onClick={() => {
                    setPicker(false);
                    setCustom(false);
                  }}
                >
                  <Icon name="close" size={18} />
                </button>
              </header>
              <label className="search-box">
                <Icon name="search" size={19} />
                <input
                  aria-label={custom ? "Exercise name" : "Search exercises"}
                  placeholder={custom ? "Exercise name" : "Search exercises"}
                  maxLength={100}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {custom ? (
                <>
                  <label className="equipment-label">
                    Equipment
                    <select
                      value={equipment}
                      onChange={(e) =>
                        setEquipment(e.target.value as TrainingEquipment)
                      }
                    >
                      {equipmentOptions.map((option) => (
                        <option key={option} value={option}>
                          {gearLabel(option)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary"
                    disabled={!query.trim()}
                    onClick={() =>
                      addExercise({
                        id: null,
                        title: query.trim(),
                        equipment,
                        type:
                          equipment === "bodyweight"
                            ? "reps_only"
                            : "weight_reps",
                      })
                    }
                  >
                    Add to workout
                  </button>
                </>
              ) : (
                <>
                  <div className="exercise-results">
                    {options.slice(0, 14).map((e) => (
                      <button
                        className="exercise-result"
                        key={e.id ?? e.title}
                        onClick={() => addExercise(e)}
                      >
                        <span>
                          <strong>{e.title}</strong>
                          <small>{gearLabel(e.equipment)}</small>
                        </span>
                        <Icon name="plus" size={19} />
                      </button>
                    ))}
                    {!options.length && (
                      <p className="muted">No exercises match your search.</p>
                    )}
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setCustom(true)}
                  >
                    Create custom exercise <Icon name="plus" size={17} />
                  </button>
                </>
              )}
            </section>
          )}
          {!picker && (
            <button
              className="outline add-exercise"
              disabled={workout.exercises.length >= 16}
              onClick={() => setPicker(true)}
            >
              <Icon name="plus" /> Add exercise
            </button>
          )}
          <div className="finish-panel">
            {rest > 0 && (
              <div className="rest-timer">
                <Icon name="timer" size={19} />
                <span>
                  Rest <strong>{clock(rest)}</strong>
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    update({
                      ...workout,
                      restsUntil: workout.restsUntil + 15000,
                    })
                  }
                >
                  +15 sec
                </button>
                <button
                  className="text-button"
                  onClick={() => update({ ...workout, restsUntil: 0 })}
                >
                  Skip
                </button>
              </div>
            )}
            {unfinished && !!completed && (
              <small>Only checked sets will be saved.</small>
            )}
            <button
              className="primary wide"
              disabled={!completed || busy}
              onClick={() => void save()}
            >
              <Icon name="check" size={20} /> Finish workout
            </button>
          </div>
        </>
      )}
      <div className="discard-row">
        {discard ? (
          <>
            <small>Discard this workout draft?</small>
            <button
              className="text-button danger-text"
              disabled={busy}
              onClick={() => {
                update(null);
                setDiscard(false);
                setPicker(false);
              }}
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
            disabled={busy}
            onClick={() => setDiscard(true)}
          >
            Discard draft
          </button>
        )}
      </div>
    </div>
  );
}

export function repeatedExercises(
  workout: Workout,
  unit: string,
): DraftExercise[] {
  return workout.exercises
    .filter((e) => e.sets.length)
    .slice(0, 16)
    .map((e) => ({
      id: e.exercise_template_id,
      title: e.title,
      equipment: e.equipment,
      type: e.exercise_type,
      sets: e.sets.slice(0, 20).map((s) => ({
        reps: s.reps?.toString() ?? "",
        weight:
          s.weight_kg === null
            ? ""
            : String(
                Math.round(
                  (s.weight_kg / (unit === "lbs" ? 0.45359237 : 1)) * 100,
                ) / 100,
              ),
        warmup: s.type === "warmup",
        complete: false,
      })),
    }));
}

export function InstallCard() {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true);
  if (standalone) return null;
  return (
    <details className="card install-card">
      <summary>
        <span className="row-icon">
          <Icon name="download" />
        </span>
        <span>
          <strong>Add to Home Screen</strong>
          <small>Open Workout Competition as an app.</small>
        </span>
        <Icon name="plus" size={18} />
      </summary>
      <div className="install-steps">
        <p>
          <strong>iPhone</strong> · In Safari, tap Share → Add to Home Screen.
          Turn on Open as Web App and tap Add.
        </p>
        <p>
          <strong>Android</strong> · In Chrome, open the menu and choose Install
          app or Add to Home screen.
        </p>
      </div>
    </details>
  );
}

type ActivityPerson = { id: string; name: string; workouts: Workout[] };
type Slot = { name: string; user_id: string | null };
const formatNumber = new Intl.NumberFormat("en-US");
const timeLabel = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
const workoutLabel = (workout: Workout) =>
  isManualWorkout(workout.id) ? "Logged workout" : "Hevy workout";
export function Activity({
  name,
  userId,
  draft,
  people,
  roster,
  openTrain,
  openCompetition,
  openHistory,
}: {
  name: string;
  userId: string;
  draft: Draft | null;
  people: ActivityPerson[];
  roster: Slot[];
  openTrain: () => void;
  openCompetition: () => void;
  openHistory: (user?: string, workout?: string) => void;
}) {
  const now = new Date();
  const weekStart = monday(localDay(now));
  const weekly = roster.map((slot) => {
    const person = people.find((p) => p.id === slot.user_id);
    const workouts = person?.workouts.filter(
      (w) =>
        localDay(w.start_time) >= weekStart &&
        localDay(w.start_time) <= localDay(now),
    );
    return {
      ...slot,
      count: workouts?.length ?? null,
      sets:
        workouts?.reduce(
          (n, w) =>
            n +
            w.exercises.reduce(
              (s, e) =>
                s + e.sets.filter((set) => set.type !== "warmup").length,
              0,
            ),
          0,
        ) ?? null,
    };
  });
  const max = Math.max(1, ...weekly.map((p) => p.count ?? 0));
  const activity = people
    .flatMap((p) =>
      p.workouts.slice(0, 10).map((workout) => ({ workout, person: p })),
    )
    .sort(
      (a, b) =>
        Date.parse(b.workout.start_time) - Date.parse(a.workout.start_time),
    )
    .slice(0, 8);
  const initials = (s: string) =>
    s
      .trim()
      .split(/\s+/)
      .filter((w) => /^\p{L}/u.test(w))
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  return (
    <div className="activity-layout">
      <section className="training-hero">
        <div>
          <span className="hero-kicker">
            <Icon name={draft ? "timer" : "train"} size={17} />
            {draft ? "Session in progress" : "Your training"}
          </span>
          <h1>
            {draft ? (
              "Pick up where you left off."
            ) : (
              <>
                Let's train,
                <br />
                {name.split(" ")[0]}.
              </>
            )}
          </h1>
          <button className="primary cta" onClick={openTrain}>
            {draft ? "Resume workout" : "Start workout"}
            <Icon name="arrow" size={20} />
          </button>
        </div>
      </section>
      <section className="card week-card">
        <header className="section-heading">
          <div>
            <h2>This week</h2>
            <p className="muted">Workouts and working sets</p>
          </div>
          <button
            className="icon-button"
            aria-label="Open competition"
            onClick={openCompetition}
          >
            <Icon name="arrow" />
          </button>
        </header>
        <div className="week-bars">
          {weekly.map((p, i) => (
            <div className="week-row" key={p.name}>
              <span className={`roster-avatar roster-${i % 4}`}>
                {p.name[0]}
              </span>
              <strong>{p.user_id === userId ? "You" : p.name}</strong>
              <div className="bar-rail" aria-hidden="true">
                <i style={{ width: `${(100 * (p.count ?? 0)) / max}%` }} />
              </div>
              <small>{p.count === null ? "—" : `${p.count} · ${p.sets}`}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="feed">
        <div className="section-heading">
          <h2>Activity</h2>
          <button className="text-button" onClick={() => openHistory()}>
            View history <Icon name="arrow" size={16} />
          </button>
        </div>
        {!activity.length && (
          <div className="card">
            <h3>No workouts yet</h3>
            <p className="muted">
              Your workouts and sessions shared by your circle will appear here.
            </p>
          </div>
        )}
        {activity.map(({ person, workout }) => {
          const count = workout.exercises.reduce(
            (n, e) => n + e.sets.length,
            0,
          );
          const minutes = Math.max(
            0,
            Math.round(
              (Date.parse(workout.end_time) - Date.parse(workout.start_time)) /
                60000,
            ),
          );
          return (
            <article className="card feed-card" key={person.id + workout.id}>
              <div className="feed-person">
                <span className="roster-avatar">{initials(person.name)}</span>
                <div>
                  <strong>{person.id === userId ? "You" : person.name}</strong>
                  <small>
                    {timeLabel(workout.start_time)} · {workoutLabel(workout)}
                  </small>
                </div>
              </div>
              <button
                className="feed-workout"
                onClick={() => openHistory(person.id, workout.id)}
              >
                <strong>
                  {workout.exercises
                    .slice(0, 2)
                    .map((e) => e.title)
                    .join(" + ") || "Strength session"}
                </strong>
                <Icon name="arrow" size={20} />
              </button>
              <div className="feed-metrics">
                <span>
                  <strong>{workout.exercises.length}</strong> Exercises
                </span>
                <span>
                  <strong>{formatNumber.format(count)}</strong> Sets
                </span>
                <span>
                  <strong>{minutes || "—"}</strong> Min
                </span>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
