import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "./index";
import { canonical, type Workout } from "../shared/import";
import { isManualWorkout, manualPrefix } from "../shared/training";
import { covered } from "../shared/scoring";
import { strava } from "./strava";
import { push, sendInboxNotification } from "./push";
import {
  catalog,
  exerciseInput,
  defaults,
  measurementKinds,
  personalRecords,
  preferencesInput,
  routineInput,
  summarize,
  toLegacyWorkout,
  validMovement,
  validSetValues,
  validRoutineMovement,
  workoutInput,
  metricKey,
  trainingDay as localDay,
  trainingTime as boundary,
  type SavedWorkout,
  type SetValues,
  type TrainingPreferences,
  type WorkoutEntry,
} from "../shared/workspace";

export const workspace = new Hono<AppEnv>();
workspace.route("/integrations/strava", strava);
workspace.route("/push", push);
type Ctx = Context<AppEnv>;
type Value = string | number | null;
type Group = {
  id: string;
  name: string;
  timezone: string;
  owner_id: string | null;
};
type WorkoutRow = {
  user_id: string;
  data: string;
  content: string | null;
  revision: number | null;
  annotation: string | null;
};
const stmt = (c: Ctx, query: string, ...values: Value[]) =>
  c.env.DB.prepare(query).bind(...values);
const first = <T>(c: Ctx, query: string, ...values: Value[]) =>
  stmt(c, query, ...values).first<T>();
const all = async <T>(c: Ctx, query: string, ...values: Value[]) =>
  (await stmt(c, query, ...values).all<T>()).results;
const me = (c: Ctx) => c.get("user").id;
const now = () => new Date().toISOString();
const reject = (status: 400 | 403 | 404 | 409, message: string): never => {
  throw new HTTPException(status, { message });
};
const members = `WITH members AS (
  SELECT group_id,user_id FROM training_group_members
  UNION SELECT 'original',user_id FROM player_slots
  WHERE user_id IN (SELECT id FROM users WHERE (?=0 OR login_key LIKE 'google:%'))
)`;
const google = (c: Ctx) => Number(c.env.AUTH_PROVIDER === "google");
const mutual = (a: string, b: string) => `EXISTS (SELECT 1 FROM sharing s
  WHERE s.a_consent=1 AND s.b_consent=1 AND ((s.a=${a} AND s.b=${b}) OR (s.b=${a} AND s.a=${b})))`;
const connected = (a: string, b: string) => `EXISTS (SELECT 1
  FROM training_connections x JOIN training_connections y ON y.user_id=x.target_id AND y.target_id=x.user_id
  WHERE x.user_id=${a} AND x.target_id=${b})`;
const groups = (c: Ctx) =>
  all<Group>(
    c,
    `${members} SELECT g.* FROM training_groups g JOIN members m ON m.group_id=g.id WHERE m.user_id=? ORDER BY g.name`,
    google(c),
    me(c),
  );
const membership = (c: Ctx, group: string, user = me(c)) =>
  first<Group>(
    c,
    `${members} SELECT g.* FROM training_groups g JOIN members m ON m.group_id=g.id WHERE m.group_id=? AND m.user_id=?`,
    google(c),
    group,
    user,
  );
const pref = async (c: Ctx, user = me(c)): Promise<TrainingPreferences> => {
  const row = await first<{ content: string }>(
    c,
    "SELECT content FROM training_preferences WHERE user_id=?",
    user,
  );
  return row ? preferencesInput.parse(JSON.parse(row.content)) : defaults;
};
const readable = `(w.user_id=viewer.id
  OR (COALESCE(d.audience,audience.audience,'connections')='connections' AND ${mutual("w.user_id", "viewer.id")})
  OR ((d.audience='connections' OR audience.audience='connections') AND ${connected("w.user_id", "viewer.id")})
  OR (d.audience='group' AND EXISTS(SELECT 1 FROM members a JOIN members b ON a.group_id=b.group_id
      WHERE a.group_id=d.group_id AND a.user_id=w.user_id AND b.user_id=viewer.id)))`;
const columns = `w.user_id,w.data,d.content,d.revision`;
const table = `workouts w LEFT JOIN workout_details d ON d.user_id=w.user_id AND d.workout_id=w.source_id
  LEFT JOIN workout_import_annotations audience ON audience.user_id=w.user_id AND audience.workout_id=w.source_id`;
const annotation = `json_object('title',audience.title,'note',audience.note,'gym',audience.gym,'audience',audience.audience)`;
function entry(row: WorkoutRow): WorkoutEntry {
  const workout = JSON.parse(row.data) as Workout;
  return {
    owner: row.user_id,
    source: isManualWorkout(workout.id) ? "native" : "hevy",
    workout,
    details: row.content ? JSON.parse(row.content) : null,
    revision: row.revision ?? 0,
    annotation: row.annotation ? JSON.parse(row.annotation) : null,
  };
}
const ownEntries = async (c: Ctx, user: string) =>
  (
    await all<WorkoutRow>(
      c,
      `SELECT ${columns},
  CASE WHEN audience.workout_id IS NOT NULL THEN ${annotation} END annotation
  FROM ${table} WHERE w.user_id=? AND COALESCE(d.deleted,0)=0 ORDER BY w.start_time DESC,w.source_id DESC`,
      user,
    )
  ).map(entry);
async function analysisEntries(c: Ctx, user: string) {
  const [entries, links, duplicates] = await Promise.all([
    ownEntries(c, user),
    all<{
      provider_template: string;
      equipment: string;
      movement_type: string;
      canonical_id: string;
    }>(
      c,
      "SELECT provider_template,equipment,movement_type,canonical_id FROM workout_variant_links WHERE user_id=?",
      user,
    ),
    all<{ native_id: string; hevy_id: string; kept_id: string }>(
      c,
      "SELECT native_id,hevy_id,kept_id FROM workout_duplicate_reviews WHERE user_id=?",
      user,
    ),
  ]);
  const present = new Set(entries.map((e) => e.workout.id));
  const suppressed = new Set(
    duplicates
      .filter((x) => present.has(x.kept_id))
      .map((x) => (x.kept_id === x.native_id ? x.hevy_id : x.native_id)),
  );
  const mapping = new Map(
    links.map((l) => [
      metricKey(l.provider_template, l.equipment, l.movement_type),
      l.canonical_id,
    ]),
  );
  return entries
    .filter((e) => !suppressed.has(e.workout.id))
    .map((e) =>
      e.source === "native"
        ? e
        : {
            ...e,
            workout: {
              ...e.workout,
              exercises: e.workout.exercises.map((exercise) => {
                const canonical = mapping.get(
                  metricKey(
                    exercise.exercise_template_id,
                    exercise.equipment,
                    exercise.exercise_type,
                  ),
                );
                return canonical
                  ? { ...exercise, exercise_template_id: canonical }
                  : exercise;
              }),
            },
          },
    );
}
const uuid = z.uuid();
const day = z.iso.date();
const iso = z.iso.datetime({ offset: true });
const network = `${members}, visible AS (
  SELECT DISTINCT m.user_id FROM members p JOIN members m ON p.group_id=m.group_id WHERE p.user_id=?2
  UNION SELECT CASE WHEN a=?2 THEN b ELSE a END FROM sharing WHERE (a=?2 OR b=?2) AND a_consent=1 AND b_consent=1
  UNION SELECT tc.target_id FROM training_connections tc WHERE tc.user_id=?2 AND ${connected("?2", "tc.target_id")}
)`;
const visibilityQuery = `${members}, viewer AS (SELECT ? AS id)
  SELECT ${columns}, CASE WHEN w.user_id=viewer.id AND audience.workout_id IS NOT NULL THEN ${annotation} END annotation
  FROM ${table} CROSS JOIN viewer WHERE COALESCE(d.deleted,0)=0 AND ${readable}`;

workspace.get("/home", async (c) => {
  const id = me(c);
  const [settings, routines, team, people, custom] = await Promise.all([
    pref(c),
    all<{ content: string }>(
      c,
      "SELECT content FROM routines WHERE user_id=? ORDER BY updated_at DESC,id",
      id,
    ),
    groups(c),
    all<{ id: string; name: string }>(
      c,
      `${network}
      SELECT u.id,u.name FROM users u JOIN visible v ON u.id=v.user_id WHERE u.id<>?2 AND (?1=0 OR u.login_key LIKE 'google:%') ORDER BY u.name`,
      google(c),
      id,
    ),
    all<{ content: string }>(
      c,
      "SELECT content FROM exercise_catalog WHERE user_id=? ORDER BY id",
      id,
    ),
  ]);
  const permissions = await all<{
    scope: string;
    target_id: string;
    named: number;
  }>(
    c,
    "SELECT scope,target_id,named FROM metric_permissions WHERE user_id=?",
    id,
  );
  return c.json({
    settings,
    routines: routines.map((r) => routineInput.parse(JSON.parse(r.content))),
    groups: team,
    people,
    permissions,
    catalog: [
      ...catalog,
      ...custom.map((r) => exerciseInput.parse(JSON.parse(r.content))),
    ],
  });
});
workspace.get("/network", async (c) => {
  const search = z
    .string()
    .trim()
    .max(80)
    .parse(c.req.query("search") ?? "");
  const items = await all<{
    id: string;
    name: string;
    bio: string;
    outgoing: number;
    incoming: number;
  }>(
    c,
    `${network}
    SELECT u.id,u.name,COALESCE(p.bio,'') bio,
      EXISTS(SELECT 1 FROM training_connections WHERE user_id=?2 AND target_id=u.id) AS outgoing,
      EXISTS(SELECT 1 FROM training_connections WHERE user_id=u.id AND target_id=?2) AS incoming
    FROM visible v JOIN users u ON u.id=v.user_id LEFT JOIN training_profiles p ON p.user_id=u.id
    WHERE u.id<>?2 AND (?1=0 OR u.login_key LIKE 'google:%') AND instr(lower(u.name),lower(?3))>0
    ORDER BY u.name,u.id LIMIT 50`,
    google(c),
    me(c),
    search,
  );
  return c.json({ items });
});
workspace.post("/network/connect", async (c) => {
  const { target, consent } = z
    .object({ target: z.string().max(80), consent: z.boolean() })
    .parse(await c.req.json());
  const owner = me(c);
  if (consent) {
    if (
      target === owner ||
      !(await first(
        c,
        `${network} SELECT 1 FROM visible WHERE user_id=?3`,
        google(c),
        owner,
        target,
      ))
    )
      return reject(404, "Profile unavailable.");
    await stmt(
      c,
      "INSERT OR IGNORE INTO training_connections VALUES(?,?)",
      owner,
      target,
    ).run();
  } else
    await stmt(
      c,
      "DELETE FROM training_connections WHERE user_id=? AND target_id=?",
      owner,
      target,
    ).run();
  return c.json({ ok: true });
});

workspace.get("/run-tutorial/:card", async (c) => {
  const card = c.req.param("card");
  if (card !== "summary" && card !== "splits") return c.notFound();
  const image = await c.env.MEDIA?.get(`tutorial/strava/${card}.jpg`);
  if (!image) return c.notFound();
  return new Response(image.body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
    },
  });
});
workspace.get("/workouts", async (c) => {
  const query = z
    .object({
      owner: z.string().max(80).optional(),
      after: iso.optional(),
      key: z.string().max(260).optional(),
      feed: z.enum(["0", "1"]).optional(),
      runGroup: z.string().min(1).max(80).optional(),
      start: day.optional(),
      end: day.optional(),
    })
    .parse(c.req.query());
  const tz = query.start || query.end ? (await pref(c)).timezone : "UTC";
  const owner = query.owner ?? me(c);
  if (query.runGroup && !(await membership(c, query.runGroup)))
    return reject(404, "Group unavailable.");
  const result = await all<WorkoutRow>(
    c,
    `${visibilityQuery}
    AND (?=1 OR w.user_id=?) AND (?=0 OR d.audience IN ('group','connections'))
    AND (? IS NULL OR (d.audience='group' AND d.group_id=? AND json_type(d.content,'$.stravaRun')='object'))
    AND (? IS NULL OR w.start_time<? OR (w.start_time=? AND (w.source_id||':'||w.user_id)<?))
    AND (? IS NULL OR w.start_time>=?) AND (? IS NULL OR w.start_time<?)
    ORDER BY w.start_time DESC,(w.source_id||':'||w.user_id) DESC LIMIT 26`,
    google(c),
    me(c),
    Number(query.feed === "1" || !!query.runGroup),
    owner,
    Number(query.feed === "1"),
    query.runGroup ?? null,
    query.runGroup ?? null,
    query.after ?? null,
    query.after ?? null,
    query.after ?? null,
    query.key ?? null,
    query.start ?? null,
    query.start ? boundary(query.start, tz) : null,
    query.end ?? null,
    query.end ? boundary(plusDays(query.end, 1), tz) : null,
  );
  const items = result.slice(0, 25).map(entry);
  const last = items.at(-1);
  return c.json({
    items,
    next:
      result.length > 25 && last
        ? {
            after: last.workout.start_time,
            key: last.workout.id + ":" + last.owner,
          }
        : null,
  });
});
workspace.get("/workouts/item", async (c) => {
  const input = z
    .object({ owner: z.string().max(80), id: z.string().max(160) })
    .parse(c.req.query());
  const row = await first<WorkoutRow>(
    c,
    `${visibilityQuery} AND w.user_id=? AND w.source_id=?`,
    google(c),
    me(c),
    input.owner,
    input.id,
  );
  if (!row) return reject(404, "Workout unavailable.");
  return c.json(entry(row));
});

workspace.post("/workouts/previous", async (c) => {
  const input = z
    .object({
      variants: z.array(z.string().max(320)).min(1).max(32),
      exclude: uuid,
    })
    .parse(await c.req.json());
  const results = new Map(
    input.variants.map((key) => [key, new Map<number, SetValues>()]),
  );
  const workouts = await analysisEntries(c, me(c));
  for (const item of workouts) {
    if (item.workout.id === manualPrefix + input.exclude) continue;
    for (const exercise of item.workout.exercises) {
      const previous = results.get(
        metricKey(
          exercise.exercise_template_id,
          exercise.equipment,
          exercise.exercise_type,
        ),
      );
      if (!previous) continue;
      for (const set of exercise.sets) {
        if (set.type === "warmup" || set.index >= 50 || previous.has(set.index))
          continue;
        const extra = item.details?.movements[exercise.index]?.sets[set.index];
        const values = {
          reps: set.reps,
          weightKg: set.weight_kg,
          seconds: extra?.seconds ?? null,
          meters: extra?.meters ?? null,
        };
        if (validSetValues(exercise.exercise_type, values))
          previous.set(set.index, values);
      }
    }
  }
  return c.json({
    previous: Object.fromEntries(
      [...results].map(([key, sets]) => [key, Object.fromEntries(sets)]),
    ),
  });
});
workspace.post("/workouts/import-annotation", async (c) => {
  const input = z
    .object({
      id: z.string().min(1).max(160),
      title: z.string().trim().max(100),
      note: z.string().trim().max(2500),
      gym: z.string().trim().max(100),
      audience: z.enum(["private", "connections"]),
    })
    .parse(await c.req.json());
  const owner = me(c);
  if (isManualWorkout(input.id))
    return reject(400, "Annotations are for imported workouts.");
  const saved = await stmt(
    c,
    `INSERT INTO workout_import_annotations(user_id,workout_id,title,note,gym,audience)
    SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM workouts WHERE user_id=? AND source_id=?)
    ON CONFLICT(user_id,workout_id) DO UPDATE SET title=excluded.title,note=excluded.note,gym=excluded.gym,audience=excluded.audience`,
    owner,
    input.id,
    input.title,
    input.note,
    input.gym,
    input.audience,
    owner,
    input.id,
  ).run();
  if (!saved.meta.changes) return reject(404, "Workout unavailable.");
  return c.json({ ok: true });
});

const writeInput = z.object({
  id: uuid,
  mutationId: uuid,
  expectedRevision: z.number().int().nonnegative(),
});
const commitInput = writeInput.extend({
  workout: workoutInput,
  routine: routineInput.optional(),
  exportToStrava: z.boolean().optional(),
});
type Receipt = { fingerprint: string; revision: number };
async function hashText(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function checkWorkout(w: SavedWorkout) {
  if (
    Date.parse(w.finishedAt) < Date.parse(w.startedAt) ||
    Date.parse(w.finishedAt) > Date.now() + 120_000
  )
    reject(400, "Check the workout date and duration.");
  if (
    !w.movements.every(validMovement) ||
    new Set(w.movements.map((m) => m.rowId)).size !== w.movements.length
  )
    reject(400, "Complete the required values for each saved set.");
  if (w.stravaRun) {
    const movement = w.movements[0];
    const set = movement?.sets[0];
    if (
      w.movements.length !== 1 ||
      movement.id !== "builtin:run" ||
      movement.sets.length !== 1 ||
      set.warmup ||
      !set.meters ||
      !set.seconds ||
      Date.parse(w.finishedAt) - Date.parse(w.startedAt) !== set.seconds * 1000
    )
      reject(400, "Check the imported run distance and time.");
  }
}
const ownerReceipt = (c: Ctx, id: string, mutation: string) =>
  first<Receipt>(
    c,
    "SELECT revision,fingerprint FROM workout_mutations WHERE user_id=? AND mutation_id=?",
    id,
    mutation,
  );
async function workoutConflict(c: Ctx, id: string, workoutId: string) {
  const row = await first<WorkoutRow & { deleted: number }>(
    c,
    `SELECT d.user_id,d.revision,d.deleted,d.content,w.data,NULL AS annotation
    FROM workout_details d LEFT JOIN workouts w ON w.user_id=d.user_id AND w.source_id=d.workout_id
    WHERE d.user_id=? AND d.workout_id=?`,
    id,
    workoutId,
  );
  return c.json(
    {
      error: "This workout changed on another device.",
      revision: row?.revision ?? 0,
      deleted: !!row?.deleted,
      current: row?.data && !row.deleted ? entry(row) : null,
    },
    409,
  );
}
async function saveWorkout(c: Ctx, remove: boolean) {
  const body: unknown = await c.req.json();
  const input = writeInput.parse(body);
  const extra = remove ? null : commitInput.parse(body);
  const id = me(c);
  const workoutId = manualPrefix + input.id;
  const stamp = now();
  const digest = await hashText(JSON.stringify({ remove, input, extra }));
  const replay = await ownerReceipt(c, id, input.mutationId);
  if (replay) {
    if (replay.fingerprint !== digest)
      reject(409, "This request ID was already used.");
    if (remove) cleanWorkoutMedia(c, id);
    return c.json({ id: workoutId, revision: replay.revision });
  }
  const current = await first<{ revision: number; deleted: number }>(
    c,
    "SELECT revision,deleted FROM workout_details WHERE user_id=? AND workout_id=?",
    id,
    workoutId,
  );
  if (current?.deleted || (current?.revision ?? 0) !== input.expectedRevision)
    return workoutConflict(c, id, workoutId);
  if (extra) {
    checkWorkout(extra.workout);
    if (
      extra.workout.audience === "group" &&
      (!extra.workout.groupId || !(await membership(c, extra.workout.groupId)))
    )
      reject(403, "Choose a group you belong to.");
    const known = catalog.filter((e) =>
      extra.workout.movements.some((m) => m.id === e.id),
    );
    const custom = await all<{ content: string }>(
      c,
      "SELECT content FROM exercise_catalog WHERE user_id=?",
      id,
    );
    const identities = new Map(
      [
        ...known,
        ...custom.map((x) => exerciseInput.parse(JSON.parse(x.content))),
      ].map((e) => [e.id, e]),
    );
    for (const exercise of extra.workout.movements) {
      const existing = identities.get(exercise.id);
      if (
        existing &&
        (existing.equipment !== exercise.equipment ||
          existing.type !== exercise.type)
      )
        reject(400, "Exercise equipment or measurement type changed.");
      if (!existing) {
        const allowed = await first(
          c,
          `SELECT 1 FROM exercises WHERE user_id=? AND template_id=? AND equipment=? AND exercise_type=? LIMIT 1`,
          id,
          exercise.id,
          exercise.equipment,
          exercise.type,
        );
        if (!allowed) reject(400, "Choose an exercise from your library.");
      }
    }
    if (extra.routine && !extra.routine.movements.every(validRoutineMovement))
      reject(400, "Check routine values.");
  }
  const attempt = crypto.randomUUID();
  const revision = input.expectedRevision + 1;
  const guard =
    "EXISTS(SELECT 1 FROM workout_mutations WHERE user_id=? AND mutation_id=? AND attempt=?)";
  const gate = [id, input.mutationId, attempt] as const;
  const w = extra?.workout;
  const batch = [
    stmt(
      c,
      `INSERT OR IGNORE INTO workout_mutations(user_id,mutation_id,attempt,fingerprint,revision)
      SELECT ?,?,?,?,?
      WHERE COALESCE((SELECT revision FROM workout_details WHERE user_id=? AND workout_id=?),0)=?
      AND NOT EXISTS (SELECT 1 FROM workout_details WHERE user_id=? AND workout_id=? AND deleted=1)
      AND (?=0 OR EXISTS(SELECT 1 FROM workouts WHERE user_id=? AND source_id=?))`,
      id,
      input.mutationId,
      attempt,
      digest,
      revision,
      id,
      workoutId,
      input.expectedRevision,
      id,
      workoutId,
      +remove,
      id,
      workoutId,
    ),
    stmt(
      c,
      `INSERT INTO workout_details(user_id,workout_id,revision,audience,group_id,content,deleted)
      SELECT ?,?,?,?,?,?,? WHERE ${guard}
      ON CONFLICT(user_id,workout_id) DO UPDATE SET revision=excluded.revision,audience=excluded.audience,
      group_id=excluded.group_id,content=excluded.content,deleted=excluded.deleted`,
      id,
      workoutId,
      revision,
      w?.audience ?? "private",
      w?.audience === "group" ? w.groupId : null,
      w ? JSON.stringify(w) : "null",
      +remove,
      ...gate,
    ),
    stmt(
      c,
      `DELETE FROM exercises WHERE user_id=? AND workout_id=? AND ${guard}`,
      id,
      workoutId,
      ...gate,
    ),
  ];
  if (w) {
    const projection = toLegacyWorkout(workoutId, w, stamp);
    batch.push(
      stmt(
        c,
        `INSERT INTO workouts(user_id,source_id,updated_at,start_time,data) SELECT ?,?,?,?,? WHERE ${guard}
        ON CONFLICT(user_id,source_id) DO UPDATE SET updated_at=excluded.updated_at,start_time=excluded.start_time,data=excluded.data`,
        id,
        workoutId,
        stamp,
        projection.start_time,
        canonical(projection),
        ...gate,
      ),
      stmt(
        c,
        `INSERT INTO exercises SELECT w.user_id,w.source_id,e.key,json_extract(e.value,'$.exercise_template_id'),
        json_extract(e.value,'$.title'),json_extract(e.value,'$.equipment'),json_extract(e.value,'$.exercise_type')
        FROM workouts w,json_each(w.data,'$.exercises') e WHERE w.user_id=? AND w.source_id=? AND ${guard}`,
        id,
        workoutId,
        ...gate,
      ),
      stmt(
        c,
        `INSERT INTO sets SELECT w.user_id,w.source_id,e.key,s.key,json_extract(s.value,'$.type'),
        json_extract(s.value,'$.reps'),json_extract(s.value,'$.weight_kg') FROM workouts w,json_each(w.data,'$.exercises') e,
        json_each(e.value,'$.sets') s WHERE w.user_id=? AND w.source_id=? AND ${guard}`,
        id,
        workoutId,
        ...gate,
      ),
    );
    if (extra?.routine)
      batch.push(
        stmt(
          c,
          `UPDATE routines SET content=json_set(?, '$.title', title),updated_at=? WHERE user_id=? AND id=? AND ${guard}`,
          JSON.stringify(extra.routine),
          stamp,
          id,
          extra.routine.id,
          ...gate,
        ),
      );
    if (extra?.exportToStrava && !input.expectedRevision)
      batch.push(
        stmt(
          c,
          `INSERT OR IGNORE INTO training_exports
      SELECT ?,?,'pending',NULL,? WHERE ${guard}`,
          id,
          workoutId,
          stamp,
          ...gate,
        ),
      );
  } else
    batch.push(
      stmt(
        c,
        `DELETE FROM workouts WHERE user_id=? AND source_id=? AND ${guard}`,
        id,
        workoutId,
        ...gate,
      ),
      stmt(
        c,
        `DELETE FROM workout_reactions WHERE owner_id=? AND workout_id=? AND ${guard}`,
        id,
        workoutId,
        ...gate,
      ),
      stmt(
        c,
        `DELETE FROM workout_comments WHERE owner_id=? AND workout_id=? AND ${guard}`,
        id,
        workoutId,
        ...gate,
      ),
    );
  await c.env.DB.batch(batch);
  const receipt = await ownerReceipt(c, id, input.mutationId);
  if (!receipt || receipt.fingerprint !== digest)
    return workoutConflict(c, id, workoutId);
  if (remove) cleanWorkoutMedia(c, id);
  return c.json({ id: workoutId, revision: receipt.revision });
}
workspace.post("/workouts/commit", (c) => saveWorkout(c, false));
workspace.post("/workouts/delete", (c) => saveWorkout(c, true));

workspace.post("/routines", async (c) => {
  const routine = routineInput.parse(await c.req.json());
  if (!routine.movements.every(validRoutineMovement))
    reject(400, "Check your routine set values.");
  await stmt(
    c,
    `INSERT INTO routines(user_id,id,title,content,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(user_id,id) DO UPDATE SET title=excluded.title,content=excluded.content,updated_at=excluded.updated_at`,
    me(c),
    routine.id,
    routine.title,
    JSON.stringify(routine),
    now(),
  ).run();
  return c.json({ ok: true });
});
workspace.post("/routines/program", async (c) => {
  const { routines } = z
    .object({ routines: z.array(routineInput).min(1).max(7) })
    .parse(await c.req.json());
  if (routines.some((r) => !r.movements.every(validRoutineMovement)))
    reject(400, "Check your routine set values.");
  const stamp = now();
  await c.env.DB.batch(
    routines.map((r) =>
      stmt(
        c,
        "INSERT OR IGNORE INTO routines VALUES(?,?,?,?,?)",
        me(c),
        r.id,
        r.title,
        JSON.stringify(r),
        stamp,
      ),
    ),
  );
  return c.json({ ok: true });
});
workspace.post("/routines/delete", async (c) => {
  const { id } = z.object({ id: uuid }).parse(await c.req.json());
  await stmt(
    c,
    "DELETE FROM routines WHERE user_id=? AND id=?",
    me(c),
    id,
  ).run();
  return c.json({ ok: true });
});
workspace.post("/catalog", async (c) => {
  const item = exerciseInput.parse(await c.req.json());
  if (
    !item.id.startsWith("custom:") ||
    !uuid.safeParse(item.id.slice(7)).success
  )
    reject(400, "Invalid custom exercise ID.");
  await stmt(
    c,
    `INSERT INTO exercise_catalog(user_id,id,content) VALUES(?,?,?)
    ON CONFLICT(user_id,id) DO NOTHING`,
    me(c),
    item.id,
    JSON.stringify(item),
  ).run();
  return c.json({ ok: true });
});
workspace.post("/preferences", async (c) => {
  const value = preferencesInput.parse(await c.req.json());
  await stmt(
    c,
    `INSERT INTO training_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET content=excluded.content`,
    me(c),
    JSON.stringify(value),
  ).run();
  return c.json({ ok: true });
});
workspace.get("/measurements", async (c) => {
  const items = await all<{ day: string; kind: string; value: number }>(
    c,
    `SELECT day,kind,value FROM measurements WHERE user_id=?
    UNION ALL SELECT w.day,'weight',w.kg FROM weights w WHERE w.user_id=? AND NOT EXISTS
      (SELECT 1 FROM measurements m WHERE m.user_id=w.user_id AND m.day=w.day AND m.kind='weight') ORDER BY day DESC LIMIT 1000`,
    me(c),
    me(c),
  );
  return c.json({ items });
});
workspace.post("/measurements", async (c) => {
  const input = z
    .object({
      day,
      kind: z.enum(measurementKinds),
      value: z.number().positive().max(1000).nullable(),
    })
    .parse(await c.req.json());
  const id = me(c);
  if (input.kind === "bodyFat" && input.value && input.value > 100)
    reject(400, "Enter a body fat percentage between 0 and 100.");
  if (input.value === null)
    await stmt(
      c,
      "DELETE FROM measurements WHERE user_id=? AND day=? AND kind=?",
      id,
      input.day,
      input.kind,
    ).run();
  else
    await stmt(
      c,
      `INSERT INTO measurements VALUES(?,?,?,?) ON CONFLICT(user_id,day,kind) DO UPDATE SET value=excluded.value`,
      id,
      input.day,
      input.kind,
      input.value,
    ).run();
  return c.json({ ok: true });
});

workspace.post("/groups", async (c) => {
  const { name, timezone } = z
    .object({
      name: z.string().trim().min(1).max(80),
      timezone: preferencesInput.shape.timezone,
    })
    .parse(await c.req.json());
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    stmt(
      c,
      "INSERT INTO training_groups VALUES(?,?,?,?)",
      id,
      me(c),
      name,
      timezone,
    ),
    stmt(c, "INSERT INTO training_group_members VALUES(?,?)", id, me(c)),
  ]);
  return c.json({ id });
});
workspace.post("/groups/leave", async (c) => {
  const { id } = z.object({ id: uuid }).parse(await c.req.json());
  const owner = me(c);
  const group = await membership(c, id);
  if (!group) return reject(404, "Group unavailable.");
  if (group.owner_id === owner)
    return reject(409, "The group owner manages this group.");
  await c.env.DB.batch([
    stmt(
      c,
      "DELETE FROM training_group_members WHERE group_id=? AND user_id=?",
      id,
      owner,
    ),
    stmt(
      c,
      "DELETE FROM metric_permissions WHERE user_id=? AND scope='group' AND target_id=?",
      owner,
      id,
    ),
  ]);
  return c.json({ ok: true });
});
workspace.post("/groups/invite", async (c) => {
  const { groupId, email } = z
    .object({ groupId: uuid, email: z.email().max(254) })
    .parse(await c.req.json());
  const group = await membership(c, groupId);
  if (group?.owner_id !== me(c))
    reject(403, "Only the group owner can invite members.");
  const code = crypto.randomUUID() + crypto.randomUUID();
  const hash = await hashText(code);
  const existing = await first<{ user_id: string }>(
    c,
    "SELECT user_id FROM training_profiles WHERE google_email=?",
    email.toLowerCase(),
  );
  const commands = [
    stmt(
      c,
      "INSERT INTO training_group_invites VALUES(?,?,?,?,NULL)",
      hash,
      groupId,
      email.toLowerCase(),
      new Date(Date.now() + 7 * 86400_000).toISOString(),
    ),
  ];
  if (existing)
    commands.push(
      stmt(
        c,
        "INSERT INTO training_inbox VALUES(?,?,?, ?,NULL)",
        crypto.randomUUID(),
        existing.user_id,
        "Private group invitation",
        now(),
      ),
    );
  await c.env.DB.batch(commands);
  if (existing) sendInboxNotification(c, [existing.user_id]);
  return c.json({
    url: new URL("/?groupInvite=" + code, c.env.APP_ORIGIN).href,
  });
});

export async function acceptGroupInvite(
  c: Ctx,
  loginKey: string,
  email: string,
  inviteHash: string,
) {
  const match = await first<{ group_id: string }>(
    c,
    `SELECT group_id FROM training_group_invites
    WHERE token_hash=? AND email=? AND expires_at>? AND used_by IS NULL`,
    inviteHash,
    email,
    now(),
  );
  if (!match) return null;
  const id = crypto.randomUUID();
  const eligible = `EXISTS(SELECT 1 FROM training_group_invites WHERE token_hash=? AND email=? AND expires_at>? AND used_by IS NULL)`;
  const stamp = now();
  await c.env.DB.batch([
    stmt(
      c,
      `INSERT INTO users(id,name,login_key,created_at) SELECT ?,?,?,? WHERE ${eligible}
      ON CONFLICT(login_key) DO NOTHING`,
      id,
      email.split("@")[0].slice(0, 80),
      loginKey,
      stamp,
      inviteHash,
      email,
      stamp,
    ),
    stmt(
      c,
      `INSERT OR IGNORE INTO training_group_members SELECT ?,id FROM users WHERE login_key=? AND ${eligible}`,
      match.group_id,
      loginKey,
      inviteHash,
      email,
      stamp,
    ),
    stmt(
      c,
      `UPDATE training_group_invites SET used_by=(SELECT id FROM users WHERE login_key=?) WHERE token_hash=? AND email=? AND expires_at>? AND used_by IS NULL`,
      loginKey,
      inviteHash,
      email,
      stamp,
    ),
  ]);
  return first<{ id: string }>(
    c,
    `SELECT u.id FROM users u JOIN training_group_invites i ON i.used_by=u.id WHERE i.token_hash=? AND u.login_key=?`,
    inviteHash,
    loginKey,
  );
}
workspace.post("/groups/consent", async (c) => {
  const i = z
    .object({
      scope: z.enum(["group", "person"]),
      targetId: z.string().max(80),
      share: z.boolean(),
      named: z.boolean().optional(),
    })
    .parse(await c.req.json());
  const id = me(c);
  if (
    i.share &&
    (i.scope === "group"
      ? !(await membership(c, i.targetId))
      : !(await first(
          c,
          `${members} SELECT 1 WHERE EXISTS (
      SELECT 1 FROM members a JOIN members b ON a.group_id=b.group_id WHERE a.user_id=? AND b.user_id=?)
      OR ${mutual("?2", "?3")} OR ${connected("?2", "?3")}`,
          google(c),
          id,
          i.targetId,
        )))
  ) {
    reject(403, "Choose a member or connection you can share with.");
  }
  if (i.share)
    await stmt(
      c,
      `INSERT INTO metric_permissions VALUES(?,?,?,?) ON CONFLICT(user_id,scope,target_id) DO UPDATE SET named=excluded.named`,
      id,
      i.scope,
      i.targetId,
      +!!i.named,
    ).run();
  else
    await stmt(
      c,
      "DELETE FROM metric_permissions WHERE user_id=? AND scope=? AND target_id=?",
      id,
      i.scope,
      i.targetId,
    ).run();
  return c.json({ ok: true });
});
function plusDays(day: string, days: number) {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const filters = z.object({
  start: day.optional(),
  end: day.optional(),
  variant: z.string().max(320).optional(),
});
function metrics(
  entries: WorkoutEntry[],
  query: z.infer<typeof filters>,
  timezone: string,
) {
  const items = entries.filter((e) => {
    if (
      query.variant &&
      !e.workout.exercises.some(
        (x) =>
          metricKey(x.exercise_template_id, x.equipment, x.exercise_type) ===
          query.variant,
      )
    )
      return false;
    const date = localDay(e.workout.start_time, timezone);
    return (
      (!query.start || date >= query.start) && (!query.end || date <= query.end)
    );
  });
  const byDay = new Map<string, WorkoutEntry[]>();
  for (const e of items) {
    const date = localDay(e.workout.start_time, timezone);
    const group = byDay.get(date);
    if (group) group.push(e);
    else byDay.set(date, [e]);
  }
  return {
    ...summarize(items, query.variant),
    days: [...byDay]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, entries]) => ({ day, ...summarize(entries, query.variant) })),
    latest:
      items
        .map((e) => e.workout.updated_at)
        .sort()
        .at(-1) ?? null,
    sources: [...new Set(items.map((e) => e.source))],
  };
}
workspace.get("/metrics", async (c) => {
  const query = filters.parse(c.req.query());
  const [entries, settings] = await Promise.all([
    analysisEntries(c, me(c)),
    pref(c),
  ]);
  const variants = new Map<string, string>();
  for (const { workout } of entries)
    for (const e of workout.exercises)
      variants.set(
        metricKey(e.exercise_template_id, e.equipment, e.exercise_type),
        e.title + (e.equipment ? " · " + e.equipment : ""),
      );
  return c.json({
    summary: metrics(entries, query, settings.timezone),
    variants: [...variants].map(([id, label]) => ({ id, label })),
    records: personalRecords(entries)
      .filter(
        (r) =>
          (!query.variant || r.variant === query.variant) &&
          (!query.start || localDay(r.at, settings.timezone) >= query.start) &&
          (!query.end || localDay(r.at, settings.timezone) <= query.end),
      )
      .slice(0, 100),
  });
});
workspace.get("/compare", async (c) => {
  const query = filters
    .extend({ scope: z.enum(["person", "group"]), target: z.string().max(80) })
    .parse(c.req.query());
  const id = me(c);
  const team =
    query.scope === "group" ? await membership(c, query.target) : null;
  if (query.scope === "group" && !team)
    return reject(404, "Group unavailable.");
  const timezone = team?.timezone ?? (await pref(c)).timezone;
  const self = metrics(await analysisEntries(c, id), query, timezone);
  if (query.scope === "person") {
    const allowed = await first<{ id: string; name: string }>(
      c,
      `${members} SELECT u.id,u.name FROM users u
      JOIN metric_permissions p ON p.user_id=u.id AND p.scope='person' AND p.target_id=?
      WHERE u.id=? AND u.id<>? AND (EXISTS(SELECT 1 FROM members a JOIN members b ON a.group_id=b.group_id
        WHERE a.user_id=? AND b.user_id=u.id) OR ${mutual("u.id", "?2")} OR ${connected("u.id", "?2")})`,
      google(c),
      id,
      query.target,
      id,
      id,
    );
    if (!allowed)
      return c.json({
        self,
        peer: null,
        reason: "This person has not shared metrics with you.",
      });
    return c.json({
      self,
      peer: {
        name: allowed.name,
        summary: metrics(await analysisEntries(c, allowed.id), query, timezone),
      },
    });
  }
  const people = await all<{ id: string; name: string; named: number }>(
    c,
    `${members}
    SELECT u.id,u.name,p.named FROM members m JOIN users u ON u.id=m.user_id JOIN metric_permissions p ON p.user_id=u.id
    AND p.scope='group' AND p.target_id=m.group_id WHERE m.group_id=? AND u.id<>?`,
    google(c),
    query.target,
    id,
  );
  const participants = (
    await Promise.all(
      people.map(async (person) => ({
        person,
        summary: metrics(await analysisEntries(c, person.id), query, timezone),
      })),
    )
  ).filter((x) => x.summary.sessions > 0);
  const keys = [
    "sessions",
    "sets",
    "reps",
    "seconds",
    "volume",
    "top",
    "distance",
    "activeSeconds",
    "assistedReps",
    "bodyweightReps",
  ] as const;
  const median =
    participants.length < 3
      ? null
      : Object.fromEntries(
          keys.map((key) => {
            const sorted = participants
              .map((x) => x.summary[key])
              .sort((a, b) => a - b);
            return [
              key,
              (sorted[Math.floor((sorted.length - 1) / 2)] +
                sorted[Math.ceil((sorted.length - 1) / 2)]) /
                2,
            ];
          }),
        );
  return c.json({
    self,
    median,
    contributors: participants.length,
    named: participants
      .filter((x) => x.person.named)
      .map((x) => ({
        name: x.person.name,
        summary: Object.fromEntries(keys.map((key) => [key, x.summary[key]])),
      })),
  });
});
workspace.get("/reconcile", async (c) => {
  const id = me(c);
  const [entries, review, mapping] = await Promise.all([
    ownEntries(c, id),
    all<{ native_id: string; hevy_id: string; kept_id: string }>(
      c,
      "SELECT native_id,hevy_id,kept_id FROM workout_duplicate_reviews WHERE user_id=?",
      id,
    ),
    all<{
      provider_template: string;
      equipment: string;
      movement_type: string;
      canonical_id: string;
    }>(
      c,
      "SELECT provider_template,equipment,movement_type,canonical_id FROM workout_variant_links WHERE user_id=?",
      id,
    ),
  ]);
  const identity = (e: Workout["exercises"][number]) =>
    [e.title.trim().toLowerCase(), e.equipment, e.exercise_type].join("#");
  const left = entries.filter((e) => e.source === "native").slice(0, 100);
  const right = entries.filter((e) => e.source === "hevy").slice(0, 200);
  const summary = (e: WorkoutEntry) => ({
    id: e.workout.id,
    title: e.details?.title ?? e.workout.exercises[0]?.title ?? "Workout",
    at: e.workout.start_time,
  });
  const candidates = left
    .flatMap((item) =>
      right
        .filter((candidate) => {
          if (
            Math.abs(
              Date.parse(item.workout.start_time) -
                Date.parse(candidate.workout.start_time),
            ) >
            30 * 60_000
          )
            return false;
          return item.workout.exercises.some((e) =>
            candidate.workout.exercises.some(
              (other) => identity(other) === identity(e),
            ),
          );
        })
        .map((other) => ({
          native: summary(item),
          hevy: summary(other),
          keep:
            review.find(
              (x) =>
                x.native_id === item.workout.id &&
                x.hevy_id === other.workout.id,
            )?.kept_id ?? null,
        })),
    )
    .slice(0, 40);
  const variants = new Map<
    string,
    {
      source: string;
      title: string;
      equipment: string;
      type: string;
      mapped: string | null;
    }
  >();
  for (const item of entries.filter((e) => e.source === "hevy"))
    for (const exercise of item.workout.exercises) {
      const {
        exercise_template_id: source,
        title,
        equipment,
        exercise_type: type,
      } = exercise;
      if (!equipment || !type) continue;
      variants.set(metricKey(source, equipment, type), {
        source,
        title,
        equipment,
        type,
        mapped:
          mapping.find(
            (x) =>
              x.provider_template === source &&
              x.equipment === equipment &&
              x.movement_type === type,
          )?.canonical_id ?? null,
      });
    }
  return c.json({
    candidates,
    variants: [...variants.values()].sort((a, b) =>
      a.title.localeCompare(b.title),
    ),
  });
});
workspace.post("/reconcile/duplicate", async (c) => {
  const i = z
    .object({
      native: z.string().max(160),
      hevy: z.string().max(160),
      keep: z.string().max(160).nullable(),
    })
    .parse(await c.req.json());
  if (
    !isManualWorkout(i.native) ||
    isManualWorkout(i.hevy) ||
    (i.keep !== null && i.keep !== i.native && i.keep !== i.hevy)
  )
    return reject(400, "Choose one of the two workouts.");
  const user = me(c);
  const found = await first<{ count: number }>(
    c,
    "SELECT count(*) count FROM workouts WHERE user_id=? AND source_id IN (?,?)",
    user,
    i.native,
    i.hevy,
  );
  if (found?.count !== 2) return reject(404, "Workout unavailable.");
  if (!i.keep)
    await stmt(
      c,
      "DELETE FROM workout_duplicate_reviews WHERE user_id=? AND native_id=? AND hevy_id=?",
      user,
      i.native,
      i.hevy,
    ).run();
  else
    await stmt(
      c,
      `INSERT INTO workout_duplicate_reviews VALUES(?,?,?,?)
    ON CONFLICT(user_id,native_id,hevy_id) DO UPDATE SET kept_id=excluded.kept_id`,
      user,
      i.native,
      i.hevy,
      i.keep,
    ).run();
  return c.json({ ok: true });
});
workspace.post("/reconcile/variant", async (c) => {
  const i = z
    .object({
      source: z.string().max(160),
      equipment: z.string().max(60),
      type: z.string().max(60),
      canonical: z.string().max(160).nullable(),
    })
    .parse(await c.req.json());
  if (
    isManualWorkout(i.source) ||
    !(await first(
      c,
      `SELECT 1 FROM exercises WHERE user_id=? AND template_id=? AND equipment=? AND exercise_type=?
    AND workout_id NOT LIKE 'manual:%'`,
      me(c),
      i.source,
      i.equipment,
      i.type,
    ))
  )
    return reject(404, "Import variant unavailable.");
  if (i.canonical) {
    const option = catalog.find((x) => x.id === i.canonical);
    if (!option || option.equipment !== i.equipment || option.type !== i.type)
      return reject(
        400,
        "Choose a catalog variant with the same equipment and measurement type.",
      );
    await stmt(
      c,
      `INSERT INTO workout_variant_links VALUES(?,?,?,?,?)
      ON CONFLICT(user_id,provider_template,equipment,movement_type) DO UPDATE SET canonical_id=excluded.canonical_id`,
      me(c),
      i.source,
      i.equipment,
      i.type,
      i.canonical,
    ).run();
  } else
    await stmt(
      c,
      "DELETE FROM workout_variant_links WHERE user_id=? AND provider_template=? AND equipment=? AND movement_type=?",
      me(c),
      i.source,
      i.equipment,
      i.type,
    ).run();
  return c.json({ ok: true });
});
const socialTarget = z.object({
  owner: z.string().max(80),
  id: z.string().max(160),
});
async function visibleShared(c: Ctx, owner: string, id: string) {
  return first<WorkoutRow>(
    c,
    `${visibilityQuery} AND w.user_id=? AND w.source_id=? AND d.audience IN ('group','connections')`,
    google(c),
    me(c),
    owner,
    id,
  );
}
workspace.get("/social", async (c) => {
  const i = socialTarget.parse(c.req.query());
  if (!(await visibleShared(c, i.owner, i.id)))
    return reject(404, "Shared workout unavailable.");
  const [comments, reactions] = await Promise.all([
    all<{
      id: string;
      name: string;
      body: string;
      created_at: string;
      user_id: string;
    }>(
      c,
      `SELECT p.id,p.body,p.created_at,p.user_id,u.name
      FROM workout_comments p JOIN users u ON u.id=p.user_id WHERE p.owner_id=? AND p.workout_id=? ORDER BY p.created_at DESC,p.id DESC LIMIT 50`,
      i.owner,
      i.id,
    ),
    first<{ count: number; mine: number | null }>(
      c,
      `SELECT count(*) AS count,max(user_id=?) AS mine FROM workout_reactions WHERE owner_id=? AND workout_id=?`,
      me(c),
      i.owner,
      i.id,
    ),
  ]);
  return c.json({ comments, reactions });
});
workspace.post("/social/react", async (c) => {
  const i = socialTarget
    .extend({ enabled: z.boolean() })
    .parse(await c.req.json());
  if (!(await visibleShared(c, i.owner, i.id)))
    return reject(404, "Shared workout unavailable.");
  if (i.enabled)
    await stmt(
      c,
      `INSERT OR IGNORE INTO workout_reactions VALUES(?,?,?)`,
      i.owner,
      i.id,
      me(c),
    ).run();
  else
    await stmt(
      c,
      "DELETE FROM workout_reactions WHERE owner_id=? AND workout_id=? AND user_id=?",
      i.owner,
      i.id,
      me(c),
    ).run();
  return c.json({ ok: true });
});
workspace.post("/social/comment", async (c) => {
  const i = socialTarget
    .extend({ body: z.string().trim().min(1).max(500) })
    .parse(await c.req.json());
  if (!(await visibleShared(c, i.owner, i.id)))
    return reject(404, "Shared workout unavailable.");
  const batch = [
    stmt(
      c,
      "INSERT INTO workout_comments VALUES(?,?,?,?,?,?)",
      crypto.randomUUID(),
      i.owner,
      i.id,
      me(c),
      i.body,
      now(),
    ),
  ];
  if (i.owner !== me(c))
    batch.push(
      stmt(
        c,
        "INSERT INTO training_inbox VALUES(?,?,?, ?,NULL)",
        crypto.randomUUID(),
        i.owner,
        "New workout comment",
        now(),
      ),
    );
  await c.env.DB.batch(batch);
  if (i.owner !== me(c)) sendInboxNotification(c, [i.owner]);
  return c.json({ ok: true });
});
workspace.post("/social/comment/delete", async (c) => {
  const { id } = z.object({ id: uuid }).parse(await c.req.json());
  await stmt(
    c,
    "DELETE FROM workout_comments WHERE id=? AND (user_id=? OR owner_id=?)",
    id,
    me(c),
    me(c),
  ).run();
  return c.json({ ok: true });
});
workspace.get("/inbox", async (c) =>
  c.json({
    items: await all<{
      id: string;
      kind: string;
      created_at: string;
      read_at: string | null;
    }>(
      c,
      "SELECT id,kind,created_at,read_at FROM training_inbox WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 50",
      me(c),
    ),
  }),
);
workspace.post("/inbox/read", async (c) => {
  await stmt(
    c,
    "UPDATE training_inbox SET read_at=? WHERE user_id=? AND read_at IS NULL",
    now(),
    me(c),
  ).run();
  return c.json({ ok: true });
});
workspace.get("/profile", async (c) => {
  const user = c.get("user");
  const extra = await first<{ bio: string; locale: string }>(
    c,
    "SELECT bio,locale FROM training_profiles WHERE user_id=?",
    user.id,
  );
  return c.json({
    name: user.name,
    bio: extra?.bio ?? "",
    locale: extra?.locale ?? "en",
  });
});
workspace.post("/profile", async (c) => {
  const i = z
    .object({
      name: z.string().trim().min(1).max(80),
      bio: z.string().max(320),
      locale: z.enum(["en", "en-GB", "es", "fr", "de"]),
    })
    .parse(await c.req.json());
  await c.env.DB.batch([
    stmt(c, "UPDATE users SET name=? WHERE id=?", i.name, me(c)),
    stmt(
      c,
      `INSERT INTO training_profiles(user_id,bio,locale) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio,locale=excluded.locale`,
      me(c),
      i.bio,
      i.locale,
    ),
  ]);
  return c.json({ ok: true });
});
workspace.get("/export", async (c) => {
  const id = me(c);
  const [items, routines, exercises, measurements, settings] =
    await Promise.all([
      ownEntries(c, id),
      all<{ content: string }>(
        c,
        "SELECT content FROM routines WHERE user_id=? ORDER BY id",
        id,
      ),
      all<{ content: string }>(
        c,
        "SELECT content FROM exercise_catalog WHERE user_id=? ORDER BY id",
        id,
      ),
      all<{ day: string; kind: string; value: number }>(
        c,
        `SELECT day,kind,value FROM measurements WHERE user_id=?
    UNION ALL SELECT w.day,'weight',w.kg FROM weights w WHERE w.user_id=? AND NOT EXISTS
      (SELECT 1 FROM measurements m WHERE m.user_id=w.user_id AND m.day=w.day AND m.kind='weight')`,
        id,
        id,
      ),
      pref(c),
    ]);
  return c.json({
    schemaVersion: 2,
    workouts: items.map((item) => ({
      record: item.workout,
      details: item.details,
      source: item.source,
      annotation: item.annotation,
    })),
    routines: routines.map((r) => JSON.parse(r.content)),
    catalog: exercises.map((r) => JSON.parse(r.content)),
    measurements,
    preferences: settings,
  });
});
const transferItems = z.object({
  routines: z.array(routineInput).max(200).default([]),
  catalog: z.array(exerciseInput).max(200).default([]),
  measurements: z
    .array(
      z.object({
        day,
        kind: z.enum(measurementKinds),
        value: z.number().positive().max(1000),
      }),
    )
    .max(5000)
    .default([]),
});
function validTransfer(input: z.infer<typeof transferItems>) {
  return {
    routines: input.routines.filter((routine) =>
      routine.movements.every(validRoutineMovement),
    ),
    catalog: input.catalog.filter(
      (exercise) =>
        exercise.id.startsWith("custom:") &&
        uuid.safeParse(exercise.id.slice(7)).success,
    ),
    measurements: input.measurements.filter(
      (value) => value.kind !== "bodyFat" || value.value <= 100,
    ),
  };
}
workspace.post("/import/preview", async (c) => {
  const payload = transferItems
    .extend({
      schemaVersion: z.literal(2),
      workouts: z
        .array(
          z.object({
            record: z.object({ id: z.string().max(160) }),
            source: z.enum(["native", "hevy"]),
            details: workoutInput.nullable(),
          }),
        )
        .max(1000),
    })
    .parse(await c.req.json());
  const settings = validTransfer(payload);
  const owned = await all<{ source_id: string }>(
    c,
    `SELECT source_id FROM workouts WHERE user_id=?1
    UNION SELECT workout_id FROM workout_details WHERE user_id=?1`,
    me(c),
  );
  const ids = new Set(owned.map((x) => x.source_id));
  const available = new Map(
    payload.workouts
      .filter(
        (item) =>
          item.source === "native" &&
          item.details &&
          !ids.has(item.record.id) &&
          isManualWorkout(item.record.id) &&
          uuid.safeParse(item.record.id.slice(manualPrefix.length)).success,
      )
      .map((item) => [item.record.id, item]),
  );
  const catalogRows = await all<{ id: string }>(
    c,
    "SELECT id FROM exercise_catalog WHERE user_id=?",
    me(c),
  );
  const allowed = new Set([
    ...catalog.map((e) => e.id),
    ...catalogRows.map((e) => e.id),
    ...settings.catalog.map((e) => e.id),
    ...(
      await all<{ template_id: string }>(
        c,
        "SELECT DISTINCT template_id FROM exercises WHERE user_id=?",
        me(c),
      )
    ).map((e) => e.template_id),
  ]);
  const workouts = [...available.values()].flatMap((item) => {
    const value = item.details!;
    if (
      Date.parse(value.finishedAt) < Date.parse(value.startedAt) ||
      Date.parse(value.finishedAt) > Date.now() + 120_000 ||
      value.movements.some((m) => !allowed.has(m.id) || !validMovement(m))
    )
      return [];
    return [
      {
        id: item.record.id.slice(manualPrefix.length),
        workout: { ...value, audience: "private" as const, groupId: null },
      },
    ];
  });
  return c.json({
    workouts,
    skipped: payload.workouts.length - workouts.length,
    ...settings,
  });
});
workspace.post("/import/library", async (c) => {
  const data = validTransfer(transferItems.parse(await c.req.json()));
  const id = me(c);
  const [catalog, routines, measurements] = await c.env.DB.batch([
    stmt(
      c,
      `INSERT OR IGNORE INTO exercise_catalog(user_id,id,content)
      SELECT ?,json_extract(value,'$.id'),value FROM json_each(?)`,
      id,
      JSON.stringify(data.catalog),
    ),
    stmt(
      c,
      `INSERT OR IGNORE INTO routines(user_id,id,title,content,updated_at)
      SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.title'),value,? FROM json_each(?)`,
      id,
      now(),
      JSON.stringify(data.routines),
    ),
    stmt(
      c,
      `INSERT OR IGNORE INTO measurements(user_id,day,kind,value)
      SELECT ?,json_extract(j.value,'$.day'),json_extract(j.value,'$.kind'),json_extract(j.value,'$.value') FROM json_each(?) j
      WHERE json_extract(j.value,'$.kind')<>'weight' OR NOT EXISTS (SELECT 1 FROM weights w WHERE w.user_id=? AND w.day=json_extract(j.value,'$.day'))`,
      id,
      JSON.stringify(data.measurements),
      id,
    ),
  ]);
  return c.json({
    catalog: catalog.meta.changes,
    routines: routines.meta.changes,
    measurements: measurements.meta.changes,
  });
});

const mediaKey = (owner: string, id: string) => owner + "/" + id;
export function cleanWorkoutMedia(c: Ctx, owner: string) {
  const bucket = c.env.MEDIA;
  if (!bucket) return;
  const work = async () => {
    const removed = await all<{ id: string }>(
      c,
      `SELECT m.id FROM training_media m WHERE m.user_id=? AND m.workout_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM workouts w WHERE w.user_id=m.user_id AND w.source_id=m.workout_id)`,
      owner,
    );
    for (const item of removed) {
      await bucket.delete(mediaKey(owner, item.id));
      await stmt(
        c,
        "DELETE FROM training_media WHERE id=? AND user_id=?",
        item.id,
        owner,
      ).run();
    }
  };
  c.executionCtx.waitUntil(
    work().catch(() =>
      console.error("Workout attachment cleanup could not finish."),
    ),
  );
}
const maxMedia = 25_000_000;
const mediaTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
];
type Attachment = {
  id: string;
  user_id: string;
  workout_id: string | null;
  measurement_day: string | null;
  content_type: string;
  size_bytes: number;
};
workspace.get("/media", async (c) => {
  const i = z
    .object({
      owner: z.string().max(80),
      workout: z.string().max(160).optional(),
      day: day.optional(),
    })
    .parse(c.req.query());
  if (
    i.workout &&
    !(await first<WorkoutRow>(
      c,
      `${visibilityQuery} AND w.user_id=? AND w.source_id=?`,
      google(c),
      me(c),
      i.owner,
      i.workout,
    ))
  )
    return reject(404, "Attachment unavailable.");
  if (!i.workout && (i.owner !== me(c) || !i.day))
    return reject(404, "Attachment unavailable.");
  const items = await all<Attachment>(
    c,
    `SELECT * FROM training_media WHERE user_id=? AND (` +
      (i.workout ? "workout_id=?" : "measurement_day=?") +
      ") ORDER BY created_at DESC LIMIT 25",
    i.owner,
    i.workout ?? i.day!,
  );
  return c.json({ items, enabled: !!c.env.MEDIA });
});
workspace.post("/media/upload", async (c) => {
  const bucket = c.env.MEDIA;
  if (!bucket) return c.json({ error: "Media storage is unavailable." }, 503);
  const i = z
    .object({ workout: z.string().max(160).optional(), day: day.optional() })
    .parse(c.req.query());
  if (!!i.workout === !!i.day)
    reject(400, "Choose a workout or measurement date.");
  const id = me(c);
  if (
    i.workout &&
    !(await first(
      c,
      "SELECT 1 FROM workouts WHERE user_id=? AND source_id=?",
      id,
      i.workout,
    ))
  )
    reject(404, "Workout unavailable.");
  if (
    i.day &&
    !(await first(
      c,
      "SELECT 1 FROM measurements WHERE user_id=? AND day=? UNION SELECT 1 FROM weights WHERE user_id=? AND day=?",
      id,
      i.day,
      id,
      i.day,
    ))
  )
    reject(404, "Record a measurement first.");
  const type = c.req.header("content-type") ?? "";
  if (!mediaTypes.includes(type) || (i.day && !type.startsWith("image/")))
    reject(400, "Choose a supported image or video.");
  const size = Number(c.req.header("content-length"));
  if (
    !Number.isInteger(size) ||
    size <= 0 ||
    size > maxMedia ||
    !c.req.raw.body
  )
    return reject(400, "Choose a file up to 25 MB.");
  const media = crypto.randomUUID(),
    key = mediaKey(id, media);
  const stream = new FixedLengthStream(size);
  try {
    await Promise.all([
      c.req.raw.body.pipeTo(stream.writable),
      bucket.put(key, stream.readable, { httpMetadata: { contentType: type } }),
    ]);
    const saved = await stmt(
      c,
      `INSERT INTO training_media SELECT ?,?,?,?,?,?,?
      WHERE ? IS NULL OR EXISTS (SELECT 1 FROM workouts WHERE user_id=? AND source_id=?)`,
      media,
      id,
      i.workout ?? null,
      i.day ?? null,
      type,
      size,
      now(),
      i.workout ?? null,
      id,
      i.workout ?? null,
    ).run();
    if (!saved.meta.changes) return reject(404, "Workout unavailable.");
  } catch (error) {
    await bucket.delete(key);
    throw error;
  }
  return c.json({ id: media });
});
workspace.get("/media/:id", async (c) => {
  const id = uuid.parse(c.req.param("id"));
  const row = await first<Attachment>(
    c,
    "SELECT * FROM training_media WHERE id=?",
    id,
  );
  if (!row || !c.env.MEDIA) return reject(404, "Attachment unavailable.");
  if (row.workout_id) {
    if (
      !(await first<WorkoutRow>(
        c,
        `${visibilityQuery} AND w.user_id=? AND w.source_id=?`,
        google(c),
        me(c),
        row.user_id,
        row.workout_id,
      ))
    )
      return reject(404, "Attachment unavailable.");
  } else if (row.user_id !== me(c))
    return reject(404, "Attachment unavailable.");
  const size = row.size_bytes;
  const range = c.req.header("Range");
  const headers = new Headers({
    "Content-Type": row.content_type,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Accept-Ranges": "bytes",
  });
  let offset = 0,
    end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match?.[1]) {
      offset = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    } else if (match?.[2])
      offset = +match[2] > 0 ? Math.max(0, size - Number(match[2])) : size;
    else offset = size;
    if (
      offset > end ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(end)
    ) {
      headers.set("Content-Range", "bytes */" + size);
      return new Response(null, { headers, status: 416 });
    }
    headers.set("Content-Range", `bytes ${offset}-${end}/${size}`);
  }
  const length = end - offset + 1;
  const object = await c.env.MEDIA.get(
    mediaKey(row.user_id, row.id),
    range ? { range: { offset, length } } : undefined,
  );
  if (!object) return reject(404, "Attachment unavailable.");
  headers.set("Content-Length", String(length));
  return new Response(object.body, { headers, status: range ? 206 : 200 });
});
workspace.post("/media/delete", async (c) => {
  const { id } = z.object({ id: uuid }).parse(await c.req.json());
  const bucket = c.env.MEDIA;
  if (!bucket) return c.json({ error: "Media storage is unavailable." }, 503);
  const row = await first<Attachment>(
    c,
    "SELECT * FROM training_media WHERE id=? AND user_id=?",
    id,
    me(c),
  );
  if (row) {
    await bucket.delete(mediaKey(me(c), id));
    await stmt(
      c,
      "DELETE FROM training_media WHERE id=? AND user_id=?",
      id,
      me(c),
    ).run();
  }
  return c.json({ ok: true });
});
type Challenge = {
  id: string;
  group_id: string;
  creator_id: string;
  title: string;
  timezone: string;
  starts_on: string;
  variants: string;
};
const sourceChoice = z.enum(["native", "mixed"]);
const challengeSubmit = z.object({
  groupId: z.string().max(80),
  title: z.string().trim().min(1).max(100),
  start: day,
  variants: z.array(z.string().min(1).max(320)).min(1).max(30),
  players: z.array(z.string().max(80)).min(2).max(40),
  source: sourceChoice,
});
const nextWeek = (day: string) => plusDays(day, 7);
function mondayAt(day: string) {
  return plusDays(day, -((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7));
}
async function challenge(c: Ctx, id: string) {
  return first<Challenge>(
    c,
    `SELECT ch.* FROM training_challenges ch JOIN training_challenge_players p ON p.challenge_id=ch.id
      WHERE ch.id=? AND p.user_id=?`,
    id,
    me(c),
  );
}
workspace.get("/groups/members", async (c) => {
  const id = z.string().max(80).parse(c.req.query("id"));
  if (!(await membership(c, id))) return reject(404, "Group unavailable.");
  return c.json({
    items: await all<{ id: string; name: string }>(
      c,
      `${members} SELECT u.id,u.name FROM members m JOIN users u ON u.id=m.user_id
      WHERE m.group_id=? ORDER BY u.name`,
      google(c),
      id,
    ),
  });
});
workspace.post("/challenges", async (c) => {
  const i = challengeSubmit.parse(await c.req.json());
  const group = await membership(c, i.groupId);
  if (!group) return reject(404, "Group unavailable.");
  const allowed = await all<{ user_id: string }>(
    c,
    `${members} SELECT user_id FROM members WHERE group_id=?`,
    google(c),
    i.groupId,
  );
  const ids = [...new Set(i.players)],
    valid = new Set(allowed.map((x) => x.user_id));
  if (
    ids.length < 2 ||
    !ids.includes(me(c)) ||
    ids.some((id) => !valid.has(id))
  )
    reject(
      400,
      "Choose at least two current group members, including yourself.",
    );
  if (
    mondayAt(i.start) !== i.start ||
    i.start <= localDay(now(), group.timezone)
  )
    reject(400, "Choose a future Monday.");
  const items = await analysisEntries(c, me(c));
  const exact = new Set(
    items.flatMap((entry) =>
      entry.workout.exercises
        .filter((e) => e.exercise_type === "weight_reps" && e.equipment)
        .map((e) =>
          metricKey(e.exercise_template_id, e.equipment, e.exercise_type),
        ),
    ),
  );
  if (i.variants.some((v) => !exact.has(v)))
    reject(400, "Choose externally weighted variants from your history.");
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    stmt(
      c,
      "INSERT INTO training_challenges VALUES(?,?,?,?,?,?,?)",
      id,
      group.id,
      me(c),
      i.title,
      group.timezone,
      i.start,
      JSON.stringify([...new Set(i.variants)]),
    ),
    ...ids.map((user) =>
      stmt(
        c,
        "INSERT INTO training_challenge_players VALUES(?,?,?)",
        id,
        user,
        user === me(c) ? i.source : null,
      ),
    ),
    ...ids
      .filter((x) => x !== me(c))
      .map((user) =>
        stmt(
          c,
          "INSERT INTO training_inbox VALUES(?,?,?, ?,NULL)",
          crypto.randomUUID(),
          user,
          "Competition invitation",
          now(),
        ),
      ),
  ]);
  sendInboxNotification(
    c,
    ids.filter((id) => id !== me(c)),
  );
  return c.json({ id });
});
workspace.post("/challenges/approve", async (c) => {
  const { id, source } = z
    .object({ id: uuid, source: sourceChoice })
    .parse(await c.req.json());
  const found = await challenge(c, id);
  if (!found || !(await membership(c, found.group_id)))
    return reject(404, "Competition unavailable.");
  if (localDay(now(), found.timezone) >= found.starts_on)
    reject(409, "Approval closed when the competition started.");
  const result = await stmt(
    c,
    "UPDATE training_challenge_players SET source=? WHERE challenge_id=? AND user_id=? AND source IS NULL",
    source,
    id,
    me(c),
  ).run();
  if (!result.meta.changes)
    reject(409, "Your source choice is already frozen.");
  await stmt(
    c,
    "INSERT INTO training_inbox VALUES(?,?,?, ?,NULL)",
    crypto.randomUUID(),
    found.creator_id,
    "Competition approval",
    now(),
  ).run();
  sendInboxNotification(c, [found.creator_id]);
  return c.json({ ok: true });
});
workspace.post("/challenges/confirm", async (c) => {
  const { id, week } = z
    .object({ id: uuid, week: day })
    .parse(await c.req.json());
  const found = await challenge(c, id);
  if (!found || !(await membership(c, found.group_id)))
    return reject(404, "Competition unavailable.");
  const approved = await first(
    c,
    `SELECT 1 FROM training_challenge_players WHERE challenge_id=? AND user_id=? AND source IS NOT NULL`,
    id,
    me(c),
  );
  if (
    !approved ||
    mondayAt(week) !== week ||
    week < found.starts_on ||
    nextWeek(week) > localDay(now(), found.timezone)
  )
    reject(400, "Choose a closed competition week.");
  await stmt(
    c,
    "INSERT OR IGNORE INTO training_closed_weeks VALUES(?,?,?,?)",
    id,
    me(c),
    week,
    now(),
  ).run();
  return c.json({ ok: true });
});
workspace.get("/challenges", async (c) => {
  const q = z.object({ week: day.optional() }).parse(c.req.query());
  const items = await all<Challenge>(
    c,
    `${members} SELECT ch.* FROM training_challenges ch JOIN training_challenge_players p
    ON p.challenge_id=ch.id JOIN members m ON m.group_id=ch.group_id AND m.user_id=p.user_id WHERE p.user_id=? ORDER BY ch.starts_on DESC LIMIT 30`,
    google(c),
    me(c),
  );
  return c.json({
    items: await Promise.all(
      items.map(async (ch) => {
        const players = await all<{
          id: string;
          name: string;
          source: "native" | "mixed" | null;
          member: number;
        }>(
          c,
          `${members} SELECT u.id,u.name,p.source,
      EXISTS(SELECT 1 FROM members m WHERE m.group_id=? AND m.user_id=u.id) AS member
      FROM training_challenge_players p JOIN users u ON u.id=p.user_id WHERE p.challenge_id=? ORDER BY u.name`,
          google(c),
          ch.group_id,
          ch.id,
        );
        const week = mondayAt(
          q.week ?? plusDays(localDay(now(), ch.timezone), -7),
        );
        const variants = new Set<string>(JSON.parse(ch.variants));
        const pending = players.some((p) => !p.source || !p.member);
        const standings = pending
          ? []
          : await Promise.all(
              players.map(async (p) => {
                const [entries, weights, coverage, closed] = await Promise.all([
                  analysisEntries(c, p.id),
                  all<{ day: string; kg: number }>(
                    c,
                    `SELECT day,value AS kg FROM measurements WHERE user_id=? AND kind='weight'
          UNION ALL SELECT w.day,w.kg FROM weights w WHERE w.user_id=? AND NOT EXISTS
          (SELECT 1 FROM measurements m WHERE m.user_id=w.user_id AND m.day=w.day AND m.kind='weight') ORDER BY day DESC`,
                    p.id,
                    p.id,
                  ),
                  all<{ start: string; end: string }>(
                    c,
                    `SELECT scope_start AS start,scope_end AS end FROM import_runs
          WHERE user_id=? AND mode='full' AND status='completed'`,
                    p.id,
                  ),
                  all<{ starts_on: string }>(
                    c,
                    "SELECT starts_on FROM training_closed_weeks WHERE challenge_id=? AND user_id=?",
                    ch.id,
                    p.id,
                  ),
                ]);
                const own = entries.filter(
                  (e) => p.source === "mixed" || e.source === "native",
                );
                const eligible = (start: string) => {
                  const end = nextWeek(start);
                  let normalized = 0,
                    count = 0,
                    missing = false;
                  for (const { workout } of own) {
                    const date = localDay(workout.start_time, ch.timezone);
                    if (date < start || date >= end) continue;
                    const weighted = workout.exercises
                      .filter((e) =>
                        variants.has(
                          metricKey(
                            e.exercise_template_id,
                            e.equipment,
                            e.exercise_type,
                          ),
                        ),
                      )
                      .flatMap((e) => e.sets)
                      .filter(
                        (s) => s.type !== "warmup" && !!s.weight_kg && !!s.reps,
                      );
                    if (!weighted.length) continue;
                    count++;
                    const body = weights.find((x) => x.day <= date);
                    if (!body) {
                      missing = true;
                      continue;
                    }
                    for (const set of weighted)
                      normalized += (set.weight_kg! * set.reps!) / body.kg;
                  }
                  const provisional = end > localDay(now(), ch.timezone);
                  const reason = provisional
                    ? "Week still in progress"
                    : !closed.some((x) => x.starts_on === start)
                      ? "Week not confirmed"
                      : p.source === "mixed" &&
                          !covered(
                            boundary(start, ch.timezone),
                            boundary(end, ch.timezone),
                            coverage,
                          )
                        ? "Hevy coverage incomplete"
                        : missing
                          ? "Body weight missing"
                          : null;
                  return { normalized, count, reason };
                };
                const base = eligible(ch.starts_on),
                  current = eligible(week);
                const reason =
                  week <= ch.starts_on
                    ? "Waiting for a full baseline and comparison week"
                    : base.reason
                      ? "Baseline: " + base.reason
                      : base.normalized === 0
                        ? "Baseline has zero eligible volume"
                        : current.reason;
                return {
                  userId: p.id,
                  name: p.name,
                  normalized: current.normalized,
                  workouts: current.count,
                  reason,
                  improvement: reason
                    ? null
                    : Math.round(
                        10000 * (current.normalized / base.normalized - 1),
                      ) / 100,
                };
              }),
            );
        const sorted = standings.every((x) => x.improvement !== null)
          ? [...standings].sort((a, b) => b.improvement! - a.improvement!)
          : standings;
        return {
          ...ch,
          week,
          players,
          pending,
          standings: sorted.map((x) => ({
            ...x,
            rank:
              x.improvement === null ||
              sorted.some((p) => p.improvement === null)
                ? null
                : sorted.findIndex((p) => p.improvement === x.improvement) + 1,
          })),
        };
      }),
    ),
  });
});
