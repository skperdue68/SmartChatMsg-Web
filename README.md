# SmartChatMsg Web

A local Node application for editing SmartChatMsg event reminders and viewing promotion schedules. Full scheduling remains available inside the ESO addon; this is an optional larger editor for the same SavedVariables data.

## Development preview

This branch implements the event timeline redesign and requires the matching SmartChatMsg 2.1.0 addon changes. It is under review. Back up your current SavedVariables and use a copy for testing. No code is merged into the addon automatically.

## Run

Requires Node 22 or newer. The server has no runtime package dependencies.

```sh
npm start
```

Open http://127.0.0.1:4173. Set `PORT` to choose another port. The server binds to loopback. Selected SavedVariables stay in your browser and are never uploaded. Exit ESO before replacing a downloaded file; the editor does not write directly into game directories.

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

## Hosting at smartchatmsg.perdues.me

Copy `.env.example` to `.env` in the project folder, then run `npm start`. Existing environment variables take precedence over `.env`. Defaults remain local if no configuration is supplied.

```dotenv
HOST=127.0.0.1
PORT=4173
PUBLIC_ORIGIN=https://smartchatmsg.perdues.me
```

On the same server as your reverse proxy, forward HTTPS requests for `smartchatmsg.perdues.me` to `http://127.0.0.1:4173` and preserve the incoming Host header. Point DNS to that server and configure its HTTPS certificate. Example Nginx location inside your existing HTTPS server block:

```nginx
location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_set_header Host $host;
}
```

If Node runs in a container or the proxy is on another machine, set `HOST=0.0.0.0` and use the reachable service address/port in your proxy. For a direct LAN test, set `PUBLIC_ORIGIN=http://YOUR-SERVER-IP:4173` and open that exact address. Do not use `0.0.0.0` as the browser URL.

The public deployment serves the editor only. SavedVariables remain in each visitor's browser; the server does not accept file uploads, save account data, or expose a write API. Hostnames and Origin headers must match the configured public origin or the local workspace. `.env` is ignored by Git. This application has no account login because it does not store visitor data.

## Migrating a legacy schedule

Open the file and select the account, guild and event. Enter the actual activity date and time at the top of the event editor, review its recurrence and weekday override, and click **Apply event settings**. The highlighted legacy panel offers **Review and convert this event**. Review its periods and selected messages, then confirm. If the old event used several helper commands, select the actual parent event in **Combine & transfer**, select only its related helpers, and review the combined result. Source schedules are archived and backed up, not silently deleted. Load a latest snapshot before export if ESO has updated usage since opening the file. Download the Lua, close ESO, back up the current file and replace it.

## Event weekdays are not advertising weekdays

The optional advanced weekday override chooses which dates count as event occurrences. It never filters the weekdays on which reminders may run. For weekly Tuesday Tours, leave the override off and use a Tuesday event date, or select Tuesday only. A reminder window beginning Monday still runs on Monday. Selecting Tuesday and Thursday schedules two separate event occurrences each eligible week, each with its own reminder windows. Imported selections are preserved; disable the override and Apply event settings if you want to return to the anchor date's weekday.

Only relevant controls are shown: faction settings for faction rotation; repeat intervals for recurring schedules; weekday overrides for supported recurrence types; and frequency, lateness or finish windows according to a reminder's repeat/once configuration.
