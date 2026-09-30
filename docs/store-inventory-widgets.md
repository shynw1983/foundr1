# Store inventory widgets

The Android Store app offers two launcher entries using the same saved store,
brand and language settings:

- **2×1 shortcuts:** shortage registration and sales resumption, with the scope
  above the buttons. Tap the scope to reconfigure. The standard shortcut layout
  starts at 160 x 88 dp; a separate minimum layout supports 110 x 56 dp.
- **4×2 controls:** the unavailable count opens the full list. Two configurable
  slots default to Web reservations and away-order notifications; either can be
  replaced with the store's order list or sync results. These controls now share a
  top row with a 2:2:1 width ratio: two operational controls, plus two stacked
  slots for devices or scenes on the right.
  Inventory registration and resumption stay fixed at the bottom. Full controls
  start at 250 x 148 dp; 208 dp layouts add last-read times and sync details.
  Smaller layouts retain the original inventory/operational shortcuts; enlarge
  the widget to show the two device/scene slots.

Cell counts are launcher targets. Android 12+ selects responsive RemoteViews by
available width/height; older launchers use portrait/landscape options. Existing
`InventoryWidgetProvider` IDs and preferences are preserved. Both entries can be
resized between the layouts.

## Data and actions

Inventory reads the existing `/api/store/menu-settings` contract through
`InventoryApiClient`. Menu labels use menu-master display names; Chinese falls
back to English, then the Japanese/source name. No menu translations are copied
into widget UI strings.

Product names no longer occupy the widget's middle area. Registration/resumption
keep the existing searchable selection flow, exact item/option UUIDs and shared
inventory mutation API. Brand scope applies to inventory. Reservation controls
apply to the whole store; away notifications apply to the current account at that
store. Tap the widget title to change its two slots independently of other widgets.

Reservations reuse GET/PATCH `/api/store/operations` and provide Auto, Manual Open
and Manual Closed choices in a native sheet. Changing modes preserves pickup times.
Away notifications use `/api/store/order-notifications/preference`: the widget may
only toggle the viewer's existing rule, under the same owner/manager permissions
as the settings page. There is no recipient/radius input or implicit rule creation.
Tapping the away-notification tile first opens a confirmation sheet showing the
store, account scope, intended change and existing distances. Only its explicit
confirm button saves the change; cancelling, going back or recreating the sheet
does not toggle the rule, including for tap intents created by older app versions.
An atomic rule-version comparison rejects stale/duplicate taps and concurrent
distance edits. Confirmed changes update the phone's rules and stop any affected
ongoing alarm without acknowledging orders or changing other stores' rules.

Sync results come from `/api/store/inventory-history?days=1`, using the existing
bounded history response (up to 200 recent runs). The widget selects the latest
availability-change operation it can resolve within its brand scope. Operations
with unresolved identities are shown only in the all-brand view. Local operation
receipts retain exact brand identity and source translations, including when an
operation's shared inventory key differs from the clicked item key.

Platform totals are aggregated: a platform is complete only when all its
commands succeeded. Failures/timeouts remain visible even if other commands are
still running. Tapping the result opens a read-only native detail page with scope,
operation time, last checked time, per-platform outcomes and failure guidance.
The widget does not equate saving OS inventory with external platform completion.

## Refresh and failure handling

### Smart-device shortcuts

Tap the widget's store title, then select Button 1 and Button 2. Each slot can
target a device or a saved scene, independently. Each widget saves its own target
type, opaque device key or scene UUID, and label locally. Device choices come from
`/api/store/devices`; scenes come from `/api/store/devices/scenes`. Both lists belong
to the selected store, independent of the inventory brand. Read-only sensors are
excluded. Changing stores or deleting a widget clears its bindings; other widgets
keep their selections. An unsuccessful integration-list read preserves its existing
bindings when saving unrelated widget settings. Older device bindings remain valid.

Scene shortcuts use a scene icon and name; they do not display a device state.
Tapping reads the latest scene definition, device names, and revision, then shows
an ordered checklist. Confirming sends one request UUID to the existing scene
API; cancelling or restoring the sheet never starts work. Unlock actions require
an extra acknowledgement. The shared server retains conditional indoor-light
checks and executes the scene even if the sheet closes. Scene changes and removals
are checked again by the server when confirming. Lost responses only look up the
original run UUID, without resending. Result checks run every five seconds only
while an active execution sheet is in the foreground, bounded to three minutes.
Completed, failed, uncertain and skipped steps remain distinct. Scenes are created
and edited on the Store device page; see [Store device scenes](store-device-scenes.md).

Device taps open a native confirmation sheet and read the selected device before
showing actions. Only an explicit named confirmation sends a command, using the
existing authenticated POST contract, `confirmed: true`, and a fresh request UUID.
The server retains its role/store authorization, command preflight, durable claim,
and 10-second cooldown. Cached intents are rejected after a widget, store, or login
change. Opening, restoring, cancelling, or double-tapping cannot resend a command.
Lock shortcuts expose lock/unlock, and shade shortcuts expose fully open/closed;
unsupported latch actions are not introduced. Press-mode Bots are described as
one physical press; indoor light state remains explicitly inferred from the same
Hub 2 thresholds as Store. API acceptance is not presented as physical completion.

Widget values are labelled as last-read snapshots. Device snapshots are scoped
by login fingerprint, store, and device; stale/failed/missing samples are not used
for commands. Device reads occur during configuration, explicit widget refresh,
or the confirmation sheet. An accepted command schedules one read after 10 seconds
while the sheet remains open. Existing periodic inventory refreshes and their
retries do **not** poll SwitchBot or scenes. The scene GET response includes only
opaque keys, names and kinds for the checklist; it adds no endpoint or migration.
Device/scene shortcut changes are delivered in the Android Store APK.

### Inventory and operational controls

The provider renders saved state immediately and queues WorkManager reads.
Manual refresh, widget creation/configuration, returning to the Store app, and local inventory operations
start a fresh read. After an operation, unfinished platform results cause at most
six follow-up attempts with linear backoff starting at ten seconds. Android may
defer background work; this is not a real-time guarantee. The existing 30-minute
launcher update remains the periodic fallback, including for actions performed
on other devices. Opening the detail page also requests a refresh.

History and inventory have separate checked timestamps and read errors. Network
failures retain explicitly marked cached data. Authentication or store-access
failures hide and clear that store's cached inventory/history. Cancelled workers
check their state before publishing results. Changing a widget's store cannot be
saved until the corresponding brand choices finish loading.

Control snapshots are partitioned by a one-way login-cookie fingerprint. Missing,
expired, failed or other-account snapshots do not show an actionable switch.
Mutations are not queued for later execution; failed or uncertain saves remain
unconfirmed until reloaded. Older widget/presence reads cannot undo a confirmed
toggle. The preference endpoint and Android update must ship together.
No database migration is required. Development checks use local fixtures, not
live reservation changes, push notifications or physical phones.

## Local verification

Run the pure Java identity/state checks (JDK required):

```sh
javac -d /tmp/foundr1-widget-tests \
  Foundr1Android/app/src/store/java/jp/foundr1/store/InventoryTargetIdentity.java \
  Foundr1Android/app/src/store/java/jp/foundr1/store/InventoryWidgetPolicy.java \
  Foundr1Android/tests/InventoryTargetIdentityTest.java \
  Foundr1Android/tests/InventoryWidgetPolicyTest.java
java -cp /tmp/foundr1-widget-tests jp.foundr1.store.InventoryTargetIdentityTest
java -cp /tmp/foundr1-widget-tests jp.foundr1.store.InventoryWidgetPolicyTest
```

Compile the Store variant with `./gradlew :app:assembleStoreDebug` from
`Foundr1Android`. The 2026-09-16 implementation intentionally omits connected-phone
testing at the user's request. Launcher appearance, resize interactions, and
background refresh timing still require later device confirmation.

See [Store visual refinement](store-visual-refinement.md) for the shared visual
system and host-side RemoteViews render checks.
