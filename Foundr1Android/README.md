# Foundr1 Android Shells

This Android project builds three WebView shell apps from the same native code:

- `store`: `Foundr1 Store`, opens `https://www.foundr1.jp/store`
- `os`: `Foundr1 OS`, opens `https://www.foundr1.jp/os`
- `member`: `Foundr1 Member`, opens `https://www.foundr1.jp/member`

All variants expose this JavaScript bridge to the web app:

```js
window.Foundr1Printer.print(payloadJson)
window.Foundr1Printer.isAvailable()
```

The bridge sends ESC/POS bytes to a Wi-Fi thermal printer through TCP, using the printer settings saved in Foundr1 OS.

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

6. Click Run.

Command-line builds:

```bash
./gradlew assembleStoreDebug
./gradlew assembleOsDebug
./gradlew assembleMemberDebug
```

## Test Printer

1. On the Android tablet, connect to the same Wi-Fi as the printer.
2. Open the installed `Foundr1 Store` app.
3. Log in to Foundr1 OS.
4. Go to `/os/pos`.
5. In `レシート / 厨房プリンター`, use:

   - Printer IP: `192.168.0.33`
   - Port: `9100`
   - Paper width: `80mm`
   - Character encoding: `Shift_JIS`

6. Tap `テスト印刷`.

If the printer does not print, first confirm the printer works from a computer:

```bash
printf '\x1b\x40Foundr1 OS Test Print\n80mm Printer OK\nIP 192.168.0.33\n\n\n\x1d\x56\x00' | nc -w 3 192.168.0.33 9100
```

## Notes

- Ordinary Chrome/Safari will still show `Android 印刷ブリッジが見つかりません。`
- Printing works only inside these Android app shells.
- The web side currently sends test jobs, POS receipts, and brand-grouped kitchen tickets.
