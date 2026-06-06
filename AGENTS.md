# AGENTS.md

This file is the working guide for coding agents and future maintainers of Foundr1 OS.

## Project

- Framework: Next.js App Router.
- Language: TypeScript/React.
- Database: Neon/Postgres via `@neondatabase/serverless`.
- File storage: Vercel Blob for uploaded images.
- Styling: global CSS in `app/globals.css`.
- Product name: Foundr1 OS.
- Public site path/domain: `foundr1.jp` is reserved for the front-facing site and is not the current focus.
- Backoffice app path: `/os`.
- Product direction: Foundr1 OS is a full backoffice platform for restaurant operators. Procurement, electronic procedures, Timecard, POS, checklists, training, inventory, audits, and analytics are parallel modules that share product master, employees, stores, brands, and permissions.

## Associated Brand Websites

Foundr1 OS is connected to two separate brand website projects on this machine. When working on public customer flows, menu sync, pickup reservations, checkout, kitchen display data, or member/loyalty integration for these brands, check these projects directly instead of rediscovering their paths:

- nanacha milk tea site: `/Users/wushengyin/Desktop/nanacha New HP`.
  - Main pickup reservation UI: `components/reservation-form.js`.
  - Checkout proxy: `app/api/create-checkout/route.js` and `server/create-checkout.js`.
  - Menu data imported into Foundr1 OS from `published/menu.json` via `scripts/import-brand-menus.mjs`.
  - Uses Foundr1 OS public checkout endpoint `/api/public/orders/nanacha/checkout` and Square payment.
- maamaa / まぁ麻 malatang site: `/Users/wushengyin/Desktop/maamaa`.
  - Main pickup reservation UI: `src/components/malatang-order-builder.tsx`.
  - Checkout proxy: `src/app/api/orders/route.js`.
  - Menu data imported into Foundr1 OS from `src/data/malatang-menu.ts` via `scripts/import-brand-menus.mjs`.
  - Uses Foundr1 OS public checkout endpoint `/api/public/orders/maamaa/checkout` and KOMOJU payment.

Foundr1 OS already owns shared menu/catalog data, store operations status, public checkout APIs, order records, kitchen/production data, POS linkage, and member/loyalty records. The brand sites are the customer-facing frontends and should pass structured order and member fields to Foundr1 OS rather than duplicating backend business logic.

## Commands

Use these commands from the repository root:

```bash
npm run dev
npm run build
npm run db:check
npm run db:push
```

Before finishing code changes, run:

```bash
npm run build
git diff --check
```

Schema changes are made in `db/schema.sql` and applied with:

```bash
npm run db:push
```

## Important Product Language

Keep Japanese UI terminology consistent.

- Use `発注` for store-side requests/orders.
- Use `購入` for the actual buying work.
- Use `納品` for delivery/arrival to the store.
- Use `店舗確認` for store-side confirmation.
- Use `レシート` for receipts. Do not use `小票`.
- Use `発注先` for supplier/order destination in Japanese UI.
- Use `メイン発注先`, `予備発注先`, and `臨時発注先` for supplier roles.

Do not reintroduce mixed terms such as using `仕入れ` for the primary flow unless the business owner explicitly changes the vocabulary again.

## Workflow Rules

The workflow has two separate sides:

- Store/request side: `/os/orders`.
- Buyer/procurement side: `/os/procurement`.

Rules:

- Requester defaults to the current logged-in user.
- Buyer defaults to store owner first, then owner/manager fallback.
- Changing actual quantity alone must not create a store confirmation/report.
- Store confirmation is created only after an execution action such as delivery, arrival, or confirmed purchase state.
- Store confirmation should be handled on the order/request side, not mainly in procurement.
- Procurement is the buyer work area.
- Online shops and wholesalers are supplier-level order/arrival flows, not physical delivery batch flows.
- A single order may have multiple online/wholesale suppliers with different arrival dates.
- Unavailable items can be marked as `購入不可`; the order can still be completed.
- Completed disabled buttons should use black background and white text.

## Future Operations Modules

Store operations is a top-level Foundr1 OS module. Electronic procedures are its current core feature, not a separate top-level module and not a procurement subpage:

- Store-facing reader: `/store/procedures`, tablet landscape first, with mobile and desktop support.
- Admin/editor area: `/os/procedures`, grouped under `店舗運営` in OS navigation.
- Store operation surfaces live under `/store` as a sibling workbench. Timecard and POS staff operation screens can live under `/store/timecard` and `/store/pos`, while detailed settings, reports, permissions, and management remain under `/os/timecard` and `/os/pos`.
- Menu management lives at `/os/menus`. It is the OS-side source of truth for customer-facing menu items and options used by brand websites, POS, and procedure variants.
- Kitchen/production screens must render from structured order item fields first, not from customer-facing long summary text. For buildable brands such as maamaa malatang, POS orders and web orders should both save options into structured fields like `size_label`, `temperature`, `sweetness`, `ice`, `option_label`, and especially `topping_labels`; kitchen summaries should deduplicate and count repeated structured choices. Avoid showing both a long multi-line customer summary and the same structured toppings on kitchen screens, because it can duplicate ingredients such as seafood or toppings.
- When adding a new brand, test kitchen display output from both POS checkout and web checkout. Complex/customizable brands should keep a clear distinction between customer/order-detail display text and production/kitchen item data.
- Procedure steps should link to product master data instead of copying product names where possible.
- Procedure books can link to menu catalog data. Fixed products such as nanacha drinks and buildable products such as maaamaa malatang must both support variant conditions through JSON, for example size/temperature for drinks and heat/numb/toppings for malatang.
- Keep procedures, checklists, training, audits, and store execution records under `店舗運営`; keep inventory, recipes/BOM, franchise operations, and analytics aligned with `docs/operations-platform-roadmap.md`.

## Receipts

Receipt data is supplier-fulfillment level.

- Do not attach receipt photos to individual items.
- Use `purchase_order_supplier_fulfillments.receipt_photo_url`.
- Receipt uploads happen in procurement.
- Receipt review happens in history.
- Receipt preview should be a modal, not a new tab.
- If items were purchased and no receipt exists, make `レシート未アップロード` visible.
- Client-side image compression should be preserved for mobile uploads.

## Permissions

Role names currently used:

- `owner`
- `manager`
- `store_owner`
- `store_manager`
- `staff`
- `store_terminal`

Permission rules are role plus scope.

- `employees.role` controls broad rights.
- `employee_scopes` controls store/brand/supplier visibility.
- Menus should hide inaccessible sections instead of showing dead links.
- `owner` can delete order history, order items, and contact reports.
- `manager` can manage staff, except owner-level accounts.
- `store_owner` and `store_manager` can manage regular staff and store terminal accounts within their scoped stores.
- Franchise/store owners may view product master but should not receive edit/delete/copy/create controls unless explicitly allowed.

## Notifications

In-app notifications are stored in `os_notifications`.

Lark integration lives in `lib/lark.ts`.

Do not make Lark a hard dependency. If Lark fails, the core operation should still work with in-app notifications.

Known Lark status:

- Internal employee direct messages can work with Lark open_id/user_id.
- Owner can look up Lark user ID by email after Lark permissions are configured.
- External/franchise group webhook support is planned but not verified yet because no external store group is available for testing.

## Product Master Rules

Product master is operational data, not only display data.

Important fields include:

- `name`
- `japanese_note`
- `category`
- `subcategory`
- `unit`
- `package_quantity`
- `package_quantity_unit`
- `package_spec`
- `reference_price`
- supplier options and purchase URLs.

Unit price rules:

- If package quantity exists, use quantity first.
- If no quantity exists, use weight where appropriate.
- Convert g and kg.
- Do not convert ml/L into weight.
- Do not calculate cup/container cost from capacity when count exists.

User-selected basic info display belongs in `employees.ui_preferences` and should affect the right-side product card info area without causing horizontal overflow.

## Product Comparison Rules

Product comparison is for candidate channel/product evaluation.

- Existing product selection should be category-aware.
- Candidate supplier can be a free text supplier name.
- Candidate purchase URL should be kept for online/import products.
- Imported products can use CNY and exchange rate conversion to JPY.
- Freight is calculated from total import weight and freight per kg.
- For `箱`, require case weight when freight comparison needs weight.
- Only g/kg auto-convert for weight comparison.
- ml/L are not treated as weight.
- History supports edit, copy to re-compare, archive/restore, and delete.

## Styling and Responsive Layout

The app is heavily used on mobile and half-width/tablet browser windows.

When editing UI:

- Use the Foundr1 theme direction: deep green primary with clean neutral surfaces and no decorative accent color. Prefer shared tokens over one-off hex colors. Keep neutral surfaces dominant, use green for primary actions/success/brand emphasis, blue only for information/link states, amber only for warnings, red for destructive/error states, and violet only when there is a clear module meaning.
- Check mobile, tablet, half-width desktop, and wide desktop behavior.
- Avoid horizontal overflow.
- Keep dense operational screens compact.
- Do not add marketing-style hero sections.
- Avoid nested cards.
- For analytics/dashboard metric cards, use a stable vertical layout: label on top, value in the middle, note on the bottom. Do not use horizontal card layouts for KPI cards, because values and notes must not overlap or force awkward wrapping in half-width and mobile windows.
- Keep spacing between dashboard modules consistent in both directions. Reuse one page-level gap for vertical module spacing and matching grid gaps for cards/charts, instead of mixing unrelated margins.
- In management analytics, keep `原価` separate from monthly `経費`. Procurement/order data feeds product costs such as food, packaging, and consumables. Monthly expenses should be grouped into fixed costs (`固定費`: rent, equipment leases), variable costs (`変動費`: utilities and communication fees), and miscellaneous costs (`雑費`: garbage handling and other store expenses).
- Use normal button heights for mobile action rows.
- Sidebar/mobile menu must be scrollable when content is long.
- Product cards and comparison history must wrap before tablet widths overflow.
- The OS navigation/sidebar must always keep language switching available near the top of the navigation, including collapsed desktop sidebars and mobile navigation. In collapsed desktop sidebars, show only a globe icon for language switching; when the sidebar is expanded, show the full language selector/name.
- Keep sidebar active states minimal. Do not add decorative accent lines or extra highlight colors; use only the restrained active background/text treatment.
- Do not let native form controls fall back to browser/system blue. Checkboxes and compact selectors should use the Foundr1 green theme and stable compact dimensions. Broad input styles must not accidentally stretch checkboxes into large blocks.

## Translation

The app supports Japanese, Simplified Chinese, and Traditional Chinese UI text.

When adding new visible text:

- Add translations where the local translation system expects them.
- Include labels, placeholders, select options, button text, empty states, notices, and errors.
- Product names and product master content are data and are not automatically translated.

## Data Compatibility

The system is not live yet. Do not preserve old fields or legacy compatibility paths unless the user explicitly asks for compatibility.

Prefer clean schema and clean UI language over backwards-compatible clutter.

## Git

The main branch is used for the current working product.

Typical finish flow:

```bash
npm run build
git diff --check
git status --short
git add <changed files>
git commit -m "<clear message>"
git push origin main
```

Never revert user changes unless explicitly asked.
