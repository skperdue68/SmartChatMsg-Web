# Calendar reminder periods

Approved design: side-by-side Period Starts/Stops calendars and server clocks, no anchor dropdowns. Important times belong in their own section. Recurring schedules retain relative timing and existing MARK/OFFSET anchors unless edited. Normal promotion starts no later than the event; explicit after-start reminders remain available. Validate dates in guild timezone and reject nonexistent DST clocks and backwards windows.

- Add tested model conversions between relative anchors and calendar fields; preserve unchanged anchors.
- Replace anchor controls and simplify important-time creation; retain once-only and after-event behavior.
- Update browser regressions for dates/clocks, DST, overlaps, recurrence and previews. Run all Node/browser checks.
- Document and publish a PR. No ESO schema change.
