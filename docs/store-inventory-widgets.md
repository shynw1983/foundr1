# Store inventory widgets

The Android Store app offers two launcher entries using the same saved store,
brand and language settings:

- **2×1 shortcuts:** shortage registration and sales resumption, with the scope
  above the buttons. Tap the scope to reconfigure.
- **4×2 sales status:** unavailable item/option count, two named shortcuts,
  overflow into the full unavailable list, the latest operation and its platform
  outcomes. Taller layouts show two more named items. A dense layout supports
  launcher allocations as short as 110 dp; regular layouts start at 156 dp.

Cell counts are launcher targets. Android 12+ selects responsive RemoteViews by
available width/height; older launchers use portrait/landscape options. Existing
`InventoryWidgetProvider` IDs and preferences are preserved. Both entries can be
resized between the layouts.

## Data and actions

Inventory reads the existing `/api/store/menu-settings` contract through
`InventoryApiClient`. Menu labels use menu-master display names; Chinese falls
back to English, then the Japanese/source name. No menu translations are copied
into widget UI strings.

Named shortcuts carry store, brand, item/option kind and UUID. The native sheet
reloads current availability before selecting the item and showing confirmation.
A stale shortcut cannot select a different same-name item or restore one that
has already become available. Ordinary registration/resumption buttons keep the
existing searchable selection flow and shared inventory mutation API.

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
Manual refresh, widget creation/configuration, and local inventory operations
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

No new server endpoints, database migrations, live data writes, or brand-website
changes are needed for the widget implementation.

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
