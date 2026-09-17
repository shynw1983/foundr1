# OS interface refinement

## Direction
A calm restaurant operations workspace using the Store brand: green actions (#1f6f5b), white surfaces (#ffffff), light green-grey canvas (#f5f7f6), dark text (#202b2a), muted labels (#65756f), fine borders (#e1e8e4). Existing locale-aware system fonts remain; headings use restrained weight and financial figures use tabular numerals. The home introduction becomes a compact green rule beside the daily overview, preserving room for working information.

## Implementation
- Route-scoped `app/os/layout.tsx` and `os-interface.css`; Store and public pages do not acquire the OS theme.
- White navigation, green active states, consistent cards, forms, buttons, table headers and visible focus rings.
- Compact home introduction, two-column secondary phone metrics, calmer typography and spacing.
- Desktop collapsed navigation retains an accessible quick-action name and visible count; expanded navigation shows readable language controls.
- Receipt editor and QR controls adapt to narrow containers.

## Verification
`npx tsc --noEmit --incremental false` and `node scripts/verify-os-responsive.mjs`.
The browser fixture uses real OS home, analytics, settings, menus, POS and Store home components with synthetic responses and blocked writes. Matrix: 1440 / 1024 / 768 / 390 / 360 px; Japanese / Simplified Chinese / Traditional Chinese. Includes navigation expansion and sales-day regression coverage. Screenshots are generated in this directory; desktop, tablet, phone and expanded navigation were visually inspected using the browser skill.

No business calculations, permissions, save handlers or production records were changed.
