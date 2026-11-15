import React, { useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
const ProgressChart = lazy(() => import("./ProgressChart"));
import { localDay, monday, addDays, rankPlayers } from "../shared/scoring";
import type { Workout } from "../shared/import";
import { allTimeStart } from "../shared/sync";
import {
  isManualWorkout,
  manualPrefix,
  type LoggedWorkout,
} from "../shared/training";
import {
  Activity,
  Icon,
  InstallCard,
  Train,
  newDraft,
  readDraft,
  repeatedExercises,
  storeDraft,
  type Draft,
} from "./workout-ui";
import "./style.css";
import "./mobile.css";

async function api(path: string, body?: unknown) {
  const r = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-Workout-Request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.error || "Something went wrong"), {
      status: r.status,
    });
  return data;
}
const date = (v: string) =>
  new Date(v).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
const percent = (v: number | null) =>
  v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
type PlayerSlot = { name: string; user_id: string | null };
type CompetitionMember = { id: string; name: string; approved: boolean };
type PlayerScore = {
  userId: string;
  name: string;
  current: { improvement: number | null };
  last: { improvement: number | null; frequency: number; baseline: number };
};
type LoginConfig = {
  devAuth: boolean;
  smsReady: boolean;
  googleAuth: boolean;
  googleReady: boolean;
};
const signInErrors: Record<string, string> = {
  invitation:
    "That Google account does not have an invitation. Reopen your link and choose the account it was issued to.",
  expired:
    "This sign-in attempt expired. Try again from this page or your invitation link.",
  canceled: "Google sign-in was canceled. You can try again.",
  verification: "Google sign-in could not be verified. Try again.",
  unavailable: "Google sign-in is being set up.",
};
const navigation = [
  { screen: "Overview", label: "Activity", icon: "activity" },
  { screen: "Competition", label: "Compete", icon: "compete" },
  { screen: "Train", label: "Train", icon: "train" },
  { screen: "Workouts", label: "History", icon: "history" },
  { screen: "Settings", label: "You", icon: "profile" },
] as const;
const pageTitles: Record<string, string> = {
  Workouts: "History",
  Competition: "Competition",
  Compare: "Compare",
  Settings: "Your account",
};
function App() {
  const [data, setData] = useState<any>(null),
    [config, setConfig] = useState<LoginConfig | null>(null),
    [tab, setTab] = useState("Overview"),
    [error, setError] = useState(
      () =>
        signInErrors[
          new URLSearchParams(location.search).get("signin") || ""
        ] || "",
    ),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [challenge, setChallenge] = useState(""),
    [login, setLogin] = useState({
      name: new URLSearchParams(location.search).get("player") || "",
      phone: "",
      code: "",
      invite: new URLSearchParams(location.search).get("invite") || "",
    });
  const [pairCode, setPairCode] = useState(""),
    [inviteUrl, setInviteUrl] = useState(""),
    [invitePlayer, setInvitePlayer] = useState(""),
    [inviteEmail, setInviteEmail] = useState(""),
    [selected, setSelected] = useState(""),
    [historyUser, setHistoryUser] = useState(""),
    [expanded, setExpanded] = useState("");
  const [weight, setWeight] = useState(""),
    [weightDay, setWeightDay] = useState(localDay(new Date()));
  const [start, setStart] = useState(addDays(monday(localDay(new Date())), 7)),
    [choices, setChoices] = useState<string[]>([]),
    [deleteConfirm, setDeleteConfirm] = useState(false);
  const [localDraft, setLocalDraft] = useState<{
    owner: string;
    value: Draft | null;
  } | null>(null);
  const [removeWorkout, setRemoveWorkout] = useState("");
  const accountId: string | undefined = data?.me.id;
  const draft =
    localDraft?.owner === accountId ? (localDraft?.value ?? null) : null;
  useEffect(() => {
    if (!accountId) return;
    const saved = readDraft(accountId);
    setLocalDraft({ owner: accountId, value: saved });
    setTab(saved ? "Train" : "Overview");
  }, [accountId]);

  function updateDraft(value: Draft | null) {
    if (!accountId) return;
    setLocalDraft({ owner: accountId, value });
    if (!storeDraft(accountId, value))
      setError(
        "Draft storage is unavailable on this device. Keep the app open until you finish.",
      );
  }
  function openTab(screen: string) {
    setTab(screen);
    setError("");
    setNotice("");
    window.scrollTo(0, 0);
  }
  async function refresh() {
    try {
      setData(await api("/app/dashboard"));
    } catch (e: any) {
      if (e.status === 401) setData(null);
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    api("/config")
      .then(setConfig)
      .catch((e) => setError(e.message));
    void refresh();
  }, []);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const me = data?.people.find((p: any) => p.id === data.me.id);
  const roster: PlayerSlot[] = data?.roster ?? [];
  const openSlots = roster.filter(
    (p) => !p.user_id && (!config?.googleAuth || p.name !== "Oliver"),
  );
  const canInvite =
    !config?.googleAuth ||
    roster.some(
      (slot) => slot.name === "Oliver" && slot.user_id === data?.me.id,
    );
  const targetPlayer =
    openSlots.find((p) => p.name === invitePlayer)?.name ??
    openSlots[0]?.name ??
    "";
  const competitionPeople = roster.map((slot) =>
    data?.people.find((p: any) => p.id === slot.user_id),
  );
  const groupReady = roster.length > 0 && competitionPeople.every(Boolean);
  const unit = data?.me.unit || "lbs",
    toDisplay = (kg: number) => (unit === "lbs" ? kg / 0.45359237 : kg);
  const allExercises = new Map<
    string,
    { id: string; title: string; equipment: string | null; type: string | null }
  >();
  for (const p of data?.people || [])
    for (const w of p.workouts as Workout[])
      for (const e of w.exercises)
        allExercises.set(e.exercise_template_id, {
          id: e.exercise_template_id,
          title: e.title,
          equipment: e.equipment,
          type: e.exercise_type,
        });
  const matching = [...allExercises.values()].filter(
    (e) =>
      e.equipment &&
      e.type === "weight_reps" &&
      groupReady &&
      competitionPeople.every((p: any) =>
        p.workouts.some((w: Workout) =>
          w.exercises.some(
            (x) =>
              x.exercise_template_id === e.id &&
              x.equipment === e.equipment &&
              x.exercise_type === e.type,
          ),
        ),
      ),
  );
  const competition = data?.results[0],
    pending =
      data?.competitions.filter(
        (c: any) =>
          c.members.some((member: CompetitionMember) => !member.approved) &&
          c.start_day > localDay(new Date()),
      ) || [];
  const scores: PlayerScore[] = competition?.results ?? [];
  const standings = rankPlayers(scores);
  const latest = me?.imports[0],
    active = ["queued", "running"].includes(latest?.status);
  useEffect(() => {
    if (!data) return;
    const update = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(
      update,
      config?.googleAuth && !active ? 30000 : 5000,
    );
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [!!data, active, config?.googleAuth]);
  const exerciseId =
    selected || matching[0]?.id || allExercises.keys().next().value;
  const chartMap = new Map<string, any>();
  for (const p of data?.people || [])
    for (const w of p.workouts as Workout[]) {
      const day = localDay(w.start_time),
        row = chartMap.get(day) || { day };
      const sets = w.exercises
        .filter((e) => e.exercise_template_id === exerciseId)
        .flatMap((e) => e.sets)
        .filter((s) => s.type !== "warmup" && s.weight_kg !== null);
      if (sets.length) {
        row[p.id] = Math.max(
          row[p.id] || 0,
          ...sets.map((s) => toDisplay(s.weight_kg!)),
        );
        row[p.id + " reps"] = Math.max(...sets.map((s) => s.reps || 0));
        chartMap.set(day, row);
      }
    }
  const chart = [...chartMap.values()].sort((a, b) =>
    a.day.localeCompare(b.day),
  );
  if (loading)
    return (
      <div className="loading">
        <span className="brand-icon">↗</span>
        <p>Opening your training space…</p>
      </div>
    );
  if (!data)
    return (
      <main className="login-layout">
        <section className="login-story">
          <div className="brand">
            <span className="brand-icon">
              <Icon name="activity" size={22} />
            </span>{" "}
            WORKOUT COMPETITION
          </div>
          <div>
            <h1>Train together.</h1>
          </div>
        </section>
        <section className="login-panel">
          {config?.googleAuth ? (
            <div className="google-login">
              <h2>
                {login.invite && login.name
                  ? `Join as ${login.name}`
                  : "Sign in to Workout Competition"}
              </h2>
              <p className="muted">
                {login.invite
                  ? "Use the Google account your invitation was issued to."
                  : "Use the Google account linked to your player slot."}
              </p>
              {error && (
                <div role="alert" className="alert error">
                  {error}
                </div>
              )}
              {!config.googleReady && (
                <div className="alert">Google sign-in is being set up.</div>
              )}
              <button
                type="button"
                className="secondary wide google-button"
                disabled={busy || !config.googleReady}
                onClick={() =>
                  void act(async () => {
                    const result = await api("/auth/google/start", {
                      invite: login.invite || undefined,
                    });
                    location.assign(result.url);
                  })
                }
              >
                {busy ? "Opening Google…" : "Sign in with Google"}
                <Icon name="arrow" size={18} />
              </button>
            </div>
          ) : config ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  if (challenge) {
                    await api("/auth/verify", { challenge, code: login.code });
                    history.replaceState(null, "", location.pathname);
                    await refresh();
                  } else {
                    const r = await api("/auth/start", login);
                    setChallenge(r.challenge);
                  }
                });
              }}
            >
              <p className="eyebrow">WELCOME TO YOUR TRAINING SPACE</p>
              <h2>{challenge ? "Check your phone" : "Let’s get stronger."}</h2>
              <p className="muted">
                {challenge
                  ? "Enter your six-digit verification code."
                  : "Sign in or join with your private invitation."}
              </p>
              {config?.devAuth && (
                <div className="alert">
                  Local test mode · fictional accounts only. Verification code:
                  123456.
                </div>
              )}
              {!config?.devAuth && !config?.smsReady && (
                <div className="alert">
                  SMS login needs server setup. Add your Twilio Verify
                  credentials to enable sign-in.
                </div>
              )}
              {!challenge ? (
                <>
                  <label>
                    Your name
                    <input
                      required
                      autoComplete="name"
                      value={login.name}
                      onChange={(e) =>
                        setLogin({ ...login, name: e.target.value })
                      }
                      placeholder="Oliver"
                    />
                  </label>
                  <label>
                    Phone number
                    <input
                      required
                      type="tel"
                      autoComplete="tel"
                      value={login.phone}
                      onChange={(e) =>
                        setLogin({ ...login, phone: e.target.value })
                      }
                      placeholder="+1 555 123 4567"
                    />
                    <small>Include your country code, with no spaces.</small>
                  </label>
                  <label>
                    Invitation code{" "}
                    <span className="muted">(new accounts)</span>
                    <input
                      value={login.invite}
                      onChange={(e) =>
                        setLogin({ ...login, invite: e.target.value })
                      }
                      placeholder="Your private invitation"
                    />
                  </label>
                </>
              ) : (
                <label>
                  Verification code
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    autoComplete="one-time-code"
                    value={login.code}
                    onChange={(e) =>
                      setLogin({ ...login, code: e.target.value })
                    }
                  />
                </label>
              )}
              {error && (
                <div role="alert" className="alert error">
                  {error}
                </div>
              )}
              <button className="primary wide" disabled={busy}>
                {busy
                  ? "One moment…"
                  : challenge
                    ? "Enter dashboard →"
                    : "Send verification code →"}
              </button>
              {challenge && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setChallenge("")}
                >
                  Use another number or request a new code
                </button>
              )}
              <p className="fine-print">
                A player can see your workouts only when you both agree to
                share.
              </p>
            </form>
          ) : (
            error && (
              <div role="alert" className="alert error">
                {error}
              </div>
            )
          )}
        </section>
      </main>
    );
  const historyPerson =
    data.people.find((p: any) => p.id === historyUser) || me;
  return (
    <div className="app-layout mobile-app">
      <header className="app-header">
        <button className="app-wordmark" onClick={() => openTab("Overview")}>
          <span className="brand-icon">
            <Icon name="activity" size={21} />
          </span>
          Workout<span className="wordmark-accent">Competition</span>
        </button>
        <button
          className="header-avatar"
          aria-label="Open your account"
          onClick={() => openTab("Settings")}
        >
          {data.me.name[0]}
        </button>
      </header>
      <nav className="app-nav" aria-label="Main navigation">
        {navigation.map(({ screen, label, icon }) => {
          const current =
            screen === tab || (screen === "Competition" && tab === "Compare");
          return (
            <button
              key={screen}
              aria-current={current ? "page" : undefined}
              className={screen === "Train" ? "nav-train" : ""}
              onClick={() => openTab(screen)}
            >
              <span className="nav-glyph">
                <Icon name={icon} />
              </span>
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
      <main className="main">
        <div className="page">
          {pageTitles[tab] && (
            <div className="page-heading mobile-heading">
              <h1>{pageTitles[tab]}</h1>
              {tab === "Workouts" && (
                <button
                  className="outline"
                  disabled={busy || active}
                  onClick={() =>
                    void act(async () => {
                      await api("/app/sync", {});
                      setNotice(
                        "Sync requested. Your local Codex companion will read Hevy.",
                      );
                      await refresh();
                    })
                  }
                >
                  <span className={active ? "spin" : ""}>
                    <Icon name="sync" size={17} />
                  </span>
                  {active ? "Syncing" : "Sync workouts"}
                </button>
              )}
            </div>
          )}
          {(tab === "Competition" || tab === "Compare") && (
            <nav className="segment" aria-label="Competition views">
              <button
                aria-current={tab === "Competition" ? "page" : undefined}
                onClick={() => openTab("Competition")}
              >
                Standings
              </button>
              <button
                aria-current={tab === "Compare" ? "page" : undefined}
                onClick={() => openTab("Compare")}
              >
                Exercises
              </button>
            </nav>
          )}
          {config?.devAuth && (
            <div className="alert">
              LOCAL TEST MODE · Accounts and SMS verification are simulated.
              Workout syncing still requires a real, separately paired Codex
              connection.
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
            </div>
          )}
          {tab === "Overview" && (
            <Activity
              name={data.me.name}
              userId={data.me.id}
              draft={draft}
              people={data.people}
              roster={roster}
              openTrain={() => {
                if (!draft) updateDraft(newDraft(unit));
                openTab("Train");
              }}
              openCompetition={() => openTab("Competition")}
              openHistory={(owner, workout) => {
                setHistoryUser(owner ?? data.me.id);
                setExpanded(workout ?? "");
                openTab("Workouts");
              }}
            />
          )}
          {tab === "Train" && (
            <Train
              key={data.me.id}
              draft={draft}
              update={updateDraft}
              busy={busy}
              ownWorkouts={me.workouts}
              exerciseOptions={[...allExercises.values()]}
              start={(previous) => {
                const next = newDraft(unit);
                if (previous)
                  next.exercises = repeatedExercises(previous, unit);
                updateDraft(next);
              }}
              commit={async (log: LoggedWorkout) =>
                act(async () => {
                  await api("/app/workouts/log", log);
                  updateDraft(null);
                  openTab("Overview");
                  setNotice("Workout saved.");
                  await refresh();
                })
              }
            />
          )}
          {tab === "Workouts" && (
            <section className="card">
              <div className="section-heading">
                <h3>Workout history</h3>
                <select
                  aria-label="Participant"
                  value={historyPerson.id}
                  onChange={(e) => setHistoryUser(e.target.value)}
                >
                  {data.people.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {historyPerson.workouts.length ? (
                historyPerson.workouts.map((w: Workout) => (
                  <article className="history-item" key={w.id}>
                    <button
                      className="history-toggle"
                      aria-expanded={expanded === w.id}
                      onClick={() => setExpanded(expanded === w.id ? "" : w.id)}
                    >
                      <span>
                        <strong>
                          {date(w.start_time)} ·{" "}
                          {w.exercises
                            .slice(0, 2)
                            .map((e) => e.title)
                            .join(" + ")}
                        </strong>
                        <small>
                          {w.exercises.length} exercises ·{" "}
                          {w.exercises.reduce((n, e) => n + e.sets.length, 0)}{" "}
                          sets ·{" "}
                          {isManualWorkout(w.id) ? "Logged in app" : "Hevy"}
                        </small>
                      </span>
                      <span>{expanded === w.id ? "−" : "+"}</span>
                    </button>
                    {expanded === w.id &&
                      w.exercises.map((e) => (
                        <div className="exercise-detail" key={e.index}>
                          <h4>
                            {e.title}{" "}
                            <small>
                              {e.equipment || "Equipment unresolved"}
                            </small>
                          </h4>
                          <table>
                            <thead>
                              <tr>
                                <th>Set</th>
                                <th>Type</th>
                                <th>Weight ({unit})</th>
                                <th>Reps</th>
                              </tr>
                            </thead>
                            <tbody>
                              {e.sets.map((s) => (
                                <tr key={s.index}>
                                  <td>{s.index + 1}</td>
                                  <td>{s.type}</td>
                                  <td>
                                    {s.weight_kg === null
                                      ? "—"
                                      : toDisplay(s.weight_kg).toFixed(1)}
                                  </td>
                                  <td>{s.reps ?? "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    {expanded === w.id &&
                      historyPerson.id === accountId &&
                      isManualWorkout(w.id) && (
                        <div className="history-actions">
                          {removeWorkout === w.id ? (
                            <>
                              <span>Remove this logged workout?</span>
                              <button
                                className="danger"
                                disabled={busy}
                                onClick={() =>
                                  void act(async () => {
                                    await api("/app/workouts/remove", {
                                      id: w.id.slice(manualPrefix.length),
                                    });
                                    setRemoveWorkout("");
                                    setExpanded("");
                                    await refresh();
                                  })
                                }
                              >
                                Remove
                              </button>
                              <button
                                className="text-button"
                                onClick={() => setRemoveWorkout("")}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              className="text-button danger-text"
                              onClick={() => setRemoveWorkout(w.id)}
                            >
                              Remove logged workout
                            </button>
                          )}
                        </div>
                      )}
                  </article>
                ))
              ) : (
                <Empty
                  title="No workouts yet"
                  text="Start a workout in Train or sync your Hevy history."
                />
              )}
            </section>
          )}
          {tab === "Compare" && (
            <section className="card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">EXERCISE BY EXERCISE</p>
                  <h3>Weight & repetitions over time</h3>
                </div>
                <select
                  aria-label="Exercise"
                  value={exerciseId || ""}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="" disabled>
                    Choose an exercise
                  </option>
                  {[...allExercises.values()].map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title} · {e.equipment || "unknown"}
                    </option>
                  ))}
                </select>
              </div>
              {chart.length ? (
                <>
                  <Suspense fallback={<p className="muted">Loading chart…</p>}>
                    <ProgressChart
                      data={chart}
                      people={data.people}
                      unit={unit}
                    />
                  </Suspense>
                  <p className="muted">
                    Heaviest working-set weight per day ({unit}). Repetitions
                    below are the highest working-set reps that day, not
                    necessarily from the heaviest set.
                  </p>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          {data.people.map((p: any) => (
                            <th key={p.id}>{p.name} · reps</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {chart.map((row) => (
                          <tr key={row.day}>
                            <td>{row.day}</td>
                            {data.people.map((p: any) => (
                              <td key={p.id}>{row[p.id + " reps"] ?? "—"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <Empty
                  title="A clearer picture with every session"
                  text="After your first sync, select an exercise to see its weight and repetition history."
                />
              )}
            </section>
          )}
          {tab === "Competition" && (
            <>
              <section className="card">
                <p className="eyebrow">THE SCOREBOARD</p>
                <h3>Improvement from your first week</h3>
                {competition ? (
                  <>
                    <div className="score-grid">
                      {(
                        standings ??
                        scores.map((player) => ({ player, rank: null }))
                      ).map(({ player: r, rank }) => (
                        <div className="score" key={r.userId}>
                          <span className="avatar pale">
                            {rank ?? r.name[0]}
                          </span>
                          <h4>{r.name}</h4>
                          <strong>{percent(r.last.improvement)}</strong>
                          <p>
                            Latest completed week · {r.last.frequency} workouts
                          </p>
                          <small>
                            Baseline normalized volume:{" "}
                            {r.last.baseline.toFixed(1)}
                          </small>
                          <p className="muted">
                            This week: {percent(r.current.improvement)} ·
                            provisional
                          </p>
                          {r.last.improvement === null && (
                            <small>
                              Not enough data: a complete nonzero baseline and
                              covered comparison week are required.
                            </small>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="card-note">
                      {standings
                        ? leaderboardSummary(standings)
                        : "Rankings start when every player has enough data."}{" "}
                      · Agreed variants:{" "}
                      {competition.choices
                        .map((x: any) => allExercises.get(x.id)?.title || x.id)
                        .join(", ")}
                    </p>
                  </>
                ) : (
                  <Empty
                    title="Your next challenge is waiting"
                    text="Have all four players sync their workouts, agree on matching exercises, and choose a Monday to start."
                  />
                )}
              </section>
              {pending.map((co: any) => (
                <section className="card" key={co.id}>
                  <h3>Proposed competition · {co.start_day}</h3>
                  <p>
                    {co.choices
                      .map((x: any) => allExercises.get(x.id)?.title || x.id)
                      .join(", ")}
                  </p>
                  <ul className="approval-list">
                    {co.members.map((member: CompetitionMember) => (
                      <li key={member.id}>
                        {member.name}{" "}
                        <span
                          className={
                            "status " + (member.approved ? "good" : "")
                          }
                        >
                          {member.approved ? "Approved" : "Pending"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      co.members.some(
                        (member: CompetitionMember) =>
                          member.id === data.me.id && member.approved,
                      )
                    }
                    onClick={() =>
                      void act(async () => {
                        await api(`/app/competition/${co.id}/approve`, {});
                        await refresh();
                      })
                    }
                  >
                    Approve shared rules
                  </button>
                </section>
              ))}
              <section className="card">
                <h3>Start a new competition</h3>
                {groupReady ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(async () => {
                        await api("/app/competition", {
                          startDay: start,
                          choices: matching
                            .filter((x) => choices.includes(x.id))
                            .map((x) => ({
                              id: x.id,
                              equipment: x.equipment,
                              type: x.type,
                            })),
                        });
                        setNotice(
                          "Proposal saved. The other three players must approve before the start date.",
                        );
                        await refresh();
                      });
                    }}
                  >
                    <label>
                      Start on a future Monday
                      <input
                        type="date"
                        required
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                      />
                    </label>
                    <p className="muted">
                      Choose exercise variants present in all four workout
                      histories.
                    </p>
                    {matching.length ? (
                      matching.map((e) => (
                        <label className="check" key={e.id}>
                          <input
                            type="checkbox"
                            checked={choices.includes(e.id)}
                            onChange={(v) =>
                              setChoices(
                                v.target.checked
                                  ? [...choices, e.id]
                                  : choices.filter((x) => x !== e.id),
                              )
                            }
                          />
                          {e.title} · {e.equipment}
                        </label>
                      ))
                    ) : (
                      <p>
                        No matching weighted exercise variants yet. Have all
                        four players sync their workouts.
                      </p>
                    )}
                    <button
                      className="primary"
                      disabled={
                        busy || !matching.some((x) => choices.includes(x.id))
                      }
                    >
                      Propose competition
                    </button>
                  </form>
                ) : (
                  <p className="muted">
                    All four players must join. Set up mutual sharing with each
                    player to propose the rules.
                  </p>
                )}
              </section>
            </>
          )}
          {tab === "Settings" && (
            <>
              <InstallCard />
              <div className="two-column">
                <section className="card">
                  <p className="eyebrow">YOUR PROFILE</p>
                  <h3>Body weight & units</h3>
                  <label>
                    Display weights in
                    <select
                      value={unit}
                      onChange={(e) =>
                        void act(async () => {
                          await api("/app/preferences", {
                            unit: e.target.value,
                          });
                          await refresh();
                        })
                      }
                    >
                      <option value="lbs">Pounds (lbs)</option>
                      <option value="kg">Kilograms (kg)</option>
                    </select>
                  </label>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(async () => {
                        await api("/app/weights", {
                          day: weightDay,
                          weight: Number(weight),
                          unit,
                        });
                        setWeight("");
                        setNotice(
                          "Body weight saved. Scores have been recalculated.",
                        );
                        await refresh();
                      });
                    }}
                  >
                    <div className="form-row">
                      <label>
                        Body weight ({unit})
                        <input
                          type="number"
                          min="1"
                          step="0.1"
                          required
                          value={weight}
                          onChange={(e) => setWeight(e.target.value)}
                        />
                      </label>
                      <label>
                        Effective date
                        <input
                          type="date"
                          required
                          value={weightDay}
                          onChange={(e) => setWeightDay(e.target.value)}
                        />
                      </label>
                    </div>
                    <button className="secondary" disabled={busy}>
                      Save body weight
                    </button>
                  </form>
                  <p className="fine-print">
                    Use a date on or before your first scored workout. Saving
                    the same date replaces that measurement.
                  </p>
                  {me.weights.slice(0, 5).map((w: any) => (
                    <div className="weight-row" key={w.day}>
                      <span>{w.day}</span>
                      <strong>
                        {toDisplay(w.kg).toFixed(1)} {unit}
                      </strong>
                    </div>
                  ))}
                </section>
                <section className="card">
                  <p className="eyebrow">PRIVATE SHARING</p>
                  <h3>Your training circle</h3>
                  <p className="muted">
                    Choose who can see your exercises, sets, reps, weights,
                    workout dates, progress, and body-weight history. Sharing
                    starts when both players agree.
                  </p>
                  {data.sharing.map((s: any) => {
                    const consent =
                      s.a === data.me.id ? s.a_consent : s.b_consent;
                    return (
                      <div className="sharing-item" key={s.partner_id}>
                        <strong>{s.partner_name}</strong>
                        <p className="muted">
                          {s.a_consent && s.b_consent
                            ? "Sharing is on"
                            : consent
                              ? "Waiting for their consent"
                              : "Private"}
                        </p>
                        <button
                          className={consent ? "secondary" : "primary"}
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await api("/app/sharing", {
                                partnerId: s.partner_id,
                                consent: !consent,
                              });
                              await refresh();
                            })
                          }
                        >
                          {consent
                            ? `Stop sharing with ${s.partner_name}`
                            : `Share with ${s.partner_name}`}
                        </button>
                      </div>
                    );
                  })}
                  {openSlots.length > 0 && canInvite ? (
                    <>
                      <label>
                        Player to invite
                        <select
                          value={targetPlayer}
                          onChange={(e) => {
                            setInvitePlayer(e.target.value);
                            setInviteEmail("");
                            setInviteUrl("");
                          }}
                        >
                          {openSlots.map((player) => (
                            <option key={player.name}>{player.name}</option>
                          ))}
                        </select>
                      </label>
                      {config?.googleAuth && (
                        <label>
                          Player’s Google email
                          <input
                            type="email"
                            value={inviteEmail}
                            autoComplete="off"
                            onChange={(e) => {
                              setInviteEmail(e.target.value);
                              setInviteUrl("");
                            }}
                          />
                        </label>
                      )}
                      <button
                        className="secondary"
                        disabled={
                          busy || (!!config?.googleAuth && !inviteEmail.trim())
                        }
                        onClick={() =>
                          void act(async () => {
                            const r = await api("/app/invite", {
                              playerName: targetPlayer,
                              googleEmail: config?.googleAuth
                                ? inviteEmail.trim()
                                : undefined,
                            });
                            setInviteUrl(r.url);
                          })
                        }
                      >
                        Create private invitation
                      </button>
                      {inviteUrl && (
                        <label>
                          Invitation link
                          <input
                            readOnly
                            value={inviteUrl}
                            onFocus={(e) => e.target.select()}
                          />
                          <small>
                            Send this link to{" "}
                            {new URL(inviteUrl).searchParams.get("player")}. It
                            expires in seven days.
                          </small>
                        </label>
                      )}
                    </>
                  ) : openSlots.length > 0 ? (
                    <p className="muted">
                      Oliver manages invitations for the remaining players.
                    </p>
                  ) : (
                    <p className="muted">All four players have joined.</p>
                  )}
                </section>
              </div>
              <section className="card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">CODEX + HEVY</p>
                    <h3>Your local connection</h3>
                  </div>
                  <span className={"status " + (data.companion ? "good" : "")}>
                    {data.companion ? "Paired" : "Not paired"}
                  </span>
                </div>
                <p className="muted">
                  The Sync button asks your own local Codex session to read
                  Hevy. Your first sync imports your full workout history.
                </p>
                {data.companion ? (
                  <>
                    <p>
                      Last seen:{" "}
                      {data.companion.last_seen
                        ? new Date(data.companion.last_seen).toLocaleString()
                        : "Waiting for companion"}
                    </p>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api("/app/revoke-companion", {});
                          setPairCode("");
                          await refresh();
                        })
                      }
                    >
                      Revoke companion
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const r = await api("/app/pair-code", {});
                          setPairCode(r.code);
                        })
                      }
                    >
                      Create pairing code
                    </button>
                    {pairCode && (
                      <div className="pairing">
                        <label>
                          Pairing code · valid for ten minutes
                          <input
                            readOnly
                            value={pairCode}
                            onFocus={(e) => e.target.select()}
                          />
                        </label>
                        <p>
                          On your computer, follow the companion setup
                          instructions in the project README. Sign in to Codex
                          and connect your own Hevy account before pairing.
                        </p>
                      </div>
                    )}
                  </>
                )}
                <button
                  className="secondary"
                  disabled={busy || active || !data.companion}
                  onClick={() =>
                    void act(async () => {
                      await api("/app/sync", { mode: "probe" });
                      setNotice(
                        "Testing one real workout. This does not establish complete history coverage.",
                      );
                      await refresh();
                    })
                  }
                >
                  Test connection with one workout
                </button>
                <p className="fine-print">
                  Changing your connected Hevy account requires revoking and
                  pairing again.
                </p>
              </section>
              <SyncStatus people={data.people} />
              <section className="card danger-zone">
                <h3>Your data, your choice</h3>
                <p>
                  Delete your Hevy imports and import history. Workouts logged
                  in this app stay in History.
                </p>
                {deleteConfirm ? (
                  <div className="button-row">
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api("/app/delete-data", {});
                          setDeleteConfirm(false);
                          await refresh();
                        })
                      }
                    >
                      Confirm deletion
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setDeleteConfirm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="secondary"
                    onClick={() => setDeleteConfirm(true)}
                  >
                    Delete imported data
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() =>
                    void act(async () => {
                      await api("/app/logout", {});
                      setData(null);
                      setChallenge("");
                    })
                  }
                >
                  Sign out
                </button>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
function leaderboardSummary(
  standings: { player: PlayerScore; rank: number }[],
) {
  const leaders = standings
    .filter((entry) => entry.rank === 1)
    .map((entry) => entry.player.name);
  return leaders.length === 1
    ? `${leaders[0]} leads the latest completed week`
    : `${new Intl.ListFormat("en").format(leaders)} are tied for first`;
}
function Empty({
  title,
  text,
  action,
  onClick,
}: {
  title: string;
  text: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol">↗</span>
      <h4>{title}</h4>
      <p>{text}</p>
      {action && (
        <button className="text-button" onClick={onClick}>
          {action} →
        </button>
      )}
    </div>
  );
}
function SyncStatus({ people }: { people: any[] }) {
  return (
    <section className="card sync-card">
      <div>
        <p className="eyebrow">FRESHNESS, WITHOUT THE GUESSWORK</p>
        <h3>Sync status</h3>
      </div>
      {people.map((p) => {
        const latest = p.imports[0],
          success = p.imports.find(
            (i: any) => i.status === "completed" && i.mode === "full",
          );
        return (
          <div className="sync-person" key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <span
                className={
                  "status " + (latest?.status === "completed" ? "good" : "")
                }
              >
                {(latest?.mode === "probe" && latest?.status === "completed"
                  ? "Connection verified"
                  : latest?.status?.replace("_", " ")) || "Not synced"}
              </span>
            </div>
            <small>
              {success
                ? `Last success ${new Date(success.completed_at).toLocaleString()} · ${success.scope_start === allTimeStart ? "full history" : `covers ${date(success.scope_start)}–${date(success.scope_end)}`}`
                : "No successful full sync yet"}
            </small>
            {latest?.message && (
              <p className="sync-message">{latest.message}</p>
            )}
            {latest?.counts && (
              <small>
                {Object.entries(JSON.parse(latest.counts))
                  .map(([k, v]) => `${v} ${k}`)
                  .join(" · ")}
              </small>
            )}
          </div>
        );
      })}
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
