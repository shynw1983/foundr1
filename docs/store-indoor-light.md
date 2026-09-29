# Store SwitchBot devices

The `/store/devices` page reads equipment on demand and controls the devices
exposed by the configured store's SwitchBot Hub. The 2026-09-29 expansion adds
the outdoor sign Bot, Roller Shade and Smart Lock Pro to indoor lighting.
The Hub 2, Meter, Keypad Vision and Remote are also listed. The Remote has no
remote-control/status endpoint; the keypad displays battery information, while
PIN creation/deletion remains in the SwitchBot app.

## Binding and capabilities

The existing server configuration binds 清水店
(`ed6c3b1f-e68a-4cbd-92e2-06a800eb7183`) to Hub 2 `FBED88EDF334` and identifies
indoor Bot `CE2A84C62D40`. Discovery only includes this Hub and devices linked to
it. Devices associated with another Hub cannot be addressed through this store.
Adding stores requires an explicit store-to-Hub configuration; the current
configuration supports the approved 清水店 installation only.

| Device | Implemented operations |
| --- | --- |
| Indoor Bot | One press, or on/off if explicitly configured in switch mode |
| Outdoor sign Bot | One press; no inferred light state from the indoor Hub |
| Roller Shade | Open (0), close (100), exact closed percentage (0–100) |
| Smart Lock Pro | Lock, unlock, release latch; fresh calibration/state checks |
| Hub 2 / Meter | Available light level, temperature, humidity, battery |
| Keypad Vision | Battery; credentials are not returned to the client |
| Remote | Listed with an explicit unsupported status/control message |

Only documented commands for these discovered device types are allowed.
Unknown types are listed without controls; this is not an arbitrary command
proxy. Grouped secondary devices are not independently controlled.

Daytime indoor-light calibration was off → on → off at `2 → 12 → 2`.
Inference is `1–3 = off`, `10–20 = on`, `4–9 = unknown`. Missing/invalid readings
are unknown. On/off is always labelled inferred. Press-mode Bot `power` is not
used as the lamp state. The outdoor sign light is independent of this sensor.
Night/daylight/curtain-condition calibration remains unverified.

## On-demand data flow

`Store page → authenticated /api/store/devices → server-held configuration
→ SwitchBot list/status/validated device command`.

Opening the page reads once. Refresh-all, per-device refresh and operation
confirmation read on demand. There is no regular, focus or visibility polling.
After a user command, up to three read-only observations run at 5, 15 and 30
seconds; they stop early after an observed state change. Hidden/unmounted pages
do not make these requests. Countdown ticks are local and do not query the DB.
This does not change unrelated Store order/notification/background traffic.

The page displays **last fetched state and time**, not a promise of real-time
state. The retrieval timestamp is not a physical sensor sample timestamp.
SwitchBot cloud reports may lag devices. A successful command acknowledgement
does not establish a physical change. Nested `body.items[].code` device results
are checked as well as the outer API code. A target mismatch/missing result is
unknown; a known device rejection is surfaced with its code. Sanitized command
outcomes are logged without credentials or raw provider payloads. Observations must be fetched at least
four seconds after command completion and match the intended state (or indoor
light state change). Outdoor press and latch release cannot be confirmed by
lamp/lock status and remain explicitly unconfirmed.

Status reads do not create runtime rows or persist sensor values. They only
select existing command/lock information. Auth/session handling can separately
access the database. Operation records and concurrency locks remain durable.

## Permissions and command safety

The API uses existing Store roles `owner`, `manager`, `store_terminal` and
requires the selected store to be in the session's active scoped store list.
The browser supplies only an opaque store-specific device key, not credentials
or physical IDs. Cross-origin commands, malformed targets, unsupported actions,
missing confirmation and invalid positions are rejected. The server discovers
the target again, then reads fresh status before sending any command.

Normal commands impose a **10-second cooldown after completion**, shared across
clients/serverless instances. A separate 60-second in-flight lease prevents
slow/crashed requests from overlapping. It is replaced by the 10-second
cooldown on completion. A durable journal exists before any physical command.
Replaying a request UUID never sends twice, even after expiry. Ambiguous POST
results and abandoned pending records remain unknown; no worker retries them.

Every action has an on-screen confirmation. Unlock/latch release additionally
requires acknowledging that the door can be opened. Locking requires a closed
door and valid lock calibration/state; shade positioning requires calibration
and a valid position. Cloud status is checked before sending but can lag the physical device.
An explicitly confirmed lock, shade or switch command is therefore sent even
when the fetched value already matches. Request UUID idempotency and the
10-second cooldown still prevent accidental duplicate sends. There is no automatic unlock, PIN creation
or automatic toggle/retry.

The historical tables `store_light_runtime` and `store_light_commands` are
retained to preserve history and rolling-deployment compatibility. Apply
`20260929-store-indoor-light.sql` first, then the additive
`20260929-store-device-commands.sql` migration (also in `db/schema.sql`). It adds
command, parameter and before-sample fields; old records default to press/default.
The old `/api/store/indoor-light` endpoint adapts to the same journal and lock
for already-loaded clients. Remove that adapter only after old Store clients
have refreshed/updated. Old already-loaded clients may retain their previous
polling behaviour until refreshed.

## Environment and release verification

Server-only variables retain their existing names:

```dotenv
SWITCHBOT_TOKEN=<secret manager value>
SWITCHBOT_SECRET=<secret manager value>
SWITCHBOT_INDOOR_LIGHT_STORE_ID=<approved store UUID>
SWITCHBOT_INDOOR_LIGHT_BOT_ID=<indoor Bot ID>
SWITCHBOT_INDOOR_LIGHT_HUB_ID=<store Hub ID>
SWITCHBOT_CONTROL_ENABLED=true
```

Credentials and original indoor control were explicitly approved and activated
in production on 2026-09-29. The device expansion reuses that Hub binding and
secrets. No credentials are stored in Git, documentation or browser payloads.
Setting control enabled to false disables sends while preserving reads/history.
Never reset command UUIDs/history to retry an uncertain action.

Provider documentation describes a separate commercial integration contact
requirement. Implementation/API connectivity does not establish provider
commercial permission; this was disclosed during initial setup.

Validation commands (PGlite can live in an isolated tooling directory):

```sh
PGLITE_MODULE_PATH=/path/to/node_modules/@electric-sql/pglite node --test scripts/tests/store-indoor-light.test.cjs
node scripts/tests/store-indoor-light-ui.mjs
npm run build -- --webpack
```

The historical test filenames now cover all device types, real service/route
code and additive SQL migration with local PGlite and fake SwitchBot responses.
Tests check preserved history, SELECT-only reads, 10-second completion lock,
longer in-flight protection, duplicates, legacy compatibility, invalid commands,
calibration/door guards, response loss and access denial. The real React page
fixture blocks outbound HTTP and uses fake time to prove no idle polling,
bounded command observations, confirmation/cancel, exact shade commands,
translations and layouts at 360/768/1440px. Artifacts go to
`outputs/store-devices-20260929`. These tests send no physical commands.

Upstream references: [API](https://github.com/OpenWonderLabs/SwitchBotAPI),
[Roller Shade](https://github.com/OpenWonderLabs/SwitchBotAPI/blob/main/devices/curtains-blinds/roller-shade.md),
[Lock Pro](https://github.com/OpenWonderLabs/SwitchBotAPI/blob/main/devices/locks-security/lock-pro.md),
[Keypad Vision](https://github.com/OpenWonderLabs/SwitchBotAPI/blob/main/devices/locks-security/keypad-vision.md).
