# Franchise owner permissions

Prepared on 2026-11-01. This document describes a local repair, not deployment or live activation. The current owner decision is that `store_owner` should have broad authority over assigned stores, while headquarters and other stores remain isolated.

## Allowed scope

- Assigned-store POS settings, table QR settings, sales, cash-session history, expected cash, counted cash and differences. Opening, closing and normal cash movements continue through Store POS. Existing refund/operator authorization remains in force.
- Assigned-store operating expenses and expense receipts, in addition to the already-enabled sales/labor/cost/profit analysis.
- Existing local staff/terminal administration, timecard, shifts, payroll, store operating settings, inventory, replenishment, procurement and reports. Employee hierarchy and store assignments remain independently enforced.
- Local procedure creation/editing/deletion when every assigned store belongs to the caller. Published shared procedures remain readable. Product master remains read-only under the existing published-catalog policy.

## Headquarters boundary

Headquarters product/supplier/brand master editing, menu/brand-site publication, shared competitor monitoring, global settings/permissions, headquarters account assignment and order-history deletion are not granted. Cash-history deletion, closed-session correction and historical refund through the reconciliation administration endpoint retain the existing headquarters-only policy; normal Store POS refund permissions are unchanged.

The audit found:

1. `store_owner:module.pos=false` hid POS, daily cash reconciliation and table QR administration despite enabled POS settings/refund permissions. Restore the page grant for this role only.
2. `store_owner:analytics.manageExpenses=false` left own-store expense management read-only despite enabled analytics. Restore that action grant for this role only.
3. Competitor monitoring inherited the analytics page grant, while its API required headquarters authorization. Split out `module.competitors`, available only to headquarters. An explicitly configured child route takes precedence over the parent route. Existing headquarters analytics opt-outs remain effective when the new key is absent.
4. Procedure write checks accepted a book with any matching store, allowing one store to edit/delete a cross-store shared book. Require exclusive assigned-store ownership, reject out-of-scope submitted stores, hide unavailable write controls, keep shared drafts hidden, and filter store/catalog editor choices to the caller's scope. Shared action/material/equipment masters and the global maamaa production reference can only be changed by headquarters editors.
5. Cash reconciliation with no accessible store could continue into empty-store queries. Reject before querying financial or responsible-employee data.

A saved `module.masterData=true` row was also observed for `store_owner`; current permission normalization already excludes this unavailable role/permission combination. Do not enable headquarters access or rewrite unrelated overrides as a shortcut.

## Validation and activation

`lib/franchise-owner-permissions.test.ts` exercises the permission matrix, nested route protection, targeted migration, actual procedure ownership/visibility SQL, local expense persistence, cash totals, missing/cross-store access and global-master denial. Existing scoped-store and Store-workbench regressions are retained. Browser verification uses the actual procedure page with synthetic local HTTP data at 390/800/1366 pixels, including local save/reload and headquarters controls. Synthetic probes are not acceptance by real franchise accounts.

Apply `db/migrations/20261101_franchise_owner_permissions.sql` only after the guards are deployed to the approved target. It updates exactly two `store_owner` permission keys, without changing accounts, scopes, schema, business data or other roles. No `db/schema.sql` change is needed because there is no schema change. Production release and database activation require their own authorization. After activation verify each real franchise account, another store, existing sessions, and ordinary POS operation without financial test writes.

Evidence is under `outputs/franchise-owner-permissions-20261101/`.

Local results: 27 permission/API/persistence regressions passed; browser checks passed at all three sizes, including local save/reload and headquarters controls. An isolated build of the same application sources passed TypeScript, compilation and 175 static pages, using webpack with build caching disabled and synthetic credentials. The main worktree's type check found 82 existing errors in temporary investigation/PhotoStudio files; no task application errors were reported. The default Turbopack build made no progress and was stopped. The isolated copy includes the application's existing components, data, workflows, Bridge imports and type declarations; no missing dependency was replaced by a stub in that build.

The connected database check remains incomplete: five existing schedule/Google Business tables and four shift-publication columns are absent. These belong to other pending module migrations. The permission table exists, and this repair needs no schema change; those unrelated migrations were not applied. No production permission or business data was written, and no actual franchise account was used for UI acceptance.
