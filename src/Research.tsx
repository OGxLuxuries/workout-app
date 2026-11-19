import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  metricKey,
  measurementKinds,
  muscles,
  summarize,
  trainingDay,
  type WorkoutEntry,
} from "../shared/workspace";
import {
  equipmentOptions,
  isManualWorkout,
  manualPrefix,
} from "../shared/training";
import { Icon } from "./workout-ui";
import {
  query,
  request,
  type Comparison,
  type Metrics,
  type WorkspaceHome,
  type WorkoutPage,
} from "./workspace-api";

export function useResource<T>(url: string | null, revision = 0) {
  const [state, setState] = useState<{
    key: string | null;
    value: T | null;
    error: string;
  }>({ key: null, value: null, error: "" });
  useEffect(() => {
    if (!url) return;
    let canceled = false;
    request<T>(url).then(
      (value) => {
        if (!canceled) setState({ key: url, value, error: "" });
      },
      (error) => {
        if (!canceled)
          setState({ key: url, value: null, error: error.message });
      },
    );
    return () => {
      canceled = true;
    };
  }, [url, revision]);
  return state.key === url ? state : { key: url, value: null, error: "" };
}

const amount = (value: number, digits = 2) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(
    value,
  );
// Pounds are converted from stored kilograms, so extra decimals are noise.
const weight = (kg: number, unit: string, digits = unit === "lbs" ? 1 : 2) =>
  amount(kg / (unit === "lbs" ? 0.45359237 : 1), digits) + " " + unit;
const duration = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + " min";
  const rest = minutes % 60;
  return Math.floor(minutes / 60) + " h" + (rest ? " " + rest + " min" : "");
};
const initialDay = (timezone: string) => trainingDay(new Date(), timezone);
const dayLabel = (at: string, timeZone?: string) =>
  new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
const performanceKeys = [
  "volume",
  "sessions",
  "sets",
  "top",
  "reps",
  "seconds",
  "distance",
  "activeSeconds",
  "bodyweightReps",
  "assistedReps",
] as const;
type Metric = (typeof performanceKeys)[number];
const metricTitles: Record<Metric, string> = {
  volume: "Lifting volume",
  sessions: "Sessions",
  sets: "Working sets",
  top: "Top weight",
  reps: "Reps",
  seconds: "Training time",
  distance: "Distance",
  activeSeconds: "Timed exercise",
  bodyweightReps: "Bodyweight reps",
  assistedReps: "Assisted reps",
};
function valueFor(
  value: number,
  metric: Metric,
  unit: string,
  distanceUnit: string,
) {
  if (metric === "volume") return weight(value, unit, 0);
  if (metric === "top") return weight(value, unit);
  if (metric === "seconds" || metric === "activeSeconds")
    return duration(value);
  if (metric === "distance")
    return (
      amount(value / (distanceUnit === "mi" ? 1609.344 : 1000)) +
      " " +
      distanceUnit
    );
  return amount(value);
}
function MetricSummary({
  summary,
  unit,
  distanceUnit,
}: {
  summary: Partial<Record<Metric, number>>;
  unit: string;
  distanceUnit: string;
}) {
  return (
    <dl className="workspace-metrics">
      {performanceKeys
        .filter(
          (key) =>
            key in summary &&
            (["volume", "sessions", "sets", "top", "reps", "seconds"].includes(
              key,
            ) ||
              !!summary[key]),
        )
        .map((key) => (
          <div key={key}>
            <dt>{metricTitles[key]}</dt>
            <dd>{valueFor(summary[key]!, key, unit, distanceUnit)}</dd>
          </div>
        ))}
    </dl>
  );
}
function Dates({
  start,
  end,
  change,
}: {
  start: string;
  end: string;
  change: (start: string, end: string) => void;
}) {
  return (
    <div className="workspace-actions">
      <label>
        From
        <input
          type="date"
          value={start}
          onChange={(e) => change(e.target.value, end)}
        />
      </label>
      <label>
        Through
        <input
          type="date"
          min={start || undefined}
          value={end}
          onChange={(e) => change(start, e.target.value)}
        />
      </label>
      {(start || end) && (
        <button className="text-button" onClick={() => change("", "")}>
          Clear dates
        </button>
      )}
    </div>
  );
}
const limit = 31;
function Calendar({
  month,
  dates,
  open,
}: {
  month: string;
  dates: string[];
  open: (v: string) => void;
}) {
  const date = new Date(month + "-01T12:00:00Z"),
    day1 = date.getUTCDay();
  const count = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return (
    <div className="workspace-calendar">
      <div className="calendar-week">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="calendar-week">
        {Array.from({ length: day1 + Math.min(count, limit) }, (_, i) => {
          if (i < day1) return <span key={i} />;
          const text = String(i - day1 + 1);
          const key = month + "-" + text.padStart(2, "0");
          return (
            <button
              className={dates.includes(key) ? "calendar-logged" : ""}
              key={i}
              title={dates.includes(key) ? "Workout on " + key : key}
              onClick={() => open(key)}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
function selectedMetrics(
  summary: Metrics["summary"],
  metric: Metric,
  unit: string,
  distanceUnit: string,
) {
  const rows = summary.days.filter((day) => day.sessions).slice(-20);
  if (!rows.length) return <p className="muted">No workouts in this range.</p>;
  const scale = Math.max(1, ...rows.map((row) => row[metric]));
  return (
    <ul className="metric-bars">
      {rows.map((row) => (
        <li key={row.day}>
          <span>{row.day.slice(5)}</span>
          <span className="metric-track" aria-hidden="true">
            <span style={{ width: (row[metric] / scale) * 100 + "%" }} />
          </span>
          <strong>{valueFor(row[metric], metric, unit, distanceUnit)}</strong>
        </li>
      ))}
    </ul>
  );
}
type Measurement = {
  day: string;
  kind: (typeof measurementKinds)[number];
  value: number;
};
function Measurements({
  unit,
  distanceUnit,
  renderPhotos,
  timezone,
}: {
  unit: string;
  distanceUnit: string;
  timezone: string;
  renderPhotos?: (day: string) => ReactNode;
}) {
  const [refresh, setRefresh] = useState(0),
    [day, setDay] = useState(() => initialDay(timezone)),
    [kind, setKind] = useState<Measurement["kind"]>("weight"),
    [value, setValue] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const result = useResource<{ items: Measurement[] }>(
    "/measurements",
    refresh,
  );
  const factor =
    kind === "weight"
      ? unit === "lbs"
        ? 0.45359237
        : 1
      : kind === "bodyFat"
        ? 1
        : distanceUnit === "in"
          ? 2.54
          : 1;
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await request("/measurements", { day, kind, value: +value * factor });
      setValue("");
      setRefresh((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="train-stack">
      <form className="card workspace-form" onSubmit={save}>
        <h3>Log a measurement</h3>
        <label>
          Date
          <input
            type="date"
            required
            max={initialDay(timezone)}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
        <label>
          Measurement
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Measurement["kind"])}
          >
            {measurementKinds.map((k) => (
              <option key={k} value={k}>
                {k.replace(/[A-Z]/g, (l) => " " + l.toLowerCase())}
              </option>
            ))}
          </select>
        </label>
        <label>
          Value (
          {kind === "weight" ? unit : kind === "bodyFat" ? "%" : distanceUnit})
          <input
            type="number"
            step="any"
            min="0.01"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          Save measurement
        </button>
        {error && <p className="alert error">{error}</p>}
      </form>
      <section className="card">
        <h3>Measurements</h3>
        {result.error && <p className="alert error">{result.error}</p>}
        {result.value?.items.length === 0 && (
          <p className="muted">Your measurements will appear here.</p>
        )}
        {result.value?.items.map((m) => (
          <div key={m.day + m.kind} className="workspace-list-row">
            <span>
              {m.day} · {m.kind}
            </span>
            <strong>
              {m.kind === "weight"
                ? weight(m.value, unit)
                : m.kind === "bodyFat"
                  ? amount(m.value) + "%"
                  : amount(m.value / (distanceUnit === "in" ? 2.54 : 1)) +
                    " " +
                    distanceUnit}
            </strong>
            <button
              className="text-button"
              onClick={() => {
                setDay(m.day);
                setKind(m.kind);
                setValue(
                  String(
                    m.value /
                      (m.kind === "weight"
                        ? unit === "lbs"
                          ? 0.45359237
                          : 1
                        : m.kind === "bodyFat"
                          ? 1
                          : distanceUnit === "in"
                            ? 2.54
                            : 1),
                  ),
                );
              }}
            >
              Edit
            </button>
          </div>
        ))}
      </section>
      {result.value?.items.some((item) => item.day === day) && renderPhotos && (
        <section className="card">{renderPhotos(day)}</section>
      )}
    </div>
  );
}
export function WorkoutDetails({
  entry,
  unit,
  distanceUnit,
}: {
  entry: WorkoutEntry;
  unit: string;
  distanceUnit: string;
}) {
  const metric = summarize([entry]);
  return (
    <div className="workspace-detail">
      <p className="muted">
        {(entry.details?.audience ?? entry.annotation?.audience) ===
        "connections"
          ? "Shared with connections"
          : entry.details?.audience === "group"
            ? "Shared with group"
            : entry.details || entry.annotation
              ? "Private"
              : "Historical workout"}
        {" · "}
        {entry.source === "hevy" ? "Hevy" : "Logged here"} · Updated{" "}
        {dayLabel(entry.workout.updated_at)}
      </p>
      {(entry.details?.gym || entry.annotation?.gym) && (
        <p>{entry.details?.gym || entry.annotation?.gym}</p>
      )}
      {(entry.details?.note || entry.annotation?.note) && (
        <p>{entry.details?.note || entry.annotation?.note}</p>
      )}
      <MetricSummary summary={metric} unit={unit} distanceUnit={distanceUnit} />
      {Object.keys(metric.muscles).length > 0 && (
        <p className="muted">
          Working sets by primary muscle ·{" "}
          {Object.entries(metric.muscles)
            .map(([name, count]) => name + " " + count)
            .join(", ")}
        </p>
      )}
      {entry.workout.exercises.map((e) => (
        <section key={e.index} className="exercise-detail">
          <h4>
            {e.title}{" "}
            <small>
              {e.equipment ?? "Equipment unspecified"}
              {entry.details?.movements[e.index]?.group ? " · Superset" : ""}
            </small>
          </h4>
          {entry.details?.movements[e.index]?.note && (
            <p>{entry.details.movements[e.index].note}</p>
          )}
          <ul>
            {e.sets.map((s) => {
              const extra = entry.details?.movements[e.index]?.sets[s.index];
              const values = [
                s.weight_kg === null ? null : weight(s.weight_kg, unit),
                s.reps === null ? null : s.reps + " reps",
                extra?.seconds ? extra.seconds + " sec" : null,
                extra?.meters
                  ? valueFor(extra.meters, "distance", unit, distanceUnit)
                  : null,
              ].filter(Boolean);
              return (
                <li key={s.index}>
                  {s.index + 1}. {values.join(" · ") || "No values"}
                  {s.type === "warmup" ? " · Warm-up" : ""}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
export const titleFor = (entry: WorkoutEntry) =>
  entry.details?.title ||
  entry.annotation?.title ||
  entry.workout.exercises
    .slice(0, 2)
    .map((e) => e.title)
    .join(" + ") ||
  "Workout";

function ImportAnnotation({
  entry,
  changed,
}: {
  entry: WorkoutEntry;
  changed: () => void;
}) {
  const [value, setValue] = useState(
    entry.annotation ?? {
      title: "",
      note: "",
      gym: "",
      audience: "connections" as const,
    },
  );
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <details>
      <summary>Edit local details</summary>
      <form
        className="workspace-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setNotice("");
          try {
            await request("/workouts/import-annotation", {
              id: entry.workout.id,
              ...value,
            });
            setNotice("Local details saved.");
            changed();
          } catch (error) {
            setError((error as Error).message);
          }
        }}
      >
        <label>
          Local title
          <input
            maxLength={100}
            value={value.title}
            onChange={(e) => setValue({ ...value, title: e.target.value })}
          />
        </label>
        <label>
          Private note
          <textarea
            maxLength={2500}
            value={value.note}
            onChange={(e) => setValue({ ...value, note: e.target.value })}
          />
        </label>
        <label>
          Private gym
          <input
            maxLength={100}
            value={value.gym}
            onChange={(e) => setValue({ ...value, gym: e.target.value })}
          />
        </label>
        <label>
          Imported sets and attachments
          <select
            value={value.audience}
            onChange={(e) =>
              setValue({
                ...value,
                audience:
                  e.target.value === "private" ? "private" : "connections",
              })
            }
          >
            <option value="connections">Mutual connections</option>
            <option value="private">Only me</option>
          </select>
        </label>
        <button className="outline">Save local details</button>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
export function Progress({
  unit,
  home,
  revision,
  onAction,
  initial,
  initialOwner,
  changed,
  owner,
  renderExtras,
  renderPhotos,
}: {
  unit: string;
  home: WorkspaceHome;
  revision: number;
  onAction: (
    w: WorkoutEntry,
    mode: "edit" | "repeat" | "routine" | "duplicate",
  ) => void;
  initial?: string;
  initialOwner?: string;
  changed: () => void;
  owner: string;
  renderExtras?: (entry: WorkoutEntry) => ReactNode;
  renderPhotos?: (day: string) => ReactNode;
}) {
  const [view, setView] = useState<
    "Trends" | "History" | "Calendar" | "Measurements"
  >(initial || initialOwner ? "History" : "Trends");
  const [period, setPeriod] = useState({ start: "", end: "" }),
    [variant, setVariant] = useState(""),
    [metric, setMetric] = useState<Metric>("volume");
  const [month, setMonth] = useState(() =>
    initialDay(home.settings.timezone).slice(0, 7),
  );
  const [expanded, setExpanded] = useState(initial ?? ""),
    [extra, setExtra] = useState<WorkoutEntry[]>([]),
    [next, setNext] = useState<WorkoutPage["next"]>(null),
    [confirm, setConfirm] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [person, setPerson] = useState(initialOwner || owner);
  const hist = useResource<WorkoutPage>(
    query("/workouts", { owner: person, start: period.start, end: period.end }),
    revision,
  );
  const data = useResource<Metrics>(
    query("/metrics", { ...period, variant }),
    revision,
  );
  const calendar = useResource<Metrics>(
    view === "Calendar"
      ? query("/metrics", {
          start: month + "-01",
          end: new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0))
            .toISOString()
            .slice(0, 10),
        })
      : null,
    revision,
  );
  const detail = useResource<WorkoutEntry>(
    expanded ? query("/workouts/item", { id: expanded, owner: person }) : null,
    revision,
  );
  const history = [...(hist.value?.items ?? []), ...extra];
  const cursor = extra.length ? next : hist.value?.next;
  function changeDates(start: string, end: string) {
    setPeriod({ start, end });
    setExtra([]);
    setNext(null);
  }
  async function remove(w: WorkoutEntry) {
    setError("");
    try {
      await request("/workouts/delete", {
        id: w.workout.id.slice(manualPrefix.length),
        expectedRevision: w.revision,
        mutationId: crypto.randomUUID(),
      });
      setExpanded("");
      setConfirm("");
      setExtra([]);
      setNext(null);
      changed();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="train-stack">
      <nav className="segment" aria-label="Progress views">
        {(["Trends", "History", "Calendar", "Measurements"] as const).map(
          (v) => (
            <button
              key={v}
              aria-current={v === view ? "page" : undefined}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ),
        )}
      </nav>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {view === "Measurements" ? (
        <Measurements
          unit={unit}
          distanceUnit={home.settings.measurement}
          timezone={home.settings.timezone}
          renderPhotos={renderPhotos}
        />
      ) : (
        <>
          {view !== "Calendar" && (
            <section className="card">
              <Dates {...period} change={changeDates} />
            </section>
          )}
          {view === "Trends" && (
            <section className="card workspace-form">
              <div className="section-heading">
                <h3>Training trends</h3>
                <select
                  aria-label="Exercise variant"
                  value={variant}
                  onChange={(e) => setVariant(e.target.value)}
                >
                  <option value="">All exercises</option>
                  {data.value?.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              {data.error ? (
                <p className="alert error">{data.error}</p>
              ) : !data.value ? (
                <p role="status">Loading progress…</p>
              ) : (
                <>
                  <MetricSummary
                    summary={data.value.summary}
                    unit={unit}
                    distanceUnit={home.settings.distance}
                  />
                  <p className="muted">
                    {data.value.summary.sources
                      .map((s) => (s === "native" ? "Logged here" : "Hevy"))
                      .join(" + ") || "No history"}
                    {data.value.summary.latest
                      ? " · Updated " + dayLabel(data.value.summary.latest)
                      : ""}
                  </p>
                  <label>
                    Trend
                    <select
                      value={metric}
                      onChange={(e) => setMetric(e.target.value as Metric)}
                    >
                      {performanceKeys.map((k) => (
                        <option key={k} value={k}>
                          {metricTitles[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedMetrics(
                    data.value.summary,
                    metric,
                    unit,
                    home.settings.distance,
                  )}
                  <h3>Primary muscle distribution</h3>
                  <p>
                    {Object.entries(data.value.summary.muscles)
                      .map(([name, count]) => name + " " + count)
                      .join(" · ") || "No sets to summarize."}
                  </p>
                  <h3>Personal records</h3>
                  {!data.value.records.length && (
                    <p className="muted">
                      Complete a weighted working set to set a benchmark.
                    </p>
                  )}
                  <ul className="records-list">
                    {data.value.records.slice(0, 12).map((r) => (
                      <li key={r.workoutId + r.variant + r.metric}>
                        <span>
                          {r.title} · {r.metric}
                        </span>
                        <strong>{weight(r.value, unit)}</strong>
                        <small>
                          {r.benchmark ? "Benchmark" : "Personal record"} ·{" "}
                          {dayLabel(r.at, home.settings.timezone)}
                        </small>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
          {view === "Calendar" && (
            <section className="card workspace-form">
              <div className="section-heading">
                <h3>Training calendar</h3>
                <input
                  aria-label="Calendar month"
                  type="month"
                  value={month}
                  onChange={(e) => {
                    if (e.target.value) setMonth(e.target.value);
                  }}
                />
              </div>
              {calendar.error && (
                <p className="alert error">{calendar.error}</p>
              )}
              <Calendar
                month={month}
                dates={calendar.value?.summary.days.map((x) => x.day) ?? []}
                open={(day) => {
                  changeDates(day, day);
                  setView("History");
                }}
              />
            </section>
          )}
          {view === "History" && (
            <section className="card workspace-form">
              <div className="section-heading">
                <h3>Workout history</h3>
                <select
                  aria-label="Participant"
                  value={person}
                  onChange={(e) => {
                    setPerson(e.target.value);
                    setExpanded("");
                    setExtra([]);
                    setNext(null);
                  }}
                >
                  <option value={owner}>Me</option>
                  {home.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {hist.error ? (
                <p className="alert error">{hist.error}</p>
              ) : !hist.value ? (
                <p role="status">Loading workouts…</p>
              ) : (
                !history.length && (
                  <p className="muted">No visible workouts in this range.</p>
                )
              )}
              {history.map((entry) => (
                <article key={entry.workout.id} className="history-item">
                  <button
                    className="history-toggle"
                    aria-expanded={expanded === entry.workout.id}
                    onClick={() =>
                      setExpanded(
                        expanded === entry.workout.id ? "" : entry.workout.id,
                      )
                    }
                  >
                    <span>
                      <strong>{titleFor(entry)}</strong>
                      <small>
                        {dayLabel(
                          entry.workout.start_time,
                          home.settings.timezone,
                        )}{" "}
                        · {entry.workout.exercises.length} exercises
                      </small>
                    </span>
                    <span>{expanded === entry.workout.id ? "−" : "+"}</span>
                  </button>
                  {expanded === entry.workout.id && (
                    <>
                      <WorkoutDetails
                        entry={entry}
                        unit={unit}
                        distanceUnit={home.settings.distance}
                      />
                      {renderExtras?.(entry)}
                      {entry.owner === owner && entry.source === "hevy" && (
                        <ImportAnnotation entry={entry} changed={changed} />
                      )}
                      {entry.owner === owner && (
                        <div className="workspace-actions">
                          <button
                            className="outline"
                            onClick={() => onAction(entry, "repeat")}
                          >
                            Repeat
                          </button>
                          <button
                            className="outline"
                            onClick={() => onAction(entry, "routine")}
                          >
                            Save as routine
                          </button>
                          <button
                            className="outline"
                            onClick={() => onAction(entry, "duplicate")}
                          >
                            Duplicate
                          </button>
                          {isManualWorkout(entry.workout.id) && (
                            <>
                              <button
                                className="outline"
                                onClick={() => onAction(entry, "edit")}
                              >
                                Edit workout
                              </button>
                              {confirm === entry.workout.id ? (
                                <>
                                  <button
                                    className="danger"
                                    onClick={() => void remove(entry)}
                                  >
                                    Confirm removal
                                  </button>
                                  <button
                                    className="text-button"
                                    onClick={() => setConfirm("")}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="text-button danger-text"
                                  onClick={() => setConfirm(entry.workout.id)}
                                >
                                  Remove logged workout
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </article>
              ))}
              {expanded &&
                !history.some((entry) => entry.workout.id === expanded) &&
                detail.value && (
                  <>
                    <WorkoutDetails
                      entry={detail.value}
                      unit={unit}
                      distanceUnit={home.settings.distance}
                    />
                    {renderExtras?.(detail.value)}
                  </>
                )}
              {expanded &&
                detail.error &&
                !history.some((entry) => entry.workout.id === expanded) && (
                  <p className="alert error">{detail.error}</p>
                )}
              {cursor && (
                <button
                  className="outline"
                  disabled={loading}
                  onClick={async () => {
                    setLoading(true);
                    setError("");
                    try {
                      const page = await request<WorkoutPage>(
                        query("/workouts", {
                          owner: person,
                          start: period.start,
                          end: period.end,
                          ...cursor,
                        }),
                      );
                      setExtra((prev) => [...prev, ...page.items]);
                      setNext(page.next);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

export function Compare({
  home,
  unit,
  revision,
}: {
  home: WorkspaceHome;
  unit: string;
  revision: number;
}) {
  const [scope, setScope] = useState<"me" | "person" | "group">("me"),
    [target, setTarget] = useState(""),
    [variant, setVariant] = useState(""),
    [period, setPeriod] = useState({ start: "", end: "" });
  const mine = useResource<Metrics>(
    query("/metrics", { ...period, variant }),
    revision,
  );
  const result = useResource<Comparison>(
    scope !== "me" && target
      ? query("/compare", { ...period, variant, scope, target })
      : null,
    revision,
  );
  const choices = scope === "person" ? home.people : home.groups;
  const [groupView, setGroupView] = useState<"median" | "named">("median");
  const exercises = new Map(
    home.catalog.map((e) => [
      metricKey(e.id, e.equipment, e.type),
      e.title + " · " + e.equipment,
    ]),
  );
  for (const exercise of mine.value?.variants ?? [])
    exercises.set(exercise.id, exercise.label);
  return (
    <div className="train-stack">
      <nav className="segment" aria-label="Comparison scope">
        {(["me", "person", "group"] as const).map((v) => (
          <button
            key={v}
            aria-current={scope === v ? "page" : undefined}
            onClick={() => {
              setScope(v);
              setTarget(
                v === "person"
                  ? (home.people[0]?.id ?? "")
                  : v === "group"
                    ? (home.groups[0]?.id ?? "")
                    : "",
              );
            }}
          >
            {v === "me" ? "Me" : v === "person" ? "Person" : "Group"}
          </button>
        ))}
      </nav>
      <section className="card workspace-form">
        {scope !== "me" && (
          <label>
            {scope === "person" ? "Person" : "Group"}
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">
                Choose {scope === "person" ? "a person" : "a group"}
              </option>
              {choices.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Dates {...period} change={(start, end) => setPeriod({ start, end })} />
        <label>
          Exercise variant
          <select value={variant} onChange={(e) => setVariant(e.target.value)}>
            <option value="">All exercises</option>
            {[...exercises].map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>
      {(result.error || mine.error) && (
        <p className="alert error">{result.error || mine.error}</p>
      )}
      {scope !== "me" && !target && (
        <p className="muted">
          Choose an invited {scope}. Sharing settings are in You.
        </p>
      )}
      {scope === "person" && result.value?.reason && (
        <p className="card">{result.value.reason}</p>
      )}
      {scope === "group" && result.value && (
        <section className="card workspace-form">
          <p className="muted">
            {result.value.contributors} consenting peers with data in this
            range. Group medians need at least three.
          </p>
          <nav className="segment" aria-label="Group comparison views">
            <button
              aria-current={groupView === "median" ? "page" : undefined}
              onClick={() => setGroupView("median")}
            >
              Median
            </button>
            <button
              aria-current={groupView === "named" ? "page" : undefined}
              onClick={() => setGroupView("named")}
            >
              Named standings
            </button>
          </nav>
        </section>
      )}
      {(scope !== "group" || groupView === "median") && (
        <div className="comparison-grid">
          {(result.value?.self ?? mine.value?.summary) && (
            <section className="card">
              <h3>Me</h3>
              <MetricSummary
                summary={result.value?.self ?? mine.value!.summary}
                unit={unit}
                distanceUnit={home.settings.distance}
              />
            </section>
          )}
          {result.value?.peer && (
            <section className="card">
              <h3>{result.value.peer.name}</h3>
              {result.value.peer.summary.sessions ? (
                <MetricSummary
                  summary={result.value.peer.summary}
                  unit={unit}
                  distanceUnit={home.settings.distance}
                />
              ) : (
                <p className="muted">
                  No matching workouts in this date range.
                </p>
              )}
            </section>
          )}
          {result.value?.median && (
            <section className="card">
              <h3>Group median</h3>
              <MetricSummary
                summary={result.value.median}
                unit={unit}
                distanceUnit={home.settings.distance}
              />
            </section>
          )}
        </div>
      )}
      {scope === "group" && groupView === "named" && result.value && (
        <section className="card">
          <h3>Named standings by volume</h3>
          {!result.value.named?.length && (
            <p className="muted">
              No named results shared for this date range.
            </p>
          )}
          <ol>
            {[...(result.value.named ?? [])]
              .sort((a, b) => b.summary.volume - a.summary.volume)
              .map((p, i) => (
                <li key={p.name + i}>
                  {p.name} · {weight(p.summary.volume, unit, 0)}
                </li>
              ))}
          </ol>
        </section>
      )}
    </div>
  );
}

export function Library({
  home,
  unit,
  choose,
}: {
  home: WorkspaceHome;
  unit: string;
  choose: (id: string) => void;
}) {
  const [search, setSearch] = useState(""),
    [gear, setGear] = useState(""),
    [muscle, setMuscle] = useState(""),
    [selected, setSelected] = useState("");
  const selectedExercise = home.catalog.find((e) => e.id === selected);
  const data = useResource<Metrics>(
    selectedExercise
      ? query("/metrics", {
          variant: metricKey(
            selectedExercise.id,
            selectedExercise.equipment,
            selectedExercise.type,
          ),
        })
      : null,
  );
  return (
    <section className="card workspace-form">
      <h3>Exercise library</h3>
      <label>
        Find an exercise
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <div className="workspace-actions">
        <select
          aria-label="Equipment filter"
          value={gear}
          onChange={(e) => setGear(e.target.value)}
        >
          <option value="">All equipment</option>
          {equipmentOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <select
          aria-label="Muscle filter"
          value={muscle}
          onChange={(e) => setMuscle(e.target.value)}
        >
          <option value="">All muscles</option>
          {muscles.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </div>
      <div className="exercise-results">
        {home.catalog
          .filter(
            (e) =>
              e.title.toLowerCase().includes(search.toLowerCase()) &&
              (!gear || e.equipment === gear) &&
              (!muscle || e.muscle === muscle),
          )
          .map((e) => (
            <button
              className="exercise-result"
              key={e.id}
              onClick={() => setSelected(e.id)}
            >
              <span>
                <strong>{e.title}</strong>
                <small>
                  {e.equipment} · {e.muscle ?? "Custom"}
                </small>
              </span>
              <Icon name="arrow" size={16} />
            </button>
          ))}
      </div>
      {selectedExercise && (
        <section className="exercise-detail">
          <h4>{selectedExercise.title}</h4>
          <p>{selectedExercise.instructions || "No instructions added."}</p>
          <button
            className="primary"
            onClick={() => choose(selectedExercise.id)}
          >
            Log this exercise
          </button>
          {data.value && (
            <>
              <MetricSummary
                summary={data.value.summary}
                unit={unit}
                distanceUnit={home.settings.distance}
              />
              {selectedMetrics(
                data.value.summary,
                "volume",
                unit,
                home.settings.distance,
              )}
              <p>
                {data.value.records.filter((r) => !r.benchmark).length} personal
                records
              </p>
            </>
          )}
        </section>
      )}
    </section>
  );
}
