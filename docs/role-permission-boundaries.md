# Employee group and store permission boundaries

This implementation separates store operations settings from headquarters master data. It is a local change prepared on 2026-10-28; this document does not establish deployment or database activation.

## Store settings

`module.storeSettings` opens `/os/stores`. Headquarters accounts with `module.masterData` and `stores.manageMasterData` retain the complete headquarters editor. Other authorized accounts receive the scoped editor, backed by `/api/stores/scoped-settings`.

`stores.manageSettings` permits changes to assigned active stores' weekly hours, reservation note, attendance location, payroll calculation settings and shift submission deadlines. The API rejects unknown fields, checks the current store assignment inside the write and compares the saved revision. A stale form returns 409 and retains its draft. Payment accounts, company records, brand associations, sales sources cannot be submitted through this API. Temporary closures reuse the existing endpoint, with the same view/edit permission checks. Closures do not automatically cancel or refund existing reservations; the affected reservations remain visible for follow-up.

`stores.manageMasterData` is available only to `owner` and `manager`. Store/brand creation, deletion and headquarters configuration require this permission plus `module.masterData`. The scoped editor is used when a headquarters account has store access but lacks headquarters editing rights. `module.masterData` no longer grants store pages or applies to franchise roles; `/os/stores` has its own permission.

The new store settings view/edit permissions default to `owner`, `manager`, `store_owner` and `store_manager`. Existing saved overrides remain effective. Unsupported role/permission combinations display `対象外` in Settings.

## Employee management

- `owner`: existing full account-management authority.
- `manager`: may manage known non-owner roles. Creating or promoting another headquarters manager still requires `staff.assignHeadquarterRoles`.
- `store_owner` / `store_manager`: with `staff.manage`, may create/edit/delete regular staff and terminals only within their stores. An account assigned to additional stores or non-store scopes cannot be edited or deleted as a whole by a single-store administrator.
- Staff role options come from the API's `assignableRoles`; per-employee edit and PIN-reset controls use the server's target capabilities.
- PIN reset retains the separate target-role policy enforced by `pos_operator_assert_reset`. Expanding employee editing does not expand PIN-reset authority.

`staff.manage` defaults align with the existing documented store-manager policy. Existing false database rows are preserved by normal permission reads. The prepared migration explicitly enables that one key for `store_owner` and `store_manager`; it changes no account roles, store assignments, wages, refund permissions or business records.

## Routes and Store execution

OS/Staff page routes read the current role permissions rather than the navigation snapshot captured at login. `/os` grants only the homepage, never its descendants. Database failures fail closed. APIs retain their independent authentication, action and store checks.

Store reception and availability writes require the same full-workbench role boundary used by the UI and device APIs. `store_manager` and `staff` retain the documented inventory/replenishment/receiving Store boundary; this work does not open their full Store workbench. Existing POS, payroll and cash-management policies otherwise remain in place.

## Verification and activation

- `lib/scoped-store-permissions.test.ts`: actual scoped API SQL and migration run against isolated PGlite; covers field injection, scope, revocation, stale revisions, employee hierarchy, shared employees, page grants and restricted Store writes.
- `lib/store-workbench-access.test.ts`: existing Store navigation, device, session and scope regressions.
- `scripts/tests/scoped-store-settings-browser.mjs`: actual settings/hours/translation components with synthetic local HTTP persistence. Covers 390/800/1366 layouts, Japanese/Simplified Chinese/Traditional Chinese, save, conflict, permission denial and read-only states. Peripheral navigation is a fixture; this is not live franchise-account acceptance.
- The isolated verification workspace uses a previously verified source baseline plus current task files and their missing dependencies. Build-only persistent webpack caching is disabled to fit local disk space. It has synthetic credentials and does not connect to production during build.

On an authorized release: deploy the code first; then review and apply `db/migrations/20261028_scoped_store_permissions.sql` to the approved database. Apply the migration only after the new staff scope guards are active. Verify the three real franchise accounts, one out-of-scope store, headquarters-only fields and the permission-revocation case. No production writes, deployment, commit or push are authorized merely by preparing this change.

## Production activation — 2026-10-29 JST

Released deployment: `dpl_6evSaXsA8Jdzr5ERY3cYbSff8J6g`, promoted from `dpl_5bRAdn2v3XFjx71YvXRq2ay18Tja`. Both `www.foundr1.jp` and `foundr1.jp` return the new deployment identity. All 1,802 uploaded files match the scoped manifest; unrelated working-tree changes were excluded. Pending PIN administration code was not part of this release.

The production migration ran after code promotion and changed only `store_owner:staff.manage` and `store_manager:staff.manage` to true. No SQL function, schema, employee role or store assignment was changed. The three existing franchise accounts retain their original stores. The released permission definitions and live data confirm local store editing and local staff management, while headquarters master settings remain unavailable to franchise owners.

Validation: 16 isolated regressions, 7 browser scenarios, production build, 19 candidate/production probes, and existing APK download checks passed. Short observation found one Node.js `DEP0169` deprecation warning; the checked endpoints responded as expected. Actual franchise-account UI and handset acceptance remain unverified. Detailed deployment, migration, scope and validation evidence is stored in `outputs/role-permission-audit-20261028/release/`.

## Payroll settings regression correction — 2026-10-29 JST

The scoped editor originally omitted the existing payroll tab. Restore its eight settings (cycle, closing day, prescribed minutes, social insurance prefecture/timing, and first/second-half submission days/time) for assigned stores through the same view/edit grants. Reads use the existing database values, and writes retain revision and current-assignment checks. Payroll is an optional, strictly validated nested object so operations-only clients preserve all existing payroll values. No schema migration, production payroll configuration change or payment execution is required.
