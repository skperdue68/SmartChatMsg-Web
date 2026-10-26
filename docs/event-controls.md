# Event clocks, controls and next occurrence

The original date/time anchors recurrence. **Next occurrence** is a read-only projection of the current form, including unsaved date/time, recurrence and weekday changes. It never silently replaces the anchor. A paused or disabled event still has a calculable next date.

Clock fields use native time inputs and are interpreted in the displayed guild scheduling timezone, not your computer's timezone. Timezone conversion and DST validation happen before saving. Number fields use whole-minute/day values and bounded validation. Hover over a setting for its explanation; accessible descriptions are also supplied.

Events and individual reminder periods each have **Enabled**, **Paused** and **Disabled** states. Pausing or disabling retains messages, selections, usage and cooldown history. The event state controls the entire campaign; an individual period state affects only that period.

## Duration

Optional event duration is measured in minutes after the actual event starts. Repeating invitations and normal reminder windows are capped at that end time. A once-only notice beginning exactly on the end boundary retains its configured delivery grace, allowing an event-ended announcement. The advanced after-event exception permits a deliberately configured brief notice after the end. Leave duration blank to use only the existing reminder windows; 0 treats the start as the event's end.

## Substitutions

When Run at is Scheduled, Insert substitution offers event date/day/time/countdown tokens, offset examples, applicable faction tokens and named important times. They are not offered for On demand or Startup. Previews evaluate them at the selected reminder's simulated clock.

## Important times

Create a named time such as tickets before selecting it as an anchor. You can enter its offset directly or select a date and guild-local clock relative to the next actual occurrence. Date/time selections are saved as offsets, so recurring events carry that important time forward automatically. The interface explains this rather than pretending that an old absolute date repeats forever.

Hosting is configured separately in .env. None of these controls upload SavedVariables to a server or write into ESO's live folders.


## Day timeline

In Schedule overview, select **Day timeline**, or click a date heading in Week/Month view. Each announcement window has its own horizontal row so overlapping periods remain visible. Frequency colors distinguish different repeat intervals; hover a block for its exact bounds and click to edit the event. One-time announcements use diamond markers. Actual events use bordered bars covering their configured event duration (or a marker if no duration is set). Existing channel/state/type filters apply.

The axis uses the guild scheduling timezone and normally covers 24 hours. Daylight-saving transition days show their actual 23 or 25 hours, including the repeated hour. Blocks indicate eligibility, not guaranteed delivery times; login, cooldowns, shared pauses and user confirmation still affect sending.


## Ordering, overlap checks and pool previews

Announcement periods are displayed earliest-first using resolved event-relative dates and clocks. Applying edits reorders the periods without changing their IDs, message pools or runtime history. Manual up/down controls are replaced by chronological ordering. Export keeps the chronological order after merging a newer runtime snapshot.

Within one event, overlapping announcement windows produce a visible warning naming both periods and the conflicting date/time. Apply and timeline imports reject conflicts, and edited conflicting configurations cannot be downloaded. Adjacent windows may share an end/start boundary. Once announcements are checked at their trigger time, not throughout their late allowance. Checks include recurring occurrences over a 400-day cycle, including DST changes; an overly long weekly window can conflict with its next occurrence. Separate events may overlap. Existing imported conflicts remain visible for correction; opening a file does not silently rewrite their times. Configure period timing first, then use Apply reminder to confirm and reorder it.

Clock controls display the timezone beside the input. Hover or keyboard-focus a message-pool checkbox to view the full substituted message using a sample time inside that period (the trigger time for a once notice). The tooltip also shows the original template. Guild Hall is used as the sample player zone; actual ESO-only natural-language parsing and player context may differ. Press Escape to dismiss. If the period cannot be resolved, the original full template is shown instead.

Reminder headings mirror label edits immediately. After Apply reminder reorders a period, the editor scrolls to that same reminder, focuses its label, and preserves expanded reminder/message sections so you can continue editing.


## Import / Export

Use the **Import / Export** tab for sharing. The export list initially shows the selected guild; **Include all guilds in this account** expands it. Select individual items, **Select all**, or **Clear selection**, then **Export selected events**. This creates one `SmartChatMsg-events.json` file. It includes timeline schedules, messages and their period assignments, recurrence/faction/month-final settings, event and period states, output channel, Run at, notification sound, status-panel preference, repeat/retry/cooldown and auto-populate settings. On-demand and startup commands can be shared too. Locked commands and locked messages are excluded, as are account identity, cooldown/usage history and account-wide defaults. Legacy scheduled events must be converted first; full Lua backup remains available regardless.

Choose an import JSON file to review its records before applying anything. The selected **Account** is the destination. Guilds match known SavedVariables guild names, not numbered slots; event commands match names without regard to capitalization. Each item shows **Update**, **Create**, or **Skip**. Choose which available records to import, then click **Import selected events** and confirm. Missing guilds, ambiguous names, locked commands, timezone mismatches and overlapping periods are skipped with an explanation. The browser cannot query live ESO membership: a guild must already be represented in the destination file (settings, named messages or a guild timezone entry).

Existing command IDs and matching message/period IDs are reused. Repeated imports of the same messages do not create duplicates. Local message usage, cooldown/runtime records and locked message content remain. Private message membership in matching announcement periods is retained. Unselected events and unrelated guilds/accounts are unchanged. Import adds/updates; it does not delete local messages omitted from the shared file. After importing, use **Download updated Lua** to create the file to install while ESO is closed.

Older single-event `SmartChatMsgTimeline` JSON files are accepted by the new import review too. The old manual single-event tools and legacy helper consolidation remain under **Advanced: legacy conversion and older single-event tools**, collapsed by default. Opening a full SavedVariables Lua file is separate from importing shared events and does not automatically combine it with another account.

Help uses custom shaded popups via question-mark icons (hover, focus, or click), with no duplicate browser tooltip over the popup. Message pool choices similarly use their full preview popup without a second native tooltip.


## Live effective reminder dates

A small line beneath each reminder heading shows its effective **Starts**, **Stops** and reference **Event** date/time for the next calculated event occurrence. Values use the guild scheduling timezone and its daylight-saving abbreviation. The line updates while editing event dates/clocks, recurrence, day/minute offsets, important-time definitions, one-time late allowance or event duration. It uses the same window calculation as the overview, including duration limits and one-time expiry. Invalid or empty windows show an explanation instead of misleading dates. Applying remains necessary to save edits.

Recurrence intervals must be positive whole numbers (1 or greater). Event duration is optional; when supplied it must be a whole number of zero or greater. These nonnegative controls reject negative typing/paste attempts; invalid zero recurrence values or fractions cannot be applied. Day/minute offsets remain signed so you can schedule before or after an event.


## Drag editing in Day timeline

Drag a block left/right to move it, or drag a visible edge to change its start/stop. Edits snap to five minutes and a floating label shows proposed guild dates/clocks before release. Click without dragging still opens the event editor. Arrow keys move a focused block five minutes; focus an edge and use Arrow keys to resize. Escape cancels an in-progress drag.

The view includes two shaded hours of the previous and next day, with Previous day / Today / Next day navigation. Arrows on clipped blocks indicate that the period continues outside this visible range. A clipped end has no resize handle; navigate to the day containing its real boundary to edit that end. The other visible end can still be resized. Instantaneous once markers move without resizing; once-within-window announcements display as resizable windows.

Actual event bars can move or resize too. Moving an event updates the original recurring anchor rather than replacing it with this week's occurrence. Minute-offset reminders and named important times follow the event; fixed day/clock reminders retain their configured clocks. Resizing the left event edge adjusts its start and duration to keep its stop fixed; resizing the right edge changes duration. A multi-week weekday pattern that cannot represent a cross-week move is rejected with an explanation rather than silently shifting an occurrence into another week.

Dragging a reminder edge bound to an important time makes that edge an independent event offset; it does not move the shared important time used elsewhere. The status message explains this change. Overlaps, reversed windows and event-duration violations are rejected without modifying the saved configuration. Once-within-window eligibility ranges are checked for overlaps throughout the window; a fixed once notice is checked at its trigger only, without treating its retry grace as a repeating window.

**Undo last timeline edit** restores the previous schedule, including its IDs and history. It will not overwrite later edits to the same event. Download the updated Lua when your review is complete.


## Overview defaults and scheduling help

Opening Schedule overview starts with **Day timeline** for today's date in the guild timezone. Switching away and returning restores that default. The day navigation buttons show the actual adjacent weekday/date; Today returns to the current guild date. Week and Month remain available in View.

Reminder badges use plain labels: **One-time notice** means this period sends once per occurrence of the event; **Repeating reminder** means it can prepare messages repeatedly at its configured interval while the period is active. Hover, focus or click a badge to read the explanation. ESO still requires Enter to send prepared text.

**Load latest snapshot** is optional. If ESO wrote a newer copy of the same SavedVariables file while you were editing, select it there before downloading. The editor merges your edits with newer cooldowns and usage; conflicting configuration changes stop the download for review. It does not read ESO automatically. Skip this step if your source file has not changed.

The Important times section now includes a How to use guide, shows each immutable message key and an example token, and gives its date/time controls a full-width row. For key `tickets`, a value of `-30` means 30 minutes before the event; use `-60` for one hour. Apply the definition, select Anchor → Important time for a reminder boundary, or use `%eventwhen:tickets%`, `%eventtime:tickets%`, `%eventdate:tickets%` and `%eventcountdown:tickets%` in messages. A label can change; the token uses the displayed key.


## Latest snapshot: read, merge, then download

Load latest snapshot has no separate help icon; hover or keyboard-focus the button for its explanation. Choosing a file reads a separate browser-memory copy. It does not replace your current editing screen, write to disk, upload the file to the Linux server or install changes into ESO.

The editor retains three versions: the starting file you opened, your working edits, and (optionally) the newest file ESO saved. At Download updated Lua it compares these versions, combines your configuration edits with the latest runtime history, and stops for review if both copies changed the same configuration field incompatibly. The result is a new downloaded file. You manually replace SavedVariables/SmartChatMsg.lua while ESO is closed; the source files remain untouched until you do that.

Use this if you played ESO and it saved newer cooldown/usage data after you began editing. Exit ESO to save its latest data, select that newest file through Load latest snapshot, then download the merged result. If you kept ESO closed and the source file has not changed, skip the snapshot step. The browser does not automatically monitor the SavedVariables folder.

Day navigation is centered independently of Undo. Five-minute snapping and drag instructions appear on a separate line below the date controls.


## Message names and library order

Messages can have an optional short name (up to 60 characters) in the web library. The summary and pool choices update while you type; names never appear in outgoing chat. Unnamed messages display Message 1, Message 2, etc. New messages use the next appropriate default number.

Drag the arrow handle on a message summary to place it before/after another message in the same event. Keyboard users can focus the handle and press Up/Down. Open sections and unsaved message-text drafts remain in place, and the moved message stays visible. The library and message-pool choices share the same display order. This does not change weighted/random message selection.

The optional `name` and `displayOrder` fields are saved with each message, preserved by full Lua download/latest-runtime merge, and included in portable event sharing. Locked messages remain excluded from shared exports, and their local names/order are not overwritten by import. The matching ESO addon changes in PR #34 preserve these fields on startup and through addon text import/export; editing names/order is currently provided by the web editor.

Compatibility audit: previews retain unsupported tokens literally, and monthly weekday projection follows the anchor's ordinal week as the addon does. A future reminder clock that falls into the spring DST gap is skipped on that occurrence without suppressing other valid reminders (addon PR #34 fix).
