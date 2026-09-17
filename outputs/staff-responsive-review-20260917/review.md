# Staff responsive review — 2026-09-17

## Changes
- Prioritize mobile with a fixed five-item bottom navigation, safe-area clearance and 44px minimum primary touch targets.
- Remove the unrelated OS store context picker from Staff; retain the working-store selector and preserve the shared component's default behavior elsewhere.
- Refine Staff-only surfaces, spacing, typography, form controls and green status treatments; retain a centered tablet/desktop layout and sticky top navigation.
- Prevent long account names from expanding narrow screens; wrap request notes instead of truncating them.
- Pair shift availability times on mobile, add accessible field names and keep month controls in one compact row.
- Disable refresh while loading and expose active navigation/loading state to assistive technology.

## Verification
- Inspected the logged-in production Staff home, timecard and requests pages before editing. No real punches, submissions or payroll changes made.
- Actual Staff component rendered with synthetic long names, store names, notes, shifts, timecard and payroll records via `scripts/verify-staff-responsive.mjs`; non-GET fixture requests are blocked.
- Six views at 360, 390, 430, 768, 1024 and 1440px: horizontal overflow, navigation target size, mobile bottom clearance and screenshots.
- Simplified and Traditional Chinese layouts at 360px, availability checkbox editing, working punch-button states, empty state and page-error checks.
- TypeScript check: `npx tsc --noEmit --incremental false`.
- Desktop Chromium with viewport emulation; physical iOS/Android keyboard and safe-area rendering are not device-tested.
