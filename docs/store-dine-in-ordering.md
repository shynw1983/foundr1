# Store dine-in ordering controls (2026-10-22)

## Scope and activation

These controls belong to the independent store-and-brand POS `eat_in` snapshot. Viewing or deploying the editor does not initialize, enable, restore or rewrite a store catalog. Shared website, Web予約, counter takeout and delivery catalogs remain unchanged. Current prices and existing 50g portions are preserved. POS clients retain the existing explicit manual menu-update flow; a background revision check never overwrites a working cart or weighing draft.

## Ordering, visibility and recovery

POS category navigation includes only categories with at least one product that the current catalog/brand product grid can display. Management-only or empty categories remain saved and automatically reappear in their saved order when a displayable product returns. Keyword search does not remove category navigation; an active category that becomes empty after an explicit menu update falls back to `すべて`. This changes no product availability rule or automatic menu-update policy.

Managers can reorder categories and products, each product's attached groups, and each group's choices. Reorder commands require the complete current sibling ID list, preserve identities and metadata, and share existing revision and operation-id replay protections. Product group order is per product, including shared local groups.

Use hide/show for temporary removal from the POS. Hidden entries remain editable and keep their prices, source lineage and choices. Hiding a standalone product tile does not remove that product's explicitly linked bowl choices; hiding the choice itself controls that separate placement. Actual source stockouts and inactivity continue to block both placements.

Delete now retains a store-scoped trash entry with its local graph, order, prices and source-review baseline. Restore preserves local identities and surviving shared edits, rejects conflicting graphs, and does not undo category moves explicitly made after deletion. A missing parent must be restored before its individually archived choices. Historical hard deletes made before this feature have no snapshot in the operation log: an imported shared product can be explicitly reimported from its current source, but this cannot recover former local changes. No historical items are restored automatically.

## Import and selection

Optional ingredient consolidation remains restricted to eligible source addons. A separate whole-group importer can copy a source-brand or existing store group into an explicitly selected product, optionally selecting a subset of choices. It keeps flavor, soup, noodles, heat and numbness separate, preserves source IDs, prices and portions, and checks required selection capacity. The deliberate imported placement replaces the old product/category allowlist for that copied group only; canonical active/stock protections remain.

Store groups use their explicit single/multiple/quantity rule with minimum, overall maximum and per-choice maximum. Heat and numbness stay single choice. Quantity choices reuse the existing repeated-ID protocol, so two selections still mean two unchanged portions rather than one enlarged portion. Optional single groups without a valid explicit configured default start empty; opening a bowl cannot silently add the first paid drink. Shared brand POS groups retain their identified previous selection semantics.

## Products selected inside a bowl

Managers can link existing store fixed-price drinks or standalone items into a local choice group while retaining their independent POS tiles. The linked product must belong to this catalog and brand, cannot be the parent or a kitchen bowl, and cannot require unresolved configuration. Name, displayNames and price follow the real product; edits happen on that product rather than on the linked choice. Hidden tiles are allowed, archived or unavailable source products are not offered.

Checkout validates the local choice and resolves the real canonical product itself. Product-backed choices remain attached to the parent bowl's one paid/refund line and add their price exactly once. Immutable customizations keep local group/choice IDs and `linkedItems` with canonical product ID, local product ID, label, per-parent quantity and charged unit price. They never put product UUIDs in ordinary `optionIds`. Product-backed and ordinary option customization arrays are separate, so index-based option mutations cannot target the wrong identity. Ordinary option shortage refunds/substitutions do not mutate these product-backed groups; the existing whole-parent handling applies. A standalone drink remains its own paid/refund item.

Customer display, cart, kitchen and receipt snapshots retain the selected drink labels and repeated quantities with their parent bowl. Existing paid orders and reprints remain unchanged by future menu changes.

Inventory source normalization trusts product-backed metadata only for server-created Store POS orders, aggregates linked product quantities per parent serving and loads real item recipes. A linked drink never inherits the bowl's measured grams. Missing or measured-only linked recipes produce an explicit issue rather than guessed consumption. Existing preparation timing, activation, idempotency, frozen production snapshots and refunds-after-preparation rules remain unchanged; this feature does not enable inventory deductions.

## Verification boundary

Policy, real route/PGlite, POS React, customer display publishing and responsive editor tests use isolated fixtures. Production deployment checks are read-only and do not save catalog configuration or place live sales. No Android APK or physical printer/scale change is required.
