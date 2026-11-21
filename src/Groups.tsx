import { useRef, useState } from "react";
import { addDays, localDay, monday } from "../shared/scoring";
import { request, query, type WorkspaceHome } from "./workspace-api";
import { useResource } from "./Research";
import { Icon } from "./workout-ui";

type Overview = {
  group: {
    id: string;
    name: string;
    description: string;
    owner_id: string | null;
    timezone: string;
    avatar_version: number;
  };
  isOwner: boolean;
  sharing: boolean;
  week: { start: string; end: string; current: boolean };
  ranking: {
    id: string;
    name: string;
    isMe: boolean;
    workouts: number;
    sets: number;
    relative: number | null;
    volumeKg: number | null;
  }[];
  hidden: number;
  members: {
    id: string;
    name: string;
    isMe: boolean;
    isOwner: boolean;
    sharing: boolean;
  }[];
  activity: {
    user_id: string;
    name: string;
    start_time: string;
    title: string | null;
  }[];
};
type Board = "relative" | "workouts";

const tints = ["#f6d9cc", "#e4dcf4", "#d8e7f4", "#dbead7", "#f4e5c4"];
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}
export function GroupAvatar({
  id,
  name,
  version,
  size = 48,
}: {
  id: string;
  name: string;
  version: number;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (version > 0 && !failed)
    return (
      <img
        className="group-avatar"
        style={style}
        src={`/api/app/v2/groups/avatar/${id}?v=${version}`}
        alt=""
        onError={() => setFailed(true)}
      />
    );
  const tint =
    tints[[...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 5];
  return (
    <span
      className="group-avatar"
      style={{ ...style, background: tint, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials(name) || "G"}
    </span>
  );
}

// Crops to a square and shrinks, so phone photos upload quickly and stay small.
async function squarePicture(file: File, edge = 512): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = edge;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare the picture.");
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    edge,
    edge,
  );
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The picture could not be prepared.")),
      "image/jpeg",
      0.86,
    ),
  );
}
function useRunner(changed: () => void) {
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
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { error, notice, busy, run };
}
const monthDay = (day: string) =>
  new Date(day + "T12:00:00Z").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const volume = (kg: number, unit: string) =>
  Math.round(kg / (unit === "lbs" ? 0.45359237 : 1)).toLocaleString() +
  " " +
  unit;

export function MyGroups({
  home,
  owner,
  unit,
  revision,
  refresh,
}: {
  home: WorkspaceHome;
  owner: string;
  unit: string;
  revision: number;
  refresh: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null),
    [name, setName] = useState("");
  const [bump, setBump] = useState(0);
  const counts = useResource<{
    items: { group_id: string; members: number }[];
  }>("/groups/summary", revision + bump);
  const create = useRunner(() => {
    refresh();
    setBump((n) => n + 1);
  });
  const current = home.groups.find((group) => group.id === open);
  if (current)
    return (
      <GroupDetail
        key={current.id}
        id={current.id}
        home={home}
        owner={owner}
        unit={unit}
        revision={revision}
        back={() => setOpen(null)}
        changed={() => {
          refresh();
          setBump((n) => n + 1);
        }}
      />
    );
  return (
    <div className="train-stack">
      {home.groups.length ? (
        <ul className="group-list">
          {home.groups.map((group) => {
            const members = counts.value?.items.find(
              (x) => x.group_id === group.id,
            )?.members;
            return (
              <li key={group.id}>
                <button
                  className="group-card"
                  onClick={() => setOpen(group.id)}
                >
                  <GroupAvatar
                    key={group.avatar_version}
                    id={group.id}
                    name={group.name}
                    version={group.avatar_version ?? 0}
                    size={56}
                  />
                  <span className="group-card-text">
                    <strong>{group.name}</strong>
                    <small>
                      {members === undefined
                        ? "Members"
                        : members + (members === 1 ? " member" : " members")}
                      {group.owner_id === owner ? " · You own this group" : ""}
                    </small>
                  </span>
                  <Icon name="arrow" size={18} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="card">
          <h3>Start your first group</h3>
          <p className="muted">
            Invite friends, then see who lifted the most for their body weight
            each week.
          </p>
        </section>
      )}
      <form
        className="card workspace-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create.run(async () => {
            const made = await request<{ id: string }>("/groups", {
              name,
              timezone: home.settings.timezone,
            });
            setName("");
            setOpen(made.id);
          });
        }}
      >
        <h3>Create a group</h3>
        <label>
          Group name
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="primary" disabled={create.busy}>
          Create group
        </button>
        {create.error && (
          <div className="alert error" role="alert">
            {create.error}
          </div>
        )}
      </form>
    </div>
  );
}

function GroupDetail({
  id,
  home,
  owner,
  unit,
  revision,
  back,
  changed,
}: {
  id: string;
  home: WorkspaceHome;
  owner: string;
  unit: string;
  revision: number;
  back: () => void;
  changed: () => void;
}) {
  const [week, setWeek] = useState<string | undefined>(),
    [board, setBoard] = useState<Board>("relative"),
    [local, setLocal] = useState(0),
    [editing, setEditing] = useState(false),
    [email, setEmail] = useState(""),
    [link, setLink] = useState(""),
    [draftName, setDraftName] = useState(""),
    [draftAbout, setDraftAbout] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const data = useResource<Overview>(
    query("/groups/overview", { id, week }),
    revision + local,
  );
  const action = useRunner(() => {
    setLocal((n) => n + 1);
    changed();
  });
  const view = data.value;
  if (!view)
    return (
      <div className="train-stack">
        <button className="text-button" onClick={back}>
          All groups
        </button>
        {data.error ? (
          <div className="alert error" role="alert">
            {data.error}
          </div>
        ) : (
          <p className="muted">Loading group…</p>
        )}
      </div>
    );
  const { group } = view;
  const sorted = [...view.ranking].sort((a, b) =>
    board === "relative"
      ? (b.relative ?? -1) - (a.relative ?? -1) || a.name.localeCompare(b.name)
      : b.workouts - a.workouts ||
        b.sets - a.sets ||
        a.name.localeCompare(b.name),
  );
  const score = (x: Overview["ranking"][number]) =>
    board === "relative" ? (x.relative ?? -1) : x.workouts;
  const ranks = sorted.map(
    (x) => sorted.findIndex((y) => score(y) === score(x)) + 1,
  );
  const me = view.ranking.find((x) => x.isMe);
  const editable = view.isOwner && group.owner_id === owner;
  return (
    <div className="train-stack">
      <button className="text-button" onClick={back}>
        All groups
      </button>
      {action.error && (
        <div className="alert error" role="alert">
          {action.error}
        </div>
      )}
      {action.notice && (
        <div className="alert success" role="status">
          {action.notice}
        </div>
      )}
      <section className="card group-head">
        <GroupAvatar
          key={group.avatar_version}
          id={group.id}
          name={group.name}
          version={group.avatar_version}
          size={84}
        />
        <div>
          <h3>{group.name}</h3>
          <p className="muted">
            {view.members.length}{" "}
            {view.members.length === 1 ? "member" : "members"}
          </p>
          {group.description && <p>{group.description}</p>}
        </div>
        {editable && (
          <div className="workspace-actions">
            <input
              ref={picker}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void action.run(async () => {
                  const picture = await squarePicture(file);
                  const response = await fetch(
                    "/api/app/v2" + query("/groups/avatar", { id }),
                    {
                      method: "POST",
                      credentials: "same-origin",
                      headers: {
                        "Content-Type": picture.type,
                        "X-Workout-Request": "1",
                      },
                      body: picture,
                    },
                  );
                  if (!response.ok)
                    throw new Error(
                      ((await response.json()) as { error?: string }).error ??
                        "The picture could not be saved.",
                    );
                }, "Group photo updated.");
              }}
            />
            <button
              className="outline"
              disabled={action.busy}
              onClick={() => picker.current?.click()}
            >
              {group.avatar_version ? "Change photo" : "Add photo"}
            </button>
            <button
              className="outline"
              onClick={() => {
                setDraftName(group.name);
                setDraftAbout(group.description);
                setEditing(!editing);
              }}
            >
              Edit details
            </button>
          </div>
        )}
      </section>
      {editing && (
        <form
          className="card workspace-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await request("/groups/profile", {
                id,
                name: draftName,
                description: draftAbout,
              });
              setEditing(false);
            }, "Group updated.");
          }}
        >
          <label>
            Group name
            <input
              required
              maxLength={80}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
          </label>
          <label>
            About this group
            <textarea
              maxLength={240}
              rows={3}
              value={draftAbout}
              onChange={(e) => setDraftAbout(e.target.value)}
            />
          </label>
          <button className="primary" disabled={action.busy}>
            Save details
          </button>
        </form>
      )}
      <section className="card">
        <div className="group-ranking-head">
          <h3>Ranking</h3>
          <nav className="segment" aria-label="Ranking by">
            <button
              aria-current={board === "relative" ? "true" : undefined}
              onClick={() => setBoard("relative")}
            >
              Strength score
            </button>
            <button
              aria-current={board === "workouts" ? "true" : undefined}
              onClick={() => setBoard("workouts")}
            >
              Workouts
            </button>
          </nav>
        </div>
        <div className="week-switch">
          <button
            className="text-button"
            aria-label="Previous week"
            onClick={() => setWeek(addDays(view.week.start, -7))}
          >
            ‹
          </button>
          <span>
            {view.week.current ? "This week" : "Week of"} ·{" "}
            {monthDay(view.week.start)} – {monthDay(view.week.end)}
          </span>
          <button
            className="text-button"
            aria-label="Next week"
            disabled={view.week.current}
            onClick={() => {
              const next = addDays(view.week.start, 7);
              const latest = monday(localDay(new Date()));
              setWeek(next >= latest ? undefined : next);
            }}
          >
            ›
          </button>
        </div>
        <table className="rank-table">
          <caption className="sr-only">
            {board === "relative"
              ? "Weekly strength score"
              : "Workouts this week"}
          </caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Player</th>
              <th scope="col">{board === "relative" ? "Score" : "Workouts"}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((x, i) => (
              <tr key={x.id} data-me={x.isMe ? "true" : undefined}>
                <td>{ranks[i]}</td>
                <td>
                  <span className="rank-player">
                    <span className="avatar pale">{x.name[0]}</span>
                    {x.isMe ? "You" : x.name}
                  </span>
                </td>
                <td className="rank-score">
                  {board === "relative"
                    ? x.relative === null
                      ? "—"
                      : x.relative.toFixed(1) + "×"
                    : x.workouts}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="card-note">
          {board === "relative"
            ? "Strength score is the week's lifting volume divided by body weight, so a lighter lifter can beat a heavier one. 12.0× means 12 times body weight lifted."
            : "Workouts logged this week by members who share results."}
          {view.hidden > 0 &&
            ` ${view.hidden} ${view.hidden === 1 ? "member isn't" : "members aren't"} sharing named results.`}
        </p>
        {me && me.relative === null && (
          <p className="muted">
            Add your body weight under Progress → Measurements to get a strength
            score.
          </p>
        )}
        {me?.volumeKg != null && (
          <p className="muted">
            Your volume this week: {volume(me.volumeKg, unit)}.
          </p>
        )}
      </section>
      <section className="card workspace-form">
        <h3>Your results in this group</h3>
        <p className="muted">
          {view.sharing
            ? "Members can see your name, workout count, and strength score. Your body weight and exercises stay private."
            : "Members can't see your results yet. Share them to appear in the ranking."}
        </p>
        <button
          className={view.sharing ? "outline" : "primary"}
          disabled={action.busy}
          onClick={() =>
            void action.run(
              () =>
                request("/groups/consent", {
                  scope: "group",
                  targetId: id,
                  share: !view.sharing,
                  named: true,
                }),
              view.sharing ? "Sharing stopped." : "Results shared.",
            )
          }
        >
          {view.sharing ? "Stop sharing results" : "Share my results"}
        </button>
      </section>
      {editable && (
        <form
          className="card workspace-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const result = await request<{ url: string }>("/groups/invite", {
                groupId: id,
                email,
              });
              setLink(result.url);
              setEmail("");
            }, "Invitation ready. Send the link to your friend.");
          }}
        >
          <h3>Invite a player</h3>
          <label>
            Their Google account email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button className="primary" disabled={action.busy}>
            Create invitation
          </button>
          {link && (
            <div className="invite-link">
              <input
                readOnly
                aria-label="Invitation link"
                value={link}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="outline"
                onClick={() =>
                  void navigator.clipboard?.writeText(link).then(
                    () => undefined,
                    () => undefined,
                  )
                }
              >
                Copy link
              </button>
            </div>
          )}
          <p className="muted">
            The link works once, for 7 days, and only with that Google account.
          </p>
        </form>
      )}
      <section className="card">
        <h3>Members</h3>
        <ul className="member-list">
          {view.members.map((member) => (
            <li key={member.id}>
              <span className="avatar pale">{member.name[0]}</span>
              <strong>{member.isMe ? "You" : member.name}</strong>
              {member.isOwner && <span className="pill">Owner</span>}
              <small className="muted">
                {member.sharing ? "Sharing results" : "Not sharing"}
              </small>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h3>Activity</h3>
        {view.activity.length ? (
          <ul className="member-list">
            {view.activity.map((item, i) => (
              <li key={item.user_id + item.start_time + i}>
                <span>
                  <strong>{item.user_id === owner ? "You" : item.name}</strong>{" "}
                  logged {item.title ?? "a workout"}
                </span>
                <small className="muted">
                  {new Date(item.start_time).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            Workouts shared with this group will appear here.
          </p>
        )}
      </section>
      {group.owner_id && group.owner_id !== owner && (
        <button
          className="text-button"
          disabled={action.busy}
          onClick={() => {
            if (window.confirm("Leave " + group.name + "?"))
              void action.run(async () => {
                await request("/groups/leave", { id });
                back();
              });
          }}
        >
          Leave group
        </button>
      )}
    </div>
  );
}
