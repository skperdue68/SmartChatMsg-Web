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
