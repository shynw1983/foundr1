# Store inventory widgets

The Android Store app offers two launcher entries using the same saved store,
brand and language settings:

- **2×1 shortcuts:** shortage registration and sales resumption, with the scope
  above the buttons. Tap the scope to reconfigure. The standard shortcut layout
  starts at 160 x 88 dp; a separate minimum layout supports 110 x 56 dp.
- **4×2 controls:** the unavailable count opens the full list. Two configurable
  slots default to Web reservations and away-order notifications; either can be
  replaced with the store's order list or sync results. Inventory registration
  and resumption stay fixed at the bottom. Full control blocks start at 148 dp,
  and 208 dp layouts add explanatory status and sync details. The 110 dp layout
  keeps the same four actions using one-line control labels.

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
