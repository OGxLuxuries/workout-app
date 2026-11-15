import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import app from "../server/index";
import { addDays, localDay, monday } from "../shared/scoring";
import { allTimeStart } from "../shared/sync";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

let mf: Miniflare, DB: D1Database;
const env: any = {
  APP_ORIGIN: "http://localhost:5173",
  DEV_AUTH: "true",
  BOOTSTRAP_INVITE: "test-invite",
};
async function call(
  path: string,
  body?: unknown,
  cookie = "",
  credential = "",
  overrides: any = {},
) {
  const r = await app.request(
    "http://localhost:8787/api" + path,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: env.APP_ORIGIN,
        "X-Workout-Request": "1",
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(credential ? { Authorization: "Bearer " + credential } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    { ...env, ...overrides, DB },
  );
  return {
    status: r.status,
    body: (await r.json()) as any,
    cookie: r.headers.get("set-cookie")?.split(";")[0] || "",
  };
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: ["DB"],
      compatibilityDate: "2026-11-01",
    }),
  );
  DB = (await mf.getD1Database("DB")) as unknown as D1Database;
  for (const migration of (await readdir("migrations")).sort()) {
    const sql = await readFile(`migrations/${migration}`, "utf8");
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await DB.prepare(statement).run();
  }
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
let a = "",
  b = "",
  aid = "",
  bid = "",
  ca = "",
  cb = "";
let tashi = "",
  jason = "",
  tid = "",
  jid = "";
async function signup(name: string, phone: string, invite: string) {
  const start = await call("/auth/start", { name, phone, invite });
  expect(start.status).toBe(200);
  const signed = await call("/auth/verify", {
    challenge: start.body.challenge,
    code: "123456",
  });
  expect(signed.status).toBe(200);
  return signed.cookie;
}
const sample = (id = "w1", weight = 100, updated = "2026-11-01T00:00:00Z") => ({
  id,
  start_time: id === "w1" ? "2020-11-01T16:00:00Z" : "2026-11-01T16:00:00Z",
  end_time: id === "w1" ? "2020-11-01T17:00:00Z" : "2026-11-01T17:00:00Z",
  updated_at: updated,
  exercises: [
    {
      index: 0,
      exercise_template_id: "bench",
      title: "Bench Press",
      equipment: "barbell",
      exercise_type: "weight_reps",
      sets: [{ index: 0, type: "normal", reps: 10, weight_kg: weight }],
    },
  ],
});
const page = (
  workouts: any[],
  sourceUserId = "source-a",
  n = 1,
  count = 1,
) => ({ schemaVersion: 1, sourceUserId, page: n, pageCount: count, workouts });
async function startJob() {
  const r = await call("/app/sync", {}, a);
  expect(r.status).toBe(200);
  const claim = await call("/companion/next", {}, "", ca);
  expect(claim.body.job.id).toBe(r.body.id);
  return r.body.id as string;
}
async function submit(id: string, p: any) {
  return call(`/companion/jobs/${id}/page`, p, "", ca);
}
async function complete(id: string) {
  return call(`/companion/jobs/${id}/complete`, {}, "", ca);
}
describe("account and sync flow with real local D1", () => {
  it("requires invitation, validates OTP, and consumes challenges once", async () => {
    expect(
      (await call("/auth/start", { name: "stranger", phone: "+15550000003" }))
        .status,
    ).toBe(400);
    const start = await call("/auth/start", {
      name: "Test Oliver",
      phone: "+15550000001",
      invite: "test-invite",
    });
    expect(
      (
        await call("/auth/verify", {
          challenge: start.body.challenge,
          code: "000000",
        })
      ).status,
    ).toBe(401);
    const verify = await call("/auth/verify", {
      challenge: start.body.challenge,
      code: "123456",
    });
    a = verify.cookie;
    expect(a).toContain("wc_session");
    expect(
      (
        await call("/auth/verify", {
          challenge: start.body.challenge,
          code: "123456",
        })
      ).status,
    ).toBe(401);
    aid = (await call("/app/dashboard", undefined, a)).body.me.id;
  });
  it("invites a second participant without sharing until mutual consent", async () => {
    const invitation = (await call("/app/invite", { playerName: "Blake" }, a))
      .body.url;
    b = await signup(
      "Test Blake",
      "+15550000002",
      new URL(invitation).searchParams.get("invite")!,
    );
    bid = (await call("/app/dashboard", undefined, b)).body.me.id;
    await call("/app/sharing", { partnerId: bid, consent: true }, a);
    expect(
      (await call("/app/dashboard", undefined, a)).body.people,
    ).toHaveLength(1);
    await call("/app/sharing", { partnerId: aid, consent: true }, b);
    expect(
      (await call("/app/dashboard", undefined, a)).body.people,
    ).toHaveLength(2);
  });
  it("pairs distinct source accounts and rejects reused codes", async () => {
    const code = (await call("/app/pair-code", {}, a)).body.code;
    ca = (await call("/companion/pair", { code, sourceUserId: "source-a" }))
      .body.token;
    expect(
      (await call("/companion/pair", { code, sourceUserId: "source-a" }))
        .status,
    ).toBe(401);
    const codeB = (await call("/app/pair-code", {}, b)).body.code;
    expect(
      (await call("/companion/pair", { code: codeB, sourceUserId: "source-a" }))
        .status,
    ).toBe(409);
    cb = (
      await call("/companion/pair", { code: codeB, sourceUserId: "source-b" })
    ).body.token;
  });
  it("serializes triggers and isolates jobs and source identity", async () => {
    await DB.prepare(
      "INSERT INTO import_runs(id,user_id,status,scope_start,scope_end,created_at,updated_at) VALUES('prior-90-day-run',?,'completed','2026-08-01','2026-11-01','2026-08-01','2026-11-01')",
    )
      .bind(aid)
      .run();
    const [x, y] = await Promise.all([
      call("/app/sync", {}, a),
      call("/app/sync", {}, a),
    ]);
    expect(x.body.id).toBe(y.body.id);
    expect(x.body.scope_start).toBe(allTimeStart);
    expect((await call("/companion/next", {}, "", cb)).body.job).toBeNull();
    const job = (await call("/companion/next", {}, "", ca)).body.job;
    expect((await submit(job.id, page([sample()], "source-b"))).status).toBe(
      409,
    );
    expect(
      (await call(`/companion/jobs/${job.id}/page`, page([sample()]), "", cb))
        .status,
    ).toBe(409);
    expect(
      (await submit(job.id, page([sample()], "source-a", 1, 2))).status,
    ).toBe(200);
    expect((await complete(job.id)).status).toBe(409);
    expect(
      (await call("/app/dashboard", undefined, a)).body.people[0].workouts,
    ).toHaveLength(0);
    expect(
      (await submit(job.id, page([sample("w2")], "source-a", 2, 2))).status,
    ).toBe(200);
    expect((await complete(job.id)).body.counts.inserted).toBe(2);
    const firstArchive = (await call("/app/dashboard", undefined, a)).body
      .people[0].workouts;
    expect(
      firstArchive.some(
        (workout: { id: string; start_time: string }) =>
          workout.id === "w1" && workout.start_time.startsWith("2020"),
      ),
    ).toBe(true);
  });
  it("retries pages and records without duplicates, updates edits and skips stale data", async () => {
    // Keep overlap inclusive of fixture dates independent of wall-clock execution date.
    await DB.prepare(
      "UPDATE import_runs SET scope_end='2026-11-02T00:00:00Z' WHERE status='completed'",
    ).run();
    let id = await startJob();
    const p = page([sample(), sample("w2")]);
    expect((await submit(id, p)).status).toBe(200);
    expect((await submit(id, p)).status).toBe(200);
    expect((await complete(id)).body.counts.unchanged).toBe(2);
    await DB.prepare(
      "UPDATE import_runs SET scope_end='2026-11-02T00:00:00Z' WHERE status='completed'",
    ).run();
    id = await startJob();
    await submit(
      id,
      page([
        sample("w1", 120, "2026-11-03T00:00:00Z"),
        sample("w2", 80, "2026-10-30T00:00:00Z"),
      ]),
    );
    const done = await complete(id);
    expect(done.body.counts.updated).toBe(1);
    expect(done.body.counts.stale).toBe(1);
    expect(
      (await call("/app/dashboard", undefined, a)).body.people[0].workouts,
    ).toHaveLength(2);
  });
  it("rejects equal-timestamp conflicts atomically and recovers after failure", async () => {
    await DB.prepare(
      "UPDATE import_runs SET scope_end='2026-11-02T00:00:00Z' WHERE status='completed'",
    ).run();
    let id = await startJob();
    await submit(
      id,
      page([sample("new"), sample("w1", 999, "2026-11-03T00:00:00Z")]),
    );
    expect((await complete(id)).status).toBe(409);
    expect(
      await DB.prepare("SELECT * FROM workouts WHERE source_id='new'").first(),
    ).toBeNull();
    await call(`/companion/jobs/${id}/fail`, { message: "Conflict" }, "", ca);
    id = await startJob();
    await submit(id, page([], "source-a", 1, 0));
    expect((await complete(id)).status).toBe(200);
    expect(
      (await call("/app/dashboard", undefined, a)).body.people[0].workouts,
    ).toHaveLength(2);
  });
  it("converts pounds, replaces dated weights, and validates competition choices", async () => {
    expect(
      (
        await call(
          "/app/weights",
          { day: "2026-10-01", weight: 220.462262, unit: "lbs" },
          a,
        )
      ).status,
    ).toBe(200);
    const p = (await call("/app/dashboard", undefined, a)).body.people[0];
    expect(p.weights[0].kg).toBeCloseTo(100);
    await call(
      "/app/weights",
      { day: "2026-10-01", weight: 90, unit: "kg" },
      a,
    );
    expect(
      (await call("/app/dashboard", undefined, a)).body.people[0].weights,
    ).toHaveLength(1);
    expect(
      (
        await call(
          "/app/competition",
          {
            partnerId: bid,
            startDay: "2027-01-04",
            choices: [
              { id: "fake", equipment: "barbell", type: "weight_reps" },
            ],
          },
          a,
        )
      ).status,
    ).toBe(409);
  });
  it("marks one-workout probes successful without claiming full coverage", async () => {
    const requested = await call("/app/sync", { mode: "probe" }, a);
    const claimed = await call("/companion/next", {}, "", ca);
    expect(claimed.body.job.mode).toBe("probe");
    await submit(
      requested.body.id,
      page([sample("probe", "100" as any)], "source-a", 1, 15),
    );
    // Malformed agent values are rejected before staging.
    expect((await complete(requested.body.id)).status).toBe(409);
    await submit(
      requested.body.id,
      page([sample("probe", 100)], "source-a", 1, 15),
    );
    expect((await complete(requested.body.id)).status).toBe(200);
    const p = (await call("/app/dashboard", undefined, a)).body.people[0];
    expect(p.imports[0].mode).toBe("probe");
    const full = await DB.prepare(
      "SELECT count(*) n FROM import_runs WHERE user_id=? AND status='completed' AND mode='full'",
    )
      .bind(aid)
      .first<any>();
    expect(p.ranges).toHaveLength(full.n);
  });
  it("expires disconnected runs and allows a fresh retry", async () => {
    const id = await startJob();
    await DB.prepare(
      "UPDATE import_runs SET updated_at='2000-01-01T00:00:00Z' WHERE id=?",
    )
      .bind(id)
      .run();
    const retry = await call("/app/sync", {}, a);
    expect(retry.status).toBe(200);
    expect(retry.body.id).not.toBe(id);
    expect((await submit(id, page([]))).status).toBe(409);
    const claimed = (await call("/companion/next", {}, "", ca)).body.job;
    await call(
      `/companion/jobs/${claimed.id}/fail`,
      { message: "Cancelled test" },
      "",
      ca,
    );
  });
  it("blocks expired pairing codes and development sessions in real mode", async () => {
    const code = (await call("/app/pair-code", {}, a)).body.code;
    await DB.prepare("UPDATE pair_codes SET expires_at='2000-01-01'").run();
    expect(
      (await call("/companion/pair", { code, sourceUserId: "source-a" }))
        .status,
    ).toBe(401);
    expect(
      (await call("/app/dashboard", undefined, a, "", { DEV_AUTH: "false" }))
        .status,
    ).toBe(401);
  });
  it("enrolls Tashi and Jason into named slots and keeps all six pairs private by default", async () => {
    const invite = async (playerName: string) =>
      new URL(
        (await call("/app/invite", { playerName }, a)).body.url,
      ).searchParams.get("invite")!;
    const tashiInvite = await invite("Tashi");
    const unusedTashiInvite = await invite("Tashi");
    tashi = await signup("Ignored name", "+15550000003", tashiInvite);
    expect(
      (
        await call("/auth/start", {
          name: "Extra",
          phone: "+15550000005",
          invite: unusedTashiInvite,
        })
      ).status,
    ).toBe(400);
    jason = await signup("Jason", "+15550000004", await invite("Jason"));
    const t = (await call("/app/dashboard", undefined, tashi)).body;
    const j = (await call("/app/dashboard", undefined, jason)).body;
    tid = t.me.id;
    jid = j.me.id;
    expect(t.me.name).toBe("Tashi");
    expect(t.roster.map((p: any) => p.name)).toEqual([
      "Oliver",
      "Tashi",
      "Jason",
      "Blake",
    ]);
    expect(t.sharing).toHaveLength(3);
    expect(j.sharing).toHaveLength(3);
    expect(t.people).toHaveLength(1);
    expect(j.people).toHaveLength(1);
    expect(
      (await call("/app/invite", { playerName: "Fifth player" }, a)).status,
    ).toBe(409);
  });
  it("requires a variant shared by all four players and records each approval independently", async () => {
    const players = [
      { id: aid, cookie: a },
      { id: bid, cookie: b },
      { id: tid, cookie: tashi },
      { id: jid, cookie: jason },
    ];
    for (const player of players)
      for (const other of players)
        if (other.id !== player.id) {
          expect(
            (
              await call(
                "/app/sharing",
                { partnerId: other.id, consent: true },
                player.cookie,
              )
            ).status,
          ).toBe(200);
        }
    const exercise = { id: "bench", equipment: "barbell", type: "weight_reps" };
    const nextMonday = addDays(monday(localDay(new Date())), 7);
    const proposal = { startDay: nextMonday, choices: [exercise] };
    expect((await call("/app/competition", proposal, a)).status).toBe(400);
    for (const player of players.slice(1)) {
      const fixture = sample("group-bench");
      await DB.prepare("INSERT INTO workouts VALUES(?,?,?,?,?)")
        .bind(
          player.id,
          fixture.id,
          fixture.updated_at,
          fixture.start_time,
          JSON.stringify(fixture),
        )
        .run();
      await DB.prepare("INSERT INTO exercises VALUES(?,?,?,?,?,?,?)")
        .bind(
          player.id,
          fixture.id,
          0,
          "bench",
          "Bench Press",
          "barbell",
          "weight_reps",
        )
        .run();
    }
    expect((await call("/app/competition", proposal, a)).status).toBe(200);
    const dashboard = async (cookie: string) =>
      (await call("/app/dashboard", undefined, cookie)).body;
    const competition = (await dashboard(a)).competitions[0];
    expect(competition.members.map((m: any) => m.name)).toEqual([
      "Oliver",
      "Tashi",
      "Jason",
      "Blake",
    ]);
    expect(competition.members.filter((m: any) => m.approved)).toHaveLength(1);
    const approve = `/app/competition/${competition.id}/approve`;
    for (const player of [b, tashi])
      expect((await call(approve, {}, player)).status).toBe(200);
    expect((await dashboard(a)).results).toHaveLength(0);
    expect((await call(approve, {}, jason)).status).toBe(200);
    for (const player of players)
      expect((await dashboard(player.cookie)).results[0].results).toHaveLength(
        4,
      );
    await call("/app/sharing", { partnerId: jid, consent: false }, tashi);
    const j = await dashboard(jason);
    expect(j.people).toHaveLength(3);
    expect(j.results).toHaveLength(0);
    expect((await dashboard(a)).results[0].results).toHaveLength(4);
    // Restore the two-account privacy setup used by the remaining sync tests.
    for (const extra of [tid, jid])
      await call("/app/sharing", { partnerId: extra, consent: false }, b);
  });
  it("revokes sharing immediately and deletion prevents a running import from restoring data", async () => {
    await call("/app/sharing", { partnerId: bid, consent: false }, a);
    expect(
      (await call("/app/dashboard", undefined, b)).body.people,
    ).toHaveLength(1);
    const id = await startJob();
    await submit(id, page([sample()]));
    await call("/app/delete-data", {}, a);
    expect((await complete(id)).status).toBe(409);
    const own = (await call("/app/dashboard", undefined, a)).body.people[0];
    expect(own.workouts).toHaveLength(0);
    expect(own.imports).toHaveLength(0);
    await call("/app/revoke-companion", {}, a);
    expect((await call("/companion/next", {}, "", ca)).status).toBe(401);
  });
  it("rejects cross-site mutations and expired sessions", async () => {
    const r = await app.request(
      "http://localhost:8787/api/app/invite",
      {
        method: "POST",
        headers: { Origin: "https://evil.example", Cookie: a },
      },
      { ...env, DB },
    );
    expect(r.status).toBe(403);
    await DB.prepare("UPDATE sessions SET expires_at='2000-01-01'").run();
    expect((await call("/app/dashboard", undefined, a)).status).toBe(401);
  });
  it("uses Twilio Verify and never substitutes fake OTP in real mode", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ status: "pending" }), { status: 200 }),
      );
    const real = {
      DEV_AUTH: "false",
      TWILIO_ACCOUNT_SID: "ACtest",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_VERIFY_SERVICE_SID: "VAtest",
    };
    await DB.prepare("DELETE FROM rate_limits").run();
    const r = await call(
      "/auth/start",
      { name: "Test Oliver", phone: "+15550000001" },
      "",
      "",
      real,
    );
    expect(r.status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toContain("/Verifications");
    expect(
      (
        await call(
          "/auth/verify",
          { challenge: r.body.challenge, code: "123456" },
          "",
          "",
          real,
        )
      ).status,
    ).toBe(401);
    fetcher.mockImplementation(
      async () =>
        new Response(JSON.stringify({ status: "approved" }), { status: 200 }),
    );
    expect(
      (
        await call(
          "/auth/verify",
          { challenge: r.body.challenge, code: "654321" },
          "",
          "",
          real,
        )
      ).status,
    ).toBe(200);
    fetcher.mockRestore();
  });
  it("claims a migrated slot by Google identity, checks OAuth state, and enforces email-bound invitations", async () => {
    const google = {
      AUTH_PROVIDER: "google",
      GOOGLE_CLIENT_ID: "fake-client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "test-only",
      OLIVER_GOOGLE_EMAIL: "oliver@example.com",
    };
    const preserved = sample("w1");
    await DB.prepare(
      "UPDATE users SET login_key='pending:'||id WHERE id IN (?,?)",
    )
      .bind(aid, bid)
      .run();
    await DB.prepare(
      "UPDATE player_slots SET user_id=NULL WHERE name IN ('Jason','Tashi')",
    ).run();
    await DB.prepare("INSERT INTO workouts VALUES(?,?,?,?,?)")
      .bind(
        aid,
        preserved.id,
        preserved.updated_at,
        preserved.start_time,
        JSON.stringify(preserved),
      )
      .run();
    await DB.prepare("UPDATE sharing SET a_consent=0,b_consent=0").run();
    const { publicKey, privateKey } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const jwk = {
      ...(await exportJWK(publicKey)),
      kid: "workout-test",
      alg: "RS256",
    };
    const nativeFetch = globalThis.fetch;
    let nextToken = "";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const address =
          typeof input === "string" || input instanceof URL
            ? String(input)
            : input.url;
        if (address === "https://www.googleapis.com/oauth2/v3/certs")
          return Response.json({ keys: [jwk] });
        if (address === "https://oauth2.googleapis.com/token") {
          expect(
            (init?.body as URLSearchParams).get("code_verifier"),
          ).toHaveLength(72);
          return Response.json({ id_token: nextToken });
        }
        return nativeFetch(input, init);
      });
    const authEnv = { ...env, ...google, DB };
    async function init(invite?: string) {
      const result = await call(
        "/auth/google/start",
        { invite },
        "",
        "",
        google,
      );
      expect(result.status).toBe(200);
      const url = new URL(result.body.url);
      expect(url.searchParams.get("scope")).toBe("openid email");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      const callback = `/api/auth/google/callback?code=google-test&state=${url.searchParams.get("state")}`;
      return {
        cookie: result.cookie,
        callback,
        nonce: url.searchParams.get("nonce"),
      };
    }
    async function finish(
      attempt: Awaited<ReturnType<typeof init>>,
      email: string,
      subject: string,
      verified = true,
      audience = google.GOOGLE_CLIENT_ID,
    ) {
      nextToken = await new SignJWT({
        email,
        email_verified: verified,
        nonce: attempt.nonce,
      })
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
        .setIssuedAt()
        .setExpirationTime("5m")
        .setIssuer("https://accounts.google.com")
        .setAudience(audience)
        .setSubject(subject)
        .sign(privateKey);
      return app.request(
        attempt.callback,
        { headers: { Cookie: attempt.cookie } },
        authEnv,
      );
    }
    try {
      const outsider = await finish(
        await init(),
        "no-invitation@example.com",
        "unknown",
      );
      expect(outsider.headers.get("location")).toBe("/?signin=invitation");
      const attempt = await init();
      const wrongBrowser = await app.request(
        attempt.callback,
        { headers: { Cookie: "wc_google=unrelated" } },
        authEnv,
      );
      expect(wrongBrowser.headers.get("location")).toBe("/?signin=expired");
      const forged = await finish(
        await init(),
        "oliver@example.com",
        "oliver-id",
        true,
        "another-app",
      );
      expect(forged.headers.get("location")).toBe("/?signin=verification");
      const unverified = await finish(
        await init(),
        "oliver@example.com",
        "oliver-id",
        false,
      );
      expect(unverified.headers.get("location")).toBe("/?signin=verification");
      const signed = await finish(attempt, "OLIVER@example.com", "oliver-id");
      expect(signed.headers.get("location")).toBe("/");
      const session = signed.headers
        .getSetCookie()
        .find((c) => c.startsWith("wc_session="))!
        .split(";")[0];
      const dash = (
        await call("/app/dashboard", undefined, session, "", google)
      ).body;
      expect(dash.me.id).toBe(aid);
      expect(dash.people[0].workouts).toEqual([preserved]);
      expect(
        dash.roster.find((p: { name: string }) => p.name === "Blake").user_id,
      ).toBeNull();
      expect(
        (await finish(attempt, "oliver@example.com", "oliver-id")).headers.get(
          "location",
        ),
      ).toBe("/?signin=expired");
      expect(
        (
          await finish(await init(), "new-email@example.com", "oliver-id")
        ).headers.get("location"),
      ).toBe("/");
      const invitation = await call(
        "/app/invite",
        { playerName: "Blake", googleEmail: "blake@example.com" },
        session,
        "",
        google,
      );
      expect(invitation.status).toBe(200);
      const invite = new URL(invitation.body.url).searchParams.get("invite")!;
      expect(
        (
          await finish(await init(invite), "somebody@example.com", "wrong-id")
        ).headers.get("location"),
      ).toBe("/?signin=invitation");
      const blake = await finish(
        await init(invite),
        "blake@example.com",
        "blake-id",
      );
      expect(blake.headers.get("location")).toBe("/");
      const blakeCookie = blake.headers
        .getSetCookie()
        .find((c) => c.startsWith("wc_session="))!
        .split(";")[0];
      expect(
        (await call("/app/dashboard", undefined, blakeCookie, "", google)).body
          .me.id,
      ).toBe(bid);
      expect(
        (
          await call(
            "/app/invite",
            { playerName: "Jason", googleEmail: "jason@example.com" },
            blakeCookie,
            "",
            google,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await call(
            "/auth/start",
            { name: "Oliver", phone: "+15550000001" },
            "",
            "",
            google,
          )
        ).status,
      ).toBe(404);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
