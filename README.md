# SmartChatMsg Web

A local Node application for editing SmartChatMsg event reminders and viewing promotion schedules. Full scheduling remains available inside the ESO addon; this is an optional larger editor for the same SavedVariables data.

## Development preview

This branch implements the event timeline redesign and requires the matching SmartChatMsg 2.1.0 addon changes. It is under review. Back up your current SavedVariables and use a copy for testing. No code is merged into the addon automatically.

## Run

Requires Node 22 or newer. The server has no runtime package dependencies.

```sh
npm start
```

Open http://127.0.0.1:4173. Set `PORT` to choose another port. The server binds to loopback. Opening and editing SavedVariables stays in your browser. Only the explicit Save to server action uploads a complete configuration to the public shared library. Exit ESO before replacing a downloaded file; the editor does not write directly into game directories.

See [event controls and next occurrence](docs/event-controls.md) for clocks, tooltips, period states, duration and named deadlines.

## Workflow

1. Open the latest `SmartChatMsg.lua` and select the intended account and guild.
2. Set the real event date/time once. Add repeating reminder windows or time-sensitive one-time announcements, each with selected message variants.
3. Define optional important times, such as ticket sales closing one hour before the event. Message previews simulate the selected period.
4. Review the week/month overview. Windows and intervals illustrate eligibility, not guaranteed sends.
5. Existing schedules can be converted explicitly. Combine selected helper commands only after verifying the parent event time; source settings are backed up and paused.
6. If ESO has saved newer data, load the latest snapshot before export. Configuration conflicts block download. Cooldowns, usage, locked messages, unrelated accounts and unknown fields are preserved.
7. Download the updated Lua, back up the current file, and replace it while ESO is closed. Keep the filename `SmartChatMsg.lua`.

Named important time key `tickets` supports `%eventwhen:tickets%`, `%eventdate:tickets%`, `%eventtime:tickets%`, and `%eventcountdown:tickets%` with the matching addon. ET/CT/MT/PT guild timezone overrides retain wall-clock event settings.

## Tests

```sh
npm install
npm test
npm run test:browser
```

Browser checks use Playwright and synthetic in-memory SavedVariables. Set `BROWSER_PATH` to an installed Chromium-compatible browser, or install Playwright Chromium using `npx playwright install chromium`. No real account data is checked in.

Lua is parsed as restricted data and is never executed. Portable timeline JSON excludes locked messages and runtime history; full-file export preserves your account context and runtime state.

## Hosting at scm.perdues.me

Copy `.env.example` to `.env` in the project folder, then run `npm start`. Existing environment variables take precedence over `.env`. Defaults remain local if no configuration is supplied.

```dotenv
HOST=127.0.0.1
PORT=4173
PUBLIC_ORIGIN=https://scm.perdues.me
```

On the same server as your reverse proxy, forward HTTPS requests for `scm.perdues.me` to `http://127.0.0.1:4173` and preserve the incoming Host header. Point DNS to that server and configure its HTTPS certificate. Example Nginx location inside your existing HTTPS server block:

```nginx
location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_set_header Host $host;
}
```

If Node runs in a container or the proxy is on another machine, set `HOST=0.0.0.0` and use the reachable service address/port in your proxy. For a direct LAN test, set `PUBLIC_ORIGIN=http://YOUR-SERVER-IP:4173` and open that exact address. Do not use `0.0.0.0` as the browser URL.

The public deployment includes an optional shared configuration library without logins. Save to server explicitly uploads the complete Lua configuration, including account names, locked content and runtime history. Anyone using the library can load it. Hostnames and Origin headers must match the configured public origin or the local workspace. `.env` is ignored by Git.

## Migrating a legacy schedule

Open the file and select the account, guild and event. Enter the actual activity date and time at the top of the event editor, review its recurrence and weekday override, and click **Apply event settings**. The highlighted legacy panel offers **Review and convert this event**. Review its periods and selected messages, then confirm. If the old event used several helper commands, select the actual parent event in **Combine & transfer**, select only its related helpers, and review the combined result. Source schedules are archived and backed up, not silently deleted. Load a latest snapshot before export if ESO has updated usage since opening the file. Download the Lua, close ESO, back up the current file and replace it.

## Event weekdays are not advertising weekdays

The optional advanced weekday override chooses which dates count as event occurrences. It never filters the weekdays on which reminders may run. For weekly Tuesday Tours, leave the override off and use a Tuesday event date, or select Tuesday only. A reminder window beginning Monday still runs on Monday. Selecting Tuesday and Thursday schedules two separate event occurrences each eligible week, each with its own reminder windows. Imported selections are preserved; disable the override and Apply event settings if you want to return to the anchor date's weekday.

Only relevant controls are shown: faction settings for faction rotation; repeat intervals for recurring schedules; weekday overrides for supported recurrence types; and frequency, lateness or finish windows according to a reminder's repeat/once configuration.

## Shared server library

Use **Server library** to list saved configurations and click a name to load one, even before opening a local file. **Save to server** saves your applied editor changes under a unique friendly name. Names are case-insensitive; overwrites and deletion are not offered. Use a new name for each revision.

Loading copies the configuration into the editor. **Download updated Lua** includes that configuration plus your applied changes; it never modifies the server copy or ESO files. Full-file loading retains the stored accounts and guilds. To transfer selected events between accounts, use the separate event import/export controls instead.

Save and download use the same validation and latest-snapshot merge, preserving cooldowns and usage. Apply form changes before saving. If ESO has written newer runtime data, load that latest snapshot first; conflicting configuration edits block saving until resolved.

The server stores records in `data/shared-library` by default, excluded from Git. Set `LIBRARY_DIR` in `.env` to change it; relative paths resolve from the server working directory. Keep this directory across deployments and back it up. The systemd service user must be able to write it. Internal `.scm` records contain metadata plus Lua; use the app's download button to obtain the installable `SmartChatMsg.lua`.

Uploads accept Lua files up to 20 MiB. If Nginx Proxy Manager rejects larger uploads, set `client_max_body_size 40m;` in the proxy host's Advanced configuration. After pulling the update, restart your service with `sudo systemctl restart scm-web`. No new runtime dependencies are required.

## Rotating activities

Special pattern **Rotating event** cycles an ordered list of activity names by scheduled occurrence. `%eventactivity%` inserts the selected name. Both activity and faction rotations support cancelling individual dates with Keep rotation moving or Postpone selection, plus Undo. All settings and exceptions are retained in SavedVariables and sharing. See [rotation and cancellation controls](docs/event-controls.md#rotating-event-and-cancellations). This feature requires the matching SmartChatMsg addon update; earlier addon releases do not understand EVENT_ROTATION.

Guild choices also read the addon’s saved guild roster, so an empty account can create or import its first event without an existing message. Run the matching addon update and let ESO save the file first. Guild names/IDs/slots are account-specific runtime metadata and are not replaced by portable event imports.

Monthly weekday recurrence now uses explicit First–Fifth or Last and Sunday–Saturday selectors. For the last Sunday of every month, select Monthly on weekday, Last, Sunday, interval 1. Older numbered-weekday schedules keep their prior behavior. Install the matching addon update before using explicit Last rules.


## Reminder availability and daily limits

Inside a reminder, open **Availability** and enable **Limit when this reminder may run** to choose announcement weekdays, allowed server-clock hours, and an optional maximum announcements per server calendar day. Leave it off to keep existing behavior. This does not change the event recurrence: a Tuesday event can have announcements allowed on Sunday and Monday. The overall promotion start/finish still apply.

For one announcement per day between 7 AM and 10 PM, use a repeating reminder, choose those hours, and set the daily maximum to 1. **Send once** instead means once per whole event occurrence. Counts advance only when you send or the addon recognizes a matching announcement from another player; preparing or timing out a message does not consume an announcement. Counts persist across reloads, and reset at midnight in the schedule's server timezone. Time-sensitive reminders still respect availability and daily limits.

In day view, hatched bands show the overall promotion range and bright bands show allowed hours. Drag or resize a bright band, then choose **Only this date**, **Every weekday**, or **All eligible days**. Date overrides take priority over weekday overrides, which take priority over usual hours. Dashed borders and badges identify overrides; **Reset date** or **Reset weekday** removes that override and inherits the next applicable hours. Undo also restores the previous timeline edit. Changes cannot expand the overall promotion range or enable an excluded weekday.

Hours finishing earlier than they start cross midnight. Overrides belong to the date the window opens, even when editing its continuation after midnight. Daily counts use the actual send date. Daylight saving time follows the configured server timezone. The web overview shows eligibility, not guaranteed sends or a live connection to ESO.

Availability and overrides travel with event exports; recipient daily usage is kept separately. Use the matching addon update before installing files containing availability settings. The addon continues to offer scheduling controls directly; https://scm.perdues.me provides the larger editor.
