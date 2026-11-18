# Workout workspace acceptance

The screen names below are the 37 roles identified in the teardown. The verification column describes the local checks and the scenario to exercise when piloting. The app uses invitation-only discovery and includes the core workflows for every invited member.

| Teardown role              | Workout Competition path                         | Acceptance                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `account-settings`         | You → Profile and sign-out                       | Edit your name, sign back in, and confirm it persists.                                                                                                                         |
| `calendar`                 | Progress → Calendar                              | Open a marked day and see only that date’s workouts. Mobile browser check covers the grid.                                                                                     |
| `data-transfer`            | You → Import and export                          | Download the owner’s export, validate a file, and restore native v2 workouts, routines, custom exercises, and measurements. Reimport original Hevy data through the companion. |
| `discover`                 | Today → Find people                              | Search only within the invited network.                                                                                                                                        |
| `exercise-detail`          | Train → Library → Exercise                       | Read original instructions and view the exact variant’s history and records.                                                                                                   |
| `exercise-library`         | Train → Library                                  | Search by name, select a muscle and equipment, and clear filters.                                                                                                              |
| `exercise-picker`          | Active workout → Add exercise                    | See recent movements, handle no matches, and add a custom variant.                                                                                                             |
| `exercise-reorder`         | Active workout → Exercise arrows                 | Verify the order remains after saving. Automated mobile check moves an exercise.                                                                                               |
| `followers`                | Today → Find people → People who opted in to you | See incoming invitations to connect.                                                                                                                                           |
| `following`                | Today → Find people → People you opted in to     | Withdraw consent and verify a connection-only workout becomes unavailable on the next read.                                                                                    |
| `home`                     | Today                                            | Start or resume in one tap and open shared activity.                                                                                                                           |
| `integrations`             | You → Connected services                         | With provider credentials, authorize and disconnect a test Strava account. Android health and sensor integrations require a separate companion.                                |
| `language`                 | You → Profile → Language preference              | Save and reload the preferred language. The interface copy is currently English.                                                                                               |
| `measures`                 | Progress → Measurements                          | Save dated weight and waist entries, change units, and verify a progress photo stays private.                                                                                  |
| `notification-preferences` | You → Device notifications                       | Check unsupported and denied browser states. With VAPID configured, subscribe, receive a generic inbox alert, and unsubscribe.                                                 |
| `notifications`            | Today → Inbox                                    | Receive a competition invitation or reply and mark it read.                                                                                                                    |
| `outbound-sync`            | Workout review → Strava                          | With a connected test account, export a workout once and inspect its delivery status.                                                                                          |
| `privacy-preferences`      | You → Comparison sharing and training circle     | Revoke one scope and verify the next read. API tests cover named and group consent.                                                                                            |
| `profile`                  | Progress and You                                 | Review personal metrics and open workout history.                                                                                                                              |
| `profile-settings`         | You → Profile                                    | Save a display name and bio and verify the invited directory shows both.                                                                                                       |
| `program-detail`           | Train → Programs → Program                       | Review session templates and save them as routines.                                                                                                                            |
| `routine-editor`           | Train → Routines → New routine                   | Add movements and set targets, then save and reopen the routine.                                                                                                               |
| `routine-explore`          | Train → Programs                                 | Filter by goal, level, equipment and sessions, including no matches.                                                                                                           |
| `routine-from-workout`     | Progress → History → Save as routine             | Save a new routine from completed sets. Mobile browser check covers conversion.                                                                                                |
| `routine-saved`            | Train → Routines                                 | Verify the saved routine and its title.                                                                                                                                        |
| `routine-tracking`         | Train → Routines → Start routine                 | Verify the completion control fills the routine target. Updating targets requires explicit confirmation at review.                                                             |
| `save-workout`             | Active workout → Finish workout                  | Review omitted sets, date, gym, notes, title, and audience.                                                                                                                    |
| `search`                   | Today → Find people and Train → Library          | Check scoped profiles and exact exercise variants.                                                                                                                             |
| `session`                  | Train → Active workout                           | Edit and remove sets, add a note, configure rest, and pair a superset.                                                                                                         |
| `settings`                 | You                                              | Navigate account settings, privacy, device settings, and data controls.                                                                                                        |
| `statistics`               | Progress → Trends                                | Filter metrics by day and exact variant. Confirm units, sources and record categories.                                                                                         |
| `trainer`                  | Train → Programs → Suggest a program             | Use the selected preferences and review matching routines. After two sessions at the target, choose or skip a load increase.                                                   |
| `units`                    | You → Training preferences                       | Change weight, distance, and measurement units independently.                                                                                                                  |
| `workout`                  | Train                                            | Start empty, from the previous workout, or from a routine.                                                                                                                     |
| `workout-detail`           | Progress → History → Workout                     | Check saved sets, privacy, source, notes and attachments. Test edit, repeat, duplicate, and deletion with an owned session.                                                    |
| `workout-preferences`      | You → Training preferences                       | Save the default rest period and verify it in a new workout.                                                                                                                   |
| `workout-saved`            | Today → Recap                                    | Open the saved workout in History and check new records when present.                                                                                                          |

## Behavior probes

| Probe from the teardown                     | Expected result                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Start an empty workout                      | Today opens an empty session and finishing shows validation.                                                                      |
| Add an exercise                             | Search and select an exact variant.                                                                                               |
| Log and edit a set                          | The first invalid field gets focus, Enter completes a valid set, and edits persist.                                               |
| Add another set and inspect defaults        | A new row shows prior values beside blank inputs. Completion applies the routine first and then the prior valid same-ordinal set. |
| Observe the rest timer                      | A working set starts rest. Pause, adjust, and skip.                                                                               |
| Create a superset                           | Pair two exercises and see their grouping.                                                                                        |
| Reorder exercises                           | Move an exercise using buttons or a mouse and verify the order.                                                                   |
| Finish the workout                          | See omitted rows in review and save privately.                                                                                    |
| View the workout in history                 | Open the entry with its notes, source, and saved set values.                                                                      |
| Create a routine from a workout             | Save the workout's completed sets as a routine.                                                                                   |
| Start a workout from the routine            | Complete a set using its planned values.                                                                                          |
| Change weight units and observe propagation | Change pounds to kilograms and verify converted inputs.                                                                           |
| Log a second workout and observe records    | Beat the earlier result and verify a personal record after synchronization.                                                       |

## Run the checks with fictional data

Use PowerShell from the repository root. The loopback Worker uses its own database, bucket, and environment file. The browser script creates fictional, isolated accounts and caches their session state in the ignored fixture folder so it can be rerun.

```powershell
npm ci
npm run build
npm test
New-Item -ItemType Directory -Path .local/workspace-qa -Force | Out-Null
@('APP_ORIGIN=http://127.0.0.1:8796','DEV_AUTH=true','BOOTSTRAP_INVITE=qa-workout-integration') | Set-Content .local/workspace-qa/.env
npx wrangler d1 migrations apply workout-competition --local --persist-to .local/workspace-qa/state
npx wrangler dev --ip 127.0.0.1 --port 8796 --env-file .local/workspace-qa/.env --persist-to .local/workspace-qa/state
```

In a second terminal, run `npx playwright install chromium` if needed, then `npm run check:browser`. The test uses mobile Chromium emulation and a separate authenticated desktop Chromium context. Restart Wrangler after rebuilding so the static asset manifest matches the new bundle. Before release, repeat the tap, keyboard, date input, media, and offline flows on physical Android Chrome and iPhone Safari.

## Pilot and deployment

1. Run the checks with a fresh local store and an isolated Cloudflare preview project. Use a separate D1 database, R2 bucket, OAuth configuration, and fictional accounts. Rehearse migrations on a sanitized copy with four populated player slots and existing imports and standings.
2. Apply the additive migrations ahead of the Worker update. Preserve the privacy-aware dashboard query and import behavior in the version retained for rollback. Validate data isolation with two accounts before enabling the pilot.
3. Pilot logging and personal trends with the original roster, then review comparison consent, private activity, and new competitions. Track failed writes, pending recovery, migration totals, and matching legacy scores. Enable external providers only after the corresponding preview flow passes.
4. For media, provision a private bucket and bind it as `MEDIA` in the target environment. For Strava, register the Worker callback at `/api/app/v2/integrations/strava/return` and provide `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, and a base64-encoded 32-byte `INTEGRATION_KEY` as secrets. For web push, provide the environment’s `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY`. The app exposes setup only when the relevant binding or credentials are available.
5. Store the two Strava import tutorial screenshots under `tutorial/strava/summary.jpg` and `tutorial/strava/splits.jpg` in each environment's private media bucket. Verify that the Worker requires sign-in for both images. Strava image imports work without provider credentials.
6. Record the pre-migration D1 recovery bookmark. Once new workouts can be saved, retain the privacy-aware dashboard and write behavior in any rollback build. Release the web features together. The Android companion is a separate release for Bluetooth heart-rate sensors.

Reference procedures are available in the official documentation. [Workers rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/), [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/), [Strava authorization](https://developers.strava.com/docs/authentication/), [Web push on iOS](https://webkit.org/blog/13966/web-push-for-web-apps-on-ios-and-ipados/)
