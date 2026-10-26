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
