# AGENTS.md

This file defines project execution rules. The user's current task and explicit decisions govern scope; project defaults fill routine gaps. `AI_RULES.md` is a navigation aid. `README.md`, `PROJECT_CONTEXT.md`, `DATABASE.md`, and `docs/` supply domain contracts, implementation references, and history. Read relevant sections as the task requires, not every document. Resolve implementation facts against current code and verifiable environment state; code alone does not override a business rule. Use explicit decisions within their recorded scope, and treat dated rollout notes as historical evidence. Report unresolved business-policy conflicts while continuing unaffected work.

## Working Approach and Authorization

- Carry the user's intended outcome through implementation and appropriate verification. Prioritize correctness, completeness, and maintainability; avoid redundant work without sacrificing necessary investigation or testing.
- Start with relevant code and follow its actual dependencies. Expand the investigation when evidence points to shared APIs, data, styles, translations, or another module. Do not require a fixed repository-wide reading checklist for a small change.
- Use judgment for routine implementation choices. Refactoring within the task is allowed when it addresses the root cause or materially improves the solution; explain substantial changes and verify affected behavior. Avoid unrelated cleanup, broad formatting, or speculative redesign.
- Preserve user changes. Inspect existing modifications and merge carefully where the task overlaps; leave unrelated work alone.
- Existing user authorization persists across turns. Do not request repeated confirmation for already-authorized work. Local code, schema drafts, tests, and documentation changes may proceed within the requested scope, including payment and permission fixes.
- For schema, authentication, permissions, payments, or cross-module flows, briefly explain the affected data flow and meaningful risks while continuing authorized work. This progress update is not an approval gate.
- Before applying changes to a real database or performing an external action, establish the target environment and authorization for that action. Ask only if authorization is missing for destructive changes, live financial actions, publishing/deployment, or other consequential external effects. Preparing a patch is distinct from applying it to live data. Complete independent preparation and validation before requesting any necessary approval.
- Distinguish verified facts, assumptions, and unverified behavior. Investigate resolvable uncertainty; ask only when missing business intent or access prevents a sound decision.
- Task-relevant dependency, configuration, and tooling fixes are allowed when justified; do not bypass security controls or conceal missing access.

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

## Product Image Work

For food product photography, menu images, or Uber listing images, read [Product Image Workflow](docs/product-image-workflow.md). Preserve the approved composition and real-photo surface compositing method for the matching product series; the document retains the per-ingredient fitting, masking, and rejected-method details. Apply the user's newer requirements when the requested series or composition changes.

## Store Operations and Native Shells

`/os` is the management workbench; `/store` is the store operation workbench. Before changing store operations, procedures, kitchen/order-production data, or native device capabilities, read the relevant [Store Operation Rules](docs/store-operation-rules.md). Menu and checkout changes that feed kitchen production must also follow its structured-item contract. Native foreground alerts must work without a per-launch web sound-enable tap; ordinary browsers retain explicit sound activation.

## Associated Brand Websites

Foundr1 OS is connected to two separate brand website projects on this machine. When working on public customer flows, menu sync, pickup reservations, checkout, kitchen display data, or member/loyalty integration for these brands, check these projects directly instead of rediscovering their paths:

- nanacha milk tea site: `/Users/wushengyin/Desktop/nanacha New HP`.
  - Main pickup reservation UI: `components/reservation-form.js`.
  - Checkout proxy: `app/api/create-checkout/route.js` and `server/create-checkout.js`.
  - Bootstrap import source: `published/menu.json`, via `scripts/import-brand-menus.mjs`.
  - Uses Foundr1 OS public checkout endpoint `/api/public/orders/nanacha/checkout` and Square payment.
- maamaa / まぁ麻 malatang site: `/Users/wushengyin/Desktop/maamaa`.
  - Main pickup reservation UI: `src/components/malatang-order-builder.tsx`.
  - Checkout proxy: `src/app/api/orders/route.js`.
  - Bootstrap import source: `src/data/malatang-menu.ts`, via `scripts/import-brand-menus.mjs`.
  - Uses Foundr1 OS public checkout endpoint `/api/public/orders/maamaa/checkout` and KOMOJU payment.

Foundr1 OS provides shared menu/catalog data, store operations status, public checkout APIs, order records, kitchen/production data, POS linkage, and member/loyalty records. Brand sites pass structured order and member fields to OS and consume its public menu API. For a configured Uber-authoritative source, upstream content follows [Uber Menu Authority](docs/uber-menu-authority.md#ownership); OS retains operational IDs, supplementary translations, availability, and the customer API. This source policy is scoped to the configured brand/store, not all brands.

When changing online ordering, checkout, member/loyalty, completion, receipt, or pickup-status flows for either brand, assess the corresponding flow in both websites unless the user explicitly scopes the task to one brand. Update every affected implementation in the same pass to keep shared behavior aligned. A brand-specific fix does not require changing an unaffected website; briefly state why no change is needed there.

When changing multilingual behavior for the brand websites, keep this ownership boundary clear: Foundr1 OS owns menu/catalog translations and IDs, while the brand websites may own their page UI, form, navigation, validation, help, and static-copy translations. Do not fork product, topping, option, size, sweetness, heat/numb, or category translations into brand-site UI dictionaries as a long-term source.

Customer-facing brand websites must consume the standard Foundr1 OS public menu API (`/api/public/menus?brand=...`) and render menu names/options from the menu master `displayNames` fields. Do not build new brand websites on `*-compatible` menu endpoints or hard-coded local translated menu lists. See `docs/customer-menu-i18n.md` before adding or changing any public ordering, POS customer display, member card, coupon, or menu translation flow.

maamaa Web予約 supports customer-side cancellation/refund requests until 30 minutes before pickup, before preparation starts. Keep this action available from the member order detail modal and reuse the shared order cancellation/refund rules instead of duplicating a separate policy.

## Commands

Use these commands from the repository root:

```bash
npm run dev
npm run build
npm run db:check
npm run db:push
```

## Validation and Command Execution

Choose checks by changed behavior, affected consumers, and risk. Complete applicable checks once for the final task changes, plus `git diff --check`.

- Documentation-only changes: inspect the diff, references, and consistency. No application build is required.
- Isolated copy, color, icon, or local styling changes with no behavior, shared-layout, routing, type, dependency, or configuration effects: use focused checks and browser inspection; a full build is optional unless evidence points to a broader impact.
- Application logic, APIs, shared components/layouts, types, dependencies, or build configuration changes: run relevant focused checks and one successful `npm run build` for the final code state. A build does not replace behavior testing.
- Visible UI changes: inspect affected states at representative sizes. Check mobile and desktop for component/interaction changes; include tablet/half-width when layout, density, or text wrapping may change. A color/icon-only adjustment can use a representative viewport. Follow this rule instead of treating every device size as a separate mandatory check.
- Changes to order, POS, checkout, kitchen, permission, or loyalty behavior: verify affected API, persistence, and downstream output, including failure/access-denied cases where relevant. Use an appropriate test environment for side effects. Purely cosmetic changes do not require replaying unrelated transactions.
- Database changes: maintain `db/schema.sql`, inspect affected readers/writers and data preservation, and validate any migration separately. Run `npm run db:check` against the established environment when available; it checks the connected database, not an unapplied patch. Apply schema or migrations only within authorization for that target and change, then verify the result.
- If a check fails, establish whether the task caused it. Fix task-related failures; isolate and report unrelated existing failures or missing access, and continue independent work. Do not expand scope just to make an unrelated check pass. Clearly report failed or unavailable checks and the resulting verification limit.

Do not add tests that merely mirror a trivial implementation. Broaden or repeat checks only for new changes, failures, or unresolved concerns.

Use bounded command waits and an overall timeout appropriate to the operation. After roughly 30 seconds without output, inspect available logs and process activity; silence alone does not mean a command is frozen. Keep the user informed during long-running work. A healthy build may continue beyond 60 seconds with monitoring.

If there is evidence of a hang or the operation exceeds its reasonable timeout, stop the affected process, diagnose, and retry only after addressing the cause. Inspect TypeScript errors (`npx tsc --noEmit`), configuration, build logs, and relevant server code as appropriate. Type checking may require generated Next.js types. Do not repeatedly start builds or dev servers without new evidence.

The current `npm run lint` script points to `next lint`, which is unavailable in the installed Next.js CLI. Until a supported linter is configured, do not use it as a required diagnostic or report lint as passed.

Clear generated caches only when evidence suggests cache corruption, after stopping processes that use them. Do not clear caches on every failure.

## Important Product Language

Keep Japanese UI terminology consistent.

- Use `発注` for store-side requests/orders.
- Use `購入` for the actual buying work.
- Use `納品` for delivery/arrival to the store.
- Use `店舗確認` for store-side confirmation.
- Use `レシート` for receipts. Do not use `小票`.
- Use `発注先` for supplier/order destination in Japanese UI.
- Use `メイン発注先`, `予備発注先`, and `臨時発注先` for supplier roles.
- Use `Web予約` for customer-facing online pickup reservations. Do not use `ネット予約`.
- Use `キャンセル` / `キャンセル済み` for customer-facing order cancellation status. Do not use `取消` / `取消済み` for order status labels.

Do not reintroduce mixed terms such as using `仕入れ` for the primary flow unless the business owner explicitly changes the vocabulary again.

## Procurement and Product Master

Before changing procurement, receipts, product master, suppliers, or comparison behavior, read the relevant sections of [Procurement Business Rules](docs/procurement-backoffice-framework.md). Store requests and confirmations belong to `/os/orders`; buying work belongs to `/os/procurement`. Quantity edits alone do not create store confirmations. Receipts belong to supplier fulfillments, and dashboard refreshes must preserve pending/recent optimistic actions. The linked document contains the full workflow, receipt, unit-price, freight, and product-card rules.

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

In-app notifications are stored in `os_notifications`; Lark integration lives in `lib/lark.ts`. Lark is optional: failure must not block the core operation or in-app notifications. See the notification section in [Procurement Business Rules](docs/procurement-backoffice-framework.md) for integration capabilities and unverified external-group support.

## Styling and Responsive Layout

For OS/store UI changes, read the relevant rules in [OS UI Guidelines](docs/os-ui-guidelines.md). Keep neutral surfaces dominant, deep green primary actions, compact operational typography, and layouts without horizontal overflow. Preserve language switching near the top of expanded, collapsed, and mobile navigation. Choose browser checks under [Validation and Command Execution](#validation-and-command-execution); brand marketing pages follow their own design requirements.

## Translation

Foundr1 has two separate translation layers:

- Backoffice/store operation UI text is local application UI. Add translations where the local translation system expects them. Include labels, placeholders, select options, button text, empty states, notices, and errors.
- Customer-facing menu/catalog text is data owned by `/os/menus`, not local UI copy. Product names, option group names, option names, coupon/reward display names, and any menu text shown on brand websites, member pages, POS customer display, receipts, kitchen/customer summaries, or checkout must come from structured IDs plus `displayNames`.

Customer-facing language rules:

- Japanese is the operational/default source language.
- If no member/customer language is known, customer-facing surfaces display Japanese.
- If a member card or customer context includes a language, use that language for all customer-facing copy that supports it.
- Current customer menu display languages are English, Simplified Chinese, Traditional Chinese, Korean, Vietnamese, and Nepali, with Japanese as the source fallback.
- Fallback order for menu data is requested language, then English, then the Japanese/source name. Never silently map English users to Chinese or mix languages across product names, options, tax labels, and member greetings.
- Member card language comes from the global language selector encoded with the member identity, not from a legacy profile preference field.
- Do not translate product names/options only in one frontend. Update OS menu `displayNames` and let POS, customer display, public menu APIs, and brand websites consume the same data.

See `docs/customer-menu-i18n.md` for the required data/API structure and brand website integration pattern.

## Environment and Data Compatibility

Readiness and external dependencies vary by module and environment. Do not infer that data is disposable or integrations are inactive from an old “not live yet” statement. Establish the relevant target from configuration and available read-only evidence before consequential operations; historical approvals apply only to their recorded scope.

Prefer clean schemas and APIs. Do not introduce speculative legacy compatibility. Before removing existing fields or paths, check actual readers, writers, stored data, deployed clients, and queued work as relevant. Update affected consumers and prepare any data-preserving migration within scope. Retain only compatibility needed for an identified consumer or rollout, with a removal condition; unused drafts do not need permanent support.

## Git

The main branch is used for the current working product.

After the required validation, review `git diff --check` and `git status --short`. Commit or push when the user requests it or has already authorized it in the session; do not ask again for the same authorized action. Otherwise leave the reviewed changes in the working tree. Stage only task-related files or hunks, preserving unrelated work.

When commit and push are authorized, the typical flow is:

```bash
git diff --check
git status --short
git add <changed files>
git commit -m "<clear message>"
git push origin main
```

Never revert user changes unless explicitly asked. Generated caches such as `.next` and `.next.broken-build-cache` should not be committed; ignore unrelated cache files without asking the user to classify them.
