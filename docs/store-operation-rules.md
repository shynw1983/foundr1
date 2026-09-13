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
