# Manual Store availability synchronization

Availability and menu content are separate workflows.

- Single-item Store/Kitchen/Siri availability actions use the operator's requested Store state. Existing per-platform controls remain explicit overrides.
- Whole-store action (`full_sync`, also the renamed Kitchen `audit` action) reads fresh Uber inventory through Desktop Bridge. OS-linked Uber targets use stable external IDs. Items without an Uber mapping are listed as unchanged, never guessed.
- Every requested target must return exactly one explicit available/sold-out result. Missing, duplicate, foreign, or contradictory results stop the operation before OS writes.
- The successful read only stores a preview. A scoped Store confirmation is required before any OS availability writes or downstream commands. Previews expire after 10 minutes; intervening Store changes or active sync work require a fresh read. Kitchen links to this same confirmation screen.
- After confirmation, the snapshot atomically clears the audited targets' old inventory blocks/platform availability overrides, updates OS, and queues permanent availability commands for enabled Rocket/Demae connections. Website listing/visibility and menu content are not changed.
- A missing destination mapping stops that entire destination, records a failed command with exact labels, and does not stop other destinations. Fix the menu mapping then run a fresh whole-store sync. Previously excluded non-product introduction cards and disabled platform targets stay excluded.
- OS updates and destination command creation commit in one database transaction. A persisted `osApplied` receipt prevents duplicate Bridge acknowledgements from reapplying the snapshot.
- Store writes and snapshot commits use a short database lease. Single-item writes are rejected while whole-store commands are pending/processing. Whole-store starts reject existing menu/inventory work. Platform retries reject stale target commands and mapping-blocked work.
- History shows OS as waiting until the read/commit actually succeeds; destination failures are not reported as whole-store success.

## Automation

The 08:00 inventory cron is removed. Its old authenticated endpoint returns `manual_only` without writes. Passive accessibility inventory events are retained as observations, but cannot modify OS. The separate 12:00 JST Uber **menu content** cron remains.

## Rollout

Apply the additive `menu_inventory_operation_locks` table from `db/schema.sql` before deploying. Keep Desktop Bridge running with the updated audit projection (unknown availability must not default to available). No production whole-store action should be triggered just to test deployment: it can legitimately reopen Store stockouts according to Uber.
