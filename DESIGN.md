# Event timeline and companion editor design

Approved direction from the October 26 conversation: retain complete in-game scheduling and add an equivalent optional local Node application in skperdue68/SmartChatMsg-Web. The companion is a separate repository, never a replacement for addon settings.

## Shared event model
One command and guild owns the actual event date, scheduling timezone, recurrence, special pattern, message library, and ordered reminder rows. Each row has a stable ID, label, start/end anchors, interval or once delivery, message IDs, normal/time-sensitive priority, and lateness allowance. Anchors support event offsets, calendar days at a local clock time, and named important times. Existing schedules continue working until explicitly converted. No automatic grouping by similar command names.

## Runtime
Calendar anchors preserve local wall time across DST; offset anchors represent elapsed durations. Occurrence IDs always identify the actual event, including faction rotation and month-final selection. Latest active normal period wins overlapping periods; simultaneous one-time milestones retain separate delivery identities. Changing periods ignores prior-period local cooldowns without deleting history. Peer observations are scoped to event occurrence and reminder identity; normal reminders retain command/guild/channel cooldowns. Time-sensitive rows bypass normal intervals and shared five-minute pacing, but not the initial three-minute startup hold, user chat, or relevant peer duplicate suppression. Expired milestones are skipped; queued or untouched addon-owned drafts expire too. Confirmation, not preparation, completes a once-only reminder. Always require Enter.

## Editors and preservation
In-game and web support the same event/reminder features, previews, message pools and important times. UI follows the approved dark/gold mockup. Web offers week/month schedule overview, frequency windows, milestone markers, filters and overlaps. Display human dates and timezone labels, never stored timestamps. Preview evaluates now inside the chosen row.

Node server binds to loopback by default. Lua files are parsed as restricted data, never executed. Upload is user-selected; preserve unrelated tables/accounts, stable IDs, locks, usage timestamps and cooldown fields. Saving merges configuration changes into an optional latest snapshot; conflict on simultaneous configuration edits instead of silently overwriting. No live ESO writes; download with clear exit-ESO and backup instructions. Account/guild selection is explicit. No account data checked into either repository.

## Migration
Provide an explicit reviewable combination workflow for legacy helper commands. Keep a chosen parent event and true event time. Reassign existing messages while retaining IDs and usage. Retain source configuration as a backup. Never infer new event facts from a command name. Import/export supports timeline configuration and named times with portable guild identity; private locked messages remain local.

## Approaches
Adding fixed phases would preserve legacy UI but fail flexible reminder times. A shared reminder timeline was selected by the user because it keeps a whole event together. Web-only scheduling was rejected: full in-game editing remains required. A separate Node application was explicitly requested.

## Verification
Regression suite plus timing boundaries, DST, recurring actual event timestamps, milestone priority/expiry, duplicate suppression across dynamic text, schema round trips and cooldown-preserving merges. Browser checks at narrow/wide widths; addon UI needs ESO smoke testing. PRs in both repositories; do not merge them automatically.
