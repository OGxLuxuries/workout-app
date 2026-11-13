# Workout App — design.md

> Implementation note: the proof of concept uses a dashboard button and a paired local Codex companion. See README.md for the current workflow. Dashboard plugin OAuth and scheduling are deferred.

## Summary
Create `C:\Users\odgj6\workout-app\design.md` describing the agreed first version. The directory currently exists and is empty. This document defines product behavior and integrations; framework, hosting, database vendor, and authentication provider remain outside its scope.

## Product design
- A private web dashboard for two people, each with their own account and connected Hevy account in ChatGPT.
- One person invites the other; both explicitly consent to sharing workout details: exercises, sets, reps, weights, dates, and progress. Personal notes and descriptions are excluded from imports.
- Show individual workout history and side-by-side progress for matching exercises: weight and reps over time, workout frequency, and changes from each person’s baseline.
- Preserve exercise identities and distinguish equipment and exercise variants. Store weights in kilograms and display preferred units.
- Show each person’s latest successful import and covered date range independently. Previously imported data remains viewable when their computer is offline.
- Either person can stop sharing and delete their imported data.

## Import and authentication design
- Each person connects two plugins in their own ChatGPT account: Hevy and the new dashboard plugin.
- The dashboard uses ordinary web accounts and OAuth for its ChatGPT connection. Sign in with ChatGPT and ChatGPT plan sharing are not prerequisites.
- The dashboard plugin exposes authenticated operations to inspect import status, import workout batches, and confirm completion. The server derives ownership from authentication rather than model-supplied account names.
- ChatGPT reads the user’s Hevy workouts and transfers structured records. The web app validates and stores them, then calculates progress in application code.
- Initial import covers 90 days. Subsequent imports use the last successful checkpoint plus a seven-day overlap to capture recent edits.
- Match records by dashboard user and Hevy workout ID; preserve source update timestamps and prevent stale imports from overwriting newer records.
- Retry batches safely without duplicates. Advance the successful checkpoint only after all required batches are acknowledged.
- Partial imports never imply source deletions. Historical edits outside the overlap and source deletions require an explicit full reconciliation; missing records may be removed only after a complete, verified fetch of the relevant scope.
- Keep Hevy credentials in the existing Hevy connection. The dashboard does not receive them.

## Skill and scheduled updates
- Package one reusable import skill with the dashboard plugin. Both scheduled and manual updates invoke the same procedure.
- Manual requests include “Update my lifting dashboard” and “Sync my workouts.” This is a chat invocation; a website button cannot silently invoke the user’s ChatGPT connections.
- Each person independently enables one nightly task at a locally selected time. Sharing authorization and unattended-write permissions must be established beforehand.
- Local execution requires an awake computer, internet connection, and the desktop app running. Cloud execution is an optional deployment path only after verifying both plugins and the skill are available there.
- Overlapping manual and scheduled imports are serialized per user. Missed runs recover from the saved checkpoint.
- Failed authentication, approval requirements, or usage limits produce an actionable status rather than a false success. Successful manual imports return counts; routine scheduled runs notify only on failure or required action.
- Scheduled execution consumes the user’s applicable ChatGPT allowance. This is periodic importing, not guaranteed real-time synchronization.

## Acceptance and boundaries
- Verify that A’s and B’s imports remain correctly owned and visible only under their mutual sharing permissions.
- Test initial pagination, repeat imports, edited workouts, unit conversion, duplicate prevention, concurrent triggers, partial failure, retry, and explicit reconciliation.
- Verify identical results from manual and scheduled invocation, then test an unattended run separately for each account.
- Confirm that revoking sharing removes the other person’s access and deleting imported data removes it from the dashboard.
- Exclude direct Hevy API syncing, Hevy write actions, AI coaching, public leaderboards, and public plugin-store publication from the first version.
- Record prerequisites requiring validation before launch: Hevy’s applicable data-use terms, each account’s plugin availability, and permission for unattended transfers.

## Choices
These are unresolved decisions or checks needed for a working proof of concept. A custom domain and paid hosting are not inherently required.

- **App name and address and code repo:** App name: Workout Competition, address: workout.olivergomesjr.com use the cloudflare plugin to help set this up. Create a public repo under OGxLuxuries using the github plugin.

- **Hosting:** Cloudflare or vercel (agent choice), prioritize settings for speed and low cost when configuring.
- **Budget and ownership:** Set an acceptable monthly cost = $10.
- **Implementation stack:** (Agent Choice) web framework, backend language, MCP SDK, and charting library.
- **Database:** (Agent Choice) and hosting location; define the minimum records for users, sharing relationships, workouts, sets, and import runs.
- **Website login:** Just two participants: Oliver and Blake with an option for more to join later - by siging up with name and phone number.
- **Plugin OAuth:** (Agent Choice) Choose an OAuth authorization-server implementation compatible with ChatGPT. Define client registration, callback URLs, scopes, token storage, and revocation. Verify that the website’s login provider supports this role or provide a separate implementation.
- **Private plugin distribution:** Keep it repo based: `codex plugin marketplace add YOUR-USERNAME/YOUR-REPOSITORY`
- **Exercise matching and progress:** Users body weight is stored and updated, then volume lifted has a percent increase relative to the that users weight and that is the deciding measurement to in the competition.
- **Automation environment:** local execution for the proof of concept and verify both plugins and the skill are available in that environment.
- **Status and notifications:** No user notications yet.
- **Deployment and validation:** Launch the app locally and let the user provide feedback to codex for iteration.
