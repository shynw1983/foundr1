# Store visual refinement — 2026-09-16

The widget and Store workbench refinement preserves operational behavior while
changing typography, spacing and surface hierarchy. This is the first pass on
Store foundations, not a redesign of every OS or customer-facing screen.

## Widgets

Restore the user's preferred deep green surface, with a pale primary action and
a quieter secondary action. Replace the empty weighted spacer with a count beside
full-width product rows. Names still come from menu master data and keep their
exact action identities. The count opens the full unavailable list.

Layouts: minimum 110×56 dp; standard shortcut 160×88 dp; dense status 250×110 dp
with one product; regular status 250×164 dp with two; expanded 250×208 dp with four.
These thresholds supersede the original heights in `store-inventory-widgets.md`.
The footer summarizes the latest operation, with failure taking priority. The
detail page retains the full product name and per-platform outcomes.

## Store foundations

Styles live in `app/store/store-responsive.css`, scoped to staff workbenches.
Retain native CJK font stacks. Main colors: canvas `#f3f5f3`, white panels, ink
`#23352e`, muted text `#6c7c73`, primary `#245d49`, deep green `#173f35`. Keep the
existing operational warning/error colors. Reuse shared variables.

Use 400–600 weights, 18–20 px headings, 13–14 px body/controls and 11–12 px helper
text. Panel corners are 14 px and controls 9 px; native widgets use 22 dp shells
and 11 dp buttons. Keep shadows quiet. Separate rows inside a panel with fine
rules instead of more cards. Fit related actions on one line while preserving
tap targets. Page-specific refinement remains necessary beyond these foundations.

## Verification and delivery

- Three Robolectric native-rendering tests passed: six widget allocations,
  Japanese/Chinese, 1.3× system text, empty/auth/failure states. Export PNGs with
  `FOUNDR1_WIDGET_PREVIEW_DIR` when running `InventoryWidgetLayoutTest`.
- Existing Java identity checks and 30 widget presentation checks passed.
- The released source snapshot plus the final Store stylesheet passed
  `npm run build`. The existing receipt PDF file-tracing warning remains.
- 12 Store routes at five widths passed existing layout and interaction checks,
  including navigation, language, POS, orders, history, timecard and procedures.
  No browser errors were reported. The test server's cleanup did not exit after
  completing all assertions and was stopped.
- No phone was connected. Actual launcher clipping, resize interactions and
  background refresh behavior remain unverified on hardware.

The Desktop workspace has iCloud `dataless` files that return `Need authenticator`
or `ETIMEDOUT`. Release preparation uses a clean clone of current `origin/main`
outside the Desktop and applies only the reviewed refinement patch. This keeps
newer production changes, including continuous native order alarms, while
preserving unrelated local work. No phone is used for the release.

Preview: `outputs/store-refinement-20260916/index.html` in the original workspace.
The original reviewed patch remains backed up outside iCloud at
`/private/tmp/foundr1-store-refinement-delivery`.
