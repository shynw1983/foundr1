# Inventory command supersession

Inventory linkage (`inventoryKey`) describes a business relationship, not a
platform write target. In particular Rocket splits an operation into item and
option commands with the same `syncRunId`. These siblings must all execute.

`lib/inventory-command-supersession.ts` owns the rules used after enqueue,
before Bridge claim, and by the manual retry guard:

- Only a later, different operation in the same store/platform can supersede work.
- Match exact `kind` + `targetId`, never labels or the linkage key alone.
- Preserve unknown identities rather than guessing; support existing
  `fullSyncRunId` batches as well as `syncRunId` operations.
- Trim only overlapping pending targets. Keep other targets in their original
  order; retain removed target records in `payload.supersededTargets` for audit.
- Fully replaced commands are `cancelled`, with `result.outcome = superseded`.
  They are neither successful platform writes nor failures and cannot be retried.
- Never trim processing commands. New commands are inserted before reconciliation
  so an insertion failure cannot discard an old pending target without a replacement.
- A newer failed operation still represents newer intent; do not replay an older
  state over it. Retry the newer operation instead.

The Store history and sync panel render cancellation as a separate terminal state.
Historical `failed/superseded` records from the old bug remain failures: they may
represent genuinely missed writes and must not be relabelled as harmless skips.
Recovery requires a fresh read and the latest desired state, not bulk replay.

## Verification

`scripts/tests/inventory-command-supersession.test.mjs` runs production SQL on
an in-memory PostgreSQL-compatible PGlite instance. Install `@electric-sql/pglite`
in a disposable directory and set `PGLITE_MODULE` to its `dist/index.js`, then run:

```sh
node --experimental-strip-types --test scripts/tests/inventory-command-supersession.test.mjs
```

`scripts/tests/inventory-superseded-ui.mjs` serves actual React components with
synthetic read-only API responses on port 4187. It forbids writes and does not
connect to a real store. Optional `INVENTORY_TEST_DEPENDENCIES` points to a
temporary install containing esbuild, React, React DOM and lucide-react.

No production migration, inventory replay, or Bridge restart is needed for the
code patch itself. Deploy the server and UI together after required validation.
