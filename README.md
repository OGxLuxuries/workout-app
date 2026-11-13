# Workout Competition

A private, local proof of concept for comparing improvement in weekly lifting volume relative to body weight. A dashboard button starts a **local Codex session**, which reads the signed-in participant's **Hevy connection** and returns validated records directly to the application. There are no workout uploads, pasted JSON inputs, or direct Hevy API calls.

## Run locally

Requirements: Node.js 24+, npm, Codex signed in with Hevy connected, and a Twilio Verify service for real SMS login.

```powershell
npm ci
node scripts/setup-local.mjs
# Edit .dev.vars: add your Twilio account SID, auth token, and Verify service SID.
npm run build
npm run db:migrate
npm run dev
```

Open **http://localhost:5173** (use this exact hostname so browser request validation matches). Use the `BOOTSTRAP_INVITE` value from your private `.dev.vars` for the first signup. Enter a phone in international format, such as `+15551234567`, without spaces. After signing in, Settings → Create private invitation creates a seven-day single-use link for the second participant.

For a local UI/test walkthrough without SMS, run `node scripts/setup-local.mjs --test-auth` before `.dev.vars` exists, or explicitly set `DEV_AUTH=true` there. Use fictional phone numbers and code `123456`. A persistent banner identifies test mode. It is disabled for non-loopback hosts and must be turned off before remote access. Never use it for a publicly reachable service.

Local D1 data persists under `.wrangler/state/`. The repository ignores this directory, `.dev.vars`, and `.local/`. Do not commit real workouts or browser session state.

The current local review account is **Oliver (local test)**, phone `+15550000001`, test code `123456`. This is not an SMS-verified account. To switch to real accounts, disable test auth, configure Twilio, and use a fresh persistence directory: apply migrations with `--persist-to .wrangler/real-state` and start `npx wrangler dev --port 8787 --persist-to .wrangler/real-state` after building. Set `APP_ORIGIN` to `http://localhost:8787` for that built-app workflow. Keep the test directory for reference. Test-mode sessions are rejected when test mode is disabled.

## Pair your own Codex companion

Each participant performs these steps **on their own computer and Codex account**. The website account does not grant access to somebody else's Codex or Hevy connection.

1. Sign in to Codex and connect Hevy. `npm run probe` checks that a separate local Codex process can read one workout; it prints only validation metadata.
2. In dashboard Settings, create a ten-minute pairing code.
3. In PowerShell, from this checkout:

```powershell
$env:DASHBOARD_URL = 'http://localhost:5173'
$env:PAIR_CODE = 'paste-the-pairing-code-from-settings'
npm run companion -- --pair
Remove-Item Env:PAIR_CODE
npm run companion
```

4. Leave the companion running. In Settings, **Test connection with one workout** imports the first source workout, even if older than 90 days. This deliberately does not establish full history coverage or advance the sync checkpoint.
5. Click **Sync workouts** for the initial 90-day import. Subsequent runs use the last successful full checkpoint with seven days of overlap. All source pages are traversed because the connector does not promise a safe ordering for early termination. Large histories may take several minutes and consume multiple Codex turns.

The companion uses `codex app-server` over standard input/output, installed-app discovery, ephemeral threads, and structured output. `CODEX_BIN` can override the executable path. It inherits the participant's model settings. See [the official interface documentation](https://learn.chatgpt.com/docs/app-server).

Its revocable credential is stored in `%USERPROFILE%\.workout-competition\companion.json` (or `~/.workout-competition/companion.json`). Protect the OS account and this file; it is outside the public repository. Pairing another dashboard replaces this local companion configuration. Revoke the old companion in Settings before re-pairing. Changing Hevy accounts requires explicit re-pairing.

If an approval, login, usage limit, or connector problem occurs, the dashboard shows an actionable status. The integration does not silently grant approval. Resolve the issue in Codex and retry. A dead companion's active job expires after ten minutes; the next sync starts again from the last successful checkpoint.

## Two computers and a temporary tunnel

The local-only interface can be reviewed on one computer with separate browser profiles. Real Oliver/Blake testing requires two separately authenticated companions talking to the same backend.

1. Configure real Twilio Verify credentials and set `DEV_AUTH=false`. Verify both phone numbers with SMS (Twilio trial accounts may require verified destinations).
2. Build the UI. Start Wrangler serving the built assets on port 8787 with persistent local D1.
3. If `cloudflared` is installed, run `cloudflared tunnel --url http://127.0.0.1:8790` to get a temporary HTTPS address. Set `APP_ORIGIN` in `.dev.vars` to that exact origin and restart Wrangler. Run `node scripts/tunnel-gateway.mjs` to forward only dashboard requests from port 8790. Use the HTTPS address for browser access and both companions' `DASHBOARD_URL`.
4. Pair each participant separately, grant mutual sharing consent, and verify one-workout and full syncs independently. Stop the tunnel after testing. Its address may change on restart; update the origin and re-pair companions if it does.

The tunnel gateway keeps Wrangler's development tools local. Permanent hosting and `workout.olivergomesjr.com` are deferred. Stored data survives restarts, and the dashboard is available when its host computer is on.

## Competition and privacy

- Both participants must consent to sharing before either can see the other's workout details, body-weight history, or comparisons. Names and pending invitation relationships remain visible so consent can be managed. Phone numbers and session credentials are never returned in dashboard responses.
- Record body weights with their effective dates. The latest measurement on or before a workout is used. Pounds are converted to kilograms for storage.
- Choose exercise variants present in both histories, with resolved equipment and `weight_reps` type. Unknown variants remain visible in history but cannot be selected for competition.
- Propose a future Monday and a common exercise list; the other participant approves before the start date. Existing proposals cannot be edited; changes require a new competition. The latest mutually approved competition is displayed.
- Weeks are Monday–Sunday in America/New_York, including daylight-saving transitions. The first full week is the baseline. Normalized weekly volume is `sum(weight_kg × reps / effective_body_weight_kg)` over agreed, externally weighted working sets. Warmups, unweighted, and assisted sets are excluded.
- Improvement is `100 × (week / baseline − 1)`. Rankings begin after week two finishes. Scores equal at two decimals tie. A zero baseline, missing body weights, or incomplete import coverage prevents ranking. A covered empty later week is −100%. Current-week results are provisional.
- Sync coverage means the complete requested source pagination was acknowledged; it does not prove that somebody logged every workout in Hevy. Source deletions and edits outside the overlap require future explicit reconciliation.
- Revoking sharing takes effect on the next request. The dashboard refreshes every five seconds; previously viewed data cannot be recalled from another person's memory or screenshots. Deleting imports cancels active jobs and removes workouts, sets, staged batches, and import history. Body weights and the account remain.

## Data contract and implementation

- `shared/import.ts` owns the versioned agent-output schema, fixed prompt, strict validation, and timestamp conflict policy. Source content is treated as data, not instructions. Personal notes, descriptions, and workout titles are excluded from storage.
- `companion/` handles pairing, job polling, installed Hevy discovery, structured Codex output, and heartbeats. It submits only to authenticated companion routes; there is no browser endpoint for arbitrary prompts or shell commands.
- `server/` contains SMS/session authentication, consent, job ownership, atomic staged imports, and dashboard reads. `migrations/` defines D1 records. Session and companion credentials are stored as hashes in the backend.
- Imports are serialized per dashboard user. Batch retries are idempotent. Equal source timestamps with different records fail the entire commit; newer records replace all exercises/sets atomically, older records are ignored. Missing records never imply deletion.
- Browser mutations require the configured exact origin and a custom request header. Cookies are HTTP-only and SameSite Strict, with Secure enabled under HTTPS. SMS sends are limited to one per phone per minute and 20 application-wide per day; each challenge allows five verification attempts.

## Checks

```powershell
npm test
npm run build
npm run probe
# Opt-in real Hevy integration; uses local test auth and writes private artifacts only to .local/:
node scripts/live-check.mjs
```

Automated tests use fictional records in an isolated D1 runtime and a mocked SMS provider. The live check signs into the local test account, pairs the actual Codex account, clicks the one-workout test button, checks persistence through the API, and captures desktop/mobile screenshots. It does not send SMS, import fixture workouts into the app, or validate a second person's connection.

## Cost and remaining launch checks

Local hosting has no hosting fee. Codex usage consumes the participant's applicable allowance. Twilio Verify charges per successful verification plus delivery; verify destination pricing in your account. Send limits reduce accidental use but are not a provider billing cap. Target total recurring service spend below $10/month.

Local verification used one connected Hevy account. The browser-triggered connection test saved a real workout. The full sync completed and recorded its 90-day coverage. The account had no workouts within that window. Tests cover multi-page imports using fictional records.

Real SMS delivery for both participants, Blake's independent connection, and the two-computer HTTPS walkthrough require account-specific validation. Confirm applicable Hevy data-use terms before broader use. Nightly scheduling, notifications, plugin distribution/OAuth, full reconciliation, and permanent deployment are outside this proof of concept.
