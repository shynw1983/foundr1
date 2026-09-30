# Store device scenes

`/store/devices` supports per-store scenes with a name, a selectable icon, and an ordered list of device actions. Users can add, edit, reorder steps, and delete scenes. Each scene has 1–8 steps, with a device used at most once; a store can keep up to 20 scenes. Saving does not operate devices. Execution requires a separate confirmation, plus explicit acknowledgement for unlocking.

The editor offers 12 icons: bed, moon, sun, lightbulb, lamp, coffee, utensils,
door, lock, music, sparkles and power. The selected stable `icon` key is stored
with the scene in the existing settings JSON and returned to Store and Android.
There is no schema migration or device command for icon changes. Older scenes
without an icon keep working: the rest example defaults to bed and other scenes
to moon without rewriting settings on a read. An older editor that omits `icon`
preserves the saved choice when its revision is current.

For stores with exactly one indoor light, one ambient-light plug, one shade and one lock, the initial list offers `休憩モード`: indoor light off, ambient light on, shade fully closed, lock. Once a store saves its own list, that list is authoritative, including an empty list.

## Conditional indoor lighting

Indoor-light scenes use target on/off actions instead of an unconditional Bot press. Inside the existing device claim, the server reads the Bot and Hub before sending:

- Press-mode Bot, target off: press only for light levels 10–20. Levels 1–3 are already off; levels 4–9 are below the on range. Both ranges skip the press.
- Press-mode Bot, target on: press only for levels 1–3. Levels 10–20 are already on; levels 4–9 are ambiguous. Both ranges skip the press.
- Missing, invalid, or failed readings never trigger a press.
- A switch-mode Bot uses its explicit on/off command. Manual device-card and widget presses retain their existing explicit-command behavior.

These thresholds follow the current daytime calibration (off 2, on 12). They infer lighting from ambient brightness, not direct feedback from the lamp.

Other device safety checks are shared with manual controls: shade calibration and movement checks, lock/door state checks, device/store scope, and the ten-second per-device cooldown.

For Roller Shade `setPosition`, the shared SwitchBot adapter sends the percentage
as a JSON number. The installed firmware acknowledges string percentages with
`statusCode: 100` and an empty body but does not move. Confirmed live reads changed
from 0 to 10 with a numeric parameter and back to 0 on restoration. Public command
and journal parameters remain text for existing clients and idempotent replay;
device-page, widget, and scene actions all use this one transport conversion.

## Execution and persistence

Scene settings live in `module_settings`, with `module_key=store_device_scenes` and `scope_key=store:<id>`. Revision checks reject concurrent stale edits. Device settings and ordering are separate and preserved.

Apply `db/migrations/20260930-store-device-scenes.sql` before deploying the scene API or shared device-command changes. It only adds `store_device_scene_runs` and its indexes; existing command/history tables are retained.

A confirmed run snapshots the scene and starts server-side work using Next.js `after()`. A unique active-store index, worker claim, and deterministic command IDs prevent overlapping scene workers and duplicate sends. Manual commands are blocked while a scene is active. Existing per-device claims also protect an already-running manual command.

The worker reads each device immediately before its action, records the outcome, and proceeds in order. Failed or ambiguous commands are never automatically retried. Expired work is marked interrupted and is not resumed; a lost response might still mean a physical operation occurred. Provider acknowledgement is shown as sent, not proof of the resulting physical state.

There is no idle polling. The browser observes only an active run (initially after two seconds, then every five seconds, bounded to three minutes). On completion it waits five seconds and refreshes device state once. Leaving the page does not deliberately cancel the server worker; runtime interruptions remain visible in the run record.

The Android Store widget's four right-side slots can bind a scene or a device.
Store 0.2.20 displays the selected scene icon using the same Lucide outlines as
the editor. Existing local bindings are retained. Scene metadata refreshes once
per selected store on the existing widget/app refresh, and when a user opens its
confirmation. These reads never execute scenes, never poll device status, and
are not retried by the scene metadata refresh. Failed reads preserve saved icons.
Scene configuration and confirmation use the same authenticated API. The scene
list response exposes `devices: [{ key, name, kind }]` so native confirmation can
resolve step names without fetching device states or exposing vendor IDs. Opening
the shortcut only reads the current definition. Execution requires confirmation
of that revision, with explicit unlock acknowledgement where applicable. The
native sheet observes the same run UUID in the foreground for at most three
minutes; closing, restoring, or losing a response never sends the scene again.

## Verification

Run the existing indoor-light tests and scene integration tests with the installed PGlite module:

```sh
PGLITE_MODULE_PATH=/path/to/@electric-sql/pglite node --test scripts/tests/store-indoor-light.test.cjs scripts/tests/store-device-scenes.test.cjs
```

The scene fixture exercises the actual route, authorization, SQL, executor, and SwitchBot adapter against PGlite with fake device responses. It does not contact real hardware. Coverage includes thresholds, fresh preflight failures, command ordering, replay and concurrency, manual-command preservation, edit revisions, origin/store/role checks, unlock acknowledgement, and additive migration preservation.
