# Foundr1 Android Shells

This Android project builds four WebView shell apps and one local integration bridge from the same native code:

- `store`: `Foundr1 Store`, opens `https://www.foundr1.jp/store`
- `os`: `Foundr1 OS`, opens `https://www.foundr1.jp/os`
- `member`: `Foundr1 Member`, opens `https://www.foundr1.jp/member`
- `staff`: `Foundr1 Staff`, opens `https://www.foundr1.jp/staff`
- `bridge`: `Foundr1 Bridge`, listens to Uber Eats Orders on the same tablet and uploads structured order snapshots to Foundr1 OS

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

## Foundr1 Bridge for Uber Eats

The `bridge` variant runs independently on the Android tablet after initial setup. A computer and USB connection are not required during normal operation.

1. Install `app/build/outputs/apk/bridge/debug/app-bridge-debug.apk` or a signed release build.
2. Open `Foundr1 Bridge`.
3. Keep the default endpoint:
   `https://www.foundr1.jp/api/local-bridge/uber-eats/events`
4. Enter the server-side `LOCAL_BRIDGE_TOKEN`.
5. Enter the Foundr1 OS store UUID and a recognizable device name.
6. Save, then enable notification access and the Foundr1 Bridge accessibility service.
7. Exclude Foundr1 Bridge and Uber Eats Orders from battery optimization.

The bridge never presses Uber accept, deny, ready, or cancellation actions. A new-order notification opens Uber Eats Orders and directly signals the accessibility recovery worker; it does not depend on Android showing a visible notification banner or creating a new window event. While recovery is pending, the foreground service repeats that internal signal every two seconds. The accessibility service returns to the order overview, opens each unread active-order card, scrolls its detail area to collect off-screen modifiers, uploads the structured snapshot, and returns to the overview. Multiple simultaneous orders are processed one at a time and tracked by order number so the same active card is not reopened during the recovery batch. Failed order uploads are retained locally and retried when connectivity returns.

Foundr1 OS deduplicates bridge orders by store, local order date, and Uber order number. Only recent order-detail screens are imported, so browsing older order history does not create operational orders.

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
