import { randomBytes } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
try {
  await access(".dev.vars");
  console.log(".dev.vars already exists; leaving it unchanged.");
} catch {
  const invitation = randomBytes(24).toString("hex");
  const demo = process.argv.includes("--test-auth");
  await writeFile(
    ".dev.vars",
    `APP_ORIGIN=http://localhost:5173\nDEV_AUTH=${demo}\nBOOTSTRAP_INVITE=${invitation}\nTWILIO_ACCOUNT_SID=\nTWILIO_AUTH_TOKEN=\nTWILIO_VERIFY_SERVICE_SID=\n`,
    { mode: 0o600 },
  );
  console.log(
    `Local configuration created. ${demo ? "Local-only test authentication is enabled (code 123456)." : "Add Twilio Verify credentials before signing in."}`,
  );
  console.log(
    "The first-user invitation is in .dev.vars. Keep that file private.",
  );
}
