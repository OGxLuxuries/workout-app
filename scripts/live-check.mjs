// Explicit opt-in integration check. Uses the operator's real connected Hevy account.
// Local test authentication only; no SMS is sent. Personal output stays under .local/.
import { chromium, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
const origin = "http://localhost:5173";
await mkdir(".local", { recursive: true });
const vars = await readFile(".dev.vars", "utf8");
if (!vars.includes("DEV_AUTH=true"))
  throw new Error("This check requires explicit local test authentication.");
const invite = vars.match(/^BOOTSTRAP_INVITE=(.*)$/m)?.[1].trim();
const browser = await chromium.launch();
let savedState;
try {
  savedState = JSON.parse(await readFile(".local/browser-state.json", "utf8"));
} catch {}
const context = await browser.newContext({
  storageState: savedState,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
let companion;
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(origin);
  await page.locator(".page-heading h1, .login-panel h2").waitFor();
  if (await page.getByLabel("Your name").count()) {
    await page.getByLabel("Your name").fill("Oliver (local test)");
    await page.getByLabel("Phone number").fill("+15550000001");
    await page.getByLabel(/Invitation code/).fill(invite);
    await page.getByRole("button", { name: "Send verification code" }).click();
    await page.getByLabel("Verification code", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Enter dashboard" }).click();
  }
  await page.getByRole("heading", { name: /Let.s train/ }).waitFor();
  await page.screenshot({
    path: ".local/dashboard-desktop.png",
    fullPage: true,
  });
  await context.storageState({ path: ".local/browser-state.json" });
  await page.getByRole("button", { name: "You", exact: true }).click();
  if (
    !(await page
      .getByRole("button", { name: "Revoke companion", exact: true })
      .count())
  ) {
    await page
      .getByRole("button", { name: "Create pairing code", exact: true })
      .click();
    const code = await page.getByLabel(/Pairing code ·/).inputValue();
    const pairing = spawn(
      process.execPath,
      ["--import", "tsx", "companion/main.ts", "--pair"],
      {
        env: { ...process.env, PAIR_CODE: code, DASHBOARD_URL: origin },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    pairing.stdout.on("data", (s) => process.stdout.write(s));
    pairing.stderr.on("data", (s) => process.stderr.write(s));
    const [exitCode] = await once(pairing, "exit");
    if (exitCode !== 0) throw new Error("Companion pairing failed.");
  }
  const startTime = Date.now();
  const readDashboard = () =>
    page.evaluate(async () => (await fetch("/api/app/dashboard")).json());
  companion = spawn(
    process.execPath,
    ["--import", "tsx", "companion/main.ts"],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  companion.stdout.on("data", (s) => process.stdout.write(s));
  companion.stderr.on("data", (s) => process.stderr.write(s));
  await expect
    .poll(
      async () =>
        Date.parse((await readDashboard()).companion?.last_seen ?? "") >=
        startTime,
      { timeout: 20000 },
    )
    .toBe(true);
  if (process.env.CHECK_FULL_SYNC === "1")
    await page.getByRole("button", { name: "History", exact: true }).click();
  const requestDone = page.waitForResponse(
    (r) => r.url().endsWith("/api/app/sync") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name:
        process.env.CHECK_FULL_SYNC === "1"
          ? "Sync workouts"
          : "Test connection with one workout",
    })
    .click();
  const requested = await (await requestDone).json();
  if (!requested.id)
    throw new Error(requested.error || "Sync job was not created");
  let result;
  for (let attempt = 0; attempt < 180; attempt++) {
    result = await readDashboard();
    const tracked = result.people[0].imports.find((r) => r.id === requested.id);
    if (["completed", "needs_attention", "failed"].includes(tracked?.status))
      break;
    if (attempt % 10 === 0)
      console.log("Waiting for import:", tracked?.status || "not visible");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const own = result.people.find((p) => p.id === result.me.id);
  const run = own.imports.find((r) => r.id === requested.id);
  console.log(
    JSON.stringify({
      status: run.status,
      mode: run.mode,
      counts: run.counts,
      storedWorkoutCount: own.workouts.length,
      coverageRanges: own.ranges.length,
      message: run.message,
      pageErrors: errors,
    }),
  );
  if (run.status !== "completed")
    throw new Error(run.message || "Live sync failed.");
  await page.getByRole("button", { name: "History", exact: true }).click();
  if (own.workouts.length) {
    await page.locator(".history-toggle").first().waitFor();
    await page.locator(".history-toggle").first().click();
  } else if (run.mode === "probe") {
    throw new Error("Hevy returned no workouts for the connection test.");
  }
  await page.screenshot({
    path: ".local/real-workout-check.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.screenshot({
    path: ".local/dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/dashboard-mobile.png",
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw new Error("Mobile layout overflows.");
  await writeFile(
    process.env.CHECK_FULL_SYNC === "1"
      ? ".local/full-check-result.json"
      : ".local/live-check-result.json",
    JSON.stringify({
      status: run.status,
      mode: run.mode,
      storedWorkoutCount: own.workouts.length,
      coverageRanges: own.ranges.length,
      pageErrors: errors,
      checkedAt: new Date().toISOString(),
    }),
  );
  if (errors.length) throw new Error(errors.join(";"));
} finally {
  companion?.kill();
  await browser.close();
}
