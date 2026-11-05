# Customer display before Add

The ordinary Store POS publishes the currently selected weight-priced item before it is added to the cart. Selecting a product opens a waiting preview; valid manual net weight or the existing POS-confirmed scale capture supplies its weight and amount. The customer sees a separate current-item amount and the total of items already added. Fixed-price products retain their per-portion pricing.

## Price and scale contract

- The preview uses the same POS menu snapshot, price per unit, rounding and selected options as Add. Staff still refresh the menu manually; this flow never silently replaces the active menu with a newer server catalog.
- Automatic weighing uses the existing accepted capture and `automaticWeightReady` checks, including register ownership, recovery version, plate and filter revisions, and unsafe-reading detection. It adds no second settling interval. Lifting an accepted bowl retains the accepted value under the existing scale policy.
- Manual input is net weight and is never tared a second time. Changing the plate or reweighing invalidates the old preview until the POS accepts another value.
- The API verifies capture ownership, epoch and quantity. A consumed or changed capture becomes a waiting preview; it does not block a later cart or completed-payment display update.
- Names and options use the existing menu `displayNames` fallback and customer language. Tax-exclusive item previews identify that tax is calculated on the whole order.

## Lifecycle and transport

Opening a draft interrupts a previous completion display and prevents the ten-second advertising timer. Adding the item updates the cart and clears the preview in one state message. Closing or cancelling clears the preview. No preview creates orders, stock changes, points, print jobs or cash records.

The existing store display stream remains the transport. Each visible POS claims an ordered writer using the current display revision. Later posts carry that writer identity and a monotonic sequence; stale posts cannot resurrect a cleared preview. Configured relay stores require the current register owner. A displaced writer does not automatically reclaim the display. Existing cached POS clients must reload to publish after an ordered writer has claimed the store.

Preview updates heartbeat every two seconds and expire after eight seconds. The customer display checks expiry locally using a monotonic clock anchored to server time, rejects older revisions, and uses a visible-only polling fallback. Hiding or leaving the POS clears its preview; reconnecting resends the current draft. Member-scan commands patch only their fields and share the same display revision, preserving cart and preview ordering.

The feature is available on the existing customer display without a new per-store switch. Store settings, schema, Android capabilities, website menus, delivery menus and payment persistence are unchanged. The existing debug display remains an isolated transient channel.

## Editor placement

The standby editor defaults to snapping drag positions to its visible 5% grid. Near the screen center, exact centering takes priority. Horizontal and vertical guides and status badges distinguish the two axes, with one-click buttons for each. Numeric input and keyboard arrows remain available for fine placement. Snapping can be disabled. All guides are editor-only, and portrait and landscape layouts remain independent.

## Verification

Use `scripts/tests/pos-display-editor-placement-ui.mjs`, `scripts/tests/pos-display-preview-ui.mjs`, and `scripts/tests/pos-customer-weighing-api.mjs` for editor, real-component browser fixtures and isolated PostgreSQL route coverage. Browser fixtures do not establish physical iPhone/Safari, Bluetooth scale or printer acceptance. Release evidence is packaged separately from the source.

## Selected option labels

Customer displays show localized selected option names and repeat quantities without option-group headings. This applies before Add, in the cart, after payment, and in debug preview. Staff POS labels and printed receipt/kitchen/pickup ticket labels retain their existing group headings. Option IDs, grouping, prices, portion sizes and stored order data are unchanged.
