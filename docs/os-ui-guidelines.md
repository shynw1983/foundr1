# Foundr1 OS UI Guidelines

These requirements apply to OS and store operation interfaces. Brand marketing pages follow their own design requirements. Read the relevant rules when changing operational UI; validation scope is defined in [AGENTS.md](../AGENTS.md#validation-and-command-execution).

The app is heavily used on mobile and half-width/tablet browser windows.

When editing UI:

- Use the Foundr1 theme direction: deep green is the default primary, with clean neutral surfaces and no decorative accent color. Store supports an authorized per-store primary color through [Store themes](store-theme.md); use its derived theme tokens for actions, selected states, focus and coordinated neutrals. Keep neutral surfaces dominant. Separate primary/brand emphasis from success, information, warning and destructive/error semantics. OS retains its existing default theme. Prefer shared tokens over one-off hex colors.
- Avoid horizontal overflow.
- Keep dense operational screens compact.
- Keep operational typography light and scannable. Routine table cells, list rows, form labels, helper text, and status pills should generally use `font-weight` 400-600. Reserve 650+ for page titles, important metric values, and rare emphasis; avoid 800/900 weights for ordinary OS data because Japanese text becomes visually heavy and harder to scan.
- Do not add marketing-style hero sections.
- Avoid nested cards.
- For analytics/dashboard metric cards, use a stable vertical layout: label on top, value in the middle, note on the bottom. Do not use horizontal card layouts for KPI cards, because values and notes must not overlap or force awkward wrapping in half-width and mobile windows.
- Keep spacing between dashboard modules consistent in both directions. Reuse one page-level gap for vertical module spacing and matching grid gaps for cards/charts, instead of mixing unrelated margins.
- In management analytics, keep `原価` separate from monthly `経費`. Procurement/order data feeds product costs such as food, packaging, and consumables. Monthly expenses should be grouped into fixed costs (`固定費`: rent, equipment leases), variable costs (`変動費`: utilities and communication fees), and miscellaneous costs (`雑費`: garbage handling and other store expenses).
- Use normal button heights for mobile action rows. Prefer existing button styles and `lucide-react` for new icons.
- Sidebar/mobile menu must be scrollable when content is long.
- Product cards and comparison history must wrap before tablet widths overflow.
- The OS navigation/sidebar must always keep language switching available near the top of the navigation, including collapsed desktop sidebars and mobile navigation. In collapsed desktop sidebars, show only a globe icon for language switching; when the sidebar is expanded, show the full language selector/name.
- Keep sidebar active states minimal. Do not add decorative accent lines or extra highlight colors; use only the restrained active background/text treatment.
- Do not let native form controls fall back to browser/system blue. Checkboxes and compact selectors should use the active workbench theme and stable compact dimensions. Broad input styles must not accidentally stretch checkboxes into large blocks.

## OS Commercial UI Architecture (2026-11-25)

All `/os/*` routes inherit the scoped editorial commercial layer mounted in `app/os/layout.tsx` via `.os-editorial-root` (`app/os/os-editorial.css`). Keep every OS-only rule strictly under `.os-editorial-root` so `/store`, `/staff`, `/member`, `/t/[token]`, and TV display screens are never affected.

- **Palette restraint**: Keep all canvas, sidebar, card, input, pill, and border surfaces in crisp achromatic neutrals (`#ffffff`, `#fafafa`, `#f4f5f6`, `#eff1f3`, `#eaecf0`, `#111827`, `#667085`). Reserve Foundr1 deep pine (`#175442`) strictly for high-signal focal points: active period/filter pills, primary CTA buttons, and chart curves. Do not tint neutral surfaces, bottom tab pills, quick-action cards, or floating feedback buttons green.
- **Brand identity**: Preserve the original Foundr1 OS mark (`/icons/foundr1-os-512.png` at `166%` crop, locked `1:1` aspect ratio `34×34px`) identically across `/os` home and all `/os/*` subpage headers so proportions never jump between routes.
- **Navigation architecture**:
  - Desktop (`> 1120px`): Quiet `#fafafa` collapsible left sidebar (`OsEditorialSidebar` on `/os` home; harmonized `.sidebar` on subpages) with the language switcher near the top (globe icon only when collapsed) and restrained active pills without decorative left accent stripes.
  - Mobile and compact tablet (`<= 1120px`): Clean single-row top bar (Foundr1 mark + centered pill store switcher + compact language/notification controls) paired with the persistent bottom 5-Tab navigation bar (`OsMobileBottomNav`: `ホーム` / `発注・購入` / `売上・POS` / `勤怠` / `その他`) and its native full-screen `その他` directory sheet. Keep bottom safe-area padding (`92px`) on workspaces and lift floating buttons above the tab bar.
- **Subpage commercial grammar**: Use borderless soft neutral pills (`#f4f5f6`, active `#175442`) for filter chips and queue filters; crisp underline or segmented tabs for module view switchers; sleek `#f4f5f6` search/input controls that transition to `#ffffff` on focus; hairline data tables with `tabular-nums` and quiet `#fafafa` headers; and rounded `14px–16px` flat white containers (`1px solid #eaecf0`, zero heavy drop shadows).
