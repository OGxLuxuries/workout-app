import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  googleAuthorizationUrl,
  googleCallback,
  verifyGoogleSignIn,
} from "./google";
import {
  canonical,
  compareVersion,
  validatePage,
  type Workout,
  type ImportPage,
} from "../shared/import";
import { allTimeStart } from "../shared/sync";
import { manualPrefix } from "../shared/training";
import { loggedWorkoutSchema } from "../shared/training-schema";
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
  AUTH_PROVIDER?: "google";
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  OLIVER_GOOGLE_EMAIL?: string;
  BOOTSTRAP_INVITE?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_VERIFY_SERVICE_SID?: string;
};
type User = { id: string; name: string; login_key: string; unit: string };
type PlayerSlot = { name: string; user_id: string | null };
type Sharing = {
  a: string;
  b: string;
  a_consent: number;
  b_consent: number;
  partner_id: string;
  partner_name: string;
};
type Competition = {
  id: string;
  start_day: string;
  choices: ExerciseChoice[];
  members: { id: string; name: string; approved: boolean }[];
};
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
const googleMode = (c: Context<AppEnv>) => c.env.AUTH_PROVIDER === "google";
const googleReady = (c: Context<AppEnv>) =>
  googleMode(c) &&
  !!(
    c.env.GOOGLE_CLIENT_ID &&
    c.env.GOOGLE_CLIENT_SECRET &&
    c.env.OLIVER_GOOGLE_EMAIL
  );
const normalizeEmail = (s: string) => s.trim().toLowerCase();
const devMode = (c: Context<AppEnv>) =>
  !googleMode(c) &&
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
  c.header("Referrer-Policy", "no-referrer");
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
  c.json({
    devAuth: devMode(c),
    smsReady: !googleMode(c) && realSms(c.env),
    googleAuth: googleMode(c),
    googleReady: googleReady(c),
  }),
);
async function startSession(
  c: Context<AppEnv>,
  userId: string,
  mode: "google" | "test" | "sms",
) {
  const session = token();
  await db(c)
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at,auth_mode) VALUES(?,?,?,?)",
    )
    .bind(await hash(session), userId, after(30 * 86400000), mode)
    .run();
  setCookie(c, "wc_session", session, {
    httpOnly: true,
    sameSite: mode === "google" ? "Lax" : "Strict",
    secure: c.env.APP_ORIGIN.startsWith("https:"),
    path: "/",
    maxAge: 30 * 86400,
  });
}

app.post("/api/auth/google/start", async (c) => {
  if (!googleReady(c)) fail("Google sign-in is not configured.", 503);
  const { invite } = z
    .object({ invite: z.string().max(100).optional() })
    .parse(await c.req.json());
  await rate(
    c,
    "google-start:" + (await hash(c.req.header("CF-Connecting-IP") || "local")),
    20,
    600000,
  );
  const state = token(),
    browser = token(),
    nonce = token(),
    verifier = token();
  await db(c).batch([
    db(c)
      .prepare("DELETE FROM google_sign_ins WHERE expires_at<=?")
      .bind(now()),
    db(c)
      .prepare("INSERT INTO google_sign_ins VALUES(?,?,?,?,?,?)")
      .bind(
        await hash(state),
        await hash(browser),
        verifier,
        nonce,
        invite ? await hash(invite) : null,
        after(600000),
      ),
  ]);
  setCookie(c, "wc_google", browser, {
    path: googleCallback,
    httpOnly: true,
    secure: c.env.APP_ORIGIN.startsWith("https:"),
    sameSite: "Lax",
    maxAge: 600,
  });
  return c.json({
    url: await googleAuthorizationUrl({
      clientId: c.env.GOOGLE_CLIENT_ID!,
      origin: c.env.APP_ORIGIN,
      state,
      nonce,
      verifier,
    }),
  });
});

async function enrollWithGoogle(
  c: Context<AppEnv>,
  loginKey: string,
  email: string,
  inviteHash: string | null,
) {
  const isOliver = normalizeEmail(c.env.OLIVER_GOOGLE_EMAIL!) === email;
  if (!isOliver && !inviteHash) return null;
  const criteria = isOliver
    ? "p.name='Oliver'"
    : `p.name<>'Oliver' AND EXISTS (
    SELECT 1 FROM invitations i WHERE i.player_name=p.name AND i.token_hash=?
    AND i.google_email=? AND i.used_by IS NULL AND i.expires_at>?)`;
  const eligible = `SELECT p.name,p.user_id FROM player_slots p LEFT JOIN users u ON u.id=p.user_id
    WHERE (p.user_id IS NULL OR u.login_key='pending:'||u.id) AND ${criteria}`;
  const invitationArgs = isOliver ? [] : [inviteHash, email, now()];
  const slot = await one<PlayerSlot>(c, eligible, ...invitationArgs);
  if (!slot) return null;
  const id = slot.user_id ?? crypto.randomUUID();
  await db(c).batch([
    db(c)
      .prepare(
        `UPDATE users SET login_key=? WHERE id=? AND id=(SELECT user_id FROM (${eligible}))`,
      )
      .bind(loginKey, id, ...invitationArgs),
    db(c)
      .prepare(
        `INSERT INTO users(id,name,login_key,created_at) SELECT ?,name,?,? FROM (${eligible}) WHERE user_id IS NULL`,
      )
      .bind(id, loginKey, now(), ...invitationArgs),
    db(c)
      .prepare(
        "UPDATE player_slots SET user_id=? WHERE name=? AND user_id IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=? AND login_key=?)",
      )
      .bind(id, slot.name, id, loginKey),
    db(c)
      .prepare(
        "UPDATE invitations SET used_by=? WHERE player_name=? AND used_by IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=? AND login_key=?)",
      )
      .bind(id, slot.name, id, loginKey),
    db(c)
      .prepare(
        `INSERT INTO sharing(a,b) SELECT u.id,? FROM users u WHERE u.id<>?
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND login_key=?)
      AND NOT EXISTS(SELECT 1 FROM sharing s WHERE (s.a=u.id AND s.b=?) OR (s.a=? AND s.b=u.id))`,
      )
      .bind(id, id, id, loginKey, id, id),
  ]);
  return one<User>(
    c,
    "SELECT * FROM users WHERE id=? AND login_key=?",
    id,
    loginKey,
  );
}

app.get(googleCallback, async (c) => {
  const back = (error?: string) =>
    c.redirect(error ? `/?signin=${error}` : "/", 303);
  if (!googleReady(c)) return back("unavailable");
  const state = c.req.query("state"),
    browser = getCookie(c, "wc_google");
  if (!state || state.length > 100 || !browser || browser.length > 100)
    return back("expired");
  const attempt = await db(c)
    .prepare(
      `DELETE FROM google_sign_ins WHERE state_hash=? AND browser_hash=? AND expires_at>?
    RETURNING verifier, nonce, invite_hash`,
    )
    .bind(await hash(state), await hash(browser), now())
    .first<{ verifier: string; nonce: string; invite_hash: string | null }>();
  if (!attempt) return back("expired");
  deleteCookie(c, "wc_google", { path: googleCallback });
  const code = c.req.query("code");
  if (!code || code.length > 4096 || c.req.query("error"))
    return back("canceled");
  let identity: Awaited<ReturnType<typeof verifyGoogleSignIn>>;
  try {
    identity = await verifyGoogleSignIn({
      clientId: c.env.GOOGLE_CLIENT_ID!,
      clientSecret: c.env.GOOGLE_CLIENT_SECRET!,
      origin: c.env.APP_ORIGIN,
      code,
      verifier: attempt.verifier,
      nonce: attempt.nonce,
    });
  } catch {
    return back("verification");
  }
  const loginKey = "google:" + identity.subject;
  const user =
    (await one<User>(c, "SELECT * FROM users WHERE login_key=?", loginKey)) ??
    (await enrollWithGoogle(c, loginKey, identity.email, attempt.invite_hash));
  if (!user) return back("invitation");
  await startSession(c, user.id, "google");
  return back();
});

const openInvitation = `SELECT i.* FROM invitations i JOIN player_slots p ON p.name=i.player_name
  WHERE i.token_hash=? AND i.used_by IS NULL AND i.expires_at>? AND p.user_id IS NULL`;
app.post("/api/auth/start", async (c) => {
  if (googleMode(c)) fail("Use Sign in with Google.", 404);
  const input = z
    .object({
      phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
      name: z.string().trim().min(1).max(80),
      invite: z.string().optional(),
    })
    .parse(await c.req.json());
  const existing = await one<User>(
    c,
    "SELECT * FROM users WHERE login_key=?",
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
          `INSERT INTO invitations(token_hash,expires_at,player_name) VALUES(?,?,'Oliver')
           ON CONFLICT(token_hash) DO UPDATE SET player_name='Oliver',expires_at=excluded.expires_at
           WHERE invitations.inviter_id IS NULL AND invitations.used_by IS NULL`,
        )
        .bind(inviteHash, after(86400000))
        .run();
    const invite = await one(c, openInvitation, inviteHash, now());
    if (!invite)
      fail(
        "This invitation is invalid, expired, or the player has already joined.",
      );
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
  if (googleMode(c)) fail("Use Sign in with Google.", 404);
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
  let user = await one<User>(
    c,
    "SELECT * FROM users WHERE login_key=?",
    ch.phone,
  );
  if (!user) {
    const id = crypto.randomUUID();
    await db(c).batch([
      db(c)
        .prepare(
          `INSERT INTO users(id,name,login_key,created_at) SELECT ?,i.player_name,?,? FROM (${openInvitation}) i`,
        )
        .bind(id, ch.phone, now(), ch.invite_hash, now()),
      db(c)
        .prepare(
          "UPDATE player_slots SET user_id=? WHERE name=(SELECT player_name FROM invitations WHERE token_hash=?) AND EXISTS(SELECT 1 FROM users WHERE id=?)",
        )
        .bind(id, ch.invite_hash, id),
      db(c)
        .prepare(
          "UPDATE invitations SET used_by=? WHERE token_hash=? AND used_by IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=?)",
        )
        .bind(id, ch.invite_hash, id),
      db(c)
        .prepare(
          "INSERT INTO sharing(a,b) SELECT id,? FROM users WHERE id<>? AND EXISTS(SELECT 1 FROM users WHERE id=?)",
        )
        .bind(id, id, id),
    ]);
    user = await one<User>(c, "SELECT * FROM users WHERE id=?", id);
    if (!user) fail("Invitation has already been used.", 409);
  }
  await startSession(c, user.id, devMode(c) ? "test" : "sms");
  return c.json({ ok: true });
});
app.use("/api/app/*", async (c, next) => {
  const session = getCookie(c, "wc_session");
  if (!session) fail("Please sign in.", 401);
  const user = await one<User>(
    c,
    "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND s.auth_mode=?",
    await hash(session),
    now(),
    googleMode(c) ? "google" : devMode(c) ? "test" : "sms",
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
  const { playerName, googleEmail } = z
    .object({
      playerName: z.string(),
      googleEmail: z.string().trim().max(254).pipe(z.email()).optional(),
    })
    .parse(await c.req.json());
  const userId = c.get("user").id;
  if (googleMode(c)) {
    const organizer = await one(
      c,
      "SELECT name FROM player_slots WHERE name='Oliver' AND user_id=?",
      userId,
    );
    if (!organizer) fail("Oliver manages invitations for the roster.", 403);
    if (
      !googleEmail ||
      normalizeEmail(googleEmail) ===
        normalizeEmail(c.env.OLIVER_GOOGLE_EMAIL!) ||
      playerName === "Oliver"
    )
      fail("Enter the Google email for the invited player.");
  }
  const raw = token();
  const inviteHash = await hash(raw);
  const email = googleMode(c) ? normalizeEmail(googleEmail!) : null;
  const [created] = await db(c).batch([
    db(c)
      .prepare(
        `INSERT INTO invitations(token_hash,inviter_id,expires_at,player_name,google_email)
      SELECT ?,?,?,p.name,? FROM player_slots p LEFT JOIN users u ON u.id=p.user_id
      WHERE p.name=? AND (p.user_id IS NULL OR (?=1 AND u.login_key='pending:'||u.id))`,
      )
      .bind(
        inviteHash,
        userId,
        after(7 * 86400000),
        email,
        playerName,
        Number(googleMode(c)),
      ),
    db(c)
      .prepare(
        `DELETE FROM invitations WHERE player_name=? AND used_by IS NULL AND token_hash<>?
      AND EXISTS(SELECT 1 FROM invitations WHERE token_hash=?) AND ?=1`,
      )
      .bind(playerName, inviteHash, inviteHash, Number(googleMode(c))),
  ]);
  if (!created.meta.changes)
    fail("That player is already enrolled or is outside the roster.", 409);
  return c.json({
    url:
      c.env.APP_ORIGIN +
      "/?invite=" +
      raw +
      "&player=" +
      encodeURIComponent(playerName),
  });
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
    db(c)
      .prepare(
        "DELETE FROM workouts WHERE user_id=? AND source_id NOT LIKE 'manual:%'",
      )
      .bind(id),
  ]);
  return c.json({ ok: true });
});
app.post("/api/app/workouts/log", async (c) => {
  const input = loggedWorkoutSchema.parse(await c.req.json());
  const userId = c.get("user").id;
  const start = new Date(input.startedAt);
  const end = new Date(input.finishedAt);
  if (+start > +end || +end > Date.now() + 120000)
    fail("Check your device time and try saving again.");

  const workout: Workout = {
    id: manualPrefix + input.id,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    updated_at: end.toISOString(),
    exercises: await Promise.all(
      input.exercises.map(async (entry, index) => {
        const known = entry.templateId
          ? await one<{
              title: string;
              equipment: string | null;
              exercise_type: string | null;
            }>(
              c,
              `SELECT e.title,e.equipment,e.exercise_type FROM exercises e
        WHERE e.template_id=? AND (e.user_id=? OR EXISTS(
          SELECT 1 FROM sharing s WHERE s.a_consent=1 AND s.b_consent=1
          AND ((s.a=? AND s.b=e.user_id) OR (s.b=? AND s.a=e.user_id))
        )) ORDER BY e.user_id<>? LIMIT 1`,
              entry.templateId,
              userId,
              userId,
              userId,
              userId,
            )
          : null;
        if (entry.templateId && !known)
          fail(
            "An exercise is no longer in your library. Remove it or add it as a custom exercise.",
            409,
          );
        const title = entry.title.replace(/\s+/g, " ");
        const variant = [
          entry.equipment,
          title.normalize("NFKC").toLowerCase(),
        ].join(":");
        const bodyweight = known
          ? known.exercise_type === "reps_only"
          : entry.equipment === "bodyweight";
        return {
          index,
          exercise_template_id:
            entry.templateId ?? "logged:" + (await hash(variant)),
          title: known?.title ?? title,
          equipment: known ? known.equipment : entry.equipment,
          exercise_type: known
            ? known.exercise_type
            : bodyweight
              ? "reps_only"
              : "weight_reps",
          sets: entry.sets.map((s, index) => ({
            index,
            type: s.warmup ? "warmup" : "normal",
            reps: s.reps,
            weight_kg: bodyweight ? null : s.weightKg,
          })),
        };
      }),
    ),
  };
  const data = canonical(workout);
  const [saved] = await db(c).batch([
    db(c)
      .prepare(
        `INSERT INTO workouts(user_id,source_id,updated_at,start_time,data)
      VALUES(?,?,?,?,?) ON CONFLICT(user_id,source_id) DO NOTHING`,
      )
      .bind(userId, workout.id, workout.updated_at, workout.start_time, data),
    db(c)
      .prepare(
        `INSERT OR IGNORE INTO exercises
      SELECT w.user_id,w.source_id,json_extract(e.value,'$.index'),
        json_extract(e.value,'$.exercise_template_id'),json_extract(e.value,'$.title'),
        json_extract(e.value,'$.equipment'),json_extract(e.value,'$.exercise_type')
      FROM workouts w,json_each(w.data,'$.exercises') e
      WHERE w.user_id=? AND w.source_id=? AND w.data=?`,
      )
      .bind(userId, workout.id, data),
    db(c)
      .prepare(
        `INSERT OR IGNORE INTO sets
      SELECT w.user_id,w.source_id,json_extract(e.value,'$.index'),json_extract(s.value,'$.index'),
        json_extract(s.value,'$.type'),json_extract(s.value,'$.reps'),json_extract(s.value,'$.weight_kg')
      FROM workouts w,json_each(w.data,'$.exercises') e,json_each(e.value,'$.sets') s
      WHERE w.user_id=? AND w.source_id=? AND w.data=?`,
      )
      .bind(userId, workout.id, data),
  ]);
  if (!saved.meta.changes) {
    const existing = await one<{ data: string }>(
      c,
      "SELECT data FROM workouts WHERE user_id=? AND source_id=?",
      userId,
      workout.id,
    );
    if (existing?.data !== data)
      fail("This workout was already saved. Open History to review it.", 409);
  }
  return c.json({ id: workout.id });
});
app.post("/api/app/workouts/remove", async (c) => {
  const { id } = z
    .object({ id: z.uuid() })
    .strict()
    .parse(await c.req.json());
  await db(c)
    .prepare("DELETE FROM workouts WHERE user_id=? AND source_id=?")
    .bind(c.get("user").id, manualPrefix + id)
    .run();
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
    Date.parse(companion.last_seen) < Date.now() - 90000
  )
    fail(
      "Your companion is offline. Start it on your computer, then retry.",
      409,
    );
  const last = await one<{ scope_end: string }>(
    c,
    `SELECT scope_end FROM import_runs WHERE user_id=? AND status='completed' AND mode='full'
     AND EXISTS (SELECT 1 FROM import_runs WHERE user_id=? AND status='completed' AND mode='full' AND scope_start=?)
     ORDER BY scope_end DESC LIMIT 1`,
    user.id,
    user.id,
    allTimeStart,
  );
  const end = now(),
    start =
      last && mode === "full"
        ? new Date(Date.parse(last.scope_end) - 7 * 86400000).toISOString()
        : allTimeStart,
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
function roster(c: Context<AppEnv>) {
  return rows<PlayerSlot>(
    c,
    `SELECT p.name,CASE WHEN ?=1 AND u.login_key NOT LIKE 'google:%' THEN NULL ELSE p.user_id END user_id
     FROM player_slots p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.position`,
    Number(googleMode(c)),
  );
}
function playerSharing(c: Context<AppEnv>) {
  const id = c.get("user").id;
  return rows<Sharing>(
    c,
    `SELECT s.*,u.name partner_name,u.id partner_id FROM sharing s
    JOIN users u ON u.id=CASE WHEN s.a=? THEN s.b ELSE s.a END
    LEFT JOIN player_slots p ON p.user_id=u.id WHERE (s.a=? OR s.b=?) AND (?=0 OR u.login_key LIKE 'google:%')
    ORDER BY p.position,u.name`,
    id,
    id,
    id,
    Number(googleMode(c)),
  );
}
function canViewPlayers(c: Context<AppEnv>, ids: string[], sharing: Sharing[]) {
  return ids.every(
    (id) =>
      id === c.get("user").id ||
      sharing.some((s) => s.partner_id === id && s.a_consent && s.b_consent),
  );
}
app.post("/api/app/competition", async (c) => {
  const { startDay, choices } = z
    .object({
      startDay: z.iso.date(),
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
  const slots = await roster(c);
  const members = slots.flatMap((p) => (p.user_id ? [p.user_id] : []));
  const id = c.get("user").id;
  if (members.length !== slots.length || !members.includes(id))
    fail("All four players must join before proposing a competition.", 409);
  if (!canViewPlayers(c, members, await playerSharing(c)))
    fail("Set up mutual sharing with every player first.", 403);
  if (monday(startDay) !== startDay || startDay <= localDay(new Date()))
    fail("Choose a future Monday.");
  const shared = await rows<{
    template_id: string;
    equipment: string;
    exercise_type: string;
  }>(
    c,
    `SELECT template_id,equipment,exercise_type FROM exercises
     WHERE user_id IN (${members.map(() => "?").join(",")}) AND exercise_type='weight_reps' AND equipment IS NOT NULL
     GROUP BY template_id,equipment,exercise_type HAVING count(DISTINCT user_id)=?`,
    ...members,
    members.length,
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
    fail("Choose exercise variants present in all four workout histories.");
  const competitionId = crypto.randomUUID();
  await db(c).batch([
    db(c)
      .prepare("INSERT INTO competitions VALUES(?,?,?,?)")
      .bind(competitionId, startDay, JSON.stringify(choices), now()),
    ...members.map((member) =>
      db(c)
        .prepare("INSERT INTO competition_members VALUES(?,?,?)")
        .bind(competitionId, member, Number(member === id)),
    ),
  ]);
  return c.json({ ok: true });
});
app.post("/api/app/competition/:id/approve", async (c) => {
  const id = c.get("user").id;
  const comp = await one<any>(
    c,
    "SELECT c.id,c.start_day FROM competitions c JOIN competition_members m ON m.competition_id=c.id WHERE c.id=? AND m.user_id=?",
    c.req.param("id"),
    id,
  );
  if (!comp) fail("Competition not found.", 404);
  if (comp.start_day <= localDay(new Date()))
    fail("This start date has passed. Propose a new competition.", 409);
  const members = await rows<{ user_id: string }>(
    c,
    "SELECT user_id FROM competition_members WHERE competition_id=?",
    comp.id,
  );
  if (
    !canViewPlayers(
      c,
      members.map((m) => m.user_id),
      await playerSharing(c),
    )
  )
    fail(
      "Set up mutual sharing with every player in this competition first.",
      403,
    );
  await db(c)
    .prepare(
      "UPDATE competition_members SET approved=1 WHERE competition_id=? AND user_id=?",
    )
    .bind(comp.id, id)
    .run();
  return c.json({ ok: true });
});
app.get("/api/app/dashboard", async (c) => {
  const user = c.get("user");
  await expireRuns(c, user.id);
  const [sharing, slots] = await Promise.all([playerSharing(c), roster(c)]);
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
  const competitionRows = await rows<{
    id: string;
    start_day: string;
    choices: string;
    member_id: string;
    member_name: string;
    approved: number;
  }>(
    c,
    `
    SELECT c.id,c.start_day,c.choices,m.user_id member_id,u.name member_name,m.approved
    FROM competitions c JOIN competition_members m ON m.competition_id=c.id JOIN users u ON u.id=m.user_id
    LEFT JOIN player_slots p ON p.user_id=u.id
    WHERE EXISTS (SELECT 1 FROM competition_members mine WHERE mine.competition_id=c.id AND mine.user_id=?)
    ORDER BY c.created_at DESC,c.id,p.position,u.name`,
    user.id,
  );
  const competitionsById = new Map<string, Competition>();
  for (const row of competitionRows) {
    const competition: Competition = competitionsById.get(row.id) ?? {
      id: row.id,
      start_day: row.start_day,
      choices: JSON.parse(row.choices),
      members: [],
    };
    competition.members.push({
      id: row.member_id,
      name: row.member_name,
      approved: !!row.approved,
    });
    competitionsById.set(row.id, competition);
  }
  const competitions = [...competitionsById.values()].filter((co) =>
    co.members.every((member) => ids.includes(member.id)),
  );
  const week = monday(localDay(new Date()));
  const results = competitions
    .filter((co) => co.members.every((m) => m.approved))
    .map((co) => ({
      ...co,
      results: co.members
        .map((member) => people.find((p) => p.id === member.id)!)
        .map((p) => ({
          userId: p.id,
          name: p.name,
          current: progress(
            p.workouts,
            p.weights,
            co.choices,
            co.start_day,
            week,
            p.ranges,
          ),
          last: progress(
            p.workouts,
            p.weights,
            co.choices,
            co.start_day,
            addDays(week, -7),
            p.ranges,
          ),
        })),
    }));
  return c.json({
    me: { id: user.id, name: user.name, unit: user.unit },
    sharing,
    roster: slots,
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
    "SELECT 1 FROM workouts WHERE user_id=? AND source_id NOT LIKE 'manual:%' UNION ALL SELECT 1 FROM import_runs WHERE user_id=? LIMIT 1",
    pair.user_id,
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
        (Date.parse(w.start_time) < Date.parse(run.scope_end) &&
          Math.max(Date.parse(w.start_time), Date.parse(w.updated_at)) >=
            Date.parse(run.scope_start)),
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
