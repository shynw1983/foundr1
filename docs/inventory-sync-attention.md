# Sales-status synchronization alerts

This change addresses operations performed while staff are cooking: a requested
availability change must not lose visibility when one platform fails or the
Bridge stops responding. It does not change the menu master, availability
authority, platform identities, or customer ordering contracts.

## Staff behavior

- Store operation pages show only operations initiated in the current store
  business day. On a weekday explicitly marked `open24Hours: true` (and not
  closed), they instead show operations from the preceding 24 hours through now,
  including the exact 24-hour boundary. Other business dates follow the shared Tokyo store-hours rules,
  including overnight, preparation, and post-close work. Original command
  `created_at` controls membership; updating or retrying an old command does not
  turn it into a new operation. Within this range, unresolved platform failures
  remain visible and running commands become unconfirmed after five minutes.
- A requested stop-sale is emphasized because the platform may still accept
  orders. A requested resumption uses a lighter warning. Neither message asserts
  the platform's actual state without its result.
- Opening the warning shows per-platform results and available recovery actions.
  Retry submits only terminally failed platform commands, restricted to targets
  still belonging to that intent. In-progress commands cannot be duplicated.
  Identity/mapping/read conflicts explain why a retry is unavailable.
- A guarded manual inventory retry receives a fresh two-hour Bridge execution
  window from the server's `manualRetryAt`. Claim, progress and completion use
  the same bound. Heartbeats and automatic lease retries cannot extend it.
  `created_at` and the original command ID stay unchanged, so newer exact-target
  intents still supersede the old work and business-day membership is preserved.
- Retrying and acknowledging do not resolve the warning. Acknowledgement only
  stops the local sound for that incident. The current command projection controls
  resolution; a newer exact-target operation replaces the old intent and has its
  own pending/failure/success state.
- Native foreground pages use one short cue. Ordinary browsers require explicit
  sound activation. Muting and local acknowledgement survive refresh; the warning
  remains visible. Background alerts use the existing registered push channels.
- Notification links carry a store hint which is checked against the user's
  scoped context before changing the selected store. No notification link
  automatically changes stock or retries an operation.

## Data and delivery

`lib/inventory-sync-attention.ts` reads `local_bridge_commands`. The projection
keeps active/failed targets within that range, plus four ordinary recent
successful runs within the same range. Complete command history remains
available for exact-target supersession, and the separate synchronization
history page retains older operations. Supersession uses store, platform, item/option kind and exact target UUID,
not names or an inventory linkage key. Partial overlap preserves uncovered
targets. Missing identity remains visible and cannot be blindly retried.

The existing local Bridge finite retry policy remains in place. A manual retry
uses the store operation lock and an atomic SQL recheck before trimming stale
targets and requeuing the failed command. The present failed Bridge ACK does not
contain exact per-target failures; this feature must not claim it can distinguish
already-applied targets within one failed platform command.

The authenticated `/api/cron/inventory-sync-attention` scans independently of
Bridge polling every minute. A failed command ACK also schedules best-effort
notification work with `after()`. Neither path changes availability or starts
another inventory command, and a notification outage cannot fail a saved ACK.

Visible in-app notices use `os_notifications`. Their list and unread count
apply the same original-operation business-day rule, so an old command cannot
reappear merely because its notice was created today. No historical rows are
deleted. Opening the notification menu refreshes its list.  Internal per-destination leases,
backoff and provider acceptance use `menu_inventory_sync_alert_deliveries`.
Delivery receipts are not business notifications. Concurrent scans share durable
leases; a failed delivery remains retryable. A receipt marked `sent` means the
provider accepted it, not that a staff member saw or heard it.

Recipients must retain an active login and the relevant full Store workbench and
store scope. Native delivery also rechecks the device binding and requires the
updated App's `registration.inventorySyncVersion = 1` capability. Older Apps are
not recorded as having received an unsupported message. The existing FCM
configuration and `STORE_ORDER_PUSH_ENABLED` deployment switch remain applicable;
native device opt-out/revocation remains effective. Browser push still requires
an active subscription and VAPID configuration.

The native `store_inventory_sync` message is separate from order events: it
retains login, expiry and duplicate checks, does not require being outside the
store, and never starts the repeating order alarm. Lower-priority resumption
messages are silent in the background. An open App leaves the short sound to its
foreground page. Browser retries replace a stable notification tag without
re-notifying the same incident.

## Activation and verification

Implementation and isolated validation do not activate this feature in production.
Prepare a scoped release from the relevant deployed baseline, retaining unrelated
working-tree changes. Apply
`db/migrations/20261018_inventory_sync_alert_deliveries.sql` to the authorized
target before activating server dispatch, then deploy the server and update the
Store App. Reopening an updated registered App reports its capability through
the authenticated presence endpoint. The cron returns HTTP 503 and
`migrationRequired: true` while its delivery table is absent; the read-only UI
projection remains independent of that table.

Required isolated checks include actual PostgreSQL projection/retry/delivery
SQL; session, scope and same-origin denial; partial supersession; retry remaining
unresolved; failed provider delivery followed by recovery; concurrent claims;
old App capability; stale intent and rotated destination guards; responsive real
React components; Android operational notification/ordinary order separation;
and a successful production build of the final task sources.


Before promotion, run the exact read-only projection against the established
production database, both globally and for an authorized store, with a 15-second
statement timeout. Validate retry SQL using EXPLAIN without ANALYZE; do not replay
a real command as a check. The production-shaped fixtures must include
`stores.external_id text`: unqualified JSON-function output aliases can otherwise
bind that outer text column. Keep JSON scalar references qualified.

The history check must include a representative command/target backlog. Expanding
all newer JSON targets separately for each historical target can make a small
fixture pass while a busy store times out. Preserve every unresolved failure within the selected business-day range
and exact intent semantics when optimizing; do not impose an arbitrary row
cutoff or truncate the source history used for supersession.

The review evidence is retained in `outputs/inventory-sync-attention-20261018/`.
No test should operate a real merchant listing to manufacture a failure. A
production rollout still needs bounded server/version checks, cron configuration
and actual registered-device notification/sound verification. Report server,
Store App and installed Mac Bridge state separately; this feature does not require
a Mac Bridge runtime replacement.
