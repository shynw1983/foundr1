# POS Android Wi-Fi Printing

Foundr1 OS sends structured print jobs from the web app to an Android WebView bridge. The Android app owns the TCP socket and ESC/POS byte conversion.

## Bridge

Expose this object to the WebView:

```ts
window.Foundr1Printer = {
  isAvailable: () => true,
  print: (payloadJson: string) => "{\"ok\":true}"
}
```

`print` receives a JSON string. Return either nothing, an object, or a JSON string:

```json
{ "ok": true }
```

or:

```json
{ "ok": false, "error": "Printer connection timeout" }
```

## Printer Connection

The first supported transport is Wi-Fi ESC/POS over TCP.

- Host: saved in POS printer settings, for example `192.168.1.58`
- Port: default `9100`
- Paper width: `80mm` or `58mm`
- Encoding: default `shift_jis`

Android should connect to `host:port`, convert the payload into ESC/POS commands, write bytes, optionally cut paper, and close the socket with a short timeout.

## Payload

The web app currently sends:

- `jobType`: `test`, `receipt`, or `kitchen`
- `printer`: connection and print behavior settings
- `storeName`
- `printedAt`
- `order`: pickup code, order type, payment, totals, tax, cash tender/change, items, and option labels

The payload version is `1`. Keep Android parsing tolerant of unknown fields so POS templates can evolve.

## Current Web Entry Points

- `/os/pos`: save printer settings and send a test print.
- `/store/pos`: after checkout, send a receipt print job when printer settings are enabled.
