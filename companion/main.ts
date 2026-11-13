import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Codex } from "./codex.js";
import {
  importPrompt,
  pageJsonSchema,
  validatePage,
} from "../shared/import.js";

const dir = join(homedir(), ".workout-competition");
const file = join(dir, "companion.json");
type Config = { url: string; token: string; sourceUserId: string };
async function request(
  url: string,
  path: string,
  body: unknown,
  credential?: string,
) {
  const response = await fetch(url + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(credential ? { Authorization: "Bearer " + credential } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const value = (await response.json()) as any;
  if (!response.ok) throw new Error(value.error || "Dashboard request failed.");
  return value;
}
async function connect() {
  const codex = new Codex();
  try {
    await codex.init();
    const app = await codex.hevy();
    return { codex, app };
  } catch (e) {
    codex.close();
    throw e;
  }
}
async function pair() {
  const url = (process.env.DASHBOARD_URL || "http://localhost:5173").replace(
    /\/$/,
    "",
  );
  const u = new URL(url);
  if (
    u.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(u.hostname)
  )
    throw new Error("Remote dashboard connections require HTTPS.");
  const code = process.env.PAIR_CODE;
  if (!code)
    throw new Error("Set PAIR_CODE to the code shown in dashboard settings.");
  const { codex, app } = await connect();
  try {
    const identity = (await codex.run(
      app,
      "Use Hevy get_user_preferences to return only the authenticated source user id. Do not read or modify workouts.",
      {
        type: "object",
        properties: { sourceUserId: { type: "string" } },
        required: ["sourceUserId"],
        additionalProperties: false,
      },
    )) as { sourceUserId: string };
    if (!identity.sourceUserId) throw new Error("No source identity returned.");
    const result = await request(url, "/api/companion/pair", {
      code,
      sourceUserId: identity.sourceUserId,
    });
    await mkdir(dir, { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        url,
        token: result.token,
        sourceUserId: identity.sourceUserId,
      }),
      { mode: 0o600 },
    );
    console.log(
      "Paired. Run npm run companion to wait for dashboard sync requests.",
    );
  } finally {
    codex.close();
  }
}
async function sync(
  config: Config,
  job: { id: string; start: string; end: string; mode: string },
) {
  let codex: Codex | undefined;
  const endpoint = `/api/companion/jobs/${job.id}`;
  const beat = setInterval(() => {
    request(config.url, endpoint + "/heartbeat", {}, config.token).catch(
      () => {},
    );
  }, 20000);
  try {
    const connected = await connect();
    codex = connected.codex;
    for (let page = 1; page <= 10000; page++) {
      const output = validatePage(
        await codex.run(
          connected.app,
          importPrompt(page, job.mode === "probe" ? 1 : 5) +
            ` The server import scope is [${job.start}, ${job.end}); return the full requested page without filtering, so the server can verify pagination and filter dates.`,
          pageJsonSchema,
        ),
      );
      if (output.sourceUserId !== config.sourceUserId)
        throw new Error(
          "Connected Hevy account changed. Revoke and pair again.",
        );
      if (output.page !== page)
        throw new Error("Codex returned the wrong page. Retry sync.");
      await request(config.url, endpoint + "/page", output, config.token);
      console.log(
        `Received and validated page ${page} of ${output.pageCount}.`,
      );
      if (job.mode === "probe" || page >= output.pageCount) {
        const done = await request(
          config.url,
          endpoint + "/complete",
          {},
          config.token,
        );
        console.log("Sync complete:", done.counts);
        return;
      }
    }
    throw new Error("Pagination limit reached; no checkpoint was advanced.");
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    console.error(message);
    await request(
      config.url,
      endpoint + "/fail",
      { message },
      config.token,
    ).catch(() => {});
  } finally {
    clearInterval(beat);
    codex?.close();
  }
}
try {
  if (process.argv.includes("--pair")) await pair();
  else {
    const config = JSON.parse(await readFile(file, "utf8")) as Config;
    console.log("Companion ready. Click Sync workouts in your dashboard.");
    while (true) {
      try {
        const { job } = await request(
          config.url,
          "/api/companion/next",
          {},
          config.token,
        );
        if (job) await sync(config, job);
      } catch (e) {
        console.error((e as Error).message);
      }
      await delay(5000);
    }
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
