# Store business hours

The OS store editor supports timed hours, `24時間営業`, or `休業` for each
weekday. Checking 24-hour mode or closed clears the other selection. Saved
opening/closing times are retained so leaving 24-hour mode restores them.

The existing `stores.business_hours` JSON stores an optional strict boolean
`weekly.<weekday>.open24Hours`. An absent/false value keeps existing timed-hour
behavior, including legacy equal opening/closing times. Closed takes priority
over a conflicting flag. No database migration or automatic store conversion is
required.

Explicit 24-hour days run from Tokyo midnight to the next midnight, with the
ending boundary excluded. Operational cash/kitchen dates use that calendar day;
sales-status synchronization reminders instead use the preceding 24 hours of
original operation timestamps. Timed days retain the normal business-day rule.
History remains available after a reminder leaves its range.

Public reservation eligibility continues to require the applicable staffing,
manual reception, temporary closure and brand policies. Maamaa's existing noon
reception start remains in effect in automatic mode; both menu API projections
clip explicit 24-hour windows to that rule so the website agrees with checkout.
Manual reception keeps its existing exception. Nanacha's existing local website
pickup-hours configuration remains independent and needs review before actually
converting a Nanacha store to 24-hour reservations. This release adds the OS
setting and does not automatically change any store's saved schedule.
