import React, { useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
const ProgressChart = lazy(() => import("./ProgressChart"));
import { localDay, monday, addDays } from "../shared/scoring";
import type { Workout } from "../shared/import";
import "./style.css";

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
function App() {
  const [data, setData] = useState<any>(null),
    [config, setConfig] = useState<any>(null),
    [tab, setTab] = useState("Overview"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [challenge, setChallenge] = useState(""),
    [login, setLogin] = useState({
      name: "",
      phone: "",
      code: "",
      invite: new URLSearchParams(location.search).get("invite") || "",
    });
  const [pairCode, setPairCode] = useState(""),
    [inviteUrl, setInviteUrl] = useState(""),
    [selected, setSelected] = useState(""),
    [historyUser, setHistoryUser] = useState(""),
    [expanded, setExpanded] = useState("");
  const [weight, setWeight] = useState(""),
    [weightDay, setWeightDay] = useState(localDay(new Date()));
  const [start, setStart] = useState(addDays(monday(localDay(new Date())), 7)),
    [choices, setChoices] = useState<string[]>([]),
    [deleteConfirm, setDeleteConfirm] = useState(false);
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
  useEffect(() => {
    if (!data) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [!!data]);
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
  const me = data?.people.find((p: any) => p.id === data.me.id),
    partner = data?.people.find((p: any) => p.id !== data.me.id);
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
      data?.people.length > 1 &&
      data.people.every((p: any) =>
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
      data?.competitions.filter((c: any) => !c.a_approved || !c.b_approved) ||
      [];
  const latest = me?.imports[0],
    active = ["queued", "running"].includes(latest?.status);
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
            <span className="brand-icon">↗</span> WORKOUT COMPETITION
          </div>
          <div>
            <p className="eyebrow">A LITTLE COMPETITION. A LOT OF PROGRESS.</p>
            <h1>
              Your baseline.
              <br />
              Your next level.
            </h1>
            <p>
              Train your way. Measure your progress.
              <br />
              Get stronger together.
            </p>
          </div>
          <span className="story-footer">
            PRIVATE BY DEFAULT · BUILT FOR TWO
          </span>
        </section>
        <section className="login-panel">
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
                SMS login needs server setup. Add your Twilio Verify credentials
                to enable sign-in.
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
                  Invitation code <span className="muted">(new accounts)</span>
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
                  onChange={(e) => setLogin({ ...login, code: e.target.value })}
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
              Your workouts are visible to your partner only after you both
              agree to share.
            </p>
          </form>
        </section>
      </main>
    );
  const historyPerson =
    data.people.find((p: any) => p.id === historyUser) || me;
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">↗</span>
          <span>
            WORKOUT
            <br />
            COMPETITION
          </span>
        </div>
        <div className="workspace-label">YOUR TRAINING SPACE</div>
        <nav>
          {[
            ["Overview", "◫"],
            ["Workouts", "≡"],
            ["Compare", "↗"],
            ["Competition", "⚑"],
            ["Settings", "⚙"],
          ].map(([name, icon]) => (
            <button
              key={name}
              aria-label={name}
              className={tab === name ? "nav active" : "nav"}
              onClick={() => {
                setTab(name);
                setError("");
                setNotice("");
              }}
            >
              <span>{icon}</span>
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy">
            <span>◈</span>
            <div>
              <strong>Just your circle</strong>
              <small>Your progress stays private.</small>
            </div>
          </div>
          <button className="profile" onClick={() => setTab("Settings")}>
            <span className="avatar">{data.me.name[0]}</span>
            <span>
              <strong>{data.me.name}</strong>
              <small>Your account</small>
            </span>
            <span>↗</span>
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>YOUR PROGRESS, IN PERSPECTIVE</span>
          <span className="date">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </span>
        </header>
        <div className="page">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {tab === "Overview" ? "THE WORK ADDS UP" : tab.toUpperCase()}
              </p>
              <h1>
                {tab === "Overview"
                  ? `Keep moving, ${data.me.name}.`
                  : tab === "Workouts"
                    ? "Every session counts."
                    : tab === "Compare"
                      ? "See your progress."
                      : tab === "Competition"
                        ? "Stronger, together."
                        : "Make it yours."}
              </h1>
              <p className="muted">
                {tab === "Overview"
                  ? "A clear view of your training. A little motivation from your circle."
                  : tab === "Workouts"
                    ? "Your actual Hevy workouts, brought here by your local Codex companion."
                    : tab === "Compare"
                      ? "Same exercise. Your own starting point."
                      : tab === "Competition"
                        ? "Improvement is the goal. Your first week is the benchmark."
                        : "Manage your profile, connections, and privacy."}
              </p>
            </div>
            <button
              className="primary"
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
              <span className={active ? "spin" : ""}>⟳</span>{" "}
              {active ? "Sync in progress" : "Sync workouts"}
            </button>
          </div>
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
            <>
              <section className="hero">
                <div>
                  <p className="eyebrow">THIS WEEK’S COMPETITION</p>
                  <h2>
                    {competition
                      ? "Progress over personal records."
                      : "A stronger you starts here."}
                  </h2>
                  <p>
                    {competition
                      ? `Baseline week: ${date(dayStartForLabel(competition.start_day))}. Only your agreed exercises count.`
                      : "Connect your workouts, invite your training partner, and set your shared challenge."}
                  </p>
                  <button
                    className="light-button"
                    onClick={() =>
                      setTab(competition ? "Competition" : "Settings")
                    }
                  >
                    {competition ? "View competition" : "Set up your circle"}{" "}
                    <span>↗</span>
                  </button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="art-grid" />
                  <div className="bar bar1" />
                  <div className="bar bar2" />
                  <div className="bar bar3" />
                  <div className="bar bar4" />
                  <span className="art-arrow">↗</span>
                  <span className="art-label">YOU vs. YOUR BASELINE</span>
                </div>
              </section>
              <section className="stats">
                <Stat
                  label="YOUR WEEKLY IMPROVEMENT"
                  value={percent(
                    competition?.results.find(
                      (r: any) => r.userId === data.me.id,
                    )?.last.improvement ?? null,
                  )}
                  detail="Latest completed week · relative to baseline"
                />
                <Stat
                  label="WORKOUTS IMPORTED"
                  value={String(me.workouts.length)}
                  detail={
                    me.workouts.length
                      ? "Your training history, all in one place"
                      : "Your first sync gets things started"
                  }
                />
                <Stat
                  label="CURRENT BODY WEIGHT"
                  value={
                    me.weights[0] ? toDisplay(me.weights[0].kg).toFixed(1) : "—"
                  }
                  suffix={unit}
                  detail={
                    me.weights[0]
                      ? `Recorded ${me.weights[0].day}`
                      : "Add a dated weight to calculate progress"
                  }
                />
              </section>
              <div className="two-column">
                <section className="card">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">YOUR TRAINING LOG</p>
                      <h3>Recent sessions</h3>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setTab("Workouts")}
                    >
                      View all ↗
                    </button>
                  </div>
                  {me.workouts.length ? (
                    me.workouts.slice(0, 4).map((w: Workout) => (
                      <div className="workout-row" key={w.id}>
                        <span className="session-icon">↗</span>
                        <div>
                          <strong>
                            {w.exercises
                              .slice(0, 2)
                              .map((e) => e.title)
                              .join(" + ") || "Workout"}
                          </strong>
                          <small>
                            {date(w.start_time)} · {w.exercises.length}{" "}
                            exercises ·{" "}
                            {w.exercises.reduce((n, e) => n + e.sets.length, 0)}{" "}
                            sets
                          </small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <Empty
                      title="Your first session belongs here"
                      text="Pair your companion in Settings, then click Sync workouts. Your history will appear automatically."
                      action="Set up connection"
                      onClick={() => setTab("Settings")}
                    />
                  )}
                </section>
                <section className="card">
                  <p className="eyebrow">CONNECTED, ON YOUR TERMS</p>
                  <h3>Your circle</h3>
                  {data.sharing.length ? (
                    data.sharing.map((s: any) => (
                      <div className="circle-row" key={s.partner_id}>
                        <span className="avatar pale">{s.partner_name[0]}</span>
                        <div>
                          <strong>{s.partner_name}</strong>
                          <small>
                            {s.a_consent && s.b_consent
                              ? "Sharing is on"
                              : "Waiting for mutual consent"}
                          </small>
                        </div>
                        <span
                          className={
                            "status " +
                            (s.a_consent && s.b_consent ? "good" : "")
                          }
                        >
                          {s.a_consent && s.b_consent ? "Connected" : "Private"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <Empty
                      title="Better with a training partner"
                      text="Invite Blake, then both choose to share your workouts."
                      action="Invite your partner"
                      onClick={() => setTab("Settings")}
                    />
                  )}
                  <div className="card-note">
                    Your competition measures improvement from your own
                    baseline, adjusted for body weight.
                  </div>
                </section>
              </div>
              <SyncStatus people={data.people} />
            </>
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
                          sets
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
                  </article>
                ))
              ) : (
                <Empty
                  title="No workouts yet"
                  text="Sync your Hevy history through your paired Codex companion."
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
                      {competition.results.map((r: any) => (
                        <div className="score" key={r.userId}>
                          <span className="avatar pale">{r.name[0]}</span>
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
                      {winner(competition.results)} · Agreed variants:{" "}
                      {competition.choices
                        .map((x: any) => allExercises.get(x.id)?.title || x.id)
                        .join(", ")}
                    </p>
                  </>
                ) : (
                  <Empty
                    title="Your next challenge is waiting"
                    text="Sync both histories, agree on matching exercises, and choose a Monday to start."
                  />
                )}
              </section>
              {pending.map((co: any) => (
                <section className="card" key={co.id}>
                  <h3>Proposed competition · {co.start_day}</h3>
                  <p>
                    {JSON.parse(co.choices)
                      .map((x: any) => allExercises.get(x.id)?.title || x.id)
                      .join(", ")}
                  </p>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      (co.a === data.me.id ? co.a_approved : co.b_approved)
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
                {partner ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(async () => {
                        await api("/app/competition", {
                          partnerId: partner.id,
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
                          "Proposal saved. Your partner must approve before the start date.",
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
                      Choose the same exercise variants from both histories.
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
                        No matching weighted exercise variants yet. Sync both
                        accounts first.
                      </p>
                    )}
                    <button
                      className="primary"
                      disabled={busy || !choices.length}
                    >
                      Propose competition
                    </button>
                  </form>
                ) : (
                  <p className="muted">
                    Both participants must consent to sharing first.
                  </p>
                )}
              </section>
            </>
          )}
          {tab === "Settings" && (
            <>
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
                  {data.sharing.map((s: any) => {
                    const consent =
                      s.a === data.me.id ? s.a_consent : s.b_consent;
                    return (
                      <div className="sharing-item" key={s.partner_id}>
                        <strong>{s.partner_name}</strong>
                        <p className="muted">
                          Share exercises, sets, reps, weights, dates,
                          body-weight-adjusted progress, and body-weight
                          history. Personal notes are excluded.
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
                          {consent ? "Stop sharing" : "I agree to share"}
                        </button>
                      </div>
                    );
                  })}
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const r = await api("/app/invite", {});
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
                        Expires in seven days. Send this link to your partner.
                      </small>
                    </label>
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
                  Hevy. Your computer and companion must be running.
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
                  Delete your imported workouts, import history, and calculated
                  results. Your account and body-weight entries stay available.
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
          <footer>
            WORKOUT COMPETITION{" "}
            <span>Progress is personal. Keep showing up.</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
function dayStartForLabel(day: string) {
  return day + "T12:00:00Z";
}
function winner(results: any[]) {
  if (results.some((r) => r.last.improvement === null))
    return "Rankings start when both participants have enough data";
  const [a, b] = results;
  if (!a || !b) return "Waiting for both participants";
  const av = Number(a.last.improvement.toFixed(2)),
    bv = Number(b.last.improvement.toFixed(2));
  return av === bv
    ? "Tied this week"
    : `${av > bv ? a.name : b.name} leads the latest completed week`;
}
function Stat({
  label,
  value,
  detail,
  suffix,
}: {
  label: string;
  value: string;
  detail: string;
  suffix?: string;
}) {
  return (
    <section className="stat">
      <p className="eyebrow">{label}</p>
      <strong>
        {value} <small>{suffix}</small>
      </strong>
      <p>{detail}</p>
    </section>
  );
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
                ? `Last success ${new Date(success.completed_at).toLocaleString()} · covers ${date(success.scope_start)}–${date(success.scope_end)}`
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
