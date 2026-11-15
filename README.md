# Workout Competition

A private dashboard for Oliver, Tashi, Jason, and Blake to compare improvement in weekly lifting volume relative to body weight. A dashboard button starts a **local Codex session**, which reads the signed-in player's **Hevy connection** and returns validated records directly to the application.

## Hosted dashboard

Open [Workout Competition](https://workout.olivergomesjr.com) and choose **Continue with Google**. Oliver can join with the Google account reserved for his slot. In **Settings**, Oliver creates a named invitation for each other player using the email on that player's Google account. Each player opens their link and signs in with that account. Invitations expire after seven days.

Pair a companion using the hosted address and click **Sync workouts**. Your saved workouts are available as soon as you sign in. Your companion only needs to be running for new syncs.

### Deploy or update

1. In Google Auth Platform, configure the existing Workout App project and create a **Web application** OAuth client. Register `https://workout.olivergomesjr.com/api/auth/google/callback` as an authorized redirect URI. The Worker requests the `openid email` scopes.
2. In the production Worker, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `OLIVER_GOOGLE_EMAIL` as Cloudflare secrets. Keep the Google credential JSON out of the checkout and source control. After setting the secrets, the hosted configuration endpoint at `/api/config` should report `googleAuth: true` and `googleReady: true`.
3. Authenticate Wrangler to the configured Cloudflare account, then run these commands:

```powershell
npm ci
npm run build
npx wrangler d1 migrations apply workout-competition --env production --remote
npx wrangler deploy --env production
```

When creating the Worker for the first time, its secrets can be supplied in the same deployment with `--secrets-file <path>`, using a private JSON file containing the three names above.

## Run locally

Requirements: Node.js 24+ and npm. Connecting a workout account also requires Codex signed in with Hevy connected. Local SMS testing with real phone numbers requires a Twilio Verify service.

```powershell
npm ci
node scripts/setup-local.mjs
# Edit .dev.vars: add your Twilio account SID, auth token, and Verify service SID.
npm run build
npm run db:migrate
npm run dev
```

Open **http://localhost:5173** (use this exact hostname so browser request validation matches). Use the `BOOTSTRAP_INVITE` value from your private `.dev.vars` to enroll Oliver. Enter a phone in international format, such as `+15551234567`, without spaces. In Settings, select Tashi, Jason, or Blake under **Player to invite**, then create a private link for that player. Each link lasts seven days. A slot can be claimed only once. Recreate any unused invitations issued before the four-player update.

For a local UI/test walkthrough without SMS, run `node scripts/setup-local.mjs --test-auth` before `.dev.vars` exists, or explicitly set `DEV_AUTH=true` there. Use fictional phone numbers and code `123456`. A persistent banner identifies test mode. It is disabled for non-loopback hosts and must be turned off before remote access. Never use it for a publicly reachable service.

Local D1 data persists under `.wrangler/state/`. The repository ignores this directory, `.dev.vars`, and `.local/`. Do not commit real workouts or browser session state.

For real SMS testing, disable test auth, configure Twilio, and use a fresh persistence directory. Apply migrations with `--persist-to .wrangler/real-state` and start `npx wrangler dev --port 8787 --persist-to .wrangler/real-state` after building. Set `APP_ORIGIN` to `http://localhost:8787` for that built-app workflow.

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

4. Leave the companion running. In Settings, **Test connection with one workout** imports one workout without advancing the sync checkpoint.
5. Click **Sync workouts** to import your entire Hevy history on the first full sync, including when an older version of this app already synced a shorter range. Subsequent runs use the last successful checkpoint with seven days of overlap and pick up recently edited workouts. The companion traverses every page. Large histories may take several minutes and consume multiple Codex turns.

The companion uses `codex app-server` over standard input/output, installed-app discovery, ephemeral threads, and structured output. `CODEX_BIN` can override the executable path. It inherits the participant's model settings. See [the official interface documentation](https://learn.chatgpt.com/docs/app-server).

Its revocable credential is stored in `%USERPROFILE%\.workout-competition\companion.json` (or `~/.workout-competition/companion.json`). Protect the OS account and this file; it is outside the public repository. Pairing another dashboard replaces this local companion configuration. Revoke the old companion in Settings before re-pairing. Changing Hevy accounts requires explicit re-pairing.

If an approval, login, usage limit, or connector problem occurs, the dashboard shows an actionable status. The integration does not silently grant approval. Resolve the issue in Codex and retry. A dead companion's active job expires after ten minutes; the next sync starts again from the last successful checkpoint.

## Multiple computers and a temporary tunnel

Use separate browser profiles to review the local dashboard on one computer. Each player uses their own authenticated Codex companion to sync Hevy into the shared backend.

1. Configure real Twilio Verify credentials and set `DEV_AUTH=false`. Verify each player's phone number with SMS. Twilio trial accounts may require verified destinations.
2. Build the UI. Start Wrangler serving the built assets on port 8787 with persistent local D1.
3. If `cloudflared` is installed, run `cloudflared tunnel --url http://127.0.0.1:8790` to get a temporary HTTPS address. Set `APP_ORIGIN` in `.dev.vars` to that exact origin and restart Wrangler. Run `node scripts/tunnel-gateway.mjs` to forward only dashboard requests from port 8790. Use the HTTPS address for browser access and each companion's `DASHBOARD_URL`.
4. Pair each participant separately, grant mutual sharing consent, and verify one-workout and full syncs independently. Stop the tunnel after testing. Its address may change on restart; update the origin and re-pair companions if it does.

The tunnel gateway keeps Wrangler's development tools local. Data survives restarts, and the temporary dashboard is available while its host computer is on.

## Competition and privacy

- Sharing is private by default for each pair. Both players must consent before they can see each other's workout details, body-weight history, and comparisons. Each player can withdraw consent independently. A player can view the group scoreboard once they have mutual sharing with everyone in that competition.
- Record body weights with their effective dates. The latest measurement on or before a workout is used. Pounds are converted to kilograms for storage.
- Choose exercise variants present in all four histories, with resolved equipment and `weight_reps` type. Unknown variants remain visible in history.
- Propose a future Monday and a common exercise list. All four players must approve before the start date. The latest competition approved by every member is displayed. Changes require a new proposal.
- Weeks are Monday–Sunday in America/New_York, including daylight-saving transitions. The first full week is the baseline. Normalized weekly volume is `sum(weight_kg × reps / effective_body_weight_kg)` over agreed, externally weighted working sets. Warmups, unweighted, and assisted sets are excluded.
- Improvement is `100 × (week / baseline − 1)`. Rankings begin after week two finishes. Scores equal at two decimals tie. A zero baseline, missing body weights, or incomplete import coverage prevents ranking. A covered empty later week is −100%. Current-week results are provisional.
- Sync coverage means the complete requested source pagination was acknowledged. Source deletions and edits missed outside the overlap require future explicit reconciliation.
- Revoking sharing takes effect on the next request. Deleting imports cancels active jobs and removes workouts, sets, staged batches, and import history. Body weights and the account remain.

## Data contract and implementation

- `shared/import.ts` owns the versioned agent-output schema, fixed prompt, strict validation, and timestamp conflict policy. Source content is treated as data, not instructions. Personal notes, descriptions, and workout titles are excluded from storage.
- `companion/` handles pairing, job polling, installed Hevy discovery, structured Codex output, and heartbeats. It submits only to authenticated companion routes; there is no browser endpoint for arbitrary prompts or shell commands.
- `server/` handles authentication, consent, job ownership, atomic staged imports, and dashboard reads. Google accounts are recognized by their Google subject ID after enrollment with a verified email. `migrations/` defines D1 records. Session and companion credentials are stored as hashes.
- Imports are serialized per dashboard user. Batch retries are idempotent. Equal source timestamps with different records fail the entire commit; newer records replace all exercises/sets atomically, older records are ignored. Missing records never imply deletion.
- Browser mutations require the configured exact origin and a custom request header. Session cookies are HttpOnly and use Secure over HTTPS. Google sign-in uses a short-lived, one-use state tied to the initiating browser, PKCE, and a nonce. Local SMS limits allow one send per phone per minute, 20 sends per day across the app, and five attempts per challenge.

## Checks

```powershell
npm test
npm run build
npm run probe
# Opt-in real Hevy integration; uses local test auth and writes private artifacts only to .local/:
node scripts/live-check.mjs
```

Automated tests use fictional records in an isolated D1 runtime with mocked Google and SMS providers. The live check signs into the local test account, pairs the actual Codex account, clicks the one-workout test button, checks persistence through the API, and captures desktop/mobile screenshots.

## Cost

The hosted deployment uses Google sign-in and is sized for Cloudflare's Workers and D1 free tiers. Codex syncs consume each participant's applicable allowance. Twilio charges only apply if you configure and use SMS in a separate environment. Target recurring service spend below $10/month.
