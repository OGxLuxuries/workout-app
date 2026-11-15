// UI smoke test using isolated browser sessions; requires the local test-auth account.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch();
await mkdir(".local", { recursive: true });
try {
  const context = await browser.newContext({
    storageState: ".local/browser-state.json",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:5173");
  for (const tab of [
    "Overview",
    "Workouts",
    "Compare",
    "Competition",
    "Settings",
  ]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.locator(".page-heading h1")).toBeVisible();
  }
  const origin = "http://localhost:5173";
  const playerToInvite = page.getByLabel("Player to invite");
  const inviteButton = page.getByRole("button", {
    name: "Create private invitation",
    exact: true,
  });
  for (const player of ["Tashi", "Jason"]) {
    if (
      !(await playerToInvite.locator("option").allTextContents()).includes(
        player,
      )
    )
      continue;
    await playerToInvite.selectOption(player);
    await inviteButton.click();
    await expect(page.getByLabel("Invitation link")).toHaveValue(
      new RegExp(`player=${player}$`),
    );
  }
  let url = origin;
  if (
    (await playerToInvite.locator("option").allTextContents()).includes("Blake")
  ) {
    await playerToInvite.selectOption("Blake");
    await inviteButton.click();
    await expect(page.getByLabel("Invitation link")).toHaveValue(
      /player=Blake$/,
    );
    url = await page.getByLabel("Invitation link").inputValue();
  }
  const second = await browser.newContext();
  const b = await second.newPage();
  await b.goto(url);
  await b.getByLabel("Your name").fill("Blake (local test)");
  await b.getByLabel("Phone number").fill("+15550000002");
  await b.getByRole("button", { name: "Send verification code" }).click();
  await b.getByLabel("Verification code", { exact: true }).fill("123456");
  await b.getByRole("button", { name: "Enter dashboard" }).click();
  await b.getByRole("heading", { name: /Keep moving/ }).waitFor();
  await b.getByRole("button", { name: "Settings", exact: true }).click();
  const consent = b.getByRole("button", {
    name: /^Share with Oliver/,
  });
  if (await consent.count()) await consent.click();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /^Share with Blake/ }).click();
  await b.reload();
  await b.getByRole("button", { name: "Workouts", exact: true }).click();
  await expect(b.getByLabel("Participant").locator("option")).toHaveCount(2);
  await page.getByRole("button", { name: /^Stop sharing with Blake/ }).click();
  await b.reload();
  await b.getByRole("button", { name: "Workouts", exact: true }).click();
  await expect(b.getByLabel("Participant").locator("option")).toHaveCount(1);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  for (const player of ["Oliver", "Tashi", "Jason", "Blake"]) {
    await expect(
      page.locator(".circle-row").getByText(player, { exact: true }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/dashboard-mobile.png",
    fullPage: true,
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile overflow");
  if (errors.length) throw new Error(errors.join(";"));
  console.log(
    "Four-player roster, named invitations, pairwise consent and mobile layout checks passed.",
  );
} finally {
  await browser.close();
}
