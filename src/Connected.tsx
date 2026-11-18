import { useState, type FormEvent } from "react";
import type {
  CatalogExercise,
  Routine,
  TrainingWorkout,
  WorkoutEntry,
} from "../shared/workspace";
import {
  request,
  query,
  type WorkoutPage,
  type WorkspaceHome,
  type SaveInput,
  type Metrics,
  type StravaStatus,
} from "./workspace-api";
import { useResource, titleFor, WorkoutDetails } from "./Research";
import { addDays, localDay, monday } from "../shared/scoring";

type Member = { id: string; name: string };
type Challenge = {
  id: string;
  title: string;
  group_id: string;
  starts_on: string;
  week: string;
  pending: boolean;
  players: (Member & { source: "native" | "mixed" | null; member: number })[];
  standings: {
    userId: string;
    name: string;
    normalized: number;
    workouts: number;
    reason: string | null;
    improvement: number | null;
    rank: number | null;
  }[];
};
function Status({ error, notice }: { error: string; notice?: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="alert success">
          {notice}
        </p>
      )}
    </>
  );
}
function useAction(changed?: () => void) {
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>, message = "") {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
      setNotice(message);
      changed?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { error, notice, busy, run };
}
export function Challenges({
  home,
  owner,
}: {
  home: WorkspaceHome;
  owner: string;
}) {
  const [revision, setRevision] = useState(0),
    [week, setWeek] = useState(""),
    [groupId, setGroup] = useState(""),
    [start, setStart] = useState(addDays(monday(localDay(new Date())), 7)),
    [title, setTitle] = useState(""),
    [source, setSource] = useState<"native" | "mixed">("native"),
    [variants, setVariants] = useState<string[]>([]),
    [players, setPlayers] = useState<string[]>([]);
  const action = useAction(() => setRevision((n) => n + 1));
  const entries = useResource<{ items: Challenge[] }>(
    query("/challenges", { week }),
    revision,
  );
  const members = useResource<{ items: Member[] }>(
    groupId ? query("/groups/members", { id: groupId }) : null,
  );
  const metrics = useResource<Metrics>(groupId ? "/metrics" : null);
  const weighted =
    metrics.value?.variants.filter(
      (v) => JSON.parse(v.id)[2] === "weight_reps",
    ) ?? [];
  return (
    <div className="train-stack">
      <Status {...action} />
      <section className="card workspace-form">
        <h3>Group competitions</h3>
        <label>
          View week
          <input
            type="date"
            value={week}
            onChange={(e) => setWeek(e.target.value)}
          />
        </label>
        {entries.error && <p className="alert error">{entries.error}</p>}
        {entries.value?.items.length === 0 && (
          <p className="muted">
            Propose a competition to compare verified weekly progress.
          </p>
        )}
        {entries.value?.items.map((ch) => (
          <article key={ch.id} className="workspace-form exercise-detail">
            <h4>{ch.title}</h4>
            <p className="muted">
              Starts {ch.starts_on} · Week of {ch.week}
            </p>
            <ul>
              {ch.players.map((p) => (
                <li key={p.id}>
                  {p.name} ·{" "}
                  {!p.member
                    ? "Left group"
                    : p.source === "mixed"
                      ? "Native + Hevy"
                      : p.source === "native"
                        ? "Native only"
                        : "Awaiting approval"}
                </li>
              ))}
            </ul>
            {ch.players.find((p) => p.id === owner)?.source ? (
              <button
                className="outline"
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    () =>
                      request("/challenges/confirm", {
                        id: ch.id,
                        week: ch.week,
                      }),
                    "Week confirmed.",
                  )
                }
              >
                Confirm this week’s log
              </button>
            ) : (
              <div className="workspace-actions">
                <button
                  className="outline"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(
                      () =>
                        request("/challenges/approve", {
                          id: ch.id,
                          source: "native",
                        }),
                      "Approved.",
                    )
                  }
                >
                  Approve with native logs
                </button>
                <button
                  className="outline"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(
                      () =>
                        request("/challenges/approve", {
                          id: ch.id,
                          source: "mixed",
                        }),
                      "Approved.",
                    )
                  }
                >
                  Approve with native + Hevy
                </button>
              </div>
            )}
            {ch.pending ? (
              <p className="muted">
                Standings open when the selected members approve.
              </p>
            ) : (
              <ul>
                {ch.standings.map((p) => (
                  <li key={p.userId}>
                    {p.rank ? p.rank + ". " : ""}
                    {p.name} · {p.reason ?? p.improvement + "% from baseline"}
                    {!p.reason && " · " + p.workouts + " eligible sessions"}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>
      <form
        className="card workspace-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(
            () =>
              request("/challenges", {
                groupId,
                title,
                start,
                variants,
                players,
                source,
              }),
            "Competition proposed.",
          );
        }}
      >
        <h3>Propose a competition</h3>
        <label>
          Group
          <select
            required
            value={groupId}
            onChange={(e) => {
              setGroup(e.target.value);
              setPlayers([owner]);
              setVariants([]);
            }}
          >
            <option value="">Choose group</option>
            {home.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        {groupId && (
          <>
            <label>
              Name
              <input
                required
                value={title}
                maxLength={100}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              First full week (Monday)
              <input
                required
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              My data source
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as typeof source)}
              >
                <option value="native">Native only</option>
                <option value="mixed">Native + Hevy</option>
              </select>
            </label>
            {members.value?.items.map((p) => (
              <label key={p.id} className="workspace-checkbox">
                <input
                  type="checkbox"
                  disabled={p.id === owner}
                  checked={players.includes(p.id)}
                  onChange={(e) =>
                    setPlayers((old) =>
                      e.target.checked
                        ? [...old, p.id]
                        : old.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
            <strong>Exercise variants</strong>
            {!weighted.length && (
              <p className="muted">
                Log an externally weighted exercise first.
              </p>
            )}
            {weighted.map((v) => (
              <label key={v.id} className="workspace-checkbox">
                <input
                  type="checkbox"
                  checked={variants.includes(v.id)}
                  onChange={(e) =>
                    setVariants((old) =>
                      e.target.checked
                        ? [...old, v.id]
                        : old.filter((id) => id !== v.id),
                    )
                  }
                />
                {v.label}
              </label>
            ))}
          </>
        )}
        <button
          className="primary"
          disabled={action.busy || players.length < 2 || !variants.length}
        >
          Propose
        </button>
      </form>
    </div>
  );
}
type ReconcileOptions = {
  candidates: {
    native: { id: string; title: string; at: string };
    hevy: { id: string; title: string; at: string };
    keep: string | null;
  }[];
  variants: {
    source: string;
    title: string;
    equipment: string;
    type: string;
    mapped: string | null;
  }[];
};
export function Reconcile({
  home,
  changed,
}: {
  home: WorkspaceHome;
  changed: () => void;
}) {
  const [open, setOpen] = useState(false),
    [revision, setRevision] = useState(0);
  const data = useResource<ReconcileOptions>(
    open ? "/reconcile" : null,
    revision,
  );
  const action = useAction(() => {
    setRevision((n) => n + 1);
    changed();
  });
  return (
    <details
      className="card workspace-form"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Review Hevy imports</summary>
      <Status error={action.error || data.error} notice={action.notice} />
      {data.value?.candidates.length === 0 && (
        <p className="muted">No likely duplicate workouts.</p>
      )}
      {data.value?.candidates.map((pair) => (
        <div key={pair.native.id + pair.hevy.id} className="workspace-list-row">
          <div>
            <strong>{pair.native.title}</strong>
            <p className="muted">
              {pair.hevy.title} · {new Date(pair.hevy.at).toLocaleDateString()}
            </p>
          </div>
          <label>
            Which workout counts?
            <select
              value={pair.keep ?? ""}
              disabled={action.busy}
              onChange={(e) =>
                void action.run(
                  () =>
                    request("/reconcile/duplicate", {
                      native: pair.native.id,
                      hevy: pair.hevy.id,
                      keep: e.target.value || null,
                    }),
                  "Comparison data updated.",
                )
              }
            >
              <option value="">Both workouts</option>
              <option value={pair.native.id}>Only the logged copy</option>
              <option value={pair.hevy.id}>Only the Hevy copy</option>
            </select>
          </label>
        </div>
      ))}
      {data.value?.variants.map((v) => {
        const catalog = home.catalog.filter(
          (e) =>
            e.id.startsWith("builtin:") &&
            e.equipment === v.equipment &&
            e.type === v.type,
        );
        return (
          <label key={v.source + v.equipment + v.type}>
            {v.title} · {v.equipment}
            <select
              disabled={action.busy || !catalog.length}
              value={v.mapped ?? ""}
              onChange={(e) =>
                void action.run(
                  () =>
                    request("/reconcile/variant", {
                      source: v.source,
                      equipment: v.equipment,
                      type: v.type,
                      canonical: e.target.value || null,
                    }),
                  "Exercise mapping saved.",
                )
              }
            >
              <option value="">Keep separate</option>
              {catalog.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </details>
  );
}
export async function unsubscribePush() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const sub = await registration?.pushManager?.getSubscription();
  if (sub) {
    await request("/push/unsubscribe", { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
}
export function PushPreferences() {
  const [state, setState] = useState("");
  const action = useAction();
  const data = useResource<{ publicKey: string | null }>("/push");
  const available =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  return (
    <section className="card workspace-form">
      <h3>Notifications</h3>
      <p className="muted">
        New invitations and workout activity are always available in the inbox.
      </p>
      <Status error={action.error} notice={state} />
      {!!data.value?.publicKey && available ? (
        <div className="workspace-actions">
          <button
            className="outline"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const authorized = await Notification.requestPermission();
                if (authorized !== "granted")
                  throw new Error(
                    "Allow notifications in your browser or device settings.",
                  );
                const registration =
                  await navigator.serviceWorker.getRegistration();
                if (!registration)
                  throw new Error(
                    "Open the installed workout app to enable notifications.",
                  );
                const key = data
                  .value!.publicKey!.replace(/-/g, "+")
                  .replace(/_/g, "/");
                const raw = Uint8Array.from(
                  atob(key.padEnd(Math.ceil(key.length / 4) * 4, "=")),
                  (x) => x.charCodeAt(0),
                );
                const sub =
                  (await registration.pushManager.getSubscription()) ??
                  (await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: raw,
                  }));
                await request("/push/subscribe", sub.toJSON());
                setState("Notifications enabled on this device.");
              })
            }
          >
            Enable on this device
          </button>
          <button
            className="text-button"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await unsubscribePush();
                setState("Notifications disabled on this device.");
              })
            }
          >
            Disable on this device
          </button>
        </div>
      ) : (
        <p className="muted">Device delivery is unavailable here.</p>
      )}
    </section>
  );
}

type Media = { id: string; content_type: string };
export function Attachments({
  owner,
  current,
  workout,
  day,
}: {
  owner: string;
  current: string;
  workout?: string;
  day?: string;
}) {
  const [revision, setRevision] = useState(0),
    [file, setFile] = useState<File | null>(null);
  const action = useAction(() => setRevision((n) => n + 1));
  const items = useResource<{ items: Media[]; enabled: boolean }>(
    query("/media", { owner, workout, day }),
    revision,
  );
  return (
    <section className="workspace-form">
      <h4>{day ? "Progress photos" : "Workout attachments"}</h4>
      {items.value?.items.map((item) => (
        <div className="media-item" key={item.id}>
          {item.content_type.startsWith("image/") ? (
            <img
              src={"/api/app/v2/media/" + item.id}
              alt={day ? "Progress photo" : "Workout attachment"}
              loading="lazy"
            />
          ) : (
            <video
              src={"/api/app/v2/media/" + item.id}
              controls
              preload="metadata"
            />
          )}
          {owner === current && (
            <button
              className="text-button"
              onClick={() =>
                void action.run(
                  () => request("/media/delete", { id: item.id }),
                  "Attachment removed.",
                )
              }
            >
              Remove attachment
            </button>
          )}
        </div>
      ))}
      {owner === current && items.value?.enabled && (
        <div className="workspace-actions">
          <input
            aria-label={
              day ? "Choose progress photo" : "Choose workout attachment"
            }
            type="file"
            accept={
              day
                ? "image/png,image/jpeg,image/webp"
                : "image/png,image/jpeg,image/webp,video/mp4,video/webm"
            }
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            className="outline"
            disabled={!file || action.busy}
            onClick={() => {
              if (file)
                void action.run(async () => {
                  const res = await fetch(
                    "/api/app/v2" + query("/media/upload", { workout, day }),
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": file.type,
                        "X-Workout-Request": "1",
                      },
                      body: file,
                    },
                  );
                  const result = (await res.json()) as { error?: string };
                  if (!res.ok)
                    throw new Error(result.error ?? "Upload failed.");
                  setFile(null);
                }, "Attachment saved.");
            }}
          >
            Upload
          </button>
        </div>
      )}
      {items.value && !items.value.enabled && owner === current && (
        <p className="muted">
          Media storage is unavailable in this environment.
        </p>
      )}
      <Status {...action} />
    </section>
  );
}
type Comments = {
  comments: { id: string; name: string; body: string; user_id: string }[];
  reactions: { count: number; mine: number | null };
};
function Social({ entry, owner }: { entry: WorkoutEntry; owner: string }) {
  const [revision, setRevision] = useState(0),
    [body, setBody] = useState("");
  const action = useAction(() => setRevision((n) => n + 1));
  const context = { owner: entry.owner, id: entry.workout.id };
  const data = useResource<Comments>(query("/social", context), revision);
  return (
    <section className="workspace-form">
      <h4>Workout activity</h4>
      {data.value && (
        <>
          <div className="workspace-actions">
            <button
              className="outline"
              aria-pressed={!!data.value.reactions.mine}
              onClick={() =>
                void action.run(() =>
                  request("/social/react", {
                    ...context,
                    enabled: !data.value!.reactions.mine,
                  }),
                )
              }
            >
              {data.value.reactions.mine ? "Remove reaction" : "React"} ·{" "}
              {data.value.reactions.count}
            </button>
            <button
              className="text-button"
              onClick={() =>
                void action.run(async () => {
                  const url = new URL(location.origin);
                  url.searchParams.set("workout", context.id);
                  url.searchParams.set("owner", context.owner);
                  await navigator.clipboard.writeText(url.href);
                }, "Link copied. It opens for people in this workout’s audience.")
              }
            >
              Copy workout link
            </button>
          </div>
          {data.value.comments.map((c) => (
            <div className="workspace-list-row" key={c.id}>
              <p>
                <strong>{c.name}</strong> {c.body}
              </p>
              {(c.user_id === owner || entry.owner === owner) && (
                <button
                  className="text-button"
                  onClick={() =>
                    void action.run(() =>
                      request("/social/comment/delete", { id: c.id }),
                    )
                  }
                >
                  Remove comment
                </button>
              )}
            </div>
          ))}
          <form
            className="workspace-actions"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                await request("/social/comment", { ...context, body });
                setBody("");
              });
            }}
          >
            <label>
              Comment
              <input
                value={body}
                maxLength={500}
                required
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <button className="outline" disabled={!body.trim() || action.busy}>
              Post comment
            </button>
          </form>
        </>
      )}
      <Status error={action.error || data.error} notice={action.notice} />
    </section>
  );
}
export function ActivityViews({
  owner,
  unit,
  home,
  revision,
}: {
  owner: string;
  unit: string;
  home: WorkspaceHome;
  revision: number;
}) {
  const [view, setView] = useState<"shared" | "inbox" | "network">(
      new URLSearchParams(location.search).has("inbox") ? "inbox" : "shared",
    ),
    [expanded, setExpanded] = useState(""),
    [inboxRevision, setInboxRevision] = useState(0);
  const feed = useResource<WorkoutPage>(
    view === "shared" ? "/workouts?feed=1" : null,
    revision,
  );
  const inbox = useResource<{
    items: {
      id: string;
      kind: string;
      created_at: string;
      read_at: string | null;
    }[];
  }>(view === "inbox" ? "/inbox" : null, inboxRevision);
  const action = useAction(() => setInboxRevision((n) => n + 1));
  return (
    <section className="card workspace-form">
      <div className="section-heading">
        <h3>Private activity</h3>
        <nav aria-label="Activity views" className="workspace-actions">
          <button
            className="outline"
            aria-pressed={view === "shared"}
            onClick={() => setView("shared")}
          >
            Shared workouts
          </button>
          <button
            className="outline"
            aria-pressed={view === "inbox"}
            onClick={() => setView("inbox")}
          >
            Inbox
          </button>
          <button
            className="outline"
            aria-pressed={view === "network"}
            onClick={() => setView("network")}
          >
            Find people
          </button>
        </nav>
      </div>
      {view === "shared" ? (
        <>
          {feed.error ? (
            <p className="alert error">{feed.error}</p>
          ) : !feed.value ? (
            <p role="status">Loading activity…</p>
          ) : (
            feed.value.items.length === 0 && (
              <p className="muted">
                Workouts shared with you will appear here.
              </p>
            )
          )}
          {feed.value?.items.map((entry) => {
            const key = entry.owner + ":" + entry.workout.id;
            return (
              <article className="history-item" key={key}>
                <button
                  className="history-toggle"
                  aria-expanded={expanded === key}
                  onClick={() => setExpanded(expanded === key ? "" : key)}
                >
                  <span>
                    <strong>{titleFor(entry)}</strong>
                    <small>
                      {entry.owner === owner
                        ? "Me"
                        : (home.people.find((p) => p.id === entry.owner)
                            ?.name ?? "Group member")}{" "}
                      ·{" "}
                      {new Date(entry.workout.start_time).toLocaleDateString()}
                    </small>
                  </span>
                </button>
                {expanded === key && (
                  <>
                    <WorkoutDetails
                      entry={entry}
                      unit={unit}
                      distanceUnit={home.settings.distance}
                    />
                    <Attachments
                      owner={entry.owner}
                      current={owner}
                      workout={entry.workout.id}
                    />
                    <Social entry={entry} owner={owner} />
                  </>
                )}
              </article>
            );
          })}
        </>
      ) : view === "network" ? (
        <ConnectionDirectory />
      ) : (
        <>
          {inbox.error && <p className="alert error">{inbox.error}</p>}
          {inbox.value?.items.length === 0 && (
            <p className="muted">You are all caught up.</p>
          )}
          {inbox.value?.items.map((i) => (
            <div className="workspace-list-row" key={i.id}>
              <span>{i.kind}</span>
              <small>
                {i.read_at ? "Read" : "New"} ·{" "}
                {new Date(i.created_at).toLocaleDateString()}
              </small>
            </div>
          ))}
          {inbox.value?.items.some((i) => !i.read_at) && (
            <button
              className="outline"
              onClick={() => void action.run(() => request("/inbox/read", {}))}
            >
              Mark all read
            </button>
          )}
        </>
      )}
      <Status {...action} />
    </section>
  );
}
function ConnectionDirectory() {
  const [search, setSearch] = useState(""),
    [matches, setMatches] = useState(""),
    [revision, refresh] = useState(0);
  const [view, setView] = useState<"network" | "outgoing" | "incoming">(
    "network",
  );
  const directory = useResource<{
    items: {
      id: string;
      name: string;
      bio: string;
      incoming: number;
      outgoing: number;
    }[];
  }>(query("/network", { search: matches }), revision);
  const action = useAction(() => refresh((n) => n + 1));
  const people = directory.value?.items.filter(
    (person) => view === "network" || !!person[view],
  );
  return (
    <div className="workspace-form">
      <form
        className="workspace-actions"
        onSubmit={(e) => {
          e.preventDefault();
          setMatches(search);
        }}
      >
        <label>
          Search invited profiles
          <input
            value={search}
            maxLength={80}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button className="outline">Search</button>
      </form>
      <label>
        Connection list
        <select
          value={view}
          onChange={(e) => setView(e.target.value as typeof view)}
        >
          <option value="network">Invited network</option>
          <option value="outgoing">People you opted in to</option>
          <option value="incoming">People who opted in to you</option>
        </select>
      </label>
      <Status error={action.error || directory.error} notice={action.notice} />
      {people?.length === 0 && (
        <p className="muted">No profiles in this view.</p>
      )}
      {people?.map((person) => (
        <details className="workspace-list-row" key={person.id}>
          <summary>{person.name}</summary>
          {person.bio && <p>{person.bio}</p>}
          <p className="muted">
            {person.incoming && person.outgoing
              ? "Connected"
              : person.outgoing
                ? "Waiting for them to opt in"
                : "Connect to share workouts when you both opt in."}
          </p>
          <button
            className="outline"
            disabled={action.busy}
            onClick={() =>
              void action.run(
                () =>
                  request("/network/connect", {
                    target: person.id,
                    consent: !person.outgoing,
                  }),
                "Connection updated.",
              )
            }
          >
            {person.outgoing ? "Disconnect" : "Connect"}
          </button>
        </details>
      ))}
    </div>
  );
}
export function SharedActions({
  entry,
  owner,
}: {
  entry: WorkoutEntry;
  owner: string;
}) {
  return entry.details && entry.details.audience !== "private" ? (
    <Social entry={entry} owner={owner} />
  ) : null;
}

export function Integrations({
  status,
  refresh,
}: {
  status: StravaStatus | null;
  refresh: () => void;
}) {
  const action = useAction(refresh);
  return (
    <section className="card workspace-form">
      <h3>Connected services</h3>
      <p>
        Strava ·{" "}
        {status?.connected
          ? "Connected"
          : status?.enabled
            ? "Available to connect"
            : "Unavailable in this environment"}
      </p>
      <Status {...action} />
      {status?.enabled && !status.connected && (
        <button
          className="outline"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const result = await request<{ url: string }>(
                "/integrations/strava/start",
                {},
              );
              location.assign(result.url);
            })
          }
        >
          Connect Strava
        </button>
      )}
      {status?.connected && (
        <button
          className="outline"
          disabled={action.busy}
          onClick={() =>
            void action.run(
              () => request("/integrations/strava/disconnect", {}),
              "Strava disconnected.",
            )
          }
        >
          Disconnect Strava
        </button>
      )}
      {status?.jobs.map((job) => (
        <div className="workspace-list-row" key={job.workout_id}>
          <span>
            {job.state === "sent"
              ? "Sent to Strava"
              : job.state === "review" || job.state === "sending"
                ? "Check Strava for the workout before retrying"
                : job.state === "pending"
                  ? "Waiting to send"
                  : "Export " + job.state}{" "}
            · {new Date(job.updated_at).toLocaleDateString()}
          </span>
          {status.connected && job.state === "pending" && (
            <button
              className="outline"
              disabled={action.busy}
              onClick={() =>
                void action.run(
                  () =>
                    request("/integrations/strava/deliver", {
                      id: job.workout_id,
                    }),
                  "Export status updated.",
                )
              }
            >
              Send pending export
            </button>
          )}
        </div>
      ))}
      <p className="muted">
        Health Connect, sensors, and watch logging require the Android
        companion.
      </p>
    </section>
  );
}

export function DataTools({ changed }: { changed: () => void }) {
  const [revision, setRevision] = useState(0);
  const action = useAction(() => {
    setRevision((n) => n + 1);
    changed();
  });
  const profile = useResource<{ name: string; bio: string; locale: string }>(
    "/profile",
    revision,
  );
  const [preview, setPreview] = useState<{
    workouts: { id: string; workout: TrainingWorkout }[];
    skipped: number;
    routines: Routine[];
    catalog: CatalogExercise[];
    measurements: { day: string; kind: string; value: number }[];
  } | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    bio: string;
    locale: string;
  } | null>(null);
  const current = draft ?? profile.value;
  function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (current)
      void action.run(async () => {
        await request("/profile", current);
        setDraft(null);
      }, "Profile saved.");
  }
  return (
    <div className="train-stack">
      <Status {...action} />
      {current && (
        <form className="card workspace-form" onSubmit={saveProfile}>
          <h3>Profile</h3>
          <label>
            Display name
            <input
              value={current.name}
              required
              maxLength={80}
              onChange={(e) => setDraft({ ...current, name: e.target.value })}
            />
          </label>
          <label>
            About you
            <textarea
              value={current.bio}
              maxLength={320}
              onChange={(e) => setDraft({ ...current, bio: e.target.value })}
            />
          </label>
          <label>
            Language preference
            <select
              value={current.locale}
              onChange={(e) => setDraft({ ...current, locale: e.target.value })}
            >
              <option value="en">English</option>
              <option value="en-GB">English (UK)</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
            </select>
          </label>
          <button className="primary" disabled={action.busy}>
            Save profile
          </button>
        </form>
      )}
      <section className="card workspace-form">
        <h3>Import and export</h3>
        <button
          className="outline"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const items = await request<unknown>("/export");
              const blob = new Blob([JSON.stringify(items, null, 2)], {
                type: "application/json",
              });
              const link = document.createElement("a");
              link.href = URL.createObjectURL(blob);
              link.download = "workout-export.json";
              link.click();
              window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            })
          }
        >
          Export my data
        </button>
        <label>
          Preview a workout export
          <input
            type="file"
            accept=".json,application/json"
            disabled={action.busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.currentTarget.value = "";
              if (file)
                void action.run(async () => {
                  setPreview(null);
                  if (file.size > 1_950_000)
                    throw new Error("Choose an export under 1.95 MB.");
                  setPreview(
                    await request(
                      "/import/preview",
                      JSON.parse(await file.text()),
                    ),
                  );
                });
            }}
          />
        </label>
        {preview && (
          <>
            <p>
              {preview.workouts.length} private workouts ready ·{" "}
              {preview.skipped} skipped
            </p>
            <p>
              {preview.routines.length} routines · {preview.catalog.length}{" "}
              custom exercises · {preview.measurements.length} measurements in
              the file
            </p>
            {preview.workouts.slice(0, 10).map((item) => (
              <p key={item.id}>{item.workout.title}</p>
            ))}
            <button
              className="primary"
              disabled={
                action.busy ||
                !(
                  preview.workouts.length +
                  preview.routines.length +
                  preview.catalog.length +
                  preview.measurements.length
                )
              }
              onClick={() =>
                void action.run(async () => {
                  const { routines, catalog, measurements } = preview;
                  await request("/import/library", {
                    routines,
                    catalog,
                    measurements,
                  });
                  for (const row of preview.workouts) {
                    const input: SaveInput = {
                      ...row,
                      mutationId: row.id,
                      expectedRevision: 0,
                    };
                    await request("/workouts/commit", input);
                  }
                  setPreview(null);
                }, "Import complete.")
              }
            >
              Confirm import
            </button>
          </>
        )}
      </section>
    </div>
  );
}
