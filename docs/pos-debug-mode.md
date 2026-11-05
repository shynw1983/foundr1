# POS test mode

The POS test workspace at `/store/pos/debug` rehearses the existing store menu, product choices, weight pricing, discounts, tendered cash and change without opening a real cash session. Its Japanese UI calls the feature **テストモード**.

## Isolation contract

- Entry is explicit from the ordinary POS. Finish or cancel a real draft and resolve any uncertain checkout, offline order or active payment/print operation before entering. Existing real queues are preserved.
- The test workspace is a separate mount of the same POS component. The mode is immutable for that mount. A test cart cannot become a real cart by flipping a flag.
- Test carts and simulated results live only in React memory. Refreshing, closing or exiting the page clears them. Reloading the debug URL starts a new empty test workspace; returning to ordinary checkout is an explicit action.
- `GET /api/store/pos?debug=1` retains authentication, permissions and store scope, and reads the same current catalog and pricing settings. It omits real order summaries and table checkout requests. Menu refresh remains manual.
- Simulated checkout ends in the client before any real checkout request, recovery record, offline order, print ledger or cash movement. The result and preview use unmistakable test labels. No real payment, stock deduction, loyalty benefit, production task or pickup call is created.
- The workspace does not load real member/coupon records, reconcile money, process table orders, refund sales, claim a relay register, capture scale readings or send physical printing commands. Manual weight input rehearses the price calculation.
- A real iPhone/tablet can show the test customer display. Open **客席表示を接続** in the debug POS and scan its QR code (or open/copy its link), then log in with an account permitted to access that store. It opens `/store/pos/customer-display/debug` using the current store and a random session UUID. Regular displays remain on their existing production channel.
- Test display state and acknowledgments travel through a dedicated, authenticated non-cache Pusher channel. `/api/store/pos/debug-display` validates origin/store/shape/size and only broadcasts; it does not call the saved customer-display or external-usage ledgers. The display reuses the existing renderer for cart, price, discount, payment/change and completion, plus a test-weight preview. A visible test banner stays present.
- The latest test state exists only in the POS and display memory. It is periodically resent for reconnect, cleared on explicit end or disconnect/heartbeat expiry, and never fetched from a saved snapshot. Reopening/reloading POS creates a new pairing QR. The display may take up to 16 seconds to detect a silently lost POS connection.
- The Store background order/print/inventory/version services are not mounted on either debug route. Native services already running elsewhere and other real POS tabs remain independent.
- Debug requests marked by the debug query/header or same-origin debug-page referrer cannot write through the POS checkout/adjustment handler. Ordinary checkout still requires its existing server-side cash session and validation.

This promises no persisted **test business data**. Normal authentication/security access logs and existing language/theme preferences are not business trial records; security/session checks remain active.

## Verification

Use the dedicated debug API and browser tests together with ordinary POS cash-opening, checkout and manual-menu-refresh regressions. Cover fixed and weighted products, option pricing, discounts and change, denied scope, offline/reconnect/focus, preserved real queues, reload/exit, mobile/tablet/desktop layouts, and native printer/display spies. A local simulation test is not a physical printer or scale validation.

Transport design references: [Pusher event size limits](https://pusher.com/docs/channels/library_auth_reference/rest-api/) and [explicit cache channel behavior](https://pusher.com/docs/channels/using_channels/cache-channels/). This feature uses ordinary private channels, not cache channels.

No database schema migration or store menu changes are needed. Deployment evidence is separate from implementation.

## Entry guard correction (2026-10-27)

Historical unsent/failed local print jobs and a read-only print-queue refresh no longer prevent entry from the ordinary POS menu. They are persisted records and remain unchanged while the isolated test workspace is open; the store does not need to open a cash session or print old tickets merely to rehearse. Active printing/sending, checkout/cash/refund saves, unsynced sales, incomplete input, uncertain checkout recovery and open operation dialogs retain their entry guards. Each blocked state now identifies the actual reason rather than presenting one generic message. Test mode retains its existing no-sale/no-cash/no-printer/no-scale behavior and customer-display support.
