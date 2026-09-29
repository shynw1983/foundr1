# Store indoor lighting pilot

## Scope and verified binding

The first device page is `/store/devices`. It operates the indoor light only.
The user confirmed that the outdoor sign light is separate and out of scope.
There are no lock, curtain, scene, or arbitrary device commands in this API.

Read-only discovery on 2026-09-29 verified:

| Setting | Value |
| --- | --- |
| Store | 清水店 |
| Store ID | `ed6c3b1f-e68a-4cbd-92e2-06a800eb7183` |
| Indoor Bot | `CE2A84C62D40` (`室内照明`, `pressMode`) |
| Hub 2 | `FBED88EDF334` |
| Daytime off → on → off | `2 → 12 → 2` |

The candidate inference is `1–3 = off`, `10–20 = on`, and `4–9 = unknown`.
Invalid or unavailable readings, failed refreshes, and reads older than two
minutes are unknown. The UI always labels on/off as **inferred**. It never uses
the Bot's `power` field or assumes a successful press means the light changed.
These daytime thresholds still need night/daylight/curtain-condition validation.
The API retrieval time is shown; it is **not a physical sensor sample timestamp**.
Cloud status can lag the actual device, so a fetched value alone is not proof of
a new physical sample. No retries or automation rely on that assumption.

## Data flow and permissions

`Store page → authenticated /api/store/indoor-light → server-held configuration
→ SwitchBot status / one Bot press`. The route uses the existing Store roles
(`owner`, `manager`, `store_terminal`) and requires the selected store to be in
the session's current active store list. Device IDs and credentials are never
accepted from the browser. A different store receives an unconfigured page.
The new UI uses the existing Japanese/Simplified Chinese/Traditional Chinese
translation system and Store navigation; no native APK change is needed.

`store_light_runtime` shares the status cache and a 90-second device lock across
serverless instances. Reads are cached for 60 seconds, shortened to five seconds
after a command; the visible page polls every 60 seconds normally and every six
seconds during the command window. Hidden pages stop polling. A refresh lease
expires after 30 seconds, allowing recovery from an interrupted reader.

`store_light_commands` is the durable audit/idempotency record. It records the
actor, store, physical target, request ID, before-reading, result, and times.
An atomic SQL claim precedes any physical command. Replaying an ID never sends
again, even after the cooldown. Different IDs cannot send concurrently to the
same device. Every send rechecks Bot type, Hub linkage, and `pressMode`.
Timeouts and ambiguous upstream failures remain `unknown`; orphaned pending
records also become unknown on reads. No worker resumes these commands.
The confirmation dialog explicitly describes **one press**, including a warning
to check locally if light state is unknown. Post-command observations must be
retrieved after the command response plus five seconds; an earlier read cannot
be treated as a changed light. Later intentional presses require another user
confirmation, a healthy status read, and the cooldown to expire.

## Activation

Local preparation does not activate the production integration. Before release,
establish the deployment/database target and obtain the user's authorization.
Apply only `db/migrations/20260929-store-indoor-light.sql` to the approved target
(the same additive definitions are in `db/schema.sql`). It creates two new tables
and an index, without changing existing store or device records. Test the
migration against the target environment's isolated branch before production.

Configure these **server-only** variables in the approved environment:

The supplied credentials are staged locally in the git-ignored
`.env.switchbot.local` with file mode `0600` and control disabled. Next.js does
not load this staging filename automatically. Transfer the variables through
the target's secret/environment settings; never commit or return their values.

```dotenv
SWITCHBOT_TOKEN=<secret manager value>
SWITCHBOT_SECRET=<secret manager value>
SWITCHBOT_INDOOR_LIGHT_STORE_ID=ed6c3b1f-e68a-4cbd-92e2-06a800eb7183
SWITCHBOT_INDOOR_LIGHT_BOT_ID=CE2A84C62D40
SWITCHBOT_INDOOR_LIGHT_HUB_ID=FBED88EDF334
SWITCHBOT_CONTROL_ENABLED=false
```

With the credentials and migration in place, verify read-only state first.
Set `SWITCHBOT_CONTROL_ENABLED=true` only in the approved pilot environment.
Then perform one supervised inside-light press and inspect the light change and
command journal. A backend success is only command acceptance. Do not infer a
physical end-to-end test from a local fixture or the earlier read-only discovery.
Disable control by setting the flag back to `false`; retain the command journal.
Do not reset command IDs or remove command history to retry uncertain presses.

The standard [SwitchBot API introduction](https://github.com/OpenWonderLabs/SwitchBotAPI#introduction)
requires contacting SwitchBot for commercial product/service integration.
Commercial permission remains a separate unresolved release prerequisite;
the local implementation and API connectivity do not establish that permission.

## Validation

The API tests run the actual TypeScript modules with a local PGlite PostgreSQL
engine and mocked SwitchBot responses. They cover migration reapplication/data
preservation, durable claims, concurrent and duplicate requests, response loss,
mode changes, stale/invalid/uncertain readings, and access-denied requests.
Install PGlite in an isolated tooling directory, then run:

```sh
PGLITE_MODULE_PATH=/path/to/tooling/node_modules/@electric-sql/pglite node --test scripts/tests/store-indoor-light.test.cjs
node scripts/tests/store-indoor-light-ui.mjs
```

The browser fixture loads the actual page, navigation and translations, with
all APIs replaced and outbound HTTP blocked. It checks 360/768/1440px layouts,
three languages, confirmation/cancel, double-clicks, polling, offline/stale
states, uncertain responses, and unconfigured stores. It never controls a real
device. Screenshots and the report go to `outputs/store-indoor-light-20260929`.

The 2026-09-29 local validation passed the service/API/SQL tests and all UI
fixture checks. `npm run db:check` passed for the existing connected database;
that check does **not** assert that the unapplied new tables exist. The final
`npm run build -- --webpack` passed in
`/private/tmp/foundr1-switchbot-build-20260929`, using a source snapshot and local
dependencies with an identical lock file. The original working directory has
pre-existing duplicate `.next/types/* 2.ts` files, and its dependency reads
stalled; neither its caches nor unrelated user changes were removed. The build
used a dummy database URL and did not access production data.

Upstream references: [Bot](https://github.com/OpenWonderLabs/SwitchBotAPI/blob/main/devices/others/bot.md),
[Hub 2](https://github.com/OpenWonderLabs/SwitchBotAPI/blob/main/devices/hubs/hub-2.md).
