# Store device relay

Implementation prepared 2026-10-16. This is not deployment or hardware acceptance evidence.

## Scope and activation

The existing Store APK provides an outbound-only native relay service. iPad and other browsers operate the POS through the server; they do not connect directly to the phone. The existing Wi-Fi ESC/POS renderer is reused. The first intended pilot is 桜並木店, with one register, one phone, the configured 80mm network printer and A&D SH-3000AWP-BT. The regular `/store/pos` and `/os/stores/devices` routes remain the entry points.

Every store starts disabled: the additive migration seeds no store, station or enabled flag. OS managers with `pos.manageSettings` and the store scope configure stations in `/os/stores/devices`. Printing and scale integration are independent switches. Saving configuration fences the previous operator and clears live scale data. Nothing in this patch silently enables 桜並木店 or any other store.

Apply `db/migrations/20261016_store_device_relay.sql` to the explicitly authorized target before enabling. Deploy Web/API and install the tested Store APK separately. Use a station with both features disabled for configuration preparation; test hardware before actual operation. The first native transport accepts `escpos_network` only, not Star SDK, USB or Bluetooth printers. Existing direct printing retains those transports. Proxy mode currently rejects table-session settlement rather than saving an order without its required receipt. Brand website checkout, payment processing and customer pages are unchanged.

## Device enrollment and operation rights

1. In OS select the store and save the independent feature flags. A single register is selected automatically; register selection, naming and additional registers remain in advanced settings. Retain the store's existing printer destinations/templates. Unsaved switches do not count as enabled or connected.
2. Open the phone connection screen from the settings page. The URL carries the non-secret store/register IDs; the page validates them against the scoped server response instead of silently using a different Store selection. In a compatible Android Store app, a manager can explicitly connect this phone without copying a code: the screen issues the existing single-use code, exchanges it for the device credential, then starts the existing native service. Replacing a paired phone requires confirmation. Opening the screen alone never saves settings, changes the active cashier or pairs a device.
3. Manual code entry remains available for connections prepared by another manager/device. Issuing a single-use, 10-minute connection code revokes the previous relay credential and marks in-flight sends uncertain. The bearer credential stays in app-private preferences (Store backups are disabled); the database stores its hash only. Neither codes nor credentials are put in URLs. No inbound port is opened.
4. On iPad open POS and acquire the register. Login to the store alone never acquires it. A competing browser must explicitly confirm takeover using the current server epoch. The old token cannot renew or submit new sales. Operation rights expire after 45 seconds without renewal; clients renew every 12 seconds. The selected credential is remembered in this browser (local storage, migrating the previous tab-only session storage), but is never treated as active until the server validates its store, employee, active login session, token and epoch. Returning to POS, becoming visible, regaining focus or going online attempts recovery; transient network/5xx failures pause use without forgetting the credential. Status and renewal requests time out after ten seconds so a suspended request cannot permanently block recovery. An expired lease may resume only with that exact unreplaced identity. The locked resume clears unfinished scale sessions/readings/filter/tare evidence, while preserving the station epoch and immutable captures already in the cart. The local recovery version also fences late adoption responses and requires a fresh current-bowl capture, even for the same numerical weight. Active renewals do not clear weighing. Explicit takeover, changed configuration, disabled stations, logout/session revocation, or an unauthorized account prevent recovery; the old device never automatically claims or takes back a successor. Same-browser tabs share this device identity; separate browsers and installed web apps have separate storage. Scale sessions are invalidated on takeover.
5. Android runs a connected-device foreground service with a notification and a wake lock while enabled. Explicit start/resume saves recovery intent separately from the credential. Android sticky-service recreation, ordinary boot/package update and reopening Store may restore a valid saved connection only while that intent is enabled. A 0.2.25 installation has no saved recovery intent and requires one explicit resume after upgrading. Stop persists the disabled intent and releases the wake lock; opening the page cannot undo a manual stop. A 401 for the current credential disables recovery and stops future agent calls; a late 401 for an old credential cannot disable a replacement connection. On-device stop does not delete unresolved server jobs. Android and manufacturer background limits still apply, and reboot/lock-screen/OEM behavior requires physical verification.

The relay device credential is scoped to its assigned station/store and only accesses the agent API. It cannot change pricing, refund, take over a register or enroll another device. Operator actions additionally use the existing active employee session, same-origin checks, store access and the station's hashed operation token/epoch. The new native JS entry point is limited to the production HTTPS relay page.

The guided screens distinguish an ordinary Android browser, an older Store app and a Store app with the relay bridge. Android hardware alone does not supply the service. Native bridge calls remain restricted to the existing `/store/device-relay` path; the management screen only links there. Local service running and server-authenticated phone heartbeat are displayed separately, and neither proves physical printing. POS uses plain actions for starting checkout on this device or taking it over from another device, retaining the same exclusive operation rights and confirmation.

Guided pairing sends the expected station ID as well as the store and code. The pair API checks that station in the same credential exchange update, so a code belonging to another register is not consumed. Already-open pre-guidance manual-code pages can still omit the expected station until those clients have reloaded; their existing store/code scope remains enforced.

## Printing and uncertainty

The normal POS handler validates prices/options and writes the order, item records and server-built immutable ticket snapshots in the same database transaction. Per bowl: kitchen ticket, finishing ticket and customer pickup ticket, with the same pickup code; per payment: one receipt last. Mixed-brand ordinary kitchen documents retain their configured copies. The response and saved order summary identify server-managed printing, so iPad never also prints locally. The previous production-task printer explicitly excludes those orders. Existing offline/direct bowl requests retain their identified compatibility and do not enter the relay path.

Agent claims are serialized under a station/device lock and store-level advisory lock. Only one task per store may be sending; uncertain results stop automatic delivery until resolved. Task ACKs are fenced by the claiming device and claim token. The native agent commits an uncertain local ACK record *before* sending any bytes and retries only the ACK after a crash, never the print. A stale sending task becomes uncertain after two minutes, not pending.

The generic TCP printer has no physical paper-completion proof. `sent` means bytes were submitted; staff must inspect paper. A socket/write failure is conservatively uncertain. Explicit confirm-sent or reprint is audited. Reprint creates a separate task with the same customer code, records its source and suppresses cash-drawer opening; late ACKs cannot overwrite a manually resolved task. Kitchen/pickup reprints check order/refund/handoff state. Print failure never creates or charges a second sale.

The 2026-10-17 reliability changes keep print eligibility per bowl after a partial refund. The refund transaction and print claim/reprint share the store print lock; actual refund state is rechecked under the order lock. Never-sent work for refunded/cancelled portions is cancelled in that transaction. Sending or uncertain work is not silently resolved. An active cashier may explicitly confirm the physical result and void an already refunded/cancelled task when uncertain, or after a sending task has exceeded two minutes. This records an audit event and invalidates its old claim token. A pending refund only pauses eligibility; it does not qualify for voiding as a completed refund.

After a partial refund, an original-sale receipt is still an immutable original transaction snapshot. Its returned print copy explicitly says that the amount is before refund, and disables drawer opening. The original amount, tax, discounts, items and persisted payload are not rewritten into an invented balance receipt. The list distinguishes kitchen and finishing documents by role, and explains refunded work before offering physical confirmation/voiding. Unknown legacy aggregate kitchen documents are conservatively stopped after a refund rather than being guessed into a new per-item ticket.

The pending jobs, captures and audit records require a retention policy before broad multi-store use; they currently retain immutable operational evidence. Raw high-frequency weight frames are not archived.

## Scale: supplied manufacturer specification and transport boundaries

The manufacturer supplied `1-BLE通信仕様書-計量BLE-SDK_D.pdf`, **BLE ユニット通信仕様 Ver.D**, on 2026-10-16. Its pages 1-4 explicitly cover SH-AWP-BT / SJ-AWP-BT. It supplies the private GATT identifiers and pairing behavior needed to implement the transport; possession of this document does not establish an installed APK, a working connection or hardware acceptance. The private PDF is not copied into this repository or published. Public references:

- [A&D Bluetooth integration and manufacturer SDK/specification application](https://www.aandd.co.jp/products/weighing/balance/bal-peripherals/bluetooth_communications/)
- [SH-AWP manual, sections 9 and 10.1-10.5](https://www.aandd.co.jp/pdf_storage/manual/balance/m_sh-awp.pdf)

### Profile, discovery and pairing

The unit is a BLE peripheral; the Android phone is the central. SH-AWP-BT does **not** support the document's HOGP keyboard profile. Use the private profile, with exactly these UUIDs:

| Purpose | UUID |
| --- | --- |
| Service | `5699d362-0c53-11e7-93ae-92361f002671` |
| Scale to phone: receive characteristic | `5699d646-0c53-11e7-93ae-92361f002671` |
| Phone to scale: command characteristic | `5699d772-0c53-11e7-93ae-92361f002671` |

Discover names by the `A&D_BT` prefix, allowing the serial-number suffix, firmware/address suffix and older bare name. Do not assume a fixed complete name or select the first matching scale. Let the operator confirm the intended physical device, retain its chosen identity in app-private configuration, and verify the expected service and characteristics after connection. The documented advertising payload lists flags and complete local name, not an advertised service UUID; filtering exclusively by service UUID could hide the scale.

The SH-AWP-BT exception is important: after power-on it advertises for two minutes, then sleeps for two minutes, advertises for 15 seconds, and repeats the two-minute/15-second cycle. During an advertising window the specified interval is 20 ms. A bounded scan of at least **135 seconds** covers a complete ordinary sleep/advertising cycle; this is a discovery allowance, not a guaranteed connection deadline. Pairing failures can stop advertising on some firmware. Show actionable retry/power-on guidance instead of declaring the model unsupported after a short scan or scanning forever.

On first connection, or after pairing registration is cleared, complete pairing within **40 seconds after connecting**. The specified security is LE Security Mode 1, Level 2. A missing pairing request or failure can reset the unit and clear its registration; behavior varies on old firmware. Initiate the Android bond flow promptly, handle its system UI and bond-state result, and begin measurement only after the secured link and GATT setup succeed. Do not invent a PIN, silently remove unrelated bonds or repeatedly restart pairing. When changing profile, the document requires clearing the previous central-side pairing registration first. The chosen scale, the Android bond and the server's relay-device credential are separate identities.

The PDF specifies where values and commands go, but **does not specify the receive characteristic's GATT properties or a mandatory notification mechanism**. Inspect the actual properties and descriptors. Subscribe to notifications/indications only where supported, confirm descriptor completion, and serialize GATT operations. If only reads are available, a successful read can return an older characteristic value; do not label it a fresh request response without verified device/SDK semantics. Unsupported or unverified reception must be shown explicitly, with automatic capture unavailable.

### Weight requests and validation

For this scale, select **`Prt=1` (command only)**. The factory value 2 also accepts commands but adds print-key output; modes 3-6 add automatic output. The BLE specification forbids stream mode, so do not use `Prt=0`. Send the read-only ASCII request `Q\r\n` (`51 0D 0A`). The manual's 2400-bps, 7-bit/even-parity/one-stop-bit settings describe the scale interface; they are not GATT configuration or extra bytes to wrap around the command.

SH-AWP weight frames have a two-character header, comma, nine-character signed numeric field, three-character unit field and CRLF: **17 bytes** total. There is no space between comma and sign. Examples are `ST,+0012.345 kg\r\n`, `ST,-00001234  g\r\n` and `OL,+9999.999 kg\r\n`. Accept mass units `g` or `kg`, converting the latter to grams; reject count unit `PC`. `ST` is stable, `US` unstable, and `OL` overload. The documented Q response is a weight frame, without a promised command echo or connection ACK. An ATT/GATT write completion is not a measurement. Non-weight echoes, control replies and malformed frames must never become a numeric reading.

The implementation should issue one Q at a time only during an active weighing session, with bounded waiting and retry. Poll cadence is an implementation choice to verify on hardware, not the stream rate. Stop requesting when the session ends, the operator loses the register, scale integration is disabled or the device disconnects. Do not send zero/tare/unit-change commands as a connection test. In the default mode the operator tares the empty bowl on the scale and POS makes no second bowl deduction. The optional preset mode below instead clears existing tare with CT before each Q and subtracts the selected store-owned plate weight on the server; it never sends T against food.

### Session and frame isolation

The existing Java/TypeScript parsers, device-authenticated reading API, per-register sessions/sequences and one-use capture records remain the safety boundaries. Older deployed native clients without the new transport report `specification_required`; receipt of the PDF alone does not change their capability. Verify the built and installed transport separately.

The BLE driver must bind an immutable context to each outstanding request: scale connection generation, station, weighing session, station epoch and local monotonic request time. Preserve this context across fragmented callbacks through the terminating CRLF. Do not attach a completed frame to whichever session happens to be current at arrival: a response initiated for bowl A must never become bowl B's reading. Reset partial buffers on session/device/connection changes and reject callbacks from an obsolete GATT instance. Bound frame length and pending requests; do not join fragments from different contexts or accept an incomplete frame on timeout.

The wire protocol contains no request ID. Therefore a canceled/timed-out A request cannot simply be forgotten while a B request starts on the same channel: a late complete A response would be indistinguishable. Drain and discard the outstanding response under its original context before starting B, or close/reestablish the BLE connection when a reliable drain cannot be established. Unsolicited frames are not a substitute for a response in a current request context. Identical consecutive weights can be valid for different bowls; identity and timing, not numeric inequality, provide isolation.

Throttle uploads rather than writing raw frames to SQL. Printing and scale uploads run on separate workers, and the scale worker retains only the newest pending sample. It discards locally delayed samples (>2 seconds), while the API rejects old sessions/sequences; neither check alone proves that a frame originated in the current session. The measurement origin must survive BLE fragmentation and upload queuing: use the outstanding request's monotonic time conservatively, and derive its UTC timestamp without restarting the clock at complete-frame arrival or HTTP upload.

The native latency improvement checks that newest-sample slot with a serial 250ms fixed-delay worker; a slow request never creates overlapping uploads or catch-up runs. An enabled scale without an active weighing session discovers new POS sessions through a one-second heartbeat interval. Active sessions and disabled scales retain the three-second heartbeat interval. BLE command frequency, CT acknowledgement requirements and measurement/session/credential guards remain unchanged. This native change requires an updated installed Store APK; web deployment alone cannot activate the shorter intervals. These intervals are implementation targets, not a measured hardware response-time guarantee.

Web POS reschedules its idle timer to one-second polling as soon as a weighing session becomes active, and an immutable successful capture fills POS before the background status GET completes. The software filter retains at least three distinct samples even when uploads are about two seconds apart, while still requiring the full configured observation time and maximum-gap limit.

After a native service restart or credential replacement within the same station, seed the local sequence from the authenticated heartbeat's persisted `scale_sequence` cursor and retain the higher local/server value; this preserves the active session without relaxing old-frame, session or measurement-freshness checks.

Agent `reading` requests require integer UTC-millisecond `measuredAt`. The server rejects timestamps more than five seconds old or more than one second ahead, preserving the supplied measurement timestamp in `scale_received_at` and the immutable capture instead of replacing it with SQL arrival time. Missing timestamps are rejected; no compatibility fallback is retained because the older native shell had no working BLE-reading producer. A real installed producer must supply the new field before automatic reading is enabled.

Both the reading update and capture adoption recheck freshness with PostgreSQL `clock_timestamp()` inside their transaction, after the station lock. Transaction-start `now()` must not extend the five-second window while a request waits. Focused tests inject a bounded delay before the actual update/adoption statement to exercise this distinction; they do not simulate a real multi-connection lock.

The authenticated heartbeat returns authoritative station/store IDs and only exposes a weighing session while its cashier lease remains valid. UI URL parameters do not establish the local service's assigned store. A non-connected scale heartbeat, disabled scale integration or expired cashier lease clears the server's current candidate. Adoption independently checks that the recently authenticated relay reports scale status `connected`; an older stable row alone cannot bypass that requirement. Browser adoption also requires a stable positive reading <=3000g within the five-second measurement window. Clear a previous stable candidate when a newer response is unstable, overloaded, malformed or lost. Adoption closes the scale session and creates a one-use capture; checkout validates captured grams/unit/employee/station epoch and links it transactionally to the order. Manual weight edits remove the capture reference. Weighing is not automatic checkout.

The default mode uses net weight after taring on the scale; no additional bowl deduction is applied in POS. Setting a new hardware tare remotely (T) is not implemented. Optional plate presets use the separate CT-cleared gross-weight flow below. A new bowl requires a new scale session. Offline operation and proxy printing are not promised: manual weight entry remains available online, but a relay-mode sale must have the register operation right and, for printing, an online agent. An unknown online sale is recovered by its original request ID instead of creating an offline replacement.

## Automatic stable-weight entry (prepared 2026-10-16)

After acquiring the register, opening a weight-priced item automatically starts a
new weighing session. A fresh, stable, positive reading within the 3000g limit is
captured and fills the item's weight and calculated price. There is no separate
start/adopt button. The item still requires the normal add-to-cart and payment
actions. Further stable weight changes replace the draft with a new immutable
capture; unchanged readings do not create repeated captures. Removing the bowl
does not erase the last confirmed draft. Opening the next item never imports a
previous session's candidate, even when two bowls have the same weight.

The 2026-10-17 change also tracks whether that accepted draft remains usable. A newly observed positive unstable reading, overload, disconnected phone/scale, expired ownership or hidden page invalidates automatic addition. The prior numeric value remains visible as the previous weight, but cannot silently enter the cart. A normal removed bowl at zero or negative weight retains an already valid confirmation; zero/negative data cannot clear a previously latched invalid state. Only a fresh stable reading in the current session, a successful new capture, or deliberate manual entry restores usability. An unchanged stable weight can revalidate its existing immutable capture without repeatedly creating captures. Null data while moving from adoption to the next monitoring session does not cause button flicker. No routine manual read/lock button is added.

Typing in the weight field or selecting manual input pauses automatic entry.
Returning to automatic input starts a fresh session. Closing the item, changing
store/register, hiding the page or losing operation rights stops that view's
weighing session. Each cleanup names its original session and owner, so a late
cleanup cannot end a newer item. Start/end/adopt errors appear inside the item
window; stale-sequence conflicts wait for a new reading instead of adopting a
different server value. No store feature flags or menu prices are changed.

Each start supplies a client UUID and the expected previous session. Starts are
idempotent without clearing an existing reading; cancellation tombstones prevent
a delayed start from reviving a closed window. Adoption supplies the displayed
sequence and produces one immutable capture per actual weighing session. The
view automatically opens its next session for monitoring after adoption. A retry
of an accepted adoption returns the original capture and cannot close a newer
session. No schema change is required. Old web clients must reload before using
automatic entry; unscoped scaleEnd requests are rejected rather than closing an
unknown current session.

The corresponding native update preserves the authenticated BLE connection
across session changes. An outstanding old Q retains its fragment buffer and
original context until it is drained and discarded, or its original timeout
requires reconnection. A rejected obsolete reading (HTTP 409) triggers a fresh
agent heartbeat without dropping BLE. Authentication failures still fence the
device. Web/API deployment and installation of the new Store APK are separate
requirements; source/unit/browser tests do not establish installed or physical
scale behavior.

Transient GATT service-discovery failures now retry the same saved scale after 5, 10 and 20 seconds. A fourth consecutive discovery failure stops retries with an explicit reconnect action; successful discovery, changed device identity and an explicit reconnect reset that budget. Genuine unsupported characteristics, missing permission and deliberate disconnect remain stopping conditions. Ordinary connected-device power loss retains its separate five-second reconnect path. The phone page can reconnect the selected saved address without requiring a new scan; target store/station, recent authorization, Bluetooth and permission checks remain mandatory.

## Background recovery (prepared 2026-10-17)

The phone connection screen shows the native service's saved automatic-recovery
intent separately from its current running status. Starting or explicitly
resuming a saved connection enables automatic recovery; stopping the relay
remembers that it must remain stopped. Opening, refreshing or returning to the
connection page only reads these facts and never starts or resumes the service.
A phone migrated from an older installation may already be running with no saved
recovery intent: the existing resume button remains available in that case so
one explicit resume can record the choice. Missing connection credentials do not
count as configured recovery.

The optional native `backgroundStatus` and `openBackgroundSettings` methods keep
older Store shells usable for their existing connection actions. A shell without
both methods receives an update prompt, while ordinary browsers receive no
native background-setting action. Invalid native status is shown as unavailable
rather than as permission granted. The background-settings button appears when
Android battery optimization or background restrictions are reported. Only an
explicit button press opens Android's confirmation/settings; merely loading or
polling the page cannot request an exemption. Returning from Android rereads the
actual status instead of assuming permission was granted.

Battery-optimization exemption does not guarantee survival under manufacturer
power management. The screen also asks the operator to allow device-specific
automatic start where the device provides that setting and to reopen Store after
a force stop; the saved recovery choice still applies. Source and browser fixtures do not verify actual reboot, OEM process
termination, Android permission dialogs or physical printer/scale behavior.

## Acceptance before pilot activation

- Isolated PostgreSQL migration twice, order+ticket rollback, duplicate checkout, takeover fencing, scope/credential revocation, exclusive claims, wrong/late ACK, unknown send, explicit reprint, scale sequence/session/freshness and captured weight validation.
- The focused actual-SQL relay regression additionally covers required/old/future measurement timestamps, preservation of measurement and capture time, disconnected-status clearing and independent adoption denial, and suppression of the weighing session after cashier expiry. Policy tests cover official 17-byte SH-AWP samples, signs/units/overload and rejection of count/control replies. These checks do not establish radio connectivity or real multi-connection lock-wait timing.
- Actual React screens with synthetic APIs at phone, iPad portrait/landscape and desktop widths; Chinese UI; independent toggles and explicit register acquisition.
- Web production build and Store APK build. Distinguish existing workspace/cache failures from source failures.
- Physical pilot remains required: phone/printer pairing and IP reachability, two bowls with identical weights, actual sequential print/cut/reattach, no-paper/network interruption, reboot/lock-screen/background behavior, and the documented scale transport/units/tare/stability. For BLE also verify actual characteristic properties, initial/repeated bonding, the 40-second pairing window, discovery across the advertising sleep cycle, fragmented/late frames crossing sessions, timeout/disconnect recovery and refusal of unstable/overload/count-unit data. Manufacturer documentation is available; these hardware results remain unverified until performed.
- Enable only the tested station in 桜並木店; confirm other stores remain disabled. Retire the phone relay only after pending/uncertain jobs are reconciled, then choose direct printing on the arriving Android tablet.

## Small/large plate presets (prepared 2026-10-18)

Configure each store under `/os/pos` → `ボウルの重さ・クイック風袋引き`. The small and large presets have stable IDs, optional positive empty weights up to 3000g in 0.1g increments, and a server-owned revision. Both weights start unset and the feature starts disabled. An unset weight is never zero. Both presets must be measured and saved before enabling; partial disabled drafts can be saved. Tare-only saves preserve other POS settings, and older receipt/discount saves that omit tare settings preserve them. Scope and `pos.manageSettings` are enforced server-side.

After enabling, every new weighed item requires an explicit small/large choice. Each session fixes its preset, empty weight, revision and server-generated token. Changing the plate or configuration invalidates the open draft's confirmation and starts a fresh session. A saved cart keeps its original immutable snapshot instead of being recalculated from a later preset. The server computes net grams from the current authenticated gross reading and session-owned empty weight; checkout validates the one-use net capture and persists total, tare and net under `store_customer_order_items.weight_measurement` and the order summary. Kitchen, customer and receipt prices continue to use net food weight; premium ingredients remain separate kitchen additions.

Preset-mode Android must advertise capability `scaleTareVersion=1`. For **every sample**, one command slot sends `CT\r\n`, waits for exactly `CT\r\n`, then sends a fresh `Q\r\n`. Only that current context's completed Q can carry the session tare token. A successful GATT write is not a successful CT. Old Q/CT responses are drained and discarded under their original context; timeout, malformed data, loss of authorization or connection replacement invalidate the proof and reconnect as appropriate. No CT is sent for browsing, connecting or default/manual-net mode. An older APK cannot silently turn a preset session into ordinary net weighing.

The scale's own automatic tare must be disabled in software-preset operation, and staff must not press its physical tare key. The wire weight frame has no net/gross/tare flag, so physical key use exactly between CT and Q cannot be detected by this protocol. Manual fallback explicitly accepts already-container-deducted net weight, records `manual_net`, and does not subtract a preset again. A removed confirmed bowl may retain its accepted weight; a positive gross empty/underweight plate invalidates it, and returning to zero cannot restore an invalidated confirmation. Zero/negative net, overload, over-capacity total, stale readings and wrong-context proof cannot be adopted.

Before rollout, apply additive `db/migrations/20261018_pos_scale_tare.sql` (three JSONB columns) to the established authorized database, deploy web/API, and install the matching capable Store APK. Existing stores remain disabled with no invented weights. Fill actual measured plate weights only when supplied. Isolated SQL, browser and native tests do not establish physical CT behavior; verify both actual plates, prior hardware-tare removal, repeated bowls, scale power cycling and paper/price output on the pilot device before enabling in daily operation. This preparation neither changes live store flags/prices nor publishes/installs the candidate.

## Optional software stability window (2026-10-18)

`/os/pos` can configure a store-owned `scaleFilterSettings` policy independently from plate tare. It starts disabled; the prepared default is a 2g total range over 2 seconds. Allowed settings are an integer total range of 1–5g and an integer observation time of 2–5 seconds. “2g” means maximum minus minimum across the accepted samples, not ±2g. This changes software acceptance and display precision; it does not change the scale's hardware resolution or its own ST/US flag.

The authenticated native agent already uploads both ST and US readings. When enabled, the server builds a bounded window from distinct, ordered native measurement timestamps in one station/device/owner epoch/scale session/tare context/configuration revision. At least three samples must span the configured time, each adjacent gap must be no more than three seconds, and the whole range must remain within tolerance. A median is rounded to 1g of **net food**; preset tare is then added back only for the internal filtered gross representation, before the existing server tare deduction runs exactly once. The accepted value stays latched while new samples remain in range. A spike, overload, zero/nonpositive net, excessive gap or observed disconnected heartbeat resets acceptance. ST readings also fill the window when this feature is enabled; disabling it restores the existing hardware-ST rule and original precision.

Raw hardware weight and `hardwareStable` are retained separately from effective software acceptance. Saved captures and `weight_measurement` include the server-owned filter source, settings revision, tolerance, observation span/sample count and raw evidence. A browser-supplied filter result never authorizes a capture or changes its price. Once an accepted capture is saved, subsequent policy changes do not recalculate that cart item's original snapshot; checkout continues to validate and consume the database capture once.

The software-filter POS opts into `keepMonitoring` when adopting a reading: the immutable capture is saved while its live session and accepted window continue. Unchanged accepted weight stays ready without another capture or observation restart. A changed load, lost/invalid current evidence or changed context blocks the old confirmation and requires independent qualification. A cached timestamp becoming stale/future, or an unknown server clock, instead pauses addition and requests a fresh status without retiring the accepted window or poisoning a pending capture. Readiness resumes only on fresh evidence for the same accepted window and exact weight; a new window still requires independent qualification. Expected bowl removal still permits the already confirmed food to be added. Unsafe readings observed during a pending adoption are latched even if followed by zero; the delayed response cannot restore readiness. Confirmation also binds the plate preset/revision and accepted window. Hardware ST/US diagnostics remain available under the raw-reading disclosure, while the main state follows the effective software judgment.

Each accepted window has a server-minted UUID persisted as `acceptedWindowId` and exposed as `filter.windowId`. New POS requests supply the observed `scaleSequence`, `scaleWindowId` and exact integer net `scaleGrams`. An advancing sequence is acceptable only while the persisted state and current accepted reading both match that same window UUID and net weight, with all existing owner/session/tare/settings/device/freshness/capacity checks. The capture saves the actual latest sequence; immutable retries must match their original window, net weight and a captured sequence at least as new as the observed one. Resetting a window invalidates its UUID even if the next accepted weight is numerically identical. Requests without window proof retain strict exact-sequence behavior; old clients retain their original session-close behavior. This additive Web/API protocol needs no schema migration or Android change.

The authenticated, uncached relay status GET includes `serverNow` (UTC ISO time sampled after all status reads) and `serverElapsedMs` (the floored monotonic duration from handler entry through those reads). POS uses that server time with a local monotonic timer rather than the iPad's wall clock. At response receipt, a conservative current-time upper bound is `serverNow + max(0, requestRoundTripMs - serverElapsedMs)`; subsequent monotonic elapsed time continues to age the original `scale_received_at` and cashier lease. Subtracting known server processing avoids counting database latency twice. A missing duration can conservatively count as zero, while a missing or invalid server clock cannot authorize automatic weight entry. Only the newest response for the current store may update this clock. Status reads never renew the measurement timestamp, ownership lease or accepted window, and server-side adoption still independently enforces freshness and ownership.

Reading persistence uses station locking plus compare-and-swap against the previously read sequence, filter state, tare context and settings revision. Concurrent, repeated, late or out-of-order uploads cannot overwrite a newer window or count one sample twice. A newly authenticated higher-sequence malformed frame or invalid/backward timestamp clears the old evidence before returning an error; old-session and replayed frames cannot clear a newer window. A frame that expires while waiting for its transaction also clears the old evidence instead of becoming fresh on arrival. The authenticated heartbeat timestamp fences snapshots across an observed disconnect/reconnect even when the prior window was empty. Actual configuration changes atomically retire unfinished scale sessions, clear their readings/windows, and require fresh weighing. Re-saving the same values preserves the revision/session. Filter-only saves preserve receipt, discount, pricing and plate settings; older requests omitting the field preserve the saved policy. Store scope and `pos.manageSettings` apply to configuration writes.

Apply additive `db/migrations/20261018_pos_scale_filter.sql` to the authorized target before the new web/API runtime. It adds two JSONB columns, retains existing records and enables no store. This feature requires no additional Android command or new native protocol. A non-connected heartbeat or sample gap is an observed recovery boundary; a fast physical Bluetooth reconnection that produces neither cannot be identified without a future native stream identity. Local SQL/policy/browser tests do not establish acceptable in-store wind, vibration or billing behavior: validate the actual scale and representative plates before enabling the pilot policy.
