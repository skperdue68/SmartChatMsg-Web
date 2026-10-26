import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  parseSavedVariables,
  writeSavedVariables,
  setLuaValue,
} from "../src/lua-data.js";

// These tests use synthetic accounts and intercept every browser request. They do
// not need a listening server, network access, or a personal SavedVariables file.
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = resolve(root, "browser-temp");
await mkdir(temp, { recursive: true });
process.env.TEMP = temp;
process.env.TMP = temp;
const configured =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.BROWSER_PATH;
const windowsChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const executablePath =
  configured ||
  (process.platform === "win32" && existsSync(windowsChrome)
    ? windowsChrome
    : undefined);
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox", "--disable-crash-reporter"],
});
const assets = new Map([
  ["/", ["public/index.html", "text/html"]],
  ["/style.css", ["public/style.css", "text/css"]],
  ["/app.js", ["public/app.js", "text/javascript"]],
  ["/portable.js", ["public/portable.js", "text/javascript"]],
  ["/logo.svg", ["public/logo.svg", "image/svg+xml"]],
  ["/model.js", ["src/model.js", "text/javascript"]],
  ["/lua-data.js", ["src/lua-data.js", "text/javascript"]],
]);
const numeric = (items) => {
  const result = {};
  items.forEach((v, i) => setLuaValue(result, i + 1, v));
  return result;
};
const schedule = () => ({
  timelineVersion: 1,
  mode: "EVENT",
  enabled: true,
  paused: false,
  timeZone: "ET",
  eventDate: "2026-10-27",
  eventTime: "08:00 PM",
  recurrence: "WEEKLY",
  specialPattern: "NONE",
  importantTimes: { tickets: { label: "Tickets close", offsetMinutes: -60 } },
  reminders: numeric([
    {
      id: "row-one",
      label: "Promotion",
      start: { kind: "OFFSET", minutes: -120 },
      finish: { kind: "OFFSET", minutes: 0 },
      once: false,
      timeSensitive: false,
      lateMinutes: 5,
      intervalMinutes: 30,
      messageIds: numeric(["message-one"]),
    },
  ]),
});
function fixture() {
  return {
    Default: {
      "@fixture": {
        $AccountWide: {
          schedulingTimeZone: "ET",
          commands: numeric([{ id: "command-one", name: "Example" }]),
          messages: numeric([
            {
              id: "message-one",
              commandId: "command-one",
              guildName: "alpha",
              guildIndex: 4,
              text: "Hello %guild%",
              lastUsedAt: 123,
              useCount: 5,
            },
          ]),
          chatChannels: { "command-one": { alpha: "Officer" } },
          guildSchedulingTimeZones: {},
          commandGuildSettings: {
            "command-one": {
              alpha: { runAt: "ON_DEMAND", schedule: schedule() },
              beta: { runAt: "SCHEDULED", schedule: schedule() },
            },
          },
        },
      },
      "@other": {
        $AccountWide: {
          commands: {},
          messages: {},
          commandGuildSettings: {},
          keep: "Other account",
        },
      },
    },
  };
}
async function open(data) {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      timezoneId: "UTC",
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.route("**/*", async (route) => {
    const asset = assets.get(new URL(route.request().url()).pathname);
    assert.ok(asset, "Unexpected network request: " + route.request().url());
    await route.fulfill({
      body: await readFile(resolve(root, asset[0])),
      contentType: asset[1],
      headers: {
        "Content-Security-Policy":
          "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'",
      },
    });
  });
  await page.goto("http://localhost:4173/");
  await page
    .locator("#open")
    .setInputFiles({
      name: "SmartChatMsg.lua",
      mimeType: "text/plain",
      buffer: Buffer.from(writeSavedVariables(data)),
    });
  await page.locator("#workspace").waitFor({ state: "visible" });
  return { page, errors };
}
async function downloadData(page) {
  const pending = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await pending,
    stream = await download.createReadStream(),
    chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return parseSavedVariables(Buffer.concat(chunks).toString("utf8"));
}
async function preservationAndEditing() {
  const original = fixture(),
    { page, errors } = await open(original);
  try {
    assert.equal(await page.locator("#account option").count(), 2);
    await page.locator("#account").selectOption("@other");
    assert.match(
      await page.locator("#detail").textContent(),
      /Choose a guild event/,
    );
    await page.locator("#account").selectOption("@fixture");
    await page.locator("[data-view=calendar]").click();
    assert.equal(
      await page.locator("[data-kind=event]").count(),
      0,
      "on demand is excluded from active scheduled overview",
    );
    await page.locator("[data-field=state]").selectOption("all");
    await page.locator("[data-field=date]").fill("2026-10-27");
    await page.locator("[data-field=date]").dispatchEvent("change");
    assert.match(
      await page
        .locator('[data-date="2026-10-27"] [data-kind=event] small')
        .last()
        .textContent(),
      /8:00 PM EDT/,
    );
    await page.locator("[data-field=date]").fill("2026-11-17");
    await page.locator("[data-field=date]").dispatchEvent("change");
    assert.match(
      await page
        .locator('[data-date="2026-11-17"] [data-kind=event] small')
        .last()
        .textContent(),
      /8:00 PM EST/,
    );
    await page.locator("[data-view=editor]").click();
    await page.locator("[data-field=outputChannel]").selectOption("Group");
    await page.locator("#save-event").click();
    assert.equal(
      await page.locator("[data-field=settingsRunAt]").inputValue(),
      "ON_DEMAND",
    );
    await page.locator("#guild-timezone").selectOption("PT");
    assert.equal(
      await page.locator("input[readonly]").first().inputValue(),
      "PT",
    );
    await page.locator("#add-message").click();
    assert.equal(await page.locator("details.message").count(), 2);
    const message = page.locator("details.message").last();
    await message.locator("summary").click();
    await message.locator("textarea").fill("Tickets: ");
    await message
      .locator("[data-insert-token]")
      .selectOption("%eventtime:tickets%");
    await message.locator("[data-action=save-message]").click();
    const row = page.locator(".reminder").first();
    await row.locator("[data-message]").first().uncheck();
    await row.locator("[data-message]").last().check();
    await row.locator("[data-action=save]").click();
    assert.equal(await row.locator("[data-message]:checked").count(), 1);
    await row.locator("[data-action=preview]").click();
    assert.match(await page.locator("#simulate-status").textContent(), /READY/);
    assert.doesNotMatch(
      await page.locator("#simulate-messages").textContent(),
      /%eventtime:tickets%/,
    );
    await page.locator("#close-dialog").click();
    await page.locator("[data-view=calendar]").click();
    assert.equal(await page.locator(".calendar-day").count(), 7);
    await page.locator("[data-field=date]").fill("2026-10-27");
    await page.locator("[data-field=date]").dispatchEvent("change");
    assert.match(
      await page
        .locator('[data-date="2026-10-27"] [data-kind=event] small')
        .last()
        .textContent(),
      /8:00 PM PDT/,
    );
    await page.locator("[data-field=view]").selectOption("month");
    assert.ok((await page.locator(".calendar-day").count()) >= 28);
    await page.locator("[data-view=editor]").click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const latest = fixture();
    latest.Default["@fixture"].$AccountWide.messages[1].lastUsedAt = 999;
    await page
      .locator("#latest")
      .setInputFiles({
        name: "latest.lua",
        mimeType: "text/plain",
        buffer: Buffer.from(writeSavedVariables(latest)),
      });
    const saved = await downloadData(page),
      a = saved.Default["@fixture"].$AccountWide;
    assert.equal(a.chatChannels["command-one"].alpha, "Group");
    assert.equal(
      a.commandGuildSettings["command-one"].alpha.runAt,
      "ON_DEMAND",
    );
    assert.equal(
      a.commandGuildSettings["command-one"].alpha.schedule.timeZone,
      "PT",
    );
    assert.equal(
      a.commandGuildSettings["command-one"].beta.schedule.timeZone,
      "ET",
    );
    assert.equal(a.messages[1].lastUsedAt, 999);
    assert.equal(saved.Default["@other"].$AccountWide.keep, "Other account");
    const added = Object.values(a.messages).find((m) => m.id !== "message-one");
    assert.equal(added.guildIndex, 4);
    assert.equal(added.text, "Tickets: %eventtime:tickets%");
    assert.deepEqual(
      Object.values(
        a.commandGuildSettings["command-one"].alpha.schedule.reminders[1]
          .messageIds,
      ),
      [added.id],
    );
    await page.locator("details.message").last().locator("summary").click();
    await page.locator("[data-action=delete-message]").last().click();
    assert.equal(await page.locator("details.message").count(), 1);
    const removed = (await downloadData(page)).Default["@fixture"].$AccountWide;
    assert.equal(Object.keys(removed.messages).length, 1);
    assert.equal(
      Object.keys(
        removed.commandGuildSettings["command-one"].alpha.schedule.reminders[1]
          .messageIds,
      ).length,
      0,
    );
    const conflict = fixture();
    conflict.Default["@fixture"].$AccountWide.chatChannels[
      "command-one"
    ].alpha = "Zone";
    await page
      .locator("#latest")
      .setInputFiles({
        name: "conflicting.lua",
        mimeType: "text/plain",
        buffer: Buffer.from(writeSavedVariables(conflict)),
      });
    await page.locator("#export").click();
    await page.locator("#dialog").waitFor({ state: "visible" });
    assert.match(
      await page.locator("#dialog-body").textContent(),
      /Configuration conflicts/,
    );
    await page.locator("#close-dialog").click();
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}
async function combination() {
  const d = fixture(),
    a = d.Default["@fixture"].$AccountWide;
  a.commands = numeric([
    { id: "parent", name: "Tuesday event" },
    { id: "helper", name: "Monday helper" },
  ]);
  a.messages = numeric([
    {
      id: "helper-message",
      commandId: "helper",
      guildName: "alpha",
      guildIndex: 4,
      text: "Tour %eventtime+24h%",
      lastUsedAt: 123,
      useCount: 5,
    },
  ]);
  a.commandGuildSettings = {
    parent: {
      alpha: {
        runAt: "SCHEDULED",
        schedule: {
          mode: "EVENT",
          timeZone: "ET",
          eventDate: "2026-10-27",
          eventTime: "08:00 PM",
          startDate: "2026-10-27",
          startTime: "08:00 PM",
          endDate: "2026-10-27",
          endTime: "10:00 PM",
          recurrence: "WEEKLY",
          intervalMinutes: 60,
          specialPattern: "NONE",
        },
      },
    },
    helper: {
      alpha: {
        runAt: "SCHEDULED",
        schedule: {
          mode: "WINDOW",
          timeZone: "ET",
          startDate: "2026-10-05",
          startTime: "08:00 PM",
          endDate: "2026-10-06",
          endTime: "08:00 PM",
          recurrence: "WEEKLY",
          intervalMinutes: 60,
          specialPattern: "NONE",
        },
      },
    },
  };
  const { page, errors } = await open(d);
  try {
    await page.locator("[data-view=transfer]").click();
    await page.locator("#sources").selectOption(["helper"]);
    await page.locator("#review-combine").click();
    await page.locator("[data-view=editor]").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".reminder").length >= 2,
    );
    await page.locator("[data-action=preview]").last().click();
    await page.locator("#simulate-status").waitFor();
    await page.locator("#close-dialog").click();
    const saved = (await downloadData(page)).Default["@fixture"].$AccountWide,
      m = saved.messages[1];
    assert.equal(m.id, "helper-message");
    assert.equal(m.commandId, "parent");
    assert.equal(m.text, "Tour %eventtime%");
    assert.equal(m.lastUsedAt, 123);
    assert.equal(m.useCount, 5);
    assert.equal(saved.commandGuildSettings.helper.alpha.schedule.paused, true);
    assert.equal(
      saved.commandGuildSettings.helper.alpha.schedule.mergedInto,
      "parent",
    );
    assert.ok(
      saved.commandGuildSettings.parent.alpha.schedule.legacyTimelineBackup
        .merged.helper,
    );
    assert.equal(await page.locator(".event-item").count(), 1);
    await page.locator("#show-combined").check();
    assert.equal(await page.locator(".event-item").count(), 2);
    const helperRow = Object.values(
      saved.commandGuildSettings.parent.alpha.schedule.reminders,
    ).find((r) => r.label.includes("Monday helper"));
    assert.equal(helperRow.start.kind, "DAY");
    assert.equal(helperRow.start.days, -1);
    assert.equal(helperRow.finish.days, 0);
    assert.deepEqual(Object.values(helperRow.messageIds), ["helper-message"]);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}
async function combinationRejection() {
  for (const reason of ["channel", "recurrence"]) {
    const d = fixture(),
      a = d.Default["@fixture"].$AccountWide;
    a.commands = numeric([
      { id: "parent", name: "Parent" },
      { id: "helper", name: "Helper" },
    ]);
    a.messages = {};
    const p = {
      mode: "EVENT",
      timeZone: "ET",
      eventDate: "2026-10-27",
      eventTime: "08:00 PM",
      startDate: "2026-10-27",
      startTime: "08:00 PM",
      endDate: "2026-10-27",
      endTime: "10:00 PM",
      recurrence: "WEEKLY",
      intervalMinutes: 60,
    };
    a.commandGuildSettings = {
      parent: { alpha: { runAt: "SCHEDULED", schedule: p } },
      helper: {
        alpha: {
          runAt: "SCHEDULED",
          schedule: {
            ...p,
            recurrence: reason === "recurrence" ? "DAILY" : "WEEKLY",
          },
        },
      },
    };
    a.chatChannels = {
      parent: { alpha: "Guild" },
      helper: { alpha: reason === "channel" ? "Officer" : "Guild" },
    };
    const { page, errors } = await open(d);
    try {
      await page.locator("[data-view=transfer]").click();
      await page.locator("#sources").selectOption(["helper"]);
      await page.locator("#review-combine").click();
      assert.match(
        await page.locator("#status").textContent(),
        reason === "channel" ? /channels differ/ : /Recurrence rules differ/,
      );
      const saved = (await downloadData(page)).Default["@fixture"].$AccountWide;
      assert.equal(
        saved.commandGuildSettings.parent.alpha.schedule.timelineVersion,
        undefined,
      );
      assert.equal(
        saved.commandGuildSettings.helper.alpha.schedule.mergedInto,
        undefined,
      );
      assert.equal(
        saved.commandGuildSettings.helper.alpha.schedule.paused,
        undefined,
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
}
async function lockedPortablePrivacy() {
  const d = fixture();
  d.Default["@fixture"].$AccountWide.messages[1].locked = true;
  const { page, errors } = await open(d);
  try {
    await page.locator("details.message summary").click();
    assert.equal(
      await page.locator("details.message textarea").getAttribute("readonly"),
      "",
    );
    assert.equal(
      await page.locator("[data-action=delete-message]").isDisabled(),
      true,
    );
    assert.equal(
      await page.locator("[data-action=save-message]").isDisabled(),
      true,
    );
    await page.locator("[data-view=transfer]").click();
    const pending = page.waitForEvent("download");
    await page.locator("#portable-export").click();
    const stream = await (await pending).createReadStream(),
      chunks = [];
    for await (const c of stream) chunks.push(c);
    const portable = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(portable.messages.length, 0);
    assert.deepEqual(
      Object.values(portable.schedule.reminders[1].messageIds),
      [],
    );
    assert.equal(JSON.stringify(portable).includes("lastUsedAt"), false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}
async function legacyMessageIsolation() {
  const d = fixture(),
    a = d.Default["@fixture"].$AccountWide;
  a.messages = numeric([
    {
      id: "alpha-map",
      commandId: "mapping",
      guildName: "alpha",
      guildIndex: 1,
      text: "Mapping A",
    },
    {
      id: "beta-map",
      commandId: "mapping",
      guildName: "beta",
      guildIndex: 2,
      text: "Mapping B",
    },
    {
      id: "legacy-alpha",
      commandId: "command-one",
      guildIndex: 1,
      text: "Alpha legacy only",
    },
    {
      id: "legacy-beta",
      commandId: "command-one",
      guildIndex: 2,
      text: "Beta legacy only",
    },
  ]);
  const { page, errors } = await open(d);
  try {
    assert.equal(await page.locator("details.message").count(), 1);
    assert.match(
      await page.locator("details.message").textContent(),
      /Alpha legacy only/,
    );
    assert.doesNotMatch(
      await page.locator("#detail").textContent(),
      /Beta legacy only/,
    );
    await page.locator("#guild").selectOption("beta");
    assert.equal(await page.locator("details.message").count(), 1);
    assert.match(
      await page.locator("details.message").textContent(),
      /Beta legacy only/,
    );
    await page.locator("#guild").selectOption("alpha");
    await page.locator("details.message summary").click();
    await page.locator("[data-action=delete-message]").click();
    const saved = (await downloadData(page)).Default["@fixture"].$AccountWide;
    assert.ok(
      Object.values(saved.messages).some((m) => m.id === "legacy-beta"),
    );
    assert.ok(
      !Object.values(saved.messages).some((m) => m.id === "legacy-alpha"),
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
  const unknown = fixture();
  unknown.Default["@fixture"].$AccountWide.messages = numeric([
    {
      id: "unknown",
      commandId: "command-one",
      guildIndex: 3,
      text: "Unresolved legacy message",
    },
  ]);
  const second = await open(unknown);
  try {
    assert.equal(await second.page.locator("details.message").count(), 0);
    assert.match(
      await second.page.locator("[role=alert]").textContent(),
      /cannot be resolved/,
    );
    const saved = await downloadData(second.page);
    assert.equal(
      saved.Default["@fixture"].$AccountWide.messages[1].id,
      "unknown",
    );
    assert.deepEqual(second.errors, []);
  } finally {
    await second.page.close();
  }
}
async function validationAndWeekdays() {
  const { page, errors } = await open(fixture());
  try {
    const row = page.locator(".reminder").first();
    await row.locator("[data-field=lateMinutes]").fill("0");
    await row.locator("[data-action=save]").click();
    assert.match(
      await page.locator("#status").textContent(),
      /lateness|late allowance/i,
    );
    await row.locator("[data-field=lateMinutes]").fill("5");
    await row.locator("[data-field=intervalMinutes]").fill("1.5");
    await row.locator("[data-action=save]").click();
    assert.match(await page.locator("#status").textContent(), /whole/);
    await row.locator("[data-action=remove]").click();
    await page.locator("#export").click();
    assert.match(await page.locator("#status").textContent(), /one and 100/);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
  const d = fixture();
  setLuaValue(
    (d.Default["@fixture"].$AccountWide.commandGuildSettings[
      "command-one"
    ].alpha.schedule.weekdays = {}),
    3,
    true,
  );
  const next = await open(d);
  try {
    await next.page.locator("[data-view=transfer]").click();
    let pending = next.page.waitForEvent("download");
    await next.page.locator("#portable-export").click();
    let stream = await (await pending).createReadStream(),
      chunks = [];
    for await (const c of stream) chunks.push(c);
    const portable = Buffer.concat(chunks);
    await next.page
      .locator("#portable-import")
      .setInputFiles({
        name: "timeline.json",
        mimeType: "application/json",
        buffer: portable,
      });
    const saved = writeSavedVariables(await downloadData(next.page));
    assert.match(saved, /\[3\] = true/);
    assert.doesNotMatch(saved, /\["3"\] = true/);
    assert.deepEqual(next.errors, []);
  } finally {
    await next.page.close();
  }
}
async function rawWindowParentConversion() {
  for(const applyFirst of [true,false]) {
    const d=fixture(),a=d.Default['@fixture'].$AccountWide;
    a.commandGuildSettings['command-one'].alpha={runAt:'SCHEDULED',schedule:{mode:'WINDOW',enabled:true,paused:false,timeZone:'ET',startDate:'2026-10-26',startTime:'08:00 PM',endDate:'2026-10-27',endTime:'01:00 PM',recurrence:'WEEKLY',intervalMinutes:60,specialPattern:'NONE'}};
    a.messages[1].text='Tours %eventtime+24h% / %eventdate+24h%';
    const {page,errors}=await open(d);
    try {
      await page.locator('[data-field=eventDate]').fill('2026-10-27');
      await page.locator('[data-field=eventTime]').fill('08:00 PM');
      if(applyFirst)await page.locator('#save-event').click();
      await page.locator('#convert-legacy').click();
      assert.doesNotMatch(await page.locator('#status').textContent(),/stopped/i);
      await page.waitForFunction(()=>document.querySelectorAll('.reminder').length>0);
      const saved=(await downloadData(page)).Default['@fixture'].$AccountWide;
      const schedule=saved.commandGuildSettings['command-one'].alpha.schedule,row=Object.values(schedule.reminders)[0];
      assert.equal(schedule.eventDate,'2026-10-27');assert.equal(schedule.eventTime,'08:00 PM');
      assert.equal(row.start.kind,'DAY');assert.equal(row.start.days,-1);assert.equal(row.start.time,'08:00 PM');
      assert.equal(row.finish.days,0);assert.equal(row.finish.time,'01:00 PM');
      assert.equal(saved.messages[1].text,'Tours %eventtime% / %eventdate%');
      assert.equal(saved.messages[1].id,'message-one');assert.equal(saved.messages[1].lastUsedAt,123);
      assert.equal(schedule.legacyTimelineBackup.mode,'WINDOW');assert.equal(schedule.legacyTimelineBackup.messageTexts['message-one'],'Tours %eventtime+24h% / %eventdate+24h%');assert.deepEqual(errors,[]);
    }finally{await page.close();}
  }
}

try {
  await preservationAndEditing();
  await combination();
  await lockedPortablePrivacy();
  await legacyMessageIsolation();
  await validationAndWeekdays();
  await combinationRejection();
  await rawWindowParentConversion();
  console.log(
    "Browser checks passed: account/channel/run-mode preservation, guild timezone scope, latest-runtime merge/conflicts, locked portable privacy, message/pool editing and deletion, named preview, guild timezone/DST calendar with UTC browser, mobile, isolated legacy guild slots, validation/weekday keys, incompatible combination rejection, legacy combination and raw WINDOW parent actual-time/token alignment.",
  );
} finally {
  await browser.close();
}
