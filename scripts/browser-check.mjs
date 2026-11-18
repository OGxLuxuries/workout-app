import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium, devices, expect } from "@playwright/test";

const origin = new URL(
  process.env.WORKOUT_TEST_ORIGIN ?? "http://127.0.0.1:8796",
);
if (origin.hostname !== "127.0.0.1" && origin.hostname !== "localhost")
  throw new Error("Use a loopback Worker with an isolated test database.");
const baseURL = origin.origin;
const config = await (await fetch(baseURL + "/api/config")).json();
if (!config.devAuth)
  throw new Error("Enable local test authentication for the fixture.");
const shell = await (await fetch(baseURL)).text();
const script = shell.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1];
if (
  !script ||
  !(await fetch(baseURL + script)).headers
    .get("content-type")
    ?.includes("javascript")
)
  throw new Error(
    "Build the app, then restart Wrangler so it serves the current static assets.",
  );

const browser = await chromium.launch();
const output = ".local/workspace-qa";
await mkdir(output, { recursive: true });
const headers = { Origin: baseURL, "X-Workout-Request": "1" };
const errors = [];
const suffix = Date.now().toString(36);
const title = "Private training " + suffix;
const routine = "Mobile routine " + suffix;
const offlineTitle = "Offline workout " + suffix;

async function post(context, path, data) {
  const response = await context.request.post("/api" + path, { headers, data });
  if (!response.ok())
    throw new Error(
      path + " " + response.status() + " " + (await response.text()),
    );
  return response.json();
}

async function signIn(context, name, phone, invite) {
  try {
    const state = JSON.parse(
      await readFile(output + "/" + name + ".json", "utf8"),
    );
    await context.addCookies(state.cookies);
    if ((await context.request.get("/api/app/dashboard?compact=1")).ok())
      return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const { challenge } = await post(context, "/auth/start", {
    name,
    phone,
    invite,
  });
  await post(context, "/auth/verify", { challenge, code: "123456" });
  await context.storageState({ path: output + "/" + name + ".json" });
}

try {
  const visitor = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL,
  });
  const landing = await visitor.newPage();
  await landing.goto("/");
  const guide = landing.locator(".install-card");
  await guide.locator("summary").click();
  await expect(guide.getByText(/Turn on Open as Web App/)).toBeVisible();
  await expect(guide.locator(".install-screen")).toHaveCount(3);
  await guide.getByRole("button", { name: "Android", exact: true }).click();
  await expect(guide.getByText(/Tap the three-dot menu/)).toBeVisible();
  await visitor.close();
  const context = await browser.newContext({ ...devices["Pixel 5"], baseURL });
  await signIn(
    context,
    "Oliver",
    "+15550007961",
    process.env.WORKOUT_TEST_INVITE ?? "qa-workout-integration",
  );
  await post(context, "/app/preferences", { unit: "lbs" });
  const a = await (
    await context.request.get("/api/app/dashboard?compact=1")
  ).json();
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".install-card summary")).toContainText(
    "Add to Home Screen",
  );
  const main = page.getByRole("navigation", { name: "Main navigation" });
  const nav = (name) => main.getByRole("button", { name, exact: true }).click();
  await page
    .getByRole("button", { name: "Start workout", exact: true })
    .click();
  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(
    page.getByText("Complete at least one set before finishing."),
  ).toBeVisible();

  const catalog = page.getByRole("region", { name: "Exercise picker" });
  async function addExercise(title) {
    await page
      .getByRole("button", { name: "Add exercise", exact: true })
      .click();
    await catalog.getByLabel("Search exercises").fill(title);
    await catalog.getByRole("button", { name: new RegExp(title, "i") }).click();
  }
  await catalog.getByLabel("Search exercises").fill("no exercise matches");
  await expect(
    catalog.getByRole("button", { name: "Create custom exercise" }),
  ).toBeVisible();
  await catalog.getByRole("button", { name: "Close exercise picker" }).click();
  await addExercise("Bench press");
  const benchWeight = page.getByLabel("Weight (lbs) for Bench press set 1", {
    exact: true,
  });
  const benchReps = page.getByLabel("Reps for Bench press set 1", {
    exact: true,
  });
  await benchWeight.fill("-1");
  await page
    .getByRole("button", { name: "Complete Bench press set 1" })
    .click();
  await expect(benchWeight).toBeFocused();
  await expect(benchWeight).toHaveAttribute("inputmode", "decimal");
  await benchWeight.fill("100");
  await benchWeight.press("Tab");
  await expect(benchReps).toBeFocused();
  await benchReps.fill("6");
  await benchReps.press("Enter");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "+15 sec", exact: true }).click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await benchReps.fill("7");
  await page.getByRole("button", { name: "Add set", exact: true }).click();
  await expect(
    page.getByLabel("Reps for Bench press set 2", { exact: true }),
  ).toHaveValue("");
  await addExercise("Plank");
  const bench = page.locator(".set-card").filter({
    has: page.getByRole("heading", { name: "Bench press", exact: true }),
  });
  await bench.getByText("Exercise options", { exact: true }).click();
  await bench.getByLabel("Superset with").selectOption({ label: "Plank" });
  await bench.getByLabel("Note", { exact: true }).fill("Controlled reps");
  await page.getByRole("button", { name: "Move Plank up" }).click();
  await expect(page.locator(".set-card h3").first()).toHaveText("Plank");
  await page.getByRole("button", { name: "Finish workout" }).click();
  const audience = page.getByLabel("Who can see this workout");
  await expect(audience).toHaveValue("private");
  await expect(
    page.getByText(/2 incomplete sets will be left out/),
  ).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Save workout", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /View in Progress/ }).click();
  await expect(
    page.getByText("Controlled reps", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/100 lbs · 7 reps/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await page
    .getByRole("button", { name: "Save as routine", exact: true })
    .click();
  await page.getByLabel("Title", { exact: true }).fill(routine);
  await page.getByRole("button", { name: "Save routine", exact: true }).click();
  await expect(page.getByText(routine, { exact: true })).toBeVisible();

  await nav("You");
  await page.getByLabel("Weight unit", { exact: true }).selectOption("kg");
  await expect(page.getByText("Weight unit saved.")).toBeVisible();
  await nav("Train");
  await page
    .locator(".workspace-list-row")
    .filter({ hasText: routine })
    .getByRole("button", { name: "Start routine", exact: true })
    .click();
  const kg = page.getByLabel("Weight (kg) for Bench press set 1", {
    exact: true,
  });
  await page
    .getByRole("button", { name: "Complete Bench press set 1" })
    .click();
  await expect(kg).toHaveValue("45.36");
  await expect(
    page.getByLabel("Reps for Bench press set 1", { exact: true }),
  ).toHaveValue("7");
  const performance = await (
    await context.request.get("/api/app/v2/metrics")
  ).json();
  await kg.fill(String(Math.ceil(performance.summary.top) + 10));
  await page.getByRole("button", { name: "Finish workout" }).click();
  await page.getByLabel("Title", { exact: true }).fill(offlineTitle);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save workout", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pending sync", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Pending workouts" })
      .getByText(offlineTitle),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByRole("heading", { name: offlineTitle, exact: true }),
  ).toBeVisible();
  await nav("Progress");
  await expect(
    page.getByRole("heading", { name: "Personal records" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".records-list li small")
      .filter({ hasText: "Personal record" })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Progress views" })
    .getByRole("button", { name: "Calendar" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Training calendar" }),
  ).toBeVisible();
  await expect(page.locator(".calendar-logged").first()).toBeVisible();
  try {
    await nav("Compare");
  } catch (error) {
    await page.screenshot({
      path: output + "/calendar-failed.png",
      fullPage: true,
    });
    console.error(
      await page.evaluate(() => ({
        scroll: [scrollX, scrollY],
        viewport: [innerWidth, innerHeight],
        visualViewport: [visualViewport.width, visualViewport.height],
        overflowing: Array.from(document.querySelectorAll("main *"))
          .filter(
            (e) =>
              e.getBoundingClientRect().right >
              document.documentElement.clientWidth + 1,
          )
          .slice(0, 10)
          .map((e) => [
            e.tagName,
            e.className,
            e.getBoundingClientRect().right,
          ]),
      })),
    );
    throw error;
  }
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await expect(
    page.getByText(/Group medians need at least three/),
  ).toBeVisible();
  if (
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    )
  )
    throw new Error("Mobile layout overflows the viewport.");

  const peer = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const invite = a.roster.find((p) => p.name === "Tashi")?.user_id
    ? undefined
    : new URL(
        (await post(context, "/app/invite", { playerName: "Tashi" })).url,
      ).searchParams.get("invite");
  await signIn(peer, "Tashi", "+15550007962", invite);
  const b = await (
    await peer.request.get("/api/app/dashboard?compact=1")
  ).json();
  const owner = a.me.id;
  const item = (
    await (await context.request.get("/api/app/v2/workouts")).json()
  ).items.find((x) => x.details?.title === title);
  const details =
    "/api/app/v2/workouts/item?" +
    new URLSearchParams({ owner, id: item.workout.id });
  expect((await peer.request.get(details)).status()).toBe(404);
  await post(context, "/app/v2/groups/consent", {
    scope: "person",
    targetId: b.me.id,
    share: true,
  });
  const comparison =
    "/api/app/v2/compare?" +
    new URLSearchParams({ scope: "person", target: owner });
  expect(
    (await (await peer.request.get(comparison)).json()).peer.summary.sets,
  ).toBeGreaterThan(0);
  expect((await peer.request.get(details)).status()).toBe(404);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yhL8AAAAASUVORK5CYII=",
    "base64",
  );
  const attachment = await context.request.post(
    "/api/app/v2/media/upload?" +
      new URLSearchParams({ workout: item.workout.id }),
    {
      headers: { ...headers, "Content-Type": "image/png" },
      data: png,
    },
  );
  if (!attachment.ok())
    throw new Error(
      "Media upload: " + attachment.status() + " " + (await attachment.text()),
    );
  const media = "/api/app/v2/media/" + (await attachment.json()).id;
  const privatePhoto = await context.request.get(media);
  expect(await privatePhoto.body()).toEqual(png);
  const range = await context.request.get(media, {
    headers: { Range: "bytes=0-7" },
  });
  expect(range.status()).toBe(206);
  expect(await range.body()).toEqual(png.subarray(0, 8));
  expect((await peer.request.get(media)).status()).toBe(404);
  await post(context, "/app/v2/groups/consent", {
    scope: "person",
    targetId: b.me.id,
    share: false,
  });
  expect((await (await peer.request.get(comparison)).json()).peer).toBeFalsy();
  const shared = await post(context, "/app/v2/workouts/commit", {
    id: randomUUID(),
    mutationId: randomUUID(),
    expectedRevision: 0,
    workout: {
      ...item.details,
      title: "Connections workout " + suffix,
      audience: "connections",
    },
  });
  const sharedUrl =
    "/api/app/v2/workouts/item?" +
    new URLSearchParams({ owner, id: shared.id });
  await post(context, "/app/v2/network/connect", {
    target: b.me.id,
    consent: true,
  });
  await post(peer, "/app/v2/network/connect", {
    target: owner,
    consent: false,
  });
  expect((await peer.request.get(sharedUrl)).status()).toBe(404);
  await post(peer, "/app/v2/network/connect", { target: owner, consent: true });
  expect((await peer.request.get(sharedUrl)).status()).toBe(200);
  expect((await peer.request.get(details)).status()).toBe(404);
  const desktop = await peer.newPage();
  desktop.on("pageerror", (error) => errors.push(error.message));
  await desktop.goto("/");
  await desktop
    .getByRole("button", { name: "Find people", exact: true })
    .click();
  await desktop.locator("summary").getByText("Oliver", { exact: true }).click();
  await expect(desktop.getByText("Connected", { exact: true })).toBeVisible();
  await post(context, "/app/v2/network/connect", {
    target: b.me.id,
    consent: false,
  });
  expect((await peer.request.get(sharedUrl)).status()).toBe(404);
  const custom = {
    id: "custom:" + randomUUID(),
    title: "Transfer test " + suffix,
    equipment: "dumbbell",
    type: "weight_reps",
  };
  const transfer = await post(context, "/app/v2/import/preview", {
    schemaVersion: 2,
    workouts: [],
    catalog: [custom],
    measurements: [{ day: "2020-11-01", kind: "waist", value: 75 }],
  });
  expect(transfer.catalog).toEqual([custom]);
  const restored = await post(context, "/app/v2/import/library", transfer);
  expect(restored.catalog).toBe(1);
  expect(
    (await post(context, "/app/v2/import/library", transfer)).catalog,
  ).toBe(0);
  await page.screenshot({
    path: output + "/compare-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "Mobile logging, keyboard entry, routines, records, calendar, offline sync, desktop connections, scoped comparisons, private media, and import preview passed.",
  );
} finally {
  await browser.close();
}
