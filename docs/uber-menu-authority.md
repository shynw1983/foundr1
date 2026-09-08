# Uber-authoritative menu synchronization

## Production activation — 2026-09-08

Runtime commit `e80c920b` is READY on `https://foundr1.vercel.app`; the public
version endpoint independently confirmed it. Desktop Bridge was restarted while
idle and is running as PID 83198. The Webpack production build, TypeScript check,
171 Bridge/publication tests and 26 focused authority/identity/publication tests
passed (the latter include overlapping publication tests, not 197 unique tests).

`enabled=true` and `auto_publish=true` were activated after checking both saved
revision-1 native verification snapshots and backing up the old flags/config in
`menu_platform_snapshots`, rule `authority-activation-e80c920`. Cron checks every
10 minutes; a source scan cannot overlap pending/processing source-owned jobs.

The first real worker cycle imported Uber successfully as revision 2 with no
new/moved objects. It archived the owner-approved obsolete extreme-wide noodle
change record. Rocket's real publication command
`4f5032c6-c6b6-4588-9174-6dcf2cd30010` succeeded with 278 observations, including
the archived object and the rice cake's two physical occurrences. Demae command
`e2a27a02-200d-4c03-ac92-0bc601e952cf` succeeded at 2026-09-08T10:53:49.307Z
with 277 observations, including the archived object and the still-quarantined
quail acknowledgement. Both production publications completed on attempt 1
with no task error. This completes the first real Uber → OS → downstream cycle.

The fresh Demae manual verification interruption below was caused by concurrent
store inventory work navigating its browser. The production worker executes
these operations serially. Do not run separate mutating acceptance scripts
alongside active store inventory commands.

Runtime log inspection found a Node dependency deprecation warning, not a menu
sync failure. Log drain configuration was not inspected. Production command
results and source state, rather than older notes below, determine live status.

## Lifecycle and native ordering fixes — 2026-09-08

- The obsolete rice-cake mappings were backed up and removed after native
  replacement proof (two rows, three stale occurrences).
- Owner explicitly approved Rocket `selectionPolicy=preserve_native`; it is
  persisted in source configuration. This does not relax name, price, identity,
  stock, membership or image checks. Demae retains its prior native policy.
- Rocket group ordering uses the official separate `update-expose-order`
  endpoint. Dish group changes send sequential `exposeOrder`; reads sort by
  that field instead of incidental API array order. Group member stock is
  compared by identity, never inferred from names or array positions.
- Rocket full native acceptance passed revision 1: 276 targets, 277 physical
  observations (one source target has two physical occurrences). This is saved
  as a verification snapshot, not inferred from merchant write acknowledgements.
- All 37 replacement identities and deleted predecessors were independently
  checked. 36 still match their original migration stock; rice cake 7112171 is
  now permanently hidden by the later successful store inventory command at
  2026-09-08T10:26:04.887Z (both mapped rice-cake IDs). Do not restore the old
  ledger stock over this newer explicit inventory operation.
- Demae can move identified existing items between live categories, preserving
  stock and images. Retired items/categories are unlinked permanently; retired
  groups are removed from all item size periods, including future periods.
  Unknown consumers block before writes. Library records remain recoverable.
- An Uber item retained in the library but detached from every category is
  inactive in OS and retired downstream. A reappearing mapped Demae library
  item stays hidden rather than being silently republished.
- A fresh Demae acceptance attempt passed preflight/content checks, but its
  browser was navigated during a read. Earlier revision-1 acceptance remains
  recorded (275 verified plus one quarantined). Do not treat interruption as
  successful verification or clear the quail quarantine.
- Source automatic flags remain OFF at this checkpoint. Deployment and the
  first scheduled, single-worker production cycle are not yet verified.

Older sections below are historical checkpoints, not current readiness claims.

## Rocket request compatibility fix — 2026-09-08 (latest)

The merchant UI and Bridge window both displayed menus normally. In the same
Bridge window, the official option-tab request returned HTTP 200, while the
previous generic fetch returned 403. The official frontend attaches `Accept`,
`X-Requested-With` and dynamically generated `X-Request-Meta` headers. A
same-origin read using that request format succeeded without changing login.

The shared Bridge request function now adds these headers only for the exact
Rocket origin, using the actual current browser environment and a fresh time.
No cookies are exported, no metadata is copied between sessions, and transient
headers are not stored in creation receipts. Demae requests remain unchanged;
origin checks, request timeouts and uncertain-create protections remain intact.

The updated real Bridge catalog path passed read-only verification: 14
categories, 24 dishes, 29 groups and 213 option records. All 147 Bridge tests and
the production Webpack/TypeScript build passed. This request fix does NOT itself
complete the group/mapping acceptance or enable automatic publication; those
remaining tasks below are still pending. No merchant content was changed in
this increment.

## Replacement migration checkpoint — 2026-09-08 (latest)

Automatic source ingestion/publication remains OFF, revision 1. This is not
a completed full-CRUD launch. The sections below describe older checkpoints.

- Owner approved Rocket replacement migrations preserving original stock;
  `publish_config.rocket_now.optionMigrationPolicy=preserve_stock` is persisted.
  The additive migration-journal schema is applied. Ordinary new sellable
  records still receive a permanent hidden hold; images are read-only.
- Demae full native acceptance completed: 275 verified source objects and one
  explicitly quarantined object, 276 observations, revision 1. Verification is
  saved in `menu_platform_snapshots`. Prices follow OS; selection counts retain
  the authorized native policy. The quarantined quail was not touched.
- Rocket's official option/group update endpoints reject foreign-group option
  IDs. A replacement must be reserved in OS before hidden creation, have its
  native receipt saved, be independently checked, then receive the original
  stock state before the old physical record is deleted. Final OS mapping swap
  and completed checkpoint share a transaction. Fault tests cover uncertain
  creation, acknowledgement loss, concurrent stock change and failed cutover.
- The live plan executed 37 physical replacements (the earlier 35 estimate
  missed two occurrences). All 37 ledger entries reached complete. Independent
  native readback found every replacement at the correct name/price/group and
  original stock, with every predecessor absent: 34 ON_SALE, three NOT_EXPOSE.
  Two rice-cake occurrences were already mapped to the same source target;
  their different original stock states were preserved, not consolidated.
- Full Rocket acceptance subsequently stopped on group-save readback mismatch.
  New diagnostics report the exact group, mismatched fields, limits and consumer
  drift; group-only checks no longer refetch unrelated dish details.
- Independent mapping acceptance found the old rice-cake comma-separated OS
  mapping and an inactive noodle-group alias still referencing retired IDs.
  The journal writer now normalizes surviving siblings rather than deleting
  only exact whole-row IDs. `repair-rocket-migration-mappings.mjs` backs up and
  removes wholly obsolete legacy rows only after fresh native cutover proof;
  foreign active ownership or partially obsolete rows fail closed.
- That repair has NOT run successfully: Rocket started returning HTTP 403
  Access Denied again, and native work was stopped. The full retry also stopped
  during read-only preflight. Do not bypass the denial, recreate replacements,
  or enable auto publication based on the completed migration ledger alone.
- `audit-rocket-option-migrations.mjs` provides read-only native/OS verification.
  The current result is 36/37 fully verified because of the stale rice-cake OS
  alias, not a native stock or price discrepancy. The old aliases still need
  safe removal, followed by resolving group readback and full acceptance.
- Generic Demae category moves and non-option retirement remain guarded adapter
  gaps. Current baseline acceptance does not prove future arbitrary CRUD.

## Live acceptance in progress — 2026-09-08 (latest)

- Server release `3240d84c` is deployed READY to production; the mapped-ID
  uniqueness migration is applied. The desktop Bridge was restarted and
  independently confirmed running as PID 59459 with no queued commands.
  None of this enables full automatic publication: source flags remain off.
- A real Demae main-item edit now succeeds: `00000003`, cold dry noodles,
  ¥790, full projected description, unchanged stock/associations/image. The
  missing `originalApplyStartDate`/`originalApplyEndDate` edit keys were the
  cause of the rejected existing-size update. Native readback returns these
  request identity fields as null; they are not persisted content fields.
- Merchant requests are now paced, not unbounded parallel catalog requests.
  No automatic write retries are introduced. Held records are read by saved
  IDs, and shared private carrier assignments are checked once per snapshot.
- Ordinary Chrome independently shows Rocket's menu, while the Bridge session
  still cannot load the catalog after refresh. A fresh login in that dedicated
  window was requested; no cookies were copied and no denial was bypassed.
- OS bootstrap committed revision 1 with 277 source objects and five new
  unavailable options. `enabled=false`, `auto_publish=false` remain in force.
- Owner approved excluding only the informational, zero-yen non-product card
  `item:4f49f437-9cde-4286-95f6-673fbb141880` from both downstream platforms.
  Each platform's persisted `excludedSourceKeys` carries this decision. Uber
  and OS retain the source; zero price alone never implies an exclusion.
- Both full native preflights reached zero issues. Actual publication is still
  incomplete: Rocket's catalog endpoint subsequently returned HTTP 403 HTML
  Access Denied, including an independent read several minutes later. Do not
  bypass this denial or blindly retry writes. Persisted identities remain usable.
- Demae new options are independently verified in one-option carrier groups
  linked only to an unassigned draft pattern. The official form requires a linked
  item; unlinked-group creation is unsupported. Native option/group IDs are saved
  before subsequent writes, including a reservation for uncertain group creation.
- Demae selection counts remain native under the owner's conditional instruction
  to match Uber if supported; no unsupported min/max equality is claimed.
- Native name compatibility uses ASCII parentheses in Rocket (including
  categories), and full-width prohibited ASCII punctuation in Demae. The latter
  also normalizes full-width alphanumerics, half-width katakana and repeated
  spaces according to its official merchant form validators. Images remain
  read-only. Content writes preserve stock and new items stay unpublished.
- Verification: 128 Bridge tests and 55 focused server/projection tests passed;
  the production Webpack build completed, including TypeScript. Actual full
  downstream verification and automatic activation are still pending.

The sections below are historical increments, not the latest readiness claim.

## Current publication gate — 2026-09-08

**Not deployed; automatic publication remains disabled.** The latest full
live preflight returned one Rocket issue and 103 Demae issues. These are
validation issues, not counts of missing products. The Rocket category issue
was subsequently resolved by saving OS category
`af1f994a-6ecb-4ace-989c-03746275da56` → native `1625484`: eight independently
mapped products identify the existing set category; the ninth, beef noodles,
already has a separate identified destination. No native category was created.

Rocket's driver now plans known option moves, empty parent creation, hidden
item/option creation, and final item/category/group associations. Unknown old
group members still block before writes. New sellable records must stay hidden;
new parents may contain already-selling moved products. Quantity verification
also checks the native multi-select flag. These generic migration paths are
unit-tested, but have not yet been executed as a full live publication.

Demae remains incomplete: 50 staging/creation checks, 27 selection-policy
checks, nine group-member changes, two missing mapped observations and 15
item/group changes. The official option-create response includes its native
option code, but an unlinked option is not independently discoverable through
the ordinary live option/stock lists. A durable staging and readback path is
still required; do not link new choices to a selling group to work around it.
The quarantined quail record remains untouched.

Validation in this increment: 119 Bridge tests and 42 focused TypeScript tests
passed, followed by one additional multi-select regression test (19 focused
driver/runner tests passed). TypeScript, Webpack production build and diff
whitespace checks passed. Source remained `enabled=false`, `auto_publish=false`,
revision zero. No server deployment, uniqueness migration, full source import,
or full downstream publication was performed.

## Identity and hidden-option execution increment — 2026-09-08

- Source group moves now reuse a unique prior OS option identity, preserve its
  price policy/stock settings, rekey its source object in the same transaction,
  update its group FK and exclude the reused target from removal. Ambiguous
  old owners or splits fail closed. The real current 277-node import passed
  database constraints in a deliberately rolled-back transaction.
- Snapshot merging keys native external IDs, preserving multiple physical
  occurrences of one OS target. Remaining runtime mapping upserts now conflict
  on native external ID, not logical target. The pending uniqueness migration
  is **not applied live**; deploy compatible writers before applying it.
- Rocket native execution now supports hidden creation of options in an already
  identified group, durable receipt recovery, parent-preserving content updates
  and safe member reordering. Unknown existing members still block publication.
- Verified a real owner-approved creation: source option
  `option:42a2d7e8-64b2-41f2-ad6b-2a0a7d40500f:9dd61cde-b7e4-44f0-aa6a-d5d8c1eff12e`,
  new cheese tteokbokki, native `7080264`, mapping
  `sub_checkbox_1438026_7080264`, ¥216, permanently `NOT_EXPOSE`.
  OS identity/mapping and creation journal were persisted. An independent new
  process reused the mapping with `creates:0`; all other observed menu content
  and availability stayed unchanged. No images were sent.
- Option retirement is wired into the shared runner before relationship
  verification: Rocket deletes the physical option; Demae removes every live
  association (not a native library hard delete). New client/runner retirement
  paths are unit-tested; the constituent endpoints were previously verified
  through the owner-approved cleanups. Full automatic retirement is not enabled.
- Rocket inventory matching now uses physical ID even when the group prefix
  changes. A missing mapped ID cannot fall back to a different same-name product.
  Native publication similarly reports a misplaced record as a group migration,
  not a missing product. Group moves themselves remain preflight-blocked.
- Owner explicitly approved changing Uber category
  `8162a886-bbb6-4857-b47e-2da84f736602` from `🐃🐃🐃` to
  `麻辣牛肉麺｜麻辣牛肉面`. Saved through the official category form and confirmed
  by a fresh catalog read. The guessed category upsert with `validate` was
  rejected; do not reuse that request shape. The form's request did not use the
  instrumented fetch hook, so successful independent readback is the evidence.
  The Bridge was briefly suspended for the form and resumed in a finally block.
  OS category `3095789c-addb-43ba-8f94-68bd22a20ffd` and the mapped OS beef-noodle
  item's category field were updated to `麻辣牛肉麺`. Downstream category creation
  remains pending; no claim of completed cross-platform category publication.

Validation: 116 Bridge tests, 42 focused TypeScript tests, a full Webpack
production build and `git diff --check` passed. After checking that there were
no pending/processing commands and source flags remained false, the local Bridge
was restarted and independently confirmed running (PID 37007). The native-ID
inventory fix is loaded there. Server code and the mapping migration are still
unpublished/unapplied; full menu auto-publication remains off.

Full publication remains disabled. Before the physical-ID diagnosis correction
and category rename, live preflight found 81 Rocket and 104 Demae issues, including
parent mismatches, missing parent/item creation paths and Demae selection-policy
checks. These are issue counts, not missing-product counts. Do not describe the
full CRUD feature as complete. Five genuinely new Uber options were observed by
the latest OS dry run; they have not yet been imported or published.

## Confirmed duplicate cleanup — 2026-09-08

Owner explicitly approved deleting the old Rocket duck and keeping beef only in
the premium group. Deleted native option IDs `6308315` (old duck) and `6053170`
(standard beef). Full readback confirmed the other records were retained:
`6878749` duck, premium group `1438216`, ¥499, `NOT_EXPOSE`; `6265527` beef,
same premium group, ¥499, `ON_SALE`. OS removed the old duck mapping and changed
the canonical beef mapping to `sub_checkbox_1438216_6265527`.

Continued Demae content correction with independent stock-before/after checks:
`00000133` now has the Uber premium-duck name and OS price ¥400; `00000164`
has the Uber extra-wide-noodle-addition name, ¥170; `00000101` has the Uber
extra-wide-noodle name, ¥300. All three stock states remained unchanged.
The third name was initially rejected with `MWA0012`. The merchant's official
frontend validator explicitly prohibits ASCII parentheses. Replacing only the
English parentheses with full-width forms succeeded; the shared projection now
does that for Demae, without changing Uber or Rocket punctuation. This projection
code is local, not yet deployed. The focused name/publication suite passed 26 tests.

This cleanup does **not** complete or enable full automated publication. Native
create/move/retirement preflight gaps below remain. The pending mapping-uniqueness
migration must not be applied before every runtime mapping writer is updated.

## Latest increment — 2026-09-08

Full automated publication is **still not complete or enabled**. Both adapters
now call the shared execution runner and native driver, replacing the unconditional
`publisher_not_ready` throws. The native preflight still blocks creation, structural
migration and unsupported retirement; it only admits fully mapped, structurally
matching graphs for verified name/price/description updates. Do not interpret the
presence of the runner as full CRUD support. Never remove its preflight issues to
force activation.

The runner checks the complete batch before writing, requires durable progress
acknowledgements, separates content/relationships/retirement, and reads a fresh
full snapshot for final observations. New creations cannot bypass permanent-hide
verification. Native snapshots are shared within a phase, not reread for every
one of hundreds of options. Rocket temporary `forceNotExpose` is not accepted as
a permanent stockout. Rocket group limits are independently checked. Demae
selection constraints require explicit `selectionPolicy: preserve_native`
authorization or remain blocked; its currently inspected group API has no
Uber-style min/max selection fields. No such authorization has yet been received.

Bootstrap reconciliation now requires exact normalized name, exact platform price,
a parent identified by existing child IDs, and unique candidates on both sides.
It never adopts quarantined or already-owned IDs. Four Demae option mappings were
saved without creating products: `a0110002`, `a0110008`, `00000152`, `00000155`.
Parent mappings were refreshed (29 Rocket / 27 Demae in the final mapping pass).
Unknown children still block destructive replacement even when the parent can be
identified. User decisions were requested about permanently hiding confirmed
Uber-absent legacy options and retaining Demae's existing selection rules.

Live full preflight (read-only, before the later explicit Demae selection-policy
guard) returned 91 Rocket issues and 80 Demae issues. These are issue counts,
not counts of missing products; parent mismatches can also fail child identity
checks. The whole batch stopped before any native menu write. The complete
existing test suite passed (144 tests), three additional primitive tests passed,
and a Webpack production build passed. No server deployment, Bridge restart,
source activation, or native menu mutation occurred in this increment. Creation
and move primitives added for Rocket are unit-tested only, not live-validated.

### Earlier draft-area increment

This earlier increment resolved the Demae main-item hidden-create blocker, not
the complete category/group synchronization path. Images are now excluded from
outbound publication by explicit owner instruction.

- User approved leaving the lost quail-option record alone. Its source key is in
  `publish_config.demae_can.quarantinedSourceKeys`; its old `creating` reservation
  remains untouched. It must not be recreated, renamed, linked or restored.
  Quarantine acknowledgements are counted separately from verified publications.
- Created menu pattern `0001`, `Foundr1 下書き FS7ecda2bbd1e8bd`, with **zero assigned
  shops**, and its private category `0007`. The live pattern remains `D8Ta`.
  Drafts are hidden by lack of shop assignment, with no expiry date. The native
  form requires its store-top-image/recommend-category reference before adding
  ordinary categories. Only that reference was reused; its contents were not edited.
- Created and verified item `00000015`, Mala Beef Noodles, at OS price ¥2,300.
  Saved mapping `itemList_41064900000015false` and the persistent OS unavailable
  hold. Retried using the saved mapping: `creates:0`, name/price/hidden-state passed.
  Source option-group associations are still pending on this draft. Images are
  excluded from synchronization and managed in the merchant backoffice.
- `DemaeDraftClient` independently reads shop assignment and category menu-pattern
  links before and after creation. Category detail returns empty relationship
  arrays even when linked; use `/category/{code}/menu-pattern-list` instead.
- The initial empty-category attempt was definitively rejected with MWA0074;
  its recorded local reservation was annotated as rejected only after a complete
  category read confirmed absence. The corrected attempt succeeded. Main-item
  input also required the native default `appealIconCode:'0'`, not an empty string.
- Merchant receipts are saved inside the browser before the CDP response and then
  in OS. Only explicit Demae input-rejection codes permit corrected retries;
  network/server uncertainty stays locked. Empty description `null` versus `''`
  is normalized for verification, and newlines use the native `<br>` encoding.
- Demae's ordinary snapshot reader now selects the uniquely shop-assigned menu,
  not `menuPatternList[0]`, so a draft sorted first cannot replace the sales menu.

Operational scripts: `prepare-demae-drafts.mjs ... --apply` prepares/reuses the
isolated area; `verify-hidden-authority-item.mjs ... --draft-area --apply` performs
the narrow existing-OS-item smoke flow. Neither enables automatic publication.

Independent final audit: 21 live items unchanged; draft `00000015` absent from
both the live menu and the shop stock directory. Source remains disabled with
automatic publication off. The local Bridge was restarted successfully only
after the store's active stockout commands finished; its updated sales-menu
selection is loaded. Server-side changes have not been deployed. Full Webpack
build, 40 focused source/price tests and Bridge regression tests passed.

## Rollout status — 2026-09-07

**Not enabled and not production-ready end to end.** See the live-test incident
below before attempting any further creates. The maamaa source record is
configured with `enabled=false`, `auto_publish=false`. Database schema changes
have been applied. Source-import verification deliberately rolled its transaction
back. Subsequent OS mapping writes and the uncertain merchant create are recorded
below; neither constitutes a completed downstream publication.

### Mapping migration and live-test incident (latest increment)

48 unambiguous parent mappings have now been committed to OS using independently
read child-ID evidence: Rocket 6 categories + 20 groups; Demae 7 categories +
15 groups. Mixed parents, split ownership and unmapped members are reported by
`scripts/plan-uber-authority-publication.mjs` and are not adopted by label.
This is **partial mapping migration**, not completion of all restructuring.

The requested full publisher is still not connected. The adapters' explicit
not-ready guards and the disabled source remain in place.

Real Demae smoke testing did **not** pass:

1. Main item `item:11156cf8-eb62-455e-aabc-765dc9b27f53` (Mala Beef Noodles,
   OS price ¥2,300) was rejected twice with HTTP 400 / `MWA0012`. Independent
   all-item/marker reads found no new item. Merchant frontend validation confirms
   that a category is mandatory. `createUnlinkedItem` now rejects locally; never
   replace it with an exposed create followed by stockout. Its journal is
   `rejected`, not successful.
2. Option `option:2a1ac4c4-3831-473c-89a3-bc6f8478aa3c:c445df6c-9f5d-489e-bd68-7f11918cc458`
   (quail-egg extra, OS price ¥800), marker **`FS676f530855ebc2`**, received a
   successful creation response, but the unlinked record was not discoverable
   through the menu-pattern option list or independent stock directory, including
   no-cache reads. The original test did not retain the response ID. The record
   must be treated as potentially created, not absent. No rename, group link or
   restoration was performed. Its persistent `creating` reservation remains;
   **do not clear it or issue another create**. Recover the native ID through a
   supported unlinked-option lookup or merchant support before continuing.

The helper now persists a returned native-ID receipt before marker discovery.
Definite input rejections can be distinguished from uncertain network/create
outcomes. New live creates in the smoke script are paused; independently found
markers/mapped objects can still be recovered without issuing another create.
All merchant reads bypass browser caching.

The stock and linked-menu counts remained unchanged in the independent audit:
Demae 21 linked products / 180 options; stock definitions 22 products / 180
options. These counts do **not** prove that the unlinked option was not created.
Customer-side checkout invisibility and the complete create/rename/retry flow
have not been verified. No automatic publishing or deployment was enabled.

Validation after this increment: 69 Bridge tests, standalone TypeScript checking,
Webpack production build and `git diff --check` passed. Passing tests do not
override the live integration blockers above.

The remaining critical path is implementing and verifying both desktop Bridge
catalog publishers. They currently explicitly reject authoritative publications
with `uber_authority_publisher_not_ready`. Do not enable `auto_publish` until the
checks below pass. An empty `changes` array must never make an authoritative
publication look successful.

## Ownership

- Uber owns menu identity, source names, descriptions, images, category placement,
  groups, option membership, ordering and Uber channel prices.
- OS keeps stable operational IDs, website/POS data and supplementary translations.
  Existing OS base prices migrate as manual; new automatic prices are
  `round(Uber yen × 0.8 / 10) × 10`. Rocket never uses this calculation.
- Rocket takes the exact contextual Uber price. Demae takes the OS base price.
  Independent channel overrides cannot supersede these sources.
- OS continues owning stockout/restore. Content import never restores availability.
  New OS items/options and newly created downstream counterparts have a persistent
  unavailable hold, not a today-only stockout.
- Authority is explicitly scoped to one configured brand/store, not every brand.
  The nanacha and maamaa frontends continue consuming OS menu IDs and display names.

## Implemented foundation

1. `desktop-bridge/src/uber-authoritative-catalog.mjs` captures the delivery menu,
   including orphan objects and contextual prices. Historical overrides referencing
   deleted groups are retained but never substituted for the current group price.
2. `lib/uber-menu-source-sync.ts` validates identities/references/prices and adopts
   existing OS records strictly by stable IDs. The import, its revision checkpoint,
   run log and optional publication commands share a database transaction.
3. A revision lock rejects concurrent or stale writers; command IDs make retries
   idempotent. Two complete observations at least 60 seconds apart are needed for
   retirement. Legacy mapped objects missing before first import are included.
4. `/api/cron/uber-menu-sync` schedules enabled sources every ten minutes. It requires
   `CRON_SECRET`. `/api/menus/uber-source` exposes status, explicit scans and OS base
   price modes for owner/manager sessions. The OS menu screen has a dedicated panel.
5. Source ownership guards block the ordinary OS content-edit/publish path once
   enabled. Old pending OS-led publication commands are superseded. Inventory
   matching prioritizes verified external IDs over historical name exclusions.
6. `lib/uber-menu-publication.ts` builds versioned channel payloads and verifies all
   mapped occurrences. It rejects missing observations, wrong prices/names,
   unverified structure, and newly created objects that are exposed.
7. `lib/uber-menu-publication-store.ts` journals creation intent and discovered IDs
   before a worker may rename a newly created marker. Conflicting mapping ownership
   fails rather than reassigning another OS object's external ID. The worker must
   treat progress acknowledgements as required for this protocol.

## Publisher transport and mutation primitives — next increment

`desktop-bridge/src/merchant-menu-client.mjs` keeps requests inside the existing
authenticated merchant browser and checks the origin on every request. Requests
time out after ten seconds; mutations are never retried by this layer.

`rocket-menu-client.mjs` implements dish and option edits, hidden marker creates,
category edits, and retirement of empty categories. Dish edits submit existing
approved image references, preserve mapped option availability, and refuse pending
image approvals rather than overwriting them. After a write, independent reads
check names, exact yen prices, images, category placement and option associations.

`demae-menu-client.mjs` implements item/option edits, unlinked marker creates and
item retirement by removing category links. Price edits target the unique current
price period; ambiguous sizes and shared menu patterns are refused. Existing image
and relationship fields are retained and checked. Its read-only stock target query
checks the actual permanent stockout records before/after content edits, including
options; a truncated stock response or multiple physical shops fails closed.
Attaching an item to a category is deliberately blocked before writing until the
publication planner can verify its permanent hold.

Live **read-only** checks passed for the configured maamaa sessions:

- Rocket: 8 categories, 24 linked dishes, 25 groups, 212 options.
- Demae: 7 categories, 21 linked items, 20 groups, 180 options. Its stock query
  separately returns 22 item definitions and 180 options; definitions and placed
  menu entries must not be treated as identical sets.
- Demae's option-update date URL format was confirmed against the merchant's
  current frontend implementation (hyphenated dates).

The mutation primitives are tested with simulated merchant responses, including
successful HTTP responses with incorrect persisted content or lost stockout holds.
They have **not** been executed against the real merchant menus. Auto-assigned
creation codes, recovery of unlinked markers, native group/category CRUD and the
full publication orchestrator still need completion and live verification.
The adapters' `uber_authority_publisher_not_ready` gates remain in place. No
production menu changes, deployments, or automatic-source activation were made
in this increment.

Increment verification: 64 desktop Bridge tests and 38 focused source/price/
inventory tests passed; TypeScript checking and the Webpack production build
passed. Live merchant verification remained read-only.

Read-only audit command (does not publish):

```sh
node scripts/audit-authority-publishers.mjs <Demae chain ID> <menu pattern>
```

## Required before activation

### Scope and verification update — 2026-09-08

Outbound images are explicitly excluded by the owner. OS still imports Uber
images, but authoritative publication targets omit image fields, including nested
source image metadata, and carry `imagePolicy: read_only`. Rocket content edits
now follow the merchant's image-free edit serializer; approved and pending images
are independently compared after the write. Demae item edits retain `NOT_EDIT`.
The draft-area client no longer copies a store-top-image reference; a new area
without the merchant-required image setting requires merchant setup. The existing
isolated pattern `0001` already has that setting and remains unassigned.

Native group primitives now cover Rocket name/quantity/order updates with exact
prices and unchanged availability/consumers, and Demae name/description/member
updates reconstructed from independent item-size relationship reads. Demae's
group detail returns empty relationship arrays even when linked; these must never
be used as the actual member/consumer list. New members cannot be linked to a live
Demae group through this path. An unlinked-group create primitive records its ID
before read-back and uses the durable browser receipt journal; it is unit-tested,
not yet live-create validated or wired into the full publication runner.

Live no-op verification this turn passed for Rocket hidden dish `9955164`
(same price, images unchanged, still hidden) and Demae group `a011`
(3 linked items, 17 options; name, links, stockout state unchanged). No item was
created or made available in these checks. Full automatic publishing remains
disabled: mixed/unmapped legacy relationships, complete CRUD orchestration and
end-to-end activation tests are still outstanding. Do not describe the group
primitives or image changes as a completed full publisher.

- Implement Rocket and Demae CRUD execution using the authenticated merchant
  interfaces, with read-only planning before writes and exact store identity checks.
- Bootstrap category/group mappings from verified memberships; handle one logical
  group split across several physical groups. Never adopt by name alone.
- Preserve quantity rules, item-group order, permanent hidden state, category
  placement and images. Block unsupported rules explicitly rather than flattening.
- For create: persist `creating`, create a deterministic hidden marker, read it
  back, persist `identified`, then update final content. After an uncertain create,
  search the marker; if absent while intent is already recorded, require diagnosis
  instead of issuing another blind create. Register every physical occurrence.
- Independently read actual platform fields for `observations`; never copy desired
  values into verification output. Preserve all current availability on updates.
- Handle new required-but-hidden options without exposing them or breaking an
  existing sellable parent. Present the review hold explicitly.
- Handle detached objects separately from deleted entities; retire category/group
  relationships only after confirmation by repeated complete source observations.
- Verify OS store-specific price overrides, supplementary translation editing,
  per-option quantities and concurrent/manual stock operations before enabling.
- Run complete create/rename/reprice/restructure/delete, timeout/retry and
  next-day hidden-state tests. Verify the OS panel on mobile/tablet/desktop.
- Deploy the server, update/restart the desktop Bridge, capture baselines, then
  enable the explicitly configured source only after both adapters pass.

## Local verification

2026-09-08 acceptance hardening:

- Demae non-image saves can refresh only the `v` query parameter on the
  `cdn.demae-can.com/files/imgix/item720/` image URI. Verification compares the
  stable URI, filename and cropping metadata; other URI differences still fail.
  Outbound updates remain `NOT_EDIT` with no image content.
- Rocket empty optional groups read back a zero maximum although the edit
  endpoint requires a positive maximum. Preserve this empty-group equivalence
  only when both the source and native group contain no options. Apply actual
  selection limits after children have been created/moved, not before.
- New Rocket categories/groups/options use independently read catalog identities
  without fetching every unrelated dish detail. Full preflight and final graph
  verification still read all dish details. Missing consumer counts never prove
  a new group hidden.
- Automatic activation still requires successful native verification on both
  platforms. Unit tests and a READY server deployment alone do not qualify.

Creation receipt hardening (2026-09-07): keyed Demae option creates now save
their intent in merchant-origin local storage before the request and the complete
creation receipt before returning over CDP. Storage failure blocks the request;
an uncertain request cannot be blindly repeated. A saved response is only an
identity receipt, never independent proof of publication or hidden state. The
creation protocol can use a driver's independent ID reader and rejects mismatches
between that ID, the marker and the saved receipt. This does not recover the
earlier orphan `FS676f530855ebc2`: no receipt was saved for that earlier call.
Read-only checks again found 180 listed options and no marker; analogous newer
unlinked-option endpoints returned 404. Its existing reservation remains locked,
the live smoke-create guard stays enabled, and automatic publication stays off.
No additional merchant mutation was made during this investigation.

```sh
node scripts/apply-uber-authority-schema.mjs
node --experimental-strip-types scripts/preview-uber-authority.mjs <brand UUID>
node --experimental-strip-types scripts/preview-uber-authority.mjs <brand UUID> --verify-transaction
node --experimental-strip-types --test lib/uber-menu-authority.test.ts lib/uber-menu-publication.test.ts lib/delivery-menu-publishing.test.ts lib/inventory-platform-targets.test.ts scripts/sql-statements.test.mjs
node --test desktop-bridge/test/*.test.mjs
npx tsc --noEmit --incremental false
npm run build
git diff --check
```

The preview script uses the configured store and existing local Uber browser
session. `--verify-transaction` must return `rolledBack:true`. It is not a publishing
or activation command. No HTTP endpoint exposes the transaction-test flag.

Validation in this worktree: focused menu/price tests and all desktop Bridge tests
passed; TypeScript checking passed. The live rollback test observed 270 mapped
objects, zero new OS objects and one pending legacy removal. The final Webpack
production build passed after extracting the existing reusable Timecard component
from its route module; its business component was verified unchanged. Earlier
Turbopack/Webpack attempts were stopped and diagnosed rather than left hanging. The existing
`npm run lint` invokes removed `next lint` and cannot run on this Next.js version.
