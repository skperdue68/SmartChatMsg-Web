# Reminder Availability and Scoped Hours Editing

Approved design: optional per-reminder weekday/hour limits and maximum announcements per server calendar day. Existing reminders unchanged when availability is absent/off. Web editor follows supplied mockup. Day view shows faint promotion range, bright effective hours, hatched blocked hours, cap badge. Drag/resize chooses Only this date, Every <weekday>, or All eligible days. Date and weekday overrides show badges/distinct borders, Reset removes chosen override, usual-hour edits use existing Undo. Priority date > weekday > usual; promotion boundaries and allowed weekdays remain gating.

## Shared schema
Each reminder may have availability={enabled=true|false,weekdays={[1]=true,...},startMinute=420,endMinute=1320,maxPerDay=1,weekdayOverrides={[3]={startMinute=540,endMinute=1380}},dateOverrides={["2026-10-27"]={startMinute=420,endMinute=1380}}}. Days use Sunday1..Saturday7. Missing weekdays=all; explicit empty=none. Start0..1439, end1..1440; midnight finish=1440. Equal non-full-day clocks invalid; full day=0,1440. End<start crosses midnight. Overrides change hours only; they cannot enable excluded weekdays or extend the promotion period. Override date/weekday belongs to the window opening date; overnight continuations retain that origin in labels/scope prompts. Max/day1..1000, absent=unlimited.

Schedule runtime availabilityUsage={['rowId:YYYY-MM-DD']={count=N,lastAt=UTC}} counts confirmed sends and relevant observed peer messages, even when this client/schedule is paused or outside its allowed hours. No count on prepare/timeout/retry. Counts reset by actual server calendar day (not elapsed24h), persist in Lua/latest merge/full saves, excluded from portable sharing. Preserve existing timeline usage and IDs; imported matching rows keep recipient counters. Bootstrap at least one from today's existing lastSentAt/peerAt when no counter exists. Changing hours/reset overrides must not reset counts. Reset-all-cooldowns test command may clear counts explicitly.

Server timezone and DST apply consistently. All-day=midnight to next midnight (23/25h). Missing spring boundary clocks skip that slice; start fold FIRST/end fold SECOND. Existing Send once remains once per entire event occurrence, not once per day; daily maximum is available on repeating reminders for daily announcements. Time-sensitive does not bypass availability/daily caps. No automatic sends; Enter required.

## Model interfaces
Base reminderWindows remains geometry/overall period. effectiveReminderWindows(schedule,eventAtUtc,fromUtc,toUtc,options={}) returns intersecting effective slices (query <=400days), not clipped to query bounds: {row,start,end,eventAtUtc,availabilityDate,availabilityWeekday,availabilitySource:'USUAL'|'WEEKDAY'|'DATE',hours:{startMinute,endMinute},rawStart,rawEnd,baseStart,baseEnd,clipStart,clipEnd}. Off returns old base windows. Availability status/simulation uses effective windows and daily counter; overlap validation compares effective eligible slices rather than disjoint base ranges. Availability-independent geometry validation still rejects invalid overall periods. Expansion must remain bounded, including old/long schedules.

JS exports availabilityForDate(schedule,row,dateKey), availabilityStatus(schedule,row,eventAtUtc,nowUtc), editReminderAvailability(schedule,eventAtUtc,rowId,dateKey,scope,edge,deltaMinutes)->{schedule,notice}, resetReminderAvailability(schedule,rowId,dateKey,scope)->{schedule,notice}. Scopes DATE/WEEKDAY/ALL; reset DATE/WEEKDAY only. Edits preserve daily caps, weekdays, overall period, usage, IDs, other overrides. Moving hours cannot change the window opening date; resizing can finish next day, max24h. Reject invalid ranges/overlaps including selected dates beyond default validation horizon. UI queries only visible calendar range. Default All eligible days changes usual hours and preserves higher-priority overrides; dialog explains this.

## Work and validation
- [x] Native normalization/eligibility/queue/manual/peer/daily counts, settings and reset controls; export/import; local help URL scm.perdues.me; Lua regressions.
- [x] JS effective model/overrides/scoped edit/reset/portable/runtime merge and regressions.
- [x] Web Availability UI, daily-hours calendar styling, scope/reset dialog, Undo and browser regressions; no unrelated panel redesign.
- [x] Independent review, direct JS/Lua parity, full suites, paired PRs.

Review focus: overnight source-date vs send-day count; DST fold/gap; peer outside hours/paused; scope/reset inheritance; clipped edges; same-day counts across restart/import; disjoint effective windows and late overrides; all current non-availability schedules unchanged.


## Verification and review record
Implemented paired native/web availability with date > weekday > usual hours and server-calendar daily limits. Independent review found duplicate-text peer accounting, foreign imported-history bootstrap, ambiguous portable row matching, and fixed-range calendar projection issues; each was corrected with regressions. Empty Until clocks now reject rather than become midnight. Native tests: 52 Lua specification files. Web tests: full Node suite and browser suite, including scoped edits/reset/Undo, blocked weekdays, long promotions, numeric weekday Lua keys, and existing integration coverage.
