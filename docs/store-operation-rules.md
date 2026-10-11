# Store Operations and Native Shell Requirements

Read the relevant sections when changing store workbenches, procedure/menu relationships, kitchen production data, or native device behavior. These are domain requirements; task scope, authorization, and verification follow [AGENTS.md](../AGENTS.md).

## Native Shell Requirements

Keep native-shell business logic in the Next.js web app and shared APIs whenever possible. Android WebView and future iOS WKWebView shells should provide device capabilities through stable JavaScript bridges.

- Store order, kitchen, and pickup operation screens must support foreground alert sounds in native shells without requiring the staff member to manually press a web "sound on" button on every launch.
- Ordinary browsers should still keep an explicit sound enable control, because browser autoplay policies may block audio without user activation.
- Android WebView shells should keep media playback enabled without user gesture for trusted Foundr1 pages and expose native bridges such as `window.Foundr1Printer` and `window.Foundr1NativeNotifications`.
- Future iOS WKWebView shells must account for the same requirement: configure WebView media playback appropriately and/or expose a native sound bridge so foreground order alerts can play reliably.
- Background, lock-screen, or app-not-running alerts should use native notification mechanisms with sound rather than relying on webpage audio.

## Store Operations and Kitchen Data

Store operations is a top-level Foundr1 OS module. Electronic procedures are its current core feature, not a separate top-level module and not a procurement subpage:

- Store-facing reader: `/store/procedures`, tablet landscape first, with mobile and desktop support.
- Admin/editor area: `/os/procedures`, grouped under `店舗運営` in OS navigation.
- Store operation surfaces live under `/store` as a sibling workbench. Timecard and POS staff operation screens can live under `/store/timecard` and `/store/pos`, while detailed settings, reports, permissions, and management remain under `/os/timecard` and `/os/pos`.
- Menu management lives at `/os/menus`. It is the OS-side source of truth for customer-facing menu items and options used by brand websites, POS, and procedure variants.
- Kitchen/production screens must render from structured order item fields first, not from customer-facing long summary text. Brand menu architectures must stay separate: nanacha-style drink choices can use `temperature`, `sweetness`, and `ice`, but maamaa malatang must not map heat/numb/medicinal-spice choices into those drink fields. For buildable brands such as maamaa malatang, persist the brand-specific payload under `customer_summary.maamaa` and use `size_key = 'maamaa_buildable'` plus `topping_labels`/structured labels for kitchen production. Kitchen summaries should deduplicate and count repeated structured choices. Avoid showing both a long multi-line customer summary and the same structured toppings on kitchen screens, because it can duplicate ingredients such as seafood or toppings.
- When adding a new brand, test kitchen display output from both POS checkout and web checkout. Complex/customizable brands should keep a clear distinction between customer/order-detail display text and production/kitchen item data.
- Procedure steps should link to product master data instead of copying product names where possible.
- Procedure books can link to menu catalog data. Fixed products such as nanacha drinks and buildable products such as maamaa malatang must both support variant conditions through JSON, for example size/temperature for drinks and heat/numb/toppings for malatang.
- Keep procedures, checklists, training, audits, and store execution records under `店舗運営`; keep inventory, recipes/BOM, franchise operations, and analytics aligned with [Operations Platform Roadmap](operations-platform-roadmap.md).

## Store Inventory Execution (2026-10-11)

Store inventory execution shares the existing SKU, location, physical-count, receipt and order-usage facts with OS. This change adds employee execution surfaces; it does not create a second inventory ledger or require new database DDL. The release evidence determines which deployment is active; this section describes the implementation contract.

| Work | Store execution | OS management |
| --- | --- | --- |
| Inventory inspection | `/store/inventory`: quick observations (`足りる`, `残りわずか`, `ない`), explicit counts, location/product search, recent records and operational stock information | `/os/inventory`: store/location setup, inventory configuration, safety values, usage configuration and management review |
| Receiving | `/store/receiving`: actual arrival quantity, existing storage destination and receipt mode; arrival-only confirmation where purchase information or SKU identity is incomplete | Purchase records and corrections, supplier/price maintenance, SKU and storage setup |
| Product definitions | Read the operational units and explicit conversions needed for an existing local inventory item or purchase | SKU creation/maintenance, menu links, quantitative recipes, unit conversions, packaging templates and franchise catalog visibility |

Store replenishment requests, assigned buying and manufacturing/transfer execution screens are future work for this phase. Existing OS procurement and manufacturing functionality is not a newly implemented Store flow. Do not show unavailable Store actions or claim that these screens have been released.

### Employee and terminal identity

- `store.inventory` grants Store inventory execution independently from `module.inventory` and other OS/master permissions. Both the active account and the actual operator must have the applicable role, permission and store scope. Active-store and active-employee checks are enforced by the APIs.
- Personal `staff`, `store_owner` and `store_manager` accounts can use the inventory and receiving Store routes. This does not grant access to the full Store workbench or new OS management sections. Existing owner/manager/terminal workbench access remains governed by its existing rules.
- Personal operations record the signed-in employee. A shared `store_terminal` can read local inventory, but a write requires the actual employee's password verification. Selecting or submitting an employee UUID is not an identity credential.
- Terminal operator verification lasts 15 minutes and is bound to the terminal account/session, store, employee identity and employee session version. Each write rechecks employee activity, permission, scope and version. The separate operator cookie does not replace the terminal login or create a personal Staff login session. Expired, revoked or changed identities require verification again.
- Store writes assert the operator ID originally shown with the input and require same-origin requests. Changing the store/operator cannot silently apply the preceding operator's draft. Pending stock receipts retain their stable request ID and original body when authentication expires or the response is unknown; verify the original operator before retrying. Passwords and verification tokens are not saved in local drafts or receipt payloads.

### Counts, arrivals and store confirmation

- Quick observations describe what an employee saw. They do not invent physical quantities, reset the book balance or train precise order-use calibration. Explicit counts use the shared unit conversion, stock revision and reconciliation rules. For example, half a bag is converted to ten pieces only when the SKU explicitly defines one bag as twenty pieces.
- Counts entered in a different unit also submit the displayed input-unit conversion snapshot. A changed box-to-bag factor must conflict even if the preferred bag-to-piece factor and stock revision are unchanged. Both current OS and Store clients supply this snapshot; older literal count-unit clients retain their existing protocol. Store snapshots come from the original saved draft, not a refreshed product configuration. The complete configuration is checked again inside the count transaction.
- The Store read projection contains local operational records rather than a product-management catalog. Existing local stock and historical local purchase references may expose the necessary identity and units of a subsequently private/stopped SKU. They do not grant visibility to unrelated products or expose supplier costs.
- A stock receipt names a stable purchase detail and an existing active storage item for the same store and SKU. Employees enter the quantity that actually arrived; requested quantities never stand in for recorded actual purchases. Cumulative receipts cannot exceed the known actual purchase quantity or mix historical purchase units. Missing SKU/storage setup or uncertain purchase quantity/unit requires management correction; the Store does not create an empty balance or an arbitrary product.
- Receipt modes remain distinct: `add` adds a newly arrived amount to a known book balance; `included` links an arrival already included in the current count without adding it again; `unverified` records a known arrival while leaving the total book balance unknown. Each mode preserves the previous physical count and its timestamp. Explicit batch packaging remains a historical snapshot; subsequent template or master edits do not recalculate earlier receipts.
- Store stock-receipt submissions use `confirmStoreReceiving: true`. Receipt, movement, book update and applicable store confirmation commit in one transaction. Only a purchase detail whose cumulative known receipts equal its actual purchase quantity is confirmed. A partial receipt leaves that detail pending; a delivery batch is confirmed only after all linked details are received. This never marks the whole purchase order received merely because one detail arrived.
- `confirmArrivalOnly: true` is the separate logistical path for precisely selected unknown purchase quantity/unit or temporary-product details. It verifies the operator even for HQ clients, confirms only those selected details, and creates no stock row, stock receipt or inventory movement. In a batch containing an unknown detail and a known detail still waiting for stock registration, the known detail and batch remain pending. If purchase information has become known, the stale arrival-only request returns a conflict and requires rechecking the refreshed purchase information.
- Stock receipt requests are idempotent: the same request ID/body returns the existing result; changed content or receipt/confirmation semantics conflict. Source facts and stock revisions are checked again inside the transaction. Logistics-only retries do not reconfirm already received rows. Shared procurement order/SKU locks precede batch and purchase-detail locks so receipt and logistical confirmation use a consistent lock order.

The exact stock, last physical count, approximate observations and learned forecasts remain separate. Order consumption follows the store's already configured explicit menu/recipe mapping and preparation rules; opening the Store inventory page does not enable automatic deduction. See [Procurement Business Rules](procurement-backoffice-framework.md) and [Inventory, Recipes and Order Usage](inventory-order-usage.md) for the shared contracts.

### Receiving validation evidence

- [Receipt database regression](../scripts/tests/inventory-receipts-db.mjs): 34 isolated PostgreSQL/PGlite groups passed, including physical-count preservation, unknown totals, partial/included receipts, terminal operator attribution, last-stage transaction rollback, immutable purchase packaging, mixed-batch arrival-only confirmation and temporary-product logistics without inventory creation.
- [Receipt policy checks](../lib/inventory-receipt-policy.test.ts): 12 checks passed.
- [Store receiving concurrency](../scripts/tests/store-inventory-receipt-concurrency.mjs): four groups passed on the explicitly authorized Neon test branch using three distinct PostgreSQL connections. The actual receipt and receiving handlers/shared SQL were exercised with a fixed scoped test identity. Same request/body produced two successful responses with one receipt and movement; distinct requests at one stock revision produced one success and one conflict; mixed-batch arrival/receipt transactions passed in both held-lock orderings; the existing batch transition waited behind the combined receipt without deadlock or duplicate stock. The random test schema was removed after verification. Source hashes and final facts are retained with the release evidence.

Authentication, browser behavior, production readback and deployment identity have their own verification evidence. The concurrency test does not log into production or write public business tables. No production DDL is needed for this Store execution phase.
