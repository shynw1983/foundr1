# Headquarters immediate store alerts

This is a separate store-scoped communication path from `os_notifications` and the account bell. HQ `owner` and `manager` can send from **店舗・ブランド → 本部からの即時連絡** (`/os/stores/alerts`). Existing active-store and selected OS store scope checks still apply. Franchise owners/managers, staff, and terminal accounts cannot send HQ alerts or read HQ history.

## Store interaction

- The shared Store operational service mounts the inbox on the home, POS, order, menu, inventory, replenishment, receiving, procedures and SNS work pages, for existing full-workbench roles. Staff/restricted personal execution rights are not widened by this feature.
- Dedicated customer displays, kitchen/pickup display pages, relay-only pages, login/logout and POS debug routes do not mount the receiver. Backend authorization always checks the active session and store; route exclusions are presentation rules, not access control.
- A restrained amber notice stays at the top while scrolling. It is in document flow and has no modal, focus trap, scroll lock, automatic sound, focus change or POS-state callback. Its stack level stays below existing POS dialogs and full-screen checkout panels. On small screens it uses the available width; on wide screens the card aligns right. Reduced motion is supported.
- `あとで確認` collapses the notice to an unmistakable pending marker and preview; it does not mark it read. New oldest-pending messages reopen the card. Up to 50 oldest unread messages are fetched at once, with subsequent messages loaded as earlier ones are confirmed.
- A **delivery** receipt is written only after a foreground, focused page renders the card in the viewport and the hit-tested card is not covered by another panel. Viewing, polling and collapsing never write `read_at`.
- `確認しました` explicitly stores a **read** receipt. On failure the notice remains and an error permits retry. One successful confirmation removes the message from the store's other open work devices on the next realtime invalidation/poll. It does not certify that the operational problem was resolved.
- Verified current POS operator identity comes from the existing server-validated operator cookie; the client cannot supply the reader's name. A personal logged-in workbench user is otherwise identified by the authenticated account. Shared terminal sessions without a verified operator are explicitly labelled `店舗端末（担当者未確認）`. Device labels are derived from User-Agent and browser UUIDs identify installations, not authenticated hardware serials.

## Persistence and communication

`store_hq_alerts` stores the message, target store, sender snapshot, send request ID and creation time. `store_hq_alert_receipts` stores device delivery/read times and reader snapshots. An identical sender/request ID retry returns the original alert; changing store/content under that ID is rejected. Confirmations preserve the first per-device read time/identity. HQ sees the earliest delivery and earliest read plus reader/device/time, not a fabricated "received" status immediately after sending.

The separate private channel is `private-store-hq-alerts-<storeId>`, authorized at `/api/store/hq-alerts/realtime`. Pusher events carry invalidation timestamps, not message text. Polling recovers from missed events, foreground resumption and realtime outages (8 seconds on Store, 10 seconds on the HQ history page). Offline/closed devices remain undelivered until an eligible work page is active. This phase does not add background OS push or native APK changes. Pending notices persist across reloads and business days until acknowledged.

HQ drafts keep an idempotency key through uncertain send outcomes and optionally sessionStorage reload recovery; an uncertain draft is locked until retried successfully. HQ history is paginated and manually refreshable in addition to automatic updates. Authored messages and names are displayed verbatim rather than passed through the local UI translation observer. Japanese/Simplified Chinese/Traditional Chinese operational labels use the existing UI dictionaries.

## Deployment and verification

Apply `db/migrations/20261025_store_hq_alerts.sql` before deploying the receiver. It adds only two tables and indexes; existing business rows and the bell notification path are unchanged. Existing store/employee IDs retain their foreign-key rules; an alert's store cannot be removed while communication history references it. No test message should be sent into a live store as a release health probe.

Focused tests run actual handlers/SQL against an explicitly isolated Neon branch, with fixture authentication/operator/realtime boundaries. The browser test uses real React components and handlers through a local HTTP fixture and the same isolated database; it does not operate a store's physical POS, printer or scale. These boundaries must be retained when reporting results.

```sh
HQ_ALERT_TEST_DATABASE_URL='<isolated-branch-URL>' \
HQ_ALERT_TEST_BRANCH_ID='<non-main-branch-ID>' \
HQ_ALERT_TEST_ARTIFACT_DIR='/private/tmp/hq-alert-verification' \
node scripts/tests/store-hq-alerts-api.mjs
# Run the browser test with the same variables after the API test creates its compiled handler fixture:
node scripts/tests/store-hq-alerts-ui.mjs
```

Use a normal isolated branch with the current schema and at least two active stores/employees. Both tests reject the known main branch and production endpoint; temporary alert rows are removed afterward. Never put the test connection or generated browser bundles into the source upload. Browser fixtures require the configured Chrome executable and Puppeteer/esbuild test tooling. Run the final application build, schema check, source-bound UI/API checks and `git diff --check` before release. Verify anonymous denial and exact deployed source identity separately; a successful build is not a real-device acceptance test.
