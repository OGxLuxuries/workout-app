import { useState } from "react";
import type { Draft } from "./Session";
import type { Workout } from "../shared/import";
import { localDay, monday } from "../shared/scoring";
import { isManualWorkout } from "../shared/training";

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

export function InstallCard() {
  const [platform, setPlatform] = useState<"iPhone" | "Android">(
    /Android/i.test(navigator.userAgent) ? "Android" : "iPhone",
  );
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
        <div
          className="install-platforms"
          role="group"
          aria-label="Phone platform"
        >
          {(["iPhone", "Android"] as const).map((phone) => (
            <button
              key={phone}
              type="button"
              className="secondary"
              aria-pressed={platform === phone}
              onClick={() => setPlatform(phone)}
            >
              {phone}
            </button>
          ))}
        </div>
        <p>
          Open this page in {platform === "iPhone" ? "Safari" : "Chrome"} on
          your phone.
        </p>
        <ol className="install-flow">
          {installFlows[platform].map(({ screen, action, hint }) => (
            <li key={screen}>
              <div className="install-screen" aria-hidden="true">
                <span>{screen}</span>
                <strong>{action}</strong>
              </div>
              <p>{hint}</p>
            </li>
          ))}
        </ol>
        <small>
          Illustrated screens. Menu wording and placement can vary by browser
          version.
        </small>
      </div>
    </details>
  );
}

const installFlows = {
  iPhone: [
    {
      screen: "Safari toolbar",
      action: "↑  Share",
      hint: "Tap Share. If you see the More menu (…) first, open it and choose Share.",
    },
    {
      screen: "Share menu",
      action: "⊞  Add to Home Screen",
      hint: "Scroll down and tap Add to Home Screen. If it’s missing, look under Edit Actions.",
    },
    {
      screen: "Add to Home Screen",
      action: "Open as Web App  ✓     Add",
      hint: "Turn on Open as Web App if the switch appears, then tap Add. Open Workout from your Home Screen.",
    },
  ],
  Android: [
    {
      screen: "Chrome toolbar",
      action: "⋮  More",
      hint: "Tap the three-dot menu beside the address bar.",
    },
    {
      screen: "Chrome menu",
      action: "⊞  Install app",
      hint: "Choose Install app, Install and create shortcut, or Add to Home screen. If you’re offered both Install and Create shortcut, choose Install.",
    },
    {
      screen: "Installation prompt",
      action: "Workout  →  Install",
      hint: "Confirm Install, then open Workout from your Home screen or app drawer.",
    },
  ],
};

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
  openRunImport,
  openCompetition,
  openHistory,
}: {
  name: string;
  userId: string;
  draft: Draft | null;
  people: ActivityPerson[];
  roster: Slot[];
  openTrain: () => void;
  openRunImport: () => void;
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
          <button type="button" className="secondary" onClick={openRunImport}>
            Import run
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
              <span className={`roster-avatar roster-${i % 5}`}>
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
