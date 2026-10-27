# Monthly Weekday Controls

Approved UI: readable recurrence labels with Monthly on (First, Second, Third, Fourth, Fifth, Last) and Weekday (Sunday–Saturday). Last Sunday must work in four- and five-Sunday months. Event Date remains the starting anchor; monthly interval remains elapsed calendar months.

Shared optional SavedVariables fields: monthlyWeek = 1..5 or LAST, monthlyWeekday = 1..7. Older records infer ordinal and weekday from their anchor, preserving fifth-week skipping. Both clients, nominal projection, rotation/cancellation, cache keys, validation, previews, import/export and native controls must agree. Explicit monthly rule persists when anchor dates change; web inferred legacy rules follow date edits until chosen. Hidden monthly controls cannot overwrite an inactive saved rule.

Validation must resolve reminder clocks against the first actual selected monthly occurrence, not a phantom anchor date. Day drag cannot silently leave an explicit monthly rule. Guild roster work remains in separate PRs.

- [x] Addon projection, normalization, export/import, controls and tests.
- [x] JS model, portability, phantom-anchor correction and tests.
- [x] Web selectors, live previews, help text and browser coverage.
- [x] Full suite, direct cross-client parity and independent review.
- [ ] Publish paired PRs and check CI.

Verified locally: all 100 Node tests, the full browser suite and 51 Lua specs passed. Direct JS/Lua comparison matched 48 monthly occurrences across five schedules. Reviewed fixes include phantom anchor validation/overlap, sparse next occurrence, monthly helper alignment, and original faction/activity rotation anchor preservation.
