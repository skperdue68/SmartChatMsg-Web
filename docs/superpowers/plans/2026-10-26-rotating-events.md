# Rotating Events Implementation Plan

**Goal:** Add Rotating event special pattern and durable occurrence cancellations for event/faction rotations in both editors and runtimes.

**Architecture:** Add optional schedule fields rotationEvents (ordered Lua array of {id,name}), rotationEvery (occurrences per activity, default 1), and occurrenceExceptions (server-date keyed map of {action="KEEP"|"POSTPONE"}). Pattern code EVENT_ROTATION displays Rotating event. %eventactivity% expands to the selected activity name. Activity-specific message variants use stable activity IDs; unmarked messages use ALL. Existing faction blocks remain calendar-week based. No external service is needed by ESO.

**Accepted behavior:** Anchor date identifies the first selection. Cancel excludes that occurrence and its reminders. KEEP consumes its nominal slot; POSTPONE holds progression for that slot. Event rotation subtracts prior postponed nominal occurrences. Faction rotation subtracts the civil-day span between each postponed occurrence and the following nominal occurrence, preserving existing calendar-week semantics otherwise. A cancelled date stays saved for display and Undo. Exceptions keyed by schedule-zone date survive timezone changes as clock dates. Off-cadence exception dates do not shift rotation. Changes to base recurrence/list intentionally recalculate the projection.

**Global constraints:** All clocks use configured guild/event server timezone, including DST. IDs, messages, cooldowns, unknown data and locked content survive edits/import/export. Cancellation choices are configuration, not runtime; exported and merged as configuration. No automatic cancellation announcement in this iteration. Existing schedules without new fields behave unchanged.

## Tasks
- [x] Lua runtime, normalization, token/peer matching, import/export, addon controls and cancellation UI with regressions.
- [x] JS model projection, validation, activity selection, token preview, portable sharing and regressions.
- [x] Web ordered activity rows, occurrence frequency, upcoming/cancel/undo panel and message groups; browser regressions.
- [ ] Cross-language parity verification, full suites, updated help, separate addon/web PRs.

## Review focus
DST and multiple weekday recurrence; repeated cancellations with Undo; historical anchors and offline weeks; cancellations during active/queued promotion; full/portable export and later runtime merge preserving exceptions and stable activity IDs.

Additional approved cleanup: day-view reminder labels omit redundant event-name prefixes while retaining saved labels.

Verification: 82 Node tests, full browser checks, and 49 Lua test files passed. Direct JS/Lua comparison matched 63 occurrences across six schedules. Independent review findings (locked activity ID reconciliation, active cancellation controls, Unicode names and UUID generation) were corrected and regression-tested. Final PR/CI checks follow.
