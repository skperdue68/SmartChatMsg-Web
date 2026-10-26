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
