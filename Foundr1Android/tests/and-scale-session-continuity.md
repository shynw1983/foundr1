# A&D BLE weighing-session continuity

The driver keeps an already authenticated GATT connection when a cashier starts,
ends or changes a weighing session, including a station epoch change. It clears
the visible reading and query cadence. Device credential changes, disabled scale
integration and expired authorization still close the connection. No public
JavaScript bridge, agent API or native service interface changes are needed.

The command-mode `Q\r\n` protocol has no response/request identifier. A session
transition cannot safely discard an outstanding Q and immediately issue another:
its delayed complete reply could be attributed to the next bowl. Instead, the
single old request retains its original session, epoch, monotonic send time and
fragment buffer, but is permanently retired from delivery. The driver sends no
new Q until it has consumed the retired request's complete 17-byte response and
discarded it. Repeated transitions cannot revive the retired response. A request
that was already fully answered does not require draining.

The original two-second timeout still applies to a retired request. Timeout or
malformed replies close and retry the GATT connection; a fixed quiet delay is not
used as proof that an unanswered old reply can no longer arrive. This preserves
isolation under the configured `Prt=1` command-only protocol, with one outstanding
Q and one response frame per command. Stream/automatic-print modes remain
unsupported. Physical firmware behavior still requires in-store validation.

A reading upload can receive HTTP 409 after another request adopts a weight or
ends its session. That response discards the sample and schedules an immediate
authenticated heartbeat on the next worker tick without disabling BLE. This
handling is local to reading uploads: heartbeat conflicts, unauthorized responses
and other failures still fence the driver. The message reports a rejected sample
without claiming a specific clock/session cause that was not returned to the
worker. `StoreDeviceRelayScaleUploadTest` exercises the actual worker using local
responses, without starting its service schedulers or making network requests.

`StoreAndBleScaleSessionTest` exercises the real driver against a Robolectric
in-memory GATT: idle session start/end, fragmented retired responses, epoch
changes, multiple transitions, timeout and malformed-frame fallback, credential
changes, disabling, authorization expiry and unchanged heartbeat continuity.
It never connects to a physical phone or scale. Run it alongside the existing
protocol and parser checks:

```sh
./gradlew testStoreDebugUnitTest \
  --tests jp.foundr1.store.StoreAndBleScaleSessionTest \
  --tests jp.foundr1.store.StoreDeviceRelayScaleUploadTest \
  --tests jp.foundr1.store.AndBleQueryTest \
  --tests jp.foundr1.store.AndScaleReadingTest --no-daemon --max-workers=2 --offline
```

## Notification callback ordering investigation (2026-10-25)

The published Store 0.2.30 / code 42 APK has the same scale driver, query parser,
and upload worker source hashes as code 41. Its extracted DEX also contains the
retired-request protection above. Publishing a version does not establish the
version installed on the store phone.

An additional reproducible defect exists before the handler's response parser:
the Android BLE callback copied bytes and a millisecond timestamp, but did not
capture the outstanding query identity. `receive()` later used whatever query
was pending when the handler processed that callback. If an unsolicited or
duplicate old notification arrives while idle, behind an already queued timer,
the timer can issue a new Q before that notification is parsed. When both have
the same `elapsedRealtime()` millisecond, the parser's time guard cannot establish
their order. The old bytes acquire the new query's session, tare token and send
time. This also applies to the idle gap between a CT acknowledgment and its Q.

The callback-ordering tests invoke the real Android callbacks, driver and upload
worker. The preset test injects an unrequested 487g notification immediately
before each new Q, then delivers its actual 413g response. Before the fix, the
driver uploads 487g under the new session and discards the correct 413g while
idle. Repeating this three times at 1.25-second intervals produces three wrong
samples spanning 2.5 seconds, enough to satisfy the configured three-sample,
two-second filter. With the 204g plate preset, those wrong samples represent
283g / JPY 1,132 instead of 209g / JPY 836. These are synthetic replay values,
not recovered physical weights for either customer.

The fix snapshots the pending query in both Android callback overloads before
enqueueing the notification. Idle notifications are dropped; queued callbacks
are parsed only while their captured query is still pending. The query reference
is volatile because callbacks and the driver handler run on different threads.
Existing retired-query draining, immutable contexts, freshness checks and CT/Q
ordering remain enforced. No server protocol or schema change is required.

This proves a software defect and a possible wrong-upload mechanism. It does
not prove that the store phone emitted this event sequence during the incident,
or explain why an unsolicited 487g notification would recur. The historic server
records contain captures and session events, not raw BLE callbacks/Q/CT traffic;
the phone was unavailable for ADB inspection. Incident attribution remains open.

After crash recovery, the published-driver snapshot was replayed in an isolated
compiler input rather than temporarily replacing the working source. Both callback
variants failed with three uploaded 487g frames spanning 2,530ms and 2,522ms. The
actual server filter accepted each replay as 283g / JPY 1,132 after the 204g tare.
The repaired source passed all six suites (64 executions, including inherited
tests) and `assembleStoreDebug`. This is local validation only; no APK was
published or installed, and no order or production configuration was changed.

Run the callback regressions with the existing suites:

```sh
./gradlew testStoreDebugUnitTest \
  --tests jp.foundr1.store.StoreAndBleScaleSessionTest \
  --tests jp.foundr1.store.StoreAndBleScaleCallbackOrderingTest \
  --tests jp.foundr1.store.StoreAndBleScaleTareTest \
  --tests jp.foundr1.store.StoreAndBleScalePresetCallbackOrderingTest \
  --tests jp.foundr1.store.StoreDeviceRelayScaleUploadTest \
  --tests jp.foundr1.store.AndBleQueryTest --no-daemon --max-workers=2 --offline
```
