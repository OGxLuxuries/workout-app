import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "./index";
import type { Workout } from "../shared/import";

export const strava = new Hono<AppEnv>();
type ContextType = Context<AppEnv>;
const site = "https://www.strava.com";
const tokenEndpoint = site + "/oauth/token";
const callback = "/api/app/v2/integrations/strava/return";
const workoutId = z.string().max(160);
const tokenPayload = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number().int().positive(),
});
const storage = (c: ContextType) => c.env.DB;
const me = (c: ContextType) => c.get("user").id;
const now = () => new Date().toISOString();
const bytes = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (x) => x.charCodeAt(0));
const enabled = (c: ContextType) =>
  !!(
    c.env.STRAVA_CLIENT_ID &&
    c.env.STRAVA_CLIENT_SECRET &&
    c.env.INTEGRATION_KEY
  );
const credentials = (c: ContextType) => ({
  client_id: c.env.STRAVA_CLIENT_ID!,
  client_secret: c.env.STRAVA_CLIENT_SECRET!,
});
const fail = (status: 400 | 404 | 409 | 503, message: string): never => {
  throw new HTTPException(status, { message });
};
async function digest(input: string) {
  const result = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return bytes(new Uint8Array(result));
}
async function key(c: ContextType) {
  const raw = decode(c.env.INTEGRATION_KEY!);
  if (raw.length !== 32) throw new Error("Invalid integration encryption key.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
async function encrypt(c: ContextType, value: z.infer<typeof tokenPayload>) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(me(c)) },
    await key(c),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return bytes(iv) + "." + bytes(new Uint8Array(sealed));
}
async function decrypt(c: ContextType, value: string) {
  const [iv, body] = value.split(".");
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(iv),
      additionalData: new TextEncoder().encode(me(c)),
    },
    await key(c),
    decode(body),
  );
  return tokenPayload.parse(JSON.parse(new TextDecoder().decode(plain)));
}
async function exchange(c: ContextType, body: Record<string, string>) {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    body: new URLSearchParams({ ...credentials(c), ...body }),
  });
  if (!response.ok) return null;
  return tokenPayload.parse(await response.json());
}
async function store(c: ContextType, value: z.infer<typeof tokenPayload>) {
  await storage(c)
    .prepare(
      `INSERT INTO training_providers VALUES(?,?) ON CONFLICT(user_id)
    DO UPDATE SET token_bundle=excluded.token_bundle`,
    )
    .bind(me(c), await encrypt(c, value))
    .run();
}
strava.get("/", async (c) => {
  const connection = await storage(c)
    .prepare("SELECT 1 FROM training_providers WHERE user_id=?")
    .bind(me(c))
    .first();
  const jobs = await storage(c)
    .prepare(
      "SELECT workout_id,state,updated_at FROM training_exports WHERE user_id=? ORDER BY updated_at DESC LIMIT 25",
    )
    .bind(me(c))
    .all();
  return c.json({
    enabled: enabled(c),
    connected: !!connection,
    jobs: jobs.results,
  });
});
strava.post("/start", async (c) => {
  if (!enabled(c)) fail(503, "Strava credentials have not been configured.");
  const state = crypto.randomUUID() + crypto.randomUUID();
  await storage(c).batch([
    storage(c)
      .prepare(
        "DELETE FROM training_provider_states WHERE user_id=? OR expires_at<=?",
      )
      .bind(me(c), now()),
    storage(c)
      .prepare("INSERT INTO training_provider_states VALUES(?,?,?)")
      .bind(
        await digest(state),
        me(c),
        new Date(Date.now() + 10 * 60_000).toISOString(),
      ),
  ]);
  const url = new URL("/oauth/authorize", site);
  url.search = new URLSearchParams({
    client_id: credentials(c).client_id,
    response_type: "code",
    state,
    redirect_uri: new URL(callback, c.env.APP_ORIGIN).href,
    approval_prompt: "auto",
    scope: "read,activity:write",
  }).toString();
  return c.json({ url: url.href });
});
strava.get("/return", async (c) => {
  const back = (status: string) => c.redirect("/?strava=" + status, 303);
  if (!enabled(c)) return back("disabled");
  const parsed = z
    .object({
      state: z.string().max(100),
      code: z.string().max(500),
      scope: z.string().max(200),
    })
    .safeParse(c.req.query());
  if (!parsed.success) return back("canceled");
  const row = await storage(c)
    .prepare(
      `DELETE FROM training_provider_states WHERE hash=? AND user_id=? AND expires_at>? RETURNING hash`,
    )
    .bind(await digest(parsed.data.state), me(c), now())
    .first();
  if (!row || !parsed.data.scope.split(",").includes("activity:write"))
    return back("permission");
  try {
    const value = await exchange(c, {
      grant_type: "authorization_code",
      code: parsed.data.code,
    });
    if (!value) return back("failed");
    await store(c, value);
    return back("connected");
  } catch {
    return back("failed");
  }
});
strava.post("/disconnect", async (c) => {
  await storage(c).batch([
    storage(c)
      .prepare("DELETE FROM training_providers WHERE user_id=?")
      .bind(me(c)),
    storage(c)
      .prepare("DELETE FROM training_provider_states WHERE user_id=?")
      .bind(me(c)),
    storage(c)
      .prepare(
        "UPDATE training_exports SET state='canceled',updated_at=? WHERE user_id=? AND state='pending'",
      )
      .bind(now(), me(c)),
  ]);
  return c.json({ ok: true });
});
strava.post("/queue", async (c) => {
  const { id } = z.object({ id: workoutId }).parse(await c.req.json());
  if (!enabled(c)) fail(503, "Strava credentials have not been configured.");
  const workout = await storage(c)
    .prepare(
      `SELECT 1 FROM workouts WHERE user_id=? AND source_id=? AND source_id LIKE 'manual:%'`,
    )
    .bind(me(c), id)
    .first();
  if (!workout) fail(404, "Only your directly logged workouts can be sent.");
  await storage(c)
    .prepare(
      `INSERT INTO training_exports VALUES(?,?,'pending',NULL,?)
    ON CONFLICT(user_id,workout_id) DO UPDATE SET state='pending',updated_at=excluded.updated_at
    WHERE training_exports.state IN ('rejected','canceled')`,
    )
    .bind(me(c), id, now())
    .run();
  return c.json({ ok: true });
});
strava.post("/deliver", async (c) => {
  const { id } = z.object({ id: workoutId }).parse(await c.req.json());
  if (!enabled(c)) fail(503, "Strava credentials have not been configured.");
  const [binding, record] = await Promise.all([
    storage(c)
      .prepare("SELECT token_bundle FROM training_providers WHERE user_id=?")
      .bind(me(c))
      .first<{ token_bundle: string }>(),
    storage(c)
      .prepare(
        `SELECT w.data,d.content FROM workouts w LEFT JOIN workout_details d ON d.user_id=w.user_id AND d.workout_id=w.source_id
      WHERE w.user_id=? AND w.source_id=? AND w.source_id LIKE 'manual:%'`,
      )
      .bind(me(c), id)
      .first<{ data: string; content: string | null }>(),
  ]);
  if (!binding) return fail(409, "Connect Strava before sending a workout.");
  if (!record) return fail(404, "Workout unavailable.");
  let tokens = await decrypt(c, binding.token_bundle);
  if (tokens.expires_at <= Date.now() / 1000 + 60) {
    const refreshed = await exchange(c, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    if (!refreshed) return fail(409, "Reconnect Strava before retrying.");
    tokens = refreshed;
    const changed = await storage(c)
      .prepare(
        "UPDATE training_providers SET token_bundle=? WHERE user_id=? AND token_bundle=?",
      )
      .bind(await encrypt(c, tokens), me(c), binding.token_bundle)
      .run();
    if (!changed.meta.changes)
      return fail(409, "Your Strava connection changed. Try again.");
  }
  const job = await storage(c)
    .prepare(
      `UPDATE training_exports SET state='sending',updated_at=?
    WHERE user_id=? AND workout_id=? AND state='pending'
    AND EXISTS(SELECT 1 FROM training_providers WHERE user_id=?) RETURNING workout_id`,
    )
    .bind(now(), me(c), id, me(c))
    .first();
  if (!job) return c.json({ ok: true });
  const workout = JSON.parse(record.data) as Workout;
  const label = record.content
    ? ((JSON.parse(record.content) as { title?: string }).title ??
      "Strength training")
    : "Strength training";
  let state = "review",
    providerId: string | null = null;
  try {
    const response = await fetch(site + "/api/v3/activities", {
      method: "POST",
      headers: { Authorization: "Bearer " + tokens.access_token },
      body: new URLSearchParams({
        name: label,
        sport_type: "WeightTraining",
        start_date_local: workout.start_time,
        elapsed_time: String(
          Math.max(
            1,
            Math.round(
              (Date.parse(workout.end_time) - Date.parse(workout.start_time)) /
                1000,
            ),
          ),
        ),
      }),
    });
    if (response.ok) {
      const value = z.object({ id: z.number() }).parse(await response.json());
      state = "sent";
      providerId = String(value.id);
    } else if (response.status === 429) state = "pending";
    else if (response.status >= 400 && response.status < 500)
      state = "rejected";
  } catch {
    /* Ambiguous response. Ask the owner to check the destination before trying again. */
  }
  await storage(c)
    .prepare(
      "UPDATE training_exports SET state=?,provider_id=?,updated_at=? WHERE user_id=? AND workout_id=? AND state='sending'",
    )
    .bind(state, providerId, now(), me(c), id)
    .run();
  return c.json({ state });
});
