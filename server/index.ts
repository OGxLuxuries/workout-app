import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  canonical,
  compareVersion,
  validatePage,
  type Workout,
  type ImportPage,
} from "../shared/import";
import {
  addDays,
  dayStart,
  localDay,
  monday,
  progress,
  type ExerciseChoice,
} from "../shared/scoring";

type Env = {
  DB: D1Database;
  APP_ORIGIN: string;
  DEV_AUTH: string;
  BOOTSTRAP_INVITE?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_VERIFY_SERVICE_SID?: string;
};
type User = { id: string; name: string; phone: string; unit: string };
type Companion = { id: string; user_id: string; source_user_id: string };
type Run = {
  id: string;
  user_id: string;
  companion_id: string;
  status: string;
  scope_start: string;
  scope_end: string;
  page_count: number | null;
  updated_at: string;
};
type AppEnv = {
  Bindings: Env;
  Variables: { user: User; companion: Companion };
};
const app = new Hono<AppEnv>();
const now = () => new Date().toISOString();
const after = (ms: number) => new Date(Date.now() + ms).toISOString();
const token = () => crypto.randomUUID() + crypto.randomUUID();
async function hash(s: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
function fail(
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 429 | 503 = 400,
): never {
  throw new HTTPException(status, { message });
}
function db(c: Context<AppEnv>) {
  return c.env.DB;
}
async function one<T>(c: Context<AppEnv>, sql: string, ...args: any[]) {
  return db(c)
    .prepare(sql)
    .bind(...args)
    .first<T>();
}
async function rows<T = any>(c: Context<AppEnv>, sql: string, ...args: any[]) {
  return (
    await db(c)
      .prepare(sql)
      .bind(...args)
      .all<T>()
  ).results;
}
const realSms = (e: Env) =>
  !!(
    e.TWILIO_ACCOUNT_SID &&
    e.TWILIO_AUTH_TOKEN &&
    e.TWILIO_VERIFY_SERVICE_SID
  );
const devMode = (c: Context<AppEnv>) =>
  c.env.DEV_AUTH === "true" &&
  ["localhost", "127.0.0.1"].includes(new URL(c.env.APP_ORIGIN).hostname) &&
  ["localhost", "127.0.0.1"].includes(new URL(c.req.url).hostname);
app.onError((e, c) =>
  c.json(
    {
      error:
        e instanceof HTTPException
          ? e.message
          : e instanceof z.ZodError
            ? "Invalid request: " +
              e.issues.map((i) => i.path.join(".") + " " + i.message).join(";")
            : "Request could not be completed. Please retry.",
    },
    e instanceof HTTPException ? e.status : e instanceof z.ZodError ? 400 : 500,
  ),
);
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  if (["POST", "PUT", "DELETE", "PATCH"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin && origin !== c.env.APP_ORIGIN)
      fail("This request came from another website.", 403);
    if (
      !c.req.path.startsWith("/api/companion/") &&
      (!origin || c.req.header("X-Workout-Request") !== "1")
    )
      fail("Missing browser request verification.", 403);
    if (Number(c.req.header("Content-Length") || 0) > 2_000_000)
      fail("Request too large.");
  }
  await next();
});
async function rate(c: Context<AppEnv>, key: string, max: number, ms: number) {
  await db(c)
    .prepare(
      "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END",
    )
    .bind(key, after(ms), now(), now())
    .run();
  const r = await one<{ count: number }>(
    c,
    "SELECT count FROM rate_limits WHERE key=?",
    key,
  );
  if (r!.count > max)
    fail("Too many attempts. Please wait before trying again.", 429);
}
async function sms(
  c: Context<AppEnv>,
  action: string,
  body: Record<string, string>,
) {
  if (!realSms(c.env))
    fail("SMS login needs Twilio Verify configuration on the server.", 503);
  const r = await fetch(
    `https://verify.twilio.com/v2/Services/${c.env.TWILIO_VERIFY_SERVICE_SID}/${action}`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          btoa(`${c.env.TWILIO_ACCOUNT_SID}:${c.env.TWILIO_AUTH_TOKEN}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    },
  );
  if (!r.ok)
    fail(
      "SMS verification could not be completed. Check the number or try again later.",
      503,
    );
  return (await r.json()) as { status: string };
}
app.get("/api/config", (c) =>
  c.json({ devAuth: devMode(c), smsReady: realSms(c.env) }),
);
app.post("/api/auth/start", async (c) => {
  const input = z
    .object({
      phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
      name: z.string().trim().min(1).max(80),
      invite: z.string().optional(),
    })
    .parse(await c.req.json());
  const existing = await one<User>(
    c,
    "SELECT * FROM users WHERE phone=?",
    input.phone,
  );
  let inviteHash: string | null = null;
  if (!existing) {
    if (!input.invite) fail("An invitation is required to join.");
    inviteHash = await hash(input.invite);
    const count = await one<{ n: number }>(c, "SELECT count(*) n FROM users");
    if (
      count!.n === 0 &&
      c.env.BOOTSTRAP_INVITE &&
      input.invite === c.env.BOOTSTRAP_INVITE
    )
      await db(c)
        .prepare(
          "INSERT OR IGNORE INTO invitations(token_hash,expires_at) VALUES(?,?)",
        )
        .bind(inviteHash, after(86400000))
        .run();
    const invite = await one(
      c,
      "SELECT * FROM invitations WHERE token_hash=? AND used_by IS NULL AND expires_at>?",
      inviteHash,
      now(),
    );
    if (!invite) fail("This invitation is invalid or expired.");
  }
  if (!devMode(c) && !realSms(c.env))
    fail("SMS login needs Twilio Verify configuration on the server.", 503);
  await rate(c, "sms-global:" + now().slice(0, 10), 20, 86400000);
  await rate(c, "sms-phone:" + (await hash(input.phone)), 1, 60000);
  if (!devMode(c))
    await sms(c, "Verifications", { To: input.phone, Channel: "sms" });
  const id = token();
  await db(c)
    .prepare(
      "INSERT INTO auth_challenges(id,phone,name,invite_hash,expires_at) VALUES(?,?,?,?,?)",
    )
    .bind(await hash(id), input.phone, input.name, inviteHash, after(600000))
    .run();
  return c.json({ challenge: id, devAuth: devMode(c) });
});
app.post("/api/auth/verify", async (c) => {
  const input = z
    .object({ challenge: z.string(), code: z.string().regex(/^\d{6}$/) })
    .parse(await c.req.json());
  const challengeHash = await hash(input.challenge);
  const ch = await one<any>(
    c,
    "SELECT * FROM auth_challenges WHERE id=? AND consumed=0 AND expires_at>?",
    challengeHash,
    now(),
  );
  if (!ch) fail("This login attempt has expired.", 401);
  const attempt = await db(c)
    .prepare(
      "UPDATE auth_challenges SET attempts=attempts+1 WHERE id=? AND attempts<5 AND consumed=0 RETURNING id",
    )
    .bind(challengeHash)
    .first();
  if (!attempt)
    fail("Too many verification attempts. Request a new code.", 429);
  if (
    devMode(c)
      ? input.code !== "123456"
      : (await sms(c, "VerificationCheck", { To: ch.phone, Code: input.code }))
          .status !== "approved"
  )
    fail("The verification code is incorrect.", 401);
  const consumed = await db(c)
    .prepare(
      "UPDATE auth_challenges SET consumed=1 WHERE id=? AND consumed=0 RETURNING id",
    )
    .bind(challengeHash)
    .first();
  if (!consumed) fail("This code has already been used.", 409);
  let user = await one<User>(c, "SELECT * FROM users WHERE phone=?", ch.phone);
  if (!user) {
    const invitation = await one<any>(
      c,
      "SELECT * FROM invitations WHERE token_hash=? AND used_by IS NULL AND expires_at>?",
      ch.invite_hash,
      now(),
    );
    if (!invitation) fail("Invitation is no longer valid.", 409);
    const id = crypto.randomUUID();
    await db(c).batch([
      db(c)
        .prepare(
          "INSERT INTO users(id,name,phone,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM invitations WHERE token_hash=? AND used_by IS NULL AND expires_at>?)",
        )
        .bind(id, ch.name, ch.phone, now(), ch.invite_hash, now()),
      db(c)
        .prepare(
          "UPDATE invitations SET used_by=? WHERE token_hash=? AND used_by IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=?)",
        )
        .bind(id, ch.invite_hash, id),
      ...(invitation.inviter_id
        ? [
            db(c)
              .prepare(
                "INSERT OR IGNORE INTO sharing(a,b) SELECT ?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?)",
              )
              .bind(invitation.inviter_id, id, id),
          ]
        : []),
    ]);
    user = await one<User>(c, "SELECT * FROM users WHERE id=?", id);
    if (!user) fail("Invitation has already been used.", 409);
  }
  const session = token();
  await db(c)
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at,auth_mode) VALUES(?,?,?,?)",
    )
    .bind(
      await hash(session),
      user.id,
      after(30 * 86400000),
      devMode(c) ? "test" : "sms",
    )
    .run();
  setCookie(c, "wc_session", session, {
    httpOnly: true,
    sameSite: "Strict",
    secure: c.env.APP_ORIGIN.startsWith("https:"),
    path: "/",
    maxAge: 30 * 86400,
  });
  return c.json({ ok: true });
});
app.use("/api/app/*", async (c, next) => {
  const session = getCookie(c, "wc_session");
  if (!session) fail("Please sign in.", 401);
  const user = await one<User>(
    c,
    "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND (s.auth_mode='sms' OR ?=1)",
    await hash(session),
    now(),
    devMode(c) ? 1 : 0,
  );
  if (!user) fail("Your session has expired. Please sign in.", 401);
  c.set("user", user);
  await next();
});
app.post("/api/app/logout", async (c) => {
  await db(c)
    .prepare("DELETE FROM sessions WHERE token_hash=?")
    .bind(await hash(getCookie(c, "wc_session") || ""))
    .run();
  deleteCookie(c, "wc_session", { path: "/" });
  return c.json({ ok: true });
});
app.post("/api/app/invite", async (c) => {
  const raw = token();
  await db(c)
    .prepare("INSERT INTO invitations VALUES(?,?,?,NULL)")
    .bind(await hash(raw), c.get("user").id, after(7 * 86400000))
    .run();
  return c.json({ url: c.env.APP_ORIGIN + "/?invite=" + raw });
});
app.post("/api/app/sharing", async (c) => {
  const { partnerId, consent } = z
    .object({ partnerId: z.string(), consent: z.boolean() })
    .parse(await c.req.json());
  const id = c.get("user").id;
  await db(c)
    .prepare(
      "UPDATE sharing SET a_consent=CASE WHEN a=? THEN ? ELSE a_consent END,b_consent=CASE WHEN b=? THEN ? ELSE b_consent END WHERE (a=? AND b=?) OR (a=? AND b=?)",
    )
    .bind(id, +consent, id, +consent, id, partnerId, partnerId, id)
    .run();
  return c.json({ ok: true });
});
app.post("/api/app/preferences", async (c) => {
  const { unit } = z
    .object({ unit: z.enum(["lbs", "kg"]) })
    .parse(await c.req.json());
  await db(c)
    .prepare("UPDATE users SET unit=? WHERE id=?")
    .bind(unit, c.get("user").id)
    .run();
  return c.json({ ok: true });
});
app.post("/api/app/weights", async (c) => {
  const { day, weight, unit } = z
    .object({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      weight: z.number().positive().max(1500),
      unit: z.enum(["lbs", "kg"]),
    })
    .parse(await c.req.json());
  if (
    new Date(day + "T12:00:00Z").toISOString().slice(0, 10) !== day ||
    day > localDay(new Date())
  )
    fail("Choose a valid date no later than today.");
  await db(c)
    .prepare(
      "INSERT INTO weights VALUES(?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET kg=excluded.kg",
    )
    .bind(c.get("user").id, day, unit === "lbs" ? weight * 0.45359237 : weight)
    .run();
  return c.json({ ok: true });
});
app.post("/api/app/pair-code", async (c) => {
  const raw = crypto.randomUUID();
  await db(c)
    .prepare("INSERT INTO pair_codes VALUES(?,?,?,0)")
    .bind(await hash(raw), c.get("user").id, after(600000))
    .run();
  return c.json({ code: raw, expiresIn: 600 });
});
app.post("/api/app/revoke-companion", async (c) => {
  const id = c.get("user").id;
  await db(c).batch([
    db(c).prepare("UPDATE companions SET revoked=1 WHERE user_id=?").bind(id),
    db(c)
      .prepare(
        "DELETE FROM import_pages WHERE run_id IN (SELECT id FROM import_runs WHERE user_id=? AND status IN ('queued','running'))",
      )
      .bind(id),
    db(c)
      .prepare(
        "UPDATE import_runs SET status='failed',message='Companion revoked',updated_at=? WHERE user_id=? AND status IN ('queued','running')",
      )
      .bind(now(), id),
    db(c).prepare("UPDATE pair_codes SET used=1 WHERE user_id=?").bind(id),
  ]);
  return c.json({ ok: true });
});
app.post("/api/app/delete-data", async (c) => {
  const id = c.get("user").id;
  await db(c).batch([
    db(c).prepare("DELETE FROM import_runs WHERE user_id=?").bind(id),
    db(c).prepare("DELETE FROM workouts WHERE user_id=?").bind(id),
  ]);
  return c.json({ ok: true });
});
async function expireRuns(c: Context<AppEnv>, id: string) {
  const cutoff = new Date(Date.now() - 10 * 60000).toISOString();
  await db(c).batch([
    db(c)
      .prepare(
        "DELETE FROM import_pages WHERE run_id IN (SELECT id FROM import_runs WHERE user_id=? AND status IN ('queued','running') AND updated_at<?)",
      )
      .bind(id, cutoff),
    db(c)
      .prepare(
        "UPDATE import_runs SET status='needs_attention',message='Companion stopped responding. Restart it and retry.',updated_at=? WHERE user_id=? AND status IN ('queued','running') AND updated_at<?",
      )
      .bind(now(), id, cutoff),
  ]);
}
app.post("/api/app/sync", async (c) => {
  const { mode } = z
    .object({ mode: z.enum(["full", "probe"]).default("full") })
    .parse(await c.req.json());
  const user = c.get("user");
  await expireRuns(c, user.id);
  const companion = await one<any>(
    c,
    "SELECT * FROM companions WHERE user_id=? AND revoked=0",
    user.id,
  );
  if (!companion) fail("Pair your local Codex companion first.", 409);
  if (
    !companion.last_seen ||
    Date.parse(companion.last_seen) < Date.now() - 60000
  )
    fail(
      "Your companion is offline. Start it on your computer, then retry.",
      409,
    );
  const last = await one<any>(
    c,
    "SELECT scope_end FROM import_runs WHERE user_id=? AND status='completed' AND mode='full' ORDER BY scope_end DESC LIMIT 1",
    user.id,
  );
  const end = now(),
    start = new Date(
      last
        ? Date.parse(last.scope_end) - 7 * 86400000
        : Date.now() - 90 * 86400000,
    ).toISOString(),
    id = crypto.randomUUID();
  await db(c)
    .prepare(
      "INSERT OR IGNORE INTO import_runs(id,user_id,companion_id,status,scope_start,scope_end,created_at,updated_at,mode) VALUES(?,?,?,'queued',?,?,?,?,?)",
    )
    .bind(id, user.id, companion.id, start, end, end, end, mode)
    .run();
  return c.json(
    await one(
      c,
      "SELECT * FROM import_runs WHERE user_id=? AND status IN ('queued','running')",
      user.id,
    ),
  );
});
async function relation(c: Context<AppEnv>, partner: string) {
  const id = c.get("user").id;
  return one<any>(
    c,
    "SELECT * FROM sharing WHERE ((a=? AND b=?) OR (a=? AND b=?)) AND a_consent=1 AND b_consent=1",
    id,
    partner,
    partner,
    id,
  );
}
app.post("/api/app/competition", async (c) => {
  const { partnerId, startDay, choices } = z
    .object({
      partnerId: z.string(),
      startDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      choices: z
        .array(
          z.object({
            id: z.string(),
            equipment: z.string(),
            type: z.literal("weight_reps"),
          }),
        )
        .min(1)
        .max(30),
    })
    .parse(await c.req.json());
  if (!(await relation(c, partnerId)))
    fail("Both participants must consent to sharing.", 403);
  if (monday(startDay) !== startDay || startDay <= localDay(new Date()))
    fail("Choose a future Monday.");
  const id = c.get("user").id;
  const shared = await rows<any>(
    c,
    "SELECT DISTINCT template_id,equipment,exercise_type FROM exercises WHERE user_id=? AND exercise_type='weight_reps' AND equipment IS NOT NULL INTERSECT SELECT DISTINCT template_id,equipment,exercise_type FROM exercises WHERE user_id=? AND exercise_type='weight_reps' AND equipment IS NOT NULL",
    id,
    partnerId,
  );
  if (
    choices.some(
      (x) =>
        !shared.some(
          (e) =>
            e.template_id === x.id &&
            e.equipment === x.equipment &&
            e.exercise_type === x.type,
        ),
    )
  )
    fail("Choose only resolved exercise variants present in both histories.");
  await db(c)
    .prepare("INSERT INTO competitions VALUES(?,?,?,?,?,1,0,?)")
    .bind(
      crypto.randomUUID(),
      id,
      partnerId,
      startDay,
      JSON.stringify(choices),
      now(),
    )
    .run();
  return c.json({ ok: true });
});
app.post("/api/app/competition/:id/approve", async (c) => {
  const id = c.get("user").id;
  const comp = await one<any>(
    c,
    "SELECT * FROM competitions WHERE id=? AND (a=? OR b=?)",
    c.req.param("id"),
    id,
    id,
  );
  if (!comp) fail("Competition not found.", 404);
  if (comp.start_day <= localDay(new Date()))
    fail("This start date has passed. Propose a new competition.", 409);
  if (!(await relation(c, comp.a === id ? comp.b : comp.a)))
    fail("Sharing consent is required.", 403);
  await db(c)
    .prepare(
      "UPDATE competitions SET a_approved=CASE WHEN a=? THEN 1 ELSE a_approved END,b_approved=CASE WHEN b=? THEN 1 ELSE b_approved END WHERE id=?",
    )
    .bind(id, id, comp.id)
    .run();
  return c.json({ ok: true });
});
app.get("/api/app/dashboard", async (c) => {
  const user = c.get("user");
  await expireRuns(c, user.id);
  const sharing = await rows<any>(
    c,
    "SELECT s.*,u.name partner_name,CASE WHEN s.a=? THEN s.b ELSE s.a END partner_id FROM sharing s JOIN users u ON u.id=CASE WHEN s.a=? THEN s.b ELSE s.a END WHERE s.a=? OR s.b=?",
    user.id,
    user.id,
    user.id,
    user.id,
  );
  const ids = [
    user.id,
    ...sharing
      .filter((s) => s.a_consent && s.b_consent)
      .map((s) => s.partner_id),
  ];
  const people: any[] = [];
  for (const id of ids) {
    const profile = await one<any>(
      c,
      "SELECT id,name,unit FROM users WHERE id=?",
      id,
    );
    const workouts = (
      await rows<{ data: string }>(
        c,
        "SELECT data FROM workouts WHERE user_id=? ORDER BY start_time DESC",
        id,
      )
    ).map((w) => JSON.parse(w.data) as Workout);
    const weights = await rows<{ day: string; kg: number }>(
      c,
      "SELECT day,kg FROM weights WHERE user_id=? ORDER BY day DESC",
      id,
    );
    const ranges = await rows<{ start: string; end: string }>(
      c,
      "SELECT scope_start start,scope_end end FROM import_runs WHERE user_id=? AND status='completed' AND mode='full'",
      id,
    );
    const imports = await rows<any>(
      c,
      "SELECT id,status,mode,scope_start,scope_end,completed_at,created_at,counts,message FROM import_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 10",
      id,
    );
    people.push({ ...profile, workouts, weights, ranges, imports });
  }
  const competitions = (
    await rows<any>(
      c,
      "SELECT * FROM competitions WHERE a=? OR b=? ORDER BY created_at DESC",
      user.id,
      user.id,
    )
  ).filter((co) => ids.includes(co.a) && ids.includes(co.b));
  const week = monday(localDay(new Date()));
  const results = competitions
    .filter((co) => co.a_approved && co.b_approved)
    .map((co) => ({
      ...co,
      choices: JSON.parse(co.choices),
      results: people
        .filter((p) => p.id === co.a || p.id === co.b)
        .map((p) => ({
          userId: p.id,
          name: p.name,
          current: progress(
            p.workouts,
            p.weights,
            JSON.parse(co.choices),
            co.start_day,
            week,
            p.ranges,
          ),
          last: progress(
            p.workouts,
            p.weights,
            JSON.parse(co.choices),
            co.start_day,
            addDays(week, -7),
            p.ranges,
          ),
        })),
    }));
  return c.json({
    me: { id: user.id, name: user.name, unit: user.unit },
    sharing,
    people,
    competitions,
    results,
    companion: await one(
      c,
      "SELECT id,last_seen,source_user_id FROM companions WHERE user_id=? AND revoked=0",
      user.id,
    ),
  });
});

app.post("/api/companion/pair", async (c) => {
  const { code, sourceUserId } = z
    .object({
      code: z.string().max(100),
      sourceUserId: z.string().min(1).max(160),
    })
    .parse(await c.req.json());
  await rate(c, "pair:" + (await hash(code)), 5, 600000);
  const codeHash = await hash(code);
  const pair = await one<any>(
    c,
    "SELECT * FROM pair_codes WHERE code_hash=? AND used=0 AND expires_at>?",
    codeHash,
    now(),
  );
  if (!pair) fail("Pairing code is invalid or expired.", 401);
  const existing = await one<any>(
    c,
    "SELECT * FROM companions WHERE user_id=? AND revoked=0",
    pair.user_id,
  );
  if (existing)
    fail("Revoke the existing companion before pairing again.", 409);
  const priorSource = await one<any>(
    c,
    "SELECT source_user_id FROM companions WHERE user_id=? ORDER BY last_seen DESC LIMIT 1",
    pair.user_id,
  );
  const priorData = await one<any>(
    c,
    "SELECT id FROM import_runs WHERE user_id=? LIMIT 1",
    pair.user_id,
  );
  if (priorSource && priorSource.source_user_id !== sourceUserId && priorData)
    fail(
      "Delete imported data before switching to a different Hevy account.",
      409,
    );
  const bound = await one<any>(
    c,
    "SELECT user_id FROM companions WHERE source_user_id=?",
    sourceUserId,
  );
  if (bound && bound.user_id !== pair.user_id)
    fail("This Hevy account is already paired with another participant.", 409);
  const raw = token(),
    id = crypto.randomUUID();
  const used = await db(c)
    .prepare(
      "UPDATE pair_codes SET used=1 WHERE code_hash=? AND used=0 RETURNING user_id",
    )
    .bind(codeHash)
    .first();
  if (!used) fail("Pairing code has already been used.", 409);
  await db(c)
    .prepare(
      "INSERT INTO companions(id,user_id,token_hash,source_user_id,revoked,last_seen) VALUES(?,?,?,?,0,?) ON CONFLICT(source_user_id) DO UPDATE SET token_hash=excluded.token_hash,revoked=0,last_seen=excluded.last_seen",
    )
    .bind(id, pair.user_id, await hash(raw), sourceUserId, now())
    .run();
  return c.json({ token: raw });
});
app.use("/api/companion/*", async (c, next) => {
  const raw = c.req.header("Authorization")?.replace(/^Bearer /, "");
  if (!raw) fail("Companion authentication required.", 401);
  const comp = await one<Companion>(
    c,
    "SELECT * FROM companions WHERE token_hash=? AND revoked=0",
    await hash(raw),
  );
  if (!comp) fail("Companion credential is revoked or invalid.", 401);
  c.set("companion", comp);
  await next();
});
app.post("/api/companion/next", async (c) => {
  const comp = c.get("companion");
  await db(c)
    .prepare("UPDATE companions SET last_seen=? WHERE id=?")
    .bind(now(), comp.id)
    .run();
  await expireRuns(c, comp.user_id);
  const run = await db(c)
    .prepare(
      "UPDATE import_runs SET status='running',updated_at=? WHERE id=(SELECT id FROM import_runs WHERE user_id=? AND companion_id=? AND status='queued' LIMIT 1) AND status='queued' RETURNING *",
    )
    .bind(now(), comp.user_id, comp.id)
    .first<Run>();
  return c.json({
    job: run
      ? {
          id: run.id,
          start: run.scope_start,
          end: run.scope_end,
          mode: (run as any).mode,
        }
      : null,
  });
});
async function ownedRun(c: Context<AppEnv>) {
  const comp = c.get("companion");
  const run = await one<Run>(
    c,
    "SELECT * FROM import_runs WHERE id=? AND user_id=? AND companion_id=? AND status='running'",
    c.req.param("id"),
    comp.user_id,
    comp.id,
  );
  if (!run) fail("Import is no longer active.", 409);
  return run;
}
app.post("/api/companion/jobs/:id/heartbeat", async (c) => {
  const r = await ownedRun(c);
  await db(c).batch([
    db(c)
      .prepare(
        "UPDATE import_runs SET updated_at=? WHERE id=? AND status='running'",
      )
      .bind(now(), r.id),
    db(c)
      .prepare("UPDATE companions SET last_seen=? WHERE id=?")
      .bind(now(), c.get("companion").id),
  ]);
  return c.json({ ok: true });
});
app.post("/api/companion/jobs/:id/page", async (c) => {
  const run = await ownedRun(c);
  let page: ImportPage;
  try {
    page = validatePage(await c.req.json());
  } catch (e) {
    fail((e as Error).message);
  }
  if (page.sourceUserId !== c.get("companion").source_user_id)
    fail("Connected Hevy account changed. Revoke and pair again.", 409);
  if (
    (run as any).mode === "probe" &&
    (page.page !== 1 || page.workouts.length > 1)
  )
    fail("Connection tests accept only the first source workout.");
  const prior = await rows<{ page: number; data: string }>(
    c,
    "SELECT * FROM import_pages WHERE run_id=? ORDER BY page",
    run.id,
  );
  const same = prior.find((p) => p.page === page.page);
  if (same) {
    if (same.data !== JSON.stringify(page))
      fail("Page changed during retry. Start a fresh sync.", 409);
    return c.json({ ok: true });
  }
  if (page.page !== prior.length + 1) fail("Pages must arrive in order.");
  if (prior.length && JSON.parse(prior[0].data).pageCount !== page.pageCount)
    fail("Workout pagination changed during import. Retry.", 409);
  const oldIds = new Set(
    prior.flatMap((p) =>
      (JSON.parse(p.data) as ImportPage).workouts.map((w) => w.id),
    ),
  );
  if (page.workouts.some((w) => oldIds.has(w.id)))
    fail("Workout appeared on multiple pages. Retry a fresh sync.", 409);
  await db(c).batch([
    db(c)
      .prepare(
        "INSERT INTO import_pages SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM import_runs WHERE id=? AND status='running')",
      )
      .bind(run.id, page.page, JSON.stringify(page), run.id),
    db(c)
      .prepare(
        "UPDATE import_runs SET page_count=?,updated_at=? WHERE id=? AND status='running'",
      )
      .bind(page.pageCount, now(), run.id),
  ]);
  return c.json({ ok: true });
});
app.post("/api/companion/jobs/:id/fail", async (c) => {
  const run = await ownedRun(c);
  const { message } = z
    .object({ message: z.string().max(500) })
    .parse(await c.req.json());
  await db(c).batch([
    db(c)
      .prepare(
        "UPDATE import_runs SET status='needs_attention',message=?,updated_at=? WHERE id=? AND status='running'",
      )
      .bind(message, now(), run.id),
    db(c).prepare("DELETE FROM import_pages WHERE run_id=?").bind(run.id),
  ]);
  return c.json({ ok: true });
});
app.post("/api/companion/jobs/:id/complete", async (c) => {
  const run = await ownedRun(c);
  const pages = (
    await rows<{ data: string }>(
      c,
      "SELECT data FROM import_pages WHERE run_id=? ORDER BY page",
      run.id,
    )
  ).map((p) => validatePage(JSON.parse(p.data)));
  if (
    !pages.length ||
    pages.length !==
      ((run as any).mode === "probe" ? 1 : Math.max(1, pages[0].pageCount)) ||
    pages.some((p, i) => p.page !== i + 1)
  )
    fail("Import is missing pages.", 409);
  const incoming = pages
    .flatMap((p) => p.workouts)
    .filter(
      (w) =>
        (run as any).mode === "probe" ||
        (Date.parse(w.start_time) >= Date.parse(run.scope_start) &&
          Date.parse(w.start_time) < Date.parse(run.scope_end)),
    );
  const existing = new Map(
    (
      await rows<{ source_id: string; data: string }>(
        c,
        "SELECT source_id,data FROM workouts WHERE user_id=?",
        run.user_id,
      )
    ).map((w) => [w.source_id, JSON.parse(w.data) as Workout]),
  );
  const counts = { inserted: 0, updated: 0, unchanged: 0, stale: 0 };
  const statements: D1PreparedStatement[] = [];
  const guard =
    "EXISTS(SELECT 1 FROM import_runs WHERE id=? AND status='running')";
  for (const w of incoming) {
    let action: "inserted" | "updated" | "unchanged" | "stale" = "inserted";
    try {
      if (existing.has(w.id)) action = compareVersion(existing.get(w.id)!, w);
    } catch (e) {
      fail((e as Error).message, 409);
    }
    counts[action]++;
    if (action === "unchanged" || action === "stale") continue;
    statements.push(
      db(c)
        .prepare(
          `DELETE FROM workouts WHERE user_id=? AND source_id=? AND ${guard}`,
        )
        .bind(run.user_id, w.id, run.id),
    );
    statements.push(
      db(c)
        .prepare(`INSERT INTO workouts SELECT ?,?,?,?,? WHERE ${guard}`)
        .bind(
          run.user_id,
          w.id,
          w.updated_at,
          w.start_time,
          canonical(w),
          run.id,
        ),
    );
    for (const e of w.exercises)
      statements.push(
        db(c)
          .prepare(`INSERT INTO exercises SELECT ?,?,?,?,?,?,? WHERE ${guard}`)
          .bind(
            run.user_id,
            w.id,
            e.index,
            e.exercise_template_id,
            e.title,
            e.equipment,
            e.exercise_type,
            run.id,
          ),
      );
    for (const e of w.exercises)
      for (const s of e.sets)
        statements.push(
          db(c)
            .prepare(`INSERT INTO sets SELECT ?,?,?,?,?,?,? WHERE ${guard}`)
            .bind(
              run.user_id,
              w.id,
              e.index,
              s.index,
              s.type,
              s.reps,
              s.weight_kg,
              run.id,
            ),
        );
  }
  statements.push(
    db(c)
      .prepare(
        "UPDATE import_runs SET status='completed',completed_at=?,updated_at=?,counts=?,message=NULL WHERE id=? AND status='running'",
      )
      .bind(now(), now(), JSON.stringify(counts), run.id),
  );
  statements.push(
    db(c).prepare("DELETE FROM import_pages WHERE run_id=?").bind(run.id),
  );
  await db(c).batch(statements);
  const completed = await one<any>(
    c,
    "SELECT status FROM import_runs WHERE id=?",
    run.id,
  );
  if (completed?.status !== "completed")
    fail("Import was cancelled before commit.", 409);
  return c.json({ ok: true, counts });
});
app.notFound((c) => c.json({ error: "Not found" }, 404));
export default app;
