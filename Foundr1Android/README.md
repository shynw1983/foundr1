# Foundr1 Android Shells

This Android project builds four WebView shell apps and one local integration bridge from the same native code:

- `store`: `Foundr1 Store`, opens `https://www.foundr1.jp/store`
- `os`: `Foundr1 OS`, opens `https://www.foundr1.jp/os`
- `member`: `Foundr1 Member`, opens `https://www.foundr1.jp/member`
- `staff`: `Foundr1 Staff`, opens `https://www.foundr1.jp/staff`
- `bridge`: `Foundr1 Delivery Bridge`, listens to Uber Eats Orders and Rocket Now on the same tablet and uploads structured order snapshots to Foundr1 OS

All variants expose this JavaScript bridge to the web app:

```js
window.Foundr1Printer.print(payloadJson)
window.Foundr1Printer.isAvailable()
```

The bridge sends print jobs from Foundr1 OS to store printers using the printer settings saved in POS settings.

Supported device types:

- `ESC/POS Wi-Fi / LAN`: raw ESC/POS over TCP, usually port `9100`.
- `ESC/POS Bluetooth`: raw ESC/POS over paired Bluetooth SPP devices.
- `ESC/POS USB`: raw ESC/POS over Android USB bulk output. The first print may ask for USB permission.
- `Star プリンター`: Star printers through the official StarXpand SDK.

## Build With Android Studio

1. Install Android Studio.
2. Open this folder:

   `/Users/wushengyin/Desktop/foundr1/Foundr1Android`

3. Wait for Gradle sync to finish.
4. Connect the Android tablet by USB, or create an emulator.
5. Select the build variant:

   - `storeDebug`
   - `osDebug`
   - `memberDebug`
   - `staffDebug`
   - `bridgeDebug`

6. Click Run.

Command-line builds:

```bash
./gradlew assembleStoreDebug
./gradlew assembleOsDebug
./gradlew assembleMemberDebug
./gradlew assembleStaffDebug
./gradlew assembleBridgeDebug
```

## Foundr1 Delivery Bridge

The `bridge` variant runs independently on the Android tablet after initial setup. A computer and USB connection are not required during normal operation.

1. Install `app/build/outputs/apk/bridge/debug/app-bridge-debug.apk` or a signed release build.
2. Open `Foundr1 Delivery Bridge`.
3. Keep the default endpoint:
   `https://www.foundr1.jp/api/local-bridge/uber-eats/events`
4. Enter the server-side `LOCAL_BRIDGE_TOKEN`.
5. Enter the Foundr1 OS store UUID and a recognizable device name.
6. Choose the tablet platform mode: `Uber Eats only`, `Rocket Now only`, or `Uber Eats + Rocket Now`. Dual-platform tablets also choose one primary foreground app.
7. Save, then enable notification access and the Foundr1 Delivery Bridge accessibility service.
8. Exclude Foundr1 Delivery Bridge and the selected order apps from battery optimization.

The bridge never presses Uber accept, deny, or cancellation actions. It can press the ready action only for a matching order after Foundr1 OS explicitly issues a kitchen-completion command. A new-order notification opens Uber Eats Orders and directly signals the accessibility recovery worker; it does not depend on Android showing a visible notification banner or creating a new window event. While recovery is pending, the foreground service repeats that internal signal every two seconds. The accessibility service returns to the order overview, opens each unread active-order card, scrolls its detail area to collect off-screen modifiers, uploads the structured snapshot, and returns to the overview. Multiple simultaneous orders are processed one at a time and tracked by order number so the same active card is not reopened during the recovery batch. Failed order uploads are retained locally and retried when connectivity returns.

Bridge releases are published with `npm run apk:bridge`. The first managed release is `1.0.0` with Android `versionCode` 1. Each later publication increments `versionCode` and the semantic patch version, keeps the versioned APK, and refreshes the latest download links and metadata under `public/downloads/bridge`.

Bridge checks `/downloads/bridge/version.json` at startup and every six hours. When a newer release exists, it downloads the APK into app-private storage, verifies the declared file size and SHA-256 digest, and posts an update notification. Staff can also check manually from the Bridge system-status card. Android may require a one-time `Install unknown apps` permission and an installation confirmation; after package replacement, the boot receiver restarts Bridge while preserving the store binding, platform mode, notification access, and accessibility authorization.

Foundr1 OS deduplicates bridge orders by store, local order date, and Uber order number. Only recent order-detail screens are imported, so browsing older order history does not create operational orders.

Rocket Now notifications open the matching merchant-app order screen. The same accessibility service reads the six-character Rocket Now order number, items, options, quantities, customer request, amount, and operational status, then imports the order with `order_source = 'rocket_now'`. It never accepts or cancels a Rocket Now order automatically.

Platform mode is enforced by notification capture, accessibility parsing, Uber command polling, and foreground recovery. In dual-platform mode, only the configured primary app is guarded as the normal foreground. Explicit work in the secondary app temporarily owns the foreground, and Uber commands use a single controlled launch with a loading grace period instead of repeatedly launching and backing out of the app.

## Test Printer

1. On the Android tablet, connect to the same Wi-Fi as the printer for ESC/POS Wi-Fi printers, or pair the Star printer in Android Bluetooth settings.
2. Open the installed `Foundr1 Store` app.
3. Log in to Foundr1 OS.
4. Go to `/os/pos`.
5. In `レシート / 厨房プリンター`, choose the device type.

   For ESC/POS Wi-Fi / LAN printers such as many xprinter or Epson TM-compatible devices:

   - Printer IP: `192.168.0.33`
   - Port: `9100`
   - Paper width: `80mm`
   - Character encoding: `Shift_JIS`

   For ESC/POS Bluetooth printers:

   - Device type: `ESC/POS Bluetooth`
   - Identifier: paired Bluetooth device name or MAC address.

   For ESC/POS USB printers:

   - Device type: `ESC/POS USB`
   - Identifier: optional USB device name or `vendor:product`. Leave empty to use the first compatible USB printer.

   For Star printers:

   - Device type: `Star プリンター`
   - Connection: `Bluetooth` is recommended for store tablets; `USB` is also supported for fixed counters.
   - Identifier: paired Bluetooth name, Bluetooth MAC address, or LAN identifier depending on the connection mode. USB can leave the identifier empty.
   - Cash drawer: enable `現金会計でドロアを開く` for the receipt printer when the drawer should open after cash payment.

6. Tap `テスト印刷`.

If the printer does not print, first confirm the printer works from a computer:

```bash
printf '\x1b\x40Foundr1 OS Test Print\n80mm Printer OK\nIP 192.168.0.33\n\n\n\x1d\x56\x00' | nc -w 3 192.168.0.33 9100
```

## Notes

- Ordinary Chrome/Safari will still show `Android 印刷ブリッジが見つかりません。`
- Printing works only inside these Android app shells.
- The web side currently sends test jobs, POS receipts, and brand-grouped kitchen tickets.
- Star printer support uses the official `com.starmicronics:stario10` StarXpand SDK. Keep Bluetooth/USB permissions and USB filters in sync when updating the SDK.

### Uber idle order scan

Bridge 1.0.49 adds a five-second accessibility timer. When Uber is foreground and
there have been no clicks, scrolls, focus changes, or text/touch interactions for
45 seconds, it returns toward the active order overview and checks unread cards.
It allows at most four Back actions per idle session, five seconds apart, and
stops if it cannot reach the overview. It does not launch other apps for idle scans.
Remote commands, focused editors, and detected save/confirmation dialogs defer
scanning. Staff must finish or dismiss an open editor before scanning resumes.
New-order notifications inside Uber defer navigation to the accessibility worker
instead of immediately opening a notification intent; recent interaction delays
that worker by at least five seconds. Notification recovery and its order-number
upload deduplication remain in use.

Policy test (JDK required):
```sh
javac -d /tmp/foundr1-idle-tests app/src/bridge/java/jp/foundr1/store/bridge/UberIdleScanPolicy.java tests/UberIdleScanPolicyTest.java
java -cp /tmp/foundr1-idle-tests jp.foundr1.store.bridge.UberIdleScanPolicyTest
```

On-tablet verification: visit history, availability, and settings; stop interacting
for 45–50 seconds and verify return to the overview and import of unread orders.
Repeat while scrolling/editing and with an open save dialog; navigation should
wait. Check a new-order notification on those pages, multiple simultaneous orders,
and an active OS inventory command. OEM/Uber dialog accessibility varies, so
verify this on the installed Uber version before relying on unattended operation.

Bridge 1.0.50 fixes a device-confirmed history-page detection error: Uber reuses
`ub__ueo_orders_header_title` for both `注文履歴` and `注文の品`. Both event-driven
recovery and idle scanning now also require the active-order container or order
tabs. The presence of the shared header alone must never identify the order
workbench. Idle Back dispatch success/failure is recorded in recovery diagnostics.

Verified on the paired 24075RP89G tablet on 2026-09-09: installed 1.0.50,
opened history, and observed automatic Back followed by the active order page.
A second run entered history at 03:28:41 JST and logged successful idle Back at
03:29:30 JST (49 seconds). No orders were accepted, modified, or cancelled.
A swipe on non-scrollable content did not emit a scroll event and therefore did
not defer scanning; idle detection depends on accessibility interaction events.
Android build, standalone idle-policy tests, TypeScript, and diff checks passed.
The unrelated Next.js production build stalled during compilation and was stopped.
