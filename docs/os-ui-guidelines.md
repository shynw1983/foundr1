# Foundr1 OS UI Guidelines

These requirements apply to OS and store operation interfaces. Brand marketing pages follow their own design requirements. Read the relevant rules when changing operational UI; validation scope is defined in [AGENTS.md](../AGENTS.md#validation-and-command-execution).

The app is heavily used on mobile and half-width/tablet browser windows.

When editing UI:

- Use the Foundr1 theme direction: deep green primary with clean neutral surfaces and no decorative accent color. Prefer shared tokens over one-off hex colors. Keep neutral surfaces dominant, use green for primary actions/success/brand emphasis, blue only for information/link states, amber only for warnings, red for destructive/error states, and violet only when there is a clear module meaning.
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
- Do not let native form controls fall back to browser/system blue. Checkboxes and compact selectors should use the Foundr1 green theme and stable compact dimensions. Broad input styles must not accidentally stretch checkboxes into large blocks.
