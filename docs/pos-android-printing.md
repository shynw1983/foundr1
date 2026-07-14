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

## Printer Connections

The first supported transport is Wi-Fi ESC/POS over TCP.

- Host: saved in POS printer settings, for example `192.168.0.33`
- Port: default `9100`
- Paper width: `80mm` or `58mm`
- Encoding: default `shift_jis`

Android should connect to `host:port`, render the payload as a bitmap, convert the bitmap into ESC/POS raster commands, write bytes, optionally cut paper, and close the socket with a short timeout. Do not print CJK text through printer code pages; Chinese-market ESC/POS devices often produce mojibake unless the whole ticket is rasterized.

Printer settings are stored per store and support multiple destinations:

- Receipt printer: used for POS receipts after checkout.
- Default kitchen printer: used for kitchen tickets when a brand does not have its own printer.
- Brand kitchen printers: optional per-brand overrides for kitchen tickets.

Older single-printer settings are treated as the receipt printer during normalization.

## Payload

The web app currently sends:

- `jobType`: `test`, `receipt`, or `kitchen`
- `printer`: connection and print behavior settings
- `storeName`
- `printedAt`
- `order`: pickup code, order type, payment, totals, tax, cash tender/change, items, and option labels

The payload version is `1`. Keep Android parsing tolerant of unknown fields so POS templates can evolve. Android should rasterize `test`, `receipt`, and `kitchen` jobs through the same bitmap path so CJK output is consistent across OS test prints, POS receipts, and kitchen tickets.

## Current Web Entry Points

- `/os/pos`: save receipt, default kitchen, and brand kitchen printer settings; send test prints to the selected destination.
- `/store/pos`: after checkout, send receipt print jobs and brand-grouped kitchen print jobs when enabled.
- Kitchen ticket copies are configured per store (1-5). The web app sends one bridge print call per copy for both POS and Web reservation kitchen tickets.
