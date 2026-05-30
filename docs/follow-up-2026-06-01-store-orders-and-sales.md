# 2026-06-01 follow-up: Store orders and sales reporting

## Confirm tomorrow

The next review should focus on two areas before adding more store-order features.

## 1. Store order permissions

Current issue:

- `/store/orders` can receive and process orders, but the store view and actions need stricter permission design.
- Which store is visible should depend on the logged-in employee's scope.
- Store owners and staff should not have the same controls.

Proposed direction:

- `owner`, `manager`, `buyer`: can view all scoped stores and switch stores.
- `store_owner`: can view assigned stores, see store-level stats, and cancel orders for those stores.
- `staff`: can view assigned store orders and update production flow only.
- Staff can use:
  - `制作開始`
  - `受け取り可`
  - `受け渡し完了`
- Staff should not cancel paid orders.
- Staff should not see detailed sales stats unless explicitly allowed.

Implementation notes:

- Add a shared helper such as `getStoreOrderAccess(session)`.
- API must enforce permissions, not only hide buttons in UI.
- `/api/store/orders` should accept a scoped `storeId` filter.
- `/api/store/order-stats` should also filter by scoped `storeId`.
- UI should show a store selector only when the user can access multiple stores.

## 2. Unified sales reporting under OS

Current issue:

- `/store/orders` now has basic operational stats, but this is not the final reporting layer.
- Future POS orders, web reservations, and delivery orders must be counted together.

Proposed direction:

- Build reporting under `/os/sales` or `/os/analytics`.
- Recommended first route: `/os/sales`.
- Keep `/store/orders` as the live store workbench.
- Treat POS, web reservation, and delivery as channels of the same sales model.

Unified model direction:

- `sales_orders`
  - `brand_id`
  - `store_id`
  - `channel`: `pos`, `web_reservation`, `delivery`, `manual`
  - `source_platform`: `foundr1_pos`, `nanacha_web`, `uber_eats`, etc.
  - status and payment status
  - ordered, paid, completed, cancelled timestamps
  - subtotal, discount, tax, fees, total
- `sales_order_items`
  - order id
  - menu catalog item id
  - product/category snapshots
  - quantity, unit price, option total, line total
  - modifiers JSON

First OS sales report should include:

- Date range
- Brand and store filters
- Channel filter
- Sales
- Order count
- Average order value
- Cancellations and failed payments
- Product ranking
- Store/channel comparison
- Order detail table
- CSV export later

## Current state as of 2026-05-31

- Web reservation order flow is working.
- Square payment success is connected.
- Pusher realtime updates are connected.
- `/store/orders` has live operation controls and basic stats.
- The next product decision is where to draw the line between store workbench and OS management analytics.
