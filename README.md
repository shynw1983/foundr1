# FOUNDR1 Ops

FOUNDR1 Ops is a Next.js back-office app for store ordering, purchasing, supplier management, receipt review, product master data, field notes, and product cost comparison.

The long-term product direction is a brand/store operations platform, not only a purchasing tool. Procurement remains the current core module under `/ops`, while future store execution systems such as electronic procedures, checklists, training, inventory, audits, and analytics should be designed as related business modules that share employees, stores, brands, permissions, and product master data.

The current product language separates two ideas clearly:

- `発注`: a store-side order/request, meaning "what the store needs".
- `購入`: the actual buying work, meaning "what the buyer purchased".

This distinction is important throughout the UI, API, and documents.

## Main Workflow

1. A store user creates a `発注依頼` from the ordering screen.
2. The requester defaults to the current logged-in employee.
3. The buyer defaults to the store owner first, then owner/manager fallback.
4. The request is sent to the purchasing area and creates in-app notifications. If Lark is configured, the assigned buyer can also receive a Lark message.
5. The buyer records actual quantities, purchase price, purchase source, and exceptions.
6. Quantity differences, price exceptions, unavailable items, and buyer notes become store confirmation tasks only after the relevant execution step is completed.
7. For physical-store purchases, purchased items can be grouped into delivery batches.
8. For online shops and wholesalers, each supplier can have its own ordered/arrived state and estimated arrival date.
9. Receipts are uploaded per supplier fulfillment, not per item. A later partial purchase can upload a separate receipt.
10. Store confirmation is handled on the order/request side. The procurement screen is mainly the buyer work area.
11. Owner users can review order history, item history, reports, contact reports, and receipt status.

## Major Modules

- Dashboard: pending requests, confirmation tasks, price trend warnings, and recent status.
- Orders: create requests, confirm store-side issues, and check submitted request status.
- Procurement: buyer workflow for purchasing, delivery, arrival, exceptions, and supplier-level receipts.
- History: order history, item usage, store ranking, detail rows, and receipt review/download.
- Products: product master, images, supplier links, reference price, package quantity/spec, Japanese memo, origin countries, and configurable basic-info display.
- Suppliers: supplier profile, channel type, address/contact info, and order URL.
- Stores/Brands: store and brand master data.
- Staff: roles, scopes, last seen, Lark IDs, and Lark lookup/test.
- Reports: contact/report history with owner delete support.
- Field Notes: on-site product ideas, supplier findings, comments, and photos.
- Product Comparisons: compare current products with candidate products, including import currency, exchange rate, freight, tax, archive, edit, and re-compare.

## Product Direction

Planned expansion areas:

- Electronic procedures: tablet-first store/brand operating manuals linked to product master data. The recommended shape is a store-facing route such as `/procedures` with an admin area such as `/ops/procedures`.
- Store execution: opening, closing, cleaning, equipment, temperature, prep, waste, handoff, daily report, and incident checklists.
- Training: staff learning records, procedure read confirmations, tests, skill levels, role certification, and new-product training.
- Menu and recipe management: recipe/BOM cost, serving cost, gross margin, substitutions, seasonal products, and store-specific menu availability.
- Inventory and loss: stock counts, waste, expiration reminders, batch tracking, transfers, and theoretical-vs-actual inventory.
- Audits and quality: store inspections, photo evidence, corrective tasks, rechecks, food-safety records, customer complaints, and SOP violations.
- Analytics and franchise operations: purchase cost trends, supplier spend, store budgets, franchise/store scopes, new-store launch tasks, and brand-specific operations data.
- AI assistance: receipt OCR, procedure draft generation, product data cleanup, price anomaly detection, and operating summaries.

See `docs/operations-platform-roadmap.md` for the working product roadmap.

## Roles

The current role names are stored on `employees.role`.

- `owner`: full administration, deletion rights for history/report records, staff and master data management.
- `manager`: broad operational management.
- `buyer`: purchasing workflow user.
- `store_owner`: franchise or store owner. Can participate in store operations and view product master with restricted editing depending on screen rules.
- `staff`: store-side request and confirmation user.

Access is also controlled by `employee_scopes`, especially store scopes. Menus should be shown according to the logged-in user's permissions instead of showing inactive links.

## Notifications

The app has in-app notifications in `ops_notifications`.

Notifications are currently used for:

- purchase request assignment.
- store confirmation required after delivery/arrival.
- report or exception follow-up.

Lark integration is optional:

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `LARK_WEBHOOK_URL` optional fallback
- `LARK_ENABLED=false` disables Lark sends only
- `NEXT_PUBLIC_APP_URL` controls absolute links in Lark messages

Staff can store `lark_open_id` or `lark_user_id`. Owner can use the Lark lookup/test flow when Lark app permissions are configured.

External/franchise group webhook support is planned but not yet fully verified because no external store group is available for testing.

## Receipts

The Japanese UI uses `レシート`, not `小票`.

Receipt behavior:

- A receipt belongs to an order and supplier fulfillment.
- It is uploaded from the procurement screen after purchase.
- Images are compressed client-side before upload where possible.
- Owner can review, preview in a modal, confirm, and download receipts from history.
- If purchased items exist but no receipt is uploaded, the procurement screen should make that state visible.

## Product Master Notes

Products can have:

- product name and optional Japanese memo for imported/Chinese-name items.
- category and subcategory.
- unit.
- package quantity and package quantity unit.
- package spec, such as weight/capacity detail.
- reference price.
- derived unit price.
- supplier purchase URL for online or wholesale purchasing.
- brand scope and applicable brands.
- image, origin countries, storage type, manufacturer, and notes.

For products with both count and specification, count should be used first for unit-cost calculations. For example, a case of cups with 200 pieces and 1500 ml capacity should compare by piece count, not by 1500 ml.

## Product Comparison Notes

Product comparison is for evaluating whether to replace or add purchase channels.

- Existing product is selected by category/subcategory.
- Candidate product has its own name, supplier name, purchase URL, price, quantity, unit, origin, and optional photo.
- Imported candidates can use foreign currency input. Currently CNY is supported.
- Exchange rate is stored and comparison is normalized to JPY.
- Freight is calculated from per-kg freight and import total weight.
- For `箱` products, case weight is required when import freight matters.
- Only grams and kilograms are auto-converted for weight comparison. Milliliters and liters are not treated as weight.
- Results can be edited, copied for re-comparison, archived, restored, or deleted according to permissions.

## Development

```bash
npm install
npm run dev
```

Local URL:

```text
http://localhost:3000
```

Useful commands:

```bash
npm run build
npm run db:check
npm run db:push
npm run db:seed
```

## Environment

Required:

- `DATABASE_URL`: Neon/Postgres connection string.
- `AUTH_SECRET`: session signing secret.

Optional:

- `BLOB_READ_WRITE_TOKEN`: Vercel Blob upload token for product/comparison/receipt photos.
- `NEXT_PUBLIC_APP_URL`: public app URL used in generated links.
- `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_WEBHOOK_URL`, `LARK_ENABLED`.

## Documentation

- Chinese business framework: `docs/procurement-backoffice-framework.md`
- Japanese operation framework: `docs/procurement-backoffice-framework.ja.md`
- Operations platform roadmap: `docs/operations-platform-roadmap.md`
- Agent/developer guide: `AGENTS.md`
