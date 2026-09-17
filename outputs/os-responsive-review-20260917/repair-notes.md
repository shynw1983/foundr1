# OS responsive and translation repairs — 2026-09-17

## Changes
- Tablet header separates branding/menu from bottom-aligned store and account controls. Quick actions retain their label and count.
- Settings section fills its container; allowance and manual-rate forms adapt to available width.
- Procurement calendar, POS settings and analytics form controls use consistent sizing; phone home hero and product image preview are more compact.
- Analytics reads `salesPostedDayCount` from the existing sales-summary API and labels it as days with recorded sales. A missing value stays explicitly unknown; zero remains zero.
- Added/corrected Chinese and Traditional Chinese strings for the reviewed OS screens; home and attendance summary numbers use translation parameters. Updated the translation cache version.

## Verification
- `npx tsc --noEmit --incremental false`
- `node scripts/verify-os-responsive.mjs`: real React components against synthetic read-only fixtures. Covers OS home, analytics, payroll settings and Store home at 1440, 1024, 768, 390 and 360 px, switching Japanese, Simplified Chinese and Traditional Chinese.
- Checks horizontal overflow, visible tablet header control overlap, quick-action width and badge visibility, JavaScript errors and analytics missing/zero sales-day values. Screenshots are generated beside this report.
- Browser skill used to inspect settings overflow and header controls; screenshots visually reviewed.
- Production build deferred to deployment because local disk is nearly full. Fixtures do not validate production data or writes.

Work was performed in an isolated clone at `/private/tmp/foundr1-os-repair-20260917`; original desktop checkout was not overwritten.
