import { Hono, type Context } from "hono";
import {
  buildPushPayload,
  type PushSubscription,
  type VapidKeys,
} from "@block65/webcrypto-web-push";
import { z } from "zod";
import type { AppEnv } from "./index";

type Ctx = Context<AppEnv>;
const allowedEndpoint = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      ([
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "wns2-par02p.notify.windows.com",
      ].includes(url.hostname) ||
        url.hostname.endsWith(".push.apple.com") ||
        url.hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
};
const endpoint = z.string().max(2048).refine(allowedEndpoint);
const subscription = z.object({
  endpoint,
  expirationTime: z.number().nullable().default(null),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}={0,2}$/),
  }),
});
const keys = (c: Ctx): VapidKeys | null =>
  c.env.VAPID_SUBJECT && c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY
    ? {
        subject: c.env.VAPID_SUBJECT,
        publicKey: c.env.VAPID_PUBLIC_KEY,
        privateKey: c.env.VAPID_PRIVATE_KEY,
      }
    : null;
export const push = new Hono<AppEnv>();
push.get("/", (c) => c.json({ publicKey: keys(c)?.publicKey ?? null }));
push.post("/subscribe", async (c) => {
  if (!keys(c))
    return c.json({ error: "Web push has not been configured." }, 503);
  const value = subscription.parse(await c.req.json());
  await c.env.DB.prepare(
    `INSERT INTO training_push VALUES(?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription=excluded.subscription,changed_at=excluded.changed_at`,
  )
    .bind(
      value.endpoint,
      c.get("user").id,
      JSON.stringify(value),
      new Date().toISOString(),
    )
    .run();
  return c.json({ ok: true });
});
push.post("/unsubscribe", async (c) => {
  const value = z.object({ endpoint }).parse(await c.req.json());
  await c.env.DB.prepare(
    "DELETE FROM training_push WHERE endpoint=? AND user_id=?",
  )
    .bind(value.endpoint, c.get("user").id)
    .run();
  return c.json({ ok: true });
});
export function sendInboxNotification(c: Ctx, recipients: string[]) {
  const vapid = keys(c);
  if (!vapid || !recipients.length) return;
  const context = c.executionCtx;
  const db = c.env.DB;
  const audience = [...new Set(recipients)];
  context.waitUntil(
    (async () => {
      for (const id of audience) {
        const { results } = await db
          .prepare(
            "SELECT endpoint,subscription FROM training_push WHERE user_id=? ORDER BY changed_at DESC LIMIT 5",
          )
          .bind(id)
          .all<{ endpoint: string; subscription: string }>();
        await Promise.allSettled(
          results.map(async (row) => {
            if (!allowedEndpoint(row.endpoint)) return;
            const sub = JSON.parse(row.subscription) as PushSubscription;
            const payload = await buildPushPayload(
              {
                data: "New activity in your Workout Competition inbox.",
                options: { ttl: 3600 },
              },
              sub,
              vapid,
            );
            const response = await fetch(row.endpoint, {
              ...payload,
              redirect: "error",
            });
            if (response.status === 404 || response.status === 410)
              await db
                .prepare(
                  "DELETE FROM training_push WHERE endpoint=? AND user_id=?",
                )
                .bind(row.endpoint, id)
                .run();
          }),
        );
      }
    })().catch(() =>
      console.warn(JSON.stringify({ event: "inbox_push_dispatch_failed" })),
    ),
  );
}
