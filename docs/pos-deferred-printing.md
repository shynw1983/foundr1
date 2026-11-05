# POS deferred printing

Prepared 2026-10-20. Implementation and local verification are separate from production activation and physical printer acceptance.

## Operator flow

The normal online POS cart offers three print modes: print now, pay now and print later, or no printing. Payment and document state are separate. A disabled printer must not prevent an otherwise valid payment from being recorded. A positive checkout response clears the cart before best-effort printing; an unknown checkout response retains the same recovery request ID instead of creating a replacement sale.

The collapsed **印刷待ち** strip retains pending-order/document counts and a separate count for output requiring physical review. Open it to select an order, document kind and individual copies. Refreshing, switching devices or reconnecting a printer reads the deferred backlog but never starts printing it. Staff explicitly select deferred documents to send. An initial **auto** relay job already queued by an explicit immediate-print checkout retains its existing delivery behavior and may continue after reconnection; the row identifies it as waiting for the relay. Unknown output never automatically retries. Transaction history opens the same document records, including intentionally unrequested and previously sent documents.

Each bowl has kitchen, finishing and customer pickup documents; the receipt belongs to the payment. Existing per-role enable switches, 1–5 copy counts, templates and customer-language rules apply. Disabled roles are saved as `not_requested`, excluded from pending counts, and require an explicit confirmation to print later. Kitchen and finishing notes remain internal; customer pickup documents hide internal notes and money amounts.

## Immediate handoff items (2026-11-03 implementation)

A standalone POS line explicitly configured with `fulfillmentMode: immediate` does not create kitchen, finishing or customer pickup output. Unset/unknown modes retain preparation behavior; bowls always prepare. A prepared drink such as made-to-order nanacha remains a kitchen item unless the store explicitly changes its supported setting. Selected drinks, gifts, flavor and ingredients attached to a parent bowl remain on that bowl's structured ticket; this rule does not remove options inside a bowl.

An immediate-only sale keeps its accounting identity and every paid line/amount in the receipt. Web completion and document lists label the identity as **会計番号**; installed native paper retains its existing generic `No.` label with the same raw ID, so no APK update is implied. Mixed checkout kitchen documents contain only preparation lines, while the receipt still contains the entire sale. Disabling receipts for an immediate-only sale does not make an unrelated kitchen-printer setting a checkout gate.

The online immutable ledger remains authoritative. The identified offline/direct compatibility path persists an immediate-only receipt batch before calling the printer and reuses saved job identities; failed/sending output cannot auto-reprint on remount or synchronization. See [offline checkout](pos-offline-checkout.md) for saved policy/revision validation. These implementation rules do not claim a Web release or physical-printer acceptance.

## Durable records and transport

New online non-table checkout requests send `printDocumentVersion: 1` and `printMode: auto | deferred | none`. The paid order, structured items, per-copy immutable document snapshots and any initial automatic relay jobs are committed in the same transaction. Retrying the checkout returns the original order and snapshots. The response's `printDocuments` metadata is also recorded in the order's customer summary.

`pos_print_documents` stores the original order/code, content, price, options, template, copy number and document order independently of the sending device. Changing printer configuration only changes the destination selected at a later claim. Partially refunded receipt output adds the existing refund notice without rewriting the original snapshot. It does not invent a new refund receipt or recalculate the original sale.

`GET /api/store/pos/print-documents` is scoped to the authenticated store, paginated and non-cacheable. Global pending counts cover eligible documents, even when a page is filtered or bounded. The review count and queue also retain uncertain output that became ineligible, so an unresolved relay job cannot invisibly block subsequent printing. An `orderId` retrieves that order's complete history through pagination. Responses omit printable payloads until an authenticated, eligible claim succeeds.

`POST` supports `claim`, `ack`, `confirmPrinted` and `voidIneligible`. Claims use a document revision and unique operation ID; direct sends also use a claim token and actor. Operations retain a request fingerprint. Exact retries do not send another payload; reusing an operation ID with a changed intent conflicts. A store advisory lock and order lock serialize claims with existing relay and refund operations. Stale or losing mutations roll back their whole transaction.

Direct native printing remains within the Android Store app. Relay printing reuses the existing Android Store app and relay job protocol, with the selected register's valid owner proof. There is no new APK requirement for this feature. Ledger-owned jobs are hidden from the old relay panel's manual actions; the old reprint, confirm and void APIs cannot mutate them, including superseded historical jobs. The agent rechecks a linked document's eligibility when it claims queued work and cancels ineligible pending jobs. Sending old documents never creates a sale, changes its payment amount or opens the cash drawer. Only the original automatic first receipt, in its trusted initial-checkout context, may retain the configured drawer command.

## Outcomes and exceptions

Document states are `not_requested`, `pending`, `sending`, `sent`, `uncertain` and `cancelled`. `sent` means the printing transport reported a successful send, not proof that paper physically emerged. A sending lease older than two minutes is presented as uncertain. Missing acknowledgement never silently becomes pending again.

Staff must inspect the paper before either confirming an uncertain document as printed or explicitly reprinting it. A versioned local attempt marker also protects the initiating browser when a claim response or acknowledgement is lost. Ordinary batch selection excludes these locally uncertain attempts. Reprinting invalidates an expired old relay claim so its late acknowledgement cannot complete a new attempt.

Refunded/cancelled orders cannot print production documents. Production documents for already handed-off items are also ineligible; receipts remain available after handoff. Ineligible pending/unrequested documents leave the active backlog. Uncertain prior output remains visible in both the review queue and order history. After physical inspection, `voidIneligible` closes an ineligible uncertain document as cancelled and invalidates its old relay token; it never prints or pretends that output was successful. A live direct send lease briefly blocks a conflicting refund; uncertain or expired output cannot block a refund indefinitely. Existing relay refund locks and cancellation policy continue to apply.

Printer/network errors remain inline at the checkout action and backlog entry until resolved or dismissed by the relevant flow. A print failure following a successful payment is displayed as a paid order with pending documents, never a reason to collect payment again.

## Compatibility and rollout

Apply `db/migrations/20261020_pos_print_documents.sql` before deploying this runtime. It is additive and must be checked in an isolated database first. Keep `db/schema.sql` aligned. The runtime returns a clear unavailable/database-update response when the ledger tables are absent; checkout must not be retried with a new request ID after an unknown result.

Older clients without the version marker retain their existing printing behavior. Existing device-local job batches keep their immutable snapshots and must not be imported or automatically duplicated into the new ledger. Known offline sales and table-session aggregation retain their existing paths in this release; they are not retroactively represented as new single-order ledger checkouts. Historical orders created before activation continue to use their existing reprint flow.

Before production activation verify the intended project/database, migration, exact runtime source and deployment. Then separately verify real Android/direct or relay printing, printer disconnect/recovery, physical copies/cuts and drawer behavior. Local browser/PGlite checks do not establish physical paper output or production readiness by themselves. Never create a real paid order merely to test a deployment.
