import assert from "node:assert/strict";
import * as model from "../src/model.js";
import { readFile, mkdir, mkdtemp, readdir, unlink, rmdir } from "node:fs/promises";
import { createServer } from "../src/server.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  parseSavedVariables,
  writeSavedVariables,
  setLuaValue,
} from "../src/lua-data.js";

// Tests use synthetic accounts. Most intercept browser requests; the shared-library
// integration test uses a temporary loopback server and disposable storage. No real account files are used.
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
              alpha: { runAt: "SCHEDULED", schedule: schedule() },
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
  const original = fixture();original.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.runAt='ON_DEMAND';
  const { page, errors } = await open(original);
  try {
    assert.equal(await page.locator("#account option").count(), 2);
    await page.locator("#account").selectOption("@other");
    assert.match(
      await page.locator("#detail").textContent(),
      /Choose a guild event/,
    );
    await page.locator("#account").selectOption("@fixture");
    await page.locator("[data-view=calendar]").click();
    await page.locator("[data-field=view]").selectOption("week");
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
      await page.locator('label').filter({hasText:'Scheduling timezone (guild)'}).locator('input').inputValue(),
      "PT",
    );
    await page.locator("[data-field=settingsRunAt]").selectOption("SCHEDULED");await page.locator("#save-event").click();
  await page.locator("#add-message").click();
    assert.equal(await page.locator("details.message").count(), 2);
    const message = page.locator("details.message").last();
    await message.locator("textarea").waitFor({state:"visible"});
    assert.equal(await message.evaluate(el=>el.open),true);
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
    await page.locator("[data-field=view]").selectOption("week");assert.equal(await page.locator(".calendar-day").count(), 7);
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
    await page.locator("[data-field=settingsRunAt]").selectOption("ON_DEMAND");await page.locator("#save-event").click();
  const latest = fixture();latest.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.runAt='ON_DEMAND';
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
    await page.locator("details.message").last().evaluate(el=>el.open=true);
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
    await page.locator("[data-view=transfer]").click();await page.locator("#legacy-transfer").evaluate(el=>el.open=true);
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
      await page.locator("[data-view=transfer]").click();await page.locator("#legacy-transfer").evaluate(el=>el.open=true);
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
    await page.locator("[data-view=transfer]").click();await page.locator("#legacy-transfer").evaluate(el=>el.open=true);
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
      await second.page.locator("[role=alert]:visible").textContent(),
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
    await row.locator("[data-field=once]").check();
    await row.locator("[data-field=lateMinutes]").fill("0");
    await row.locator("[data-action=save]").click();
    assert.match(
      await page.locator("#status").textContent(),
      /lateness|late allowance/i,
    );
    await row.locator("[data-field=lateMinutes]").fill("5");
    await row.locator("[data-field=once]").uncheck();
    await row.locator("[data-field=intervalMinutes]").fill("1.5");
    await row.locator("[data-action=save]").click();
    assert.match(await page.locator("#status").textContent(), /whole/);
    await row.locator("[data-action=remove]").click();
    await page.locator("#export").click();
    assert.match(await page.locator("#status").textContent(), /no reminders.*add.*reminder/i);
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
    await next.page.locator("[data-view=transfer]").click();await next.page.locator("#legacy-transfer").evaluate(el=>el.open=true);
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
      await page.locator('[data-field=eventTime]').fill('20:00');
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

async function relevantSettingsAndMigration() {
 const d=fixture();const a=d.Default['@fixture'].$AccountWide;
 a.commandGuildSettings['command-one'].alpha.runAt='SCHEDULED';
 const {page,errors}=await open(d);
 try {
  assert.equal(await page.locator('[data-field=rotationWeeks]').isVisible(),false,'faction controls start hidden');
  await page.locator('details.message summary').first().click();
  assert.equal(await page.locator('.message [data-field=variant]').first().isVisible(),false,'message variants are hidden without a special pattern');
  assert.equal(await page.locator('[data-weekday]').first().isVisible(),false,'default weekday override starts collapsed');
  await page.locator('#weekday-options summary').click();
  await page.locator('#use-event-weekdays').check();
  await page.locator('[data-weekday="3"]').check();
  assert.match(await page.locator('#weekday-explanation').textContent(),/event.*not.*reminder|reminder.*any day/i);
  await page.locator('[data-field=recurrence]').first().selectOption('MONTHLY_DATE');
  assert.equal(await page.locator('#weekday-options').isVisible(),false);
  await page.locator('[data-field=recurrence]').first().selectOption('WEEKLY');
  await page.locator('[data-field=specialPattern]').selectOption('FACTION_ROTATION');
  assert.equal(await page.locator('[data-field=rotationWeeks]').isVisible(),true);
  assert.equal(await page.locator('.message [data-field=variant]').first().isVisible(),true);
  assert.equal(await page.locator('.message [data-field=variant]').first().locator('option[value=FINAL]').count(),0,'month-final variants are not offered for faction rotation');
  await page.locator('[data-field=recurrence]').first().selectOption('NONE');
  assert.equal(await page.locator('[data-field=specialPattern]').isVisible(),false);
  assert.equal(await page.locator('[data-field=recurrenceInterval]').isVisible(),false);
  const row=page.locator('.reminder').first();
  assert.equal(await row.locator('[data-field=lateMinutes]').isVisible(),false);
  await row.locator('[data-field=once]').check();
  assert.equal(await row.locator('[data-field=intervalMinutes]').isVisible(),false);
  assert.equal(await row.locator('[data-field=lateMinutes]').isVisible(),true);
  assert.equal(await row.locator('[data-field="finish.kind"]').isVisible(),false);
  await row.locator('[data-field=onceUntilFinish]').check();
  assert.equal(await row.locator('[data-field="finish.kind"]').isVisible(),true);
  assert.equal(await row.locator('[data-field=lateMinutes]').isVisible(),false);
  assert.deepEqual(errors,[]);
 }finally{await page.close();}
 const allDays=fixture();const chosen=allDays.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;chosen.weekdays={};for(let day=1;day<=7;day++)setLuaValue(chosen.weekdays,day,true);
 const repeated=await open(allDays);
 try{const page=repeated.page;assert.equal(await page.locator('[data-weekday]:checked').count(),7);assert.match(await page.locator('#weekday-explanation').textContent(),/All seven selected/);await page.locator('#use-event-weekdays').uncheck();await page.locator('#save-event').click();const saved=await downloadData(page);assert.equal(Object.keys(saved.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule.weekdays).length,0,'explicitly disabling override follows anchor weekday');}finally{await repeated.page.close();}
 const legacy=fixture();delete legacy.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule.timelineVersion;
 const loaded=await open(legacy);
 try{assert.equal(await loaded.page.locator('#migration-panel').isVisible(),true);assert.equal(await loaded.page.locator('#convert-legacy').isVisible(),true);assert.match(await loaded.page.locator('#migration-panel').textContent(),/actual event date/i);}finally{await loaded.page.close();}
}

async function clocksOccurrenceStatesAndHelp(){
 const d=fixture();d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule.timelineUsage={historic:{lastSentAt:111,nextDueAt:222}};
 const {page,errors}=await open(d);
 try{
 await page.clock.setFixedTime(new Date('2026-11-01T12:00:00Z'));
 assert.equal(await page.locator('[data-field=eventTime]').getAttribute('type'),'time');
 assert.equal(await page.locator('[data-field=eventTime]').getAttribute('title'),null);assert.ok(await page.locator('[data-field=eventTime]').getAttribute('aria-description'));
 await page.locator('[data-field=eventDate]').fill('2026-10-30');await page.locator('[data-field=eventTime]').fill('20:00');
 assert.match(await page.locator('#next-occurrence').inputValue(),/Nov 6, 2026/);assert.notEqual(await page.locator('#next-occurrence').getAttribute('readonly'),null);
 await page.locator('[data-field=eventDate]').fill('2026-10-31');assert.match(await page.locator('#next-occurrence').inputValue(),/Nov 7, 2026/);await page.locator('[data-field=eventDate]').fill('2026-10-30');
 await page.locator('details.message summary').first().click();assert.equal(await page.locator('[data-insert-token] option[value="%eventtime%"]').count(),1,'scheduled mode offers event tokens');
 await page.locator('[data-field=settingsRunAt]').selectOption('SCHEDULED');await page.locator('[data-field=eventDurationMinutes]').fill('120');await page.locator('[data-field=eventState]').selectOption('PAUSED');await page.locator('#save-event').click();
 await page.locator('details.message summary').first().click();assert.equal(await page.locator('[data-insert-token] option[value="%eventtime-1h%"]').count(),1);
 const row=page.locator('.reminder').first();await row.locator('[data-field=rowState]').selectOption('DISABLED');await row.locator('[data-action=save]').click();
 const mark=page.locator('.mark').first();await mark.locator('[data-field=markMode]').selectOption('DATE');await mark.locator('[data-field=markDate]').fill('2026-11-06');await mark.locator('[data-field=markTime]').fill('19:00');await mark.locator('[data-action=save-mark]').click();
 const saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;
 assert.equal(saved.eventDate,'2026-10-30','projection never changes anchor');assert.equal(saved.eventTime,'08:00 PM');assert.equal(saved.eventDurationMinutes,120);assert.equal(saved.paused,true);assert.equal(saved.enabled,true);assert.equal(saved.reminders[1].enabled,false);assert.equal(saved.importantTimes.tickets.offsetMinutes,-60);assert.equal(saved.timelineUsage.historic.lastSentAt,111);await page.locator('[data-field=eventDurationMinutes]').fill('');await page.locator('#save-event').click();const uncapped=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;assert.equal(uncapped.eventDurationMinutes,undefined);assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function dayTimeline(){
 const d=fixture(),cfg=d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha;
 cfg.runAt='SCHEDULED';cfg.schedule.eventDurationMinutes=120;
 cfg.schedule.reminders=numeric([
 {...cfg.schedule.reminders[1],finish:{kind:'OFFSET',minutes:-60},intervalMinutes:60},
 {...cfg.schedule.reminders[1],id:'row-two',label:'Closer promotion',start:{kind:'OFFSET',minutes:-60},intervalMinutes:30}
 ]);
 const {page,errors}=await open(d);
 try{
 await page.locator('[data-view=calendar]').click();
 await page.locator('#calendar [data-field=date]').fill('2026-10-27');
 await page.locator('#calendar [data-field=date]').dispatchEvent('change');
 await page.locator('#calendar [data-field=view]').selectOption('day');
 assert.equal(await page.locator('.day-hour').count(),28);
 assert.equal(await page.locator('.day-block').count(),3);
 assert.equal(await page.locator('.day-actual-event').count(),1);
 assert.match(await page.locator('.day-actual-event').getAttribute('title'),/8:00 PM.*10:00 PM/);
 const colors=await page.locator('.day-block:not(.day-actual-event)').evaluateAll(xs=>xs.map(x=>x.style.background));assert.notEqual(colors[0],colors[1]);
 await page.locator('#calendar [data-field=date]').fill('2026-11-01');await page.locator('#calendar [data-field=date]').dispatchEvent('change');
 assert.equal(await page.locator('.day-hour').count(),29,'fall DST day plus context has 29 actual hours');
 await page.locator('#calendar [data-field=date]').fill('2026-10-27');await page.locator('#calendar [data-field=date]').dispatchEvent('change');
 await page.locator('.day-actual-event').click();assert.equal(await page.locator('#editor').isVisible(),true);assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function populatedAccountDefault(){
 const d=fixture();d.Default={'@empty':{$AccountWide:{commands:{},messages:{},commandGuildSettings:{}}},...d.Default};
 const {page,errors}=await open(d);
 try{
 assert.equal(await page.locator('#account').inputValue(),'@fixture','prefer saved event data over an empty first account');
 assert.equal(await page.locator('#guild option[value=alpha]').count(),1);
 await page.locator('#account').selectOption('@empty');assert.equal(await page.locator('#guild option[value=alpha]').count(),0);
 await page.locator('#account').selectOption('@fixture');assert.equal(await page.locator('#guild option[value=alpha]').count(),1);
 const saved=await downloadData(page);assert.deepEqual(saved,parseSavedVariables(writeSavedVariables(d)),'account selection must not change saved data');assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function overlapCardHighlights(){
 const d=fixture(),cfg=d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha,s=cfg.schedule;cfg.runAt='SCHEDULED';
 s.importantTimes.tickets.offsetMinutes=-90;
 const first=s.reminders[1];first.label='Early reminder';first.finish.minutes=-60;
 s.reminders=numeric([first,{...first,id:'second',label:'Later reminder',start:{kind:'MARK',name:'tickets'},finish:{kind:'OFFSET',minutes:0}},{...first,id:'third',label:'Unrelated reminder',start:{kind:'OFFSET',minutes:60},finish:{kind:'OFFSET',minutes:120}}]);
 const {page,errors}=await open(d);
 try{
 assert.equal(await page.locator('.reminder.has-overlap').count(),2,'both conflicting reminder cards are highlighted on load');assert.equal(await page.locator('.reminder[data-row=third].has-overlap').count(),0);
 const early=page.locator('.reminder[data-row=row-one]'),later=page.locator('.reminder[data-row=second]');
 assert.match(await early.locator('[data-overlap-warning]').textContent(),/Later reminder/);assert.match(await later.locator('[data-overlap-warning]').textContent(),/Early reminder/);
 await later.locator('[data-field=label]').fill('Renamed later reminder');assert.match(await early.locator('[data-overlap-warning]').textContent(),/Renamed later reminder/);
 await page.locator('.mark [data-field=offsetMinutes]').fill('-60');assert.equal(await page.locator('.reminder.has-overlap').count(),0,'resolving an important-time overlap clears both cards live');assert.equal(await page.locator('[data-overlap-warning]:visible').count(),0);
 await early.locator('[data-field="finish.minutes"]').fill('-30');assert.equal(await page.locator('.reminder.has-overlap').count(),2);assert.equal(await early.locator('[data-field="finish.minutes"]').evaluate(el=>el===document.activeElement),true,'highlighting preserves editing focus');
 await early.locator('[data-field="finish.minutes"]').fill('-60');assert.equal(await page.locator('.reminder.has-overlap').count(),0);assert.deepEqual(errors,[]);
 }finally{await page.close();}
 const repeated=fixture(),c=repeated.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha;c.runAt='SCHEDULED';c.schedule.reminders[1].start.minutes=-8*1440;
 const other=await open(repeated);
 try{assert.equal(await other.page.locator('.reminder.has-overlap').count(),1);assert.match(await other.page.locator('[data-overlap-warning]').textContent(),/another occurrence/i);assert.deepEqual(other.errors,[]);}finally{await other.page.close();}
}

async function timelineOrderingAndPoolPreview(){
 const d=fixture(),cfg=d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha;cfg.runAt='SCHEDULED';
 const one=cfg.schedule.reminders[1];one.label='First';one.finish.minutes=-60;
 cfg.schedule.reminders=numeric([one,{...one,id:'row-two',label:'Second',start:{kind:'OFFSET',minutes:-60},finish:{kind:'OFFSET',minutes:0}}]);
 d.Default['@fixture'].$AccountWide.messages[1].text='Meet %guild% %eventwhen% at %eventtime% (%eventcountdown%).';
 const {page,errors}=await open(d);
 try{
 assert.equal(await page.locator('[data-field=eventTime]').locator('..').getAttribute('class'),'clock-control');
 assert.equal(await page.locator('.clock-control .clock-zone').first().textContent(),'ET');
 assert.equal(await page.locator('.readonly-tag').count(),0);
 assert.equal(await page.locator('[data-field=eventTime]').locator('xpath=ancestor::label').locator('.field-caption .help-icon').count(),1);
 assert.equal(await page.locator('#detail [data-help][title]').count(),0);
 const hint=page.locator('[data-field=eventTime]').locator('xpath=ancestor::label').locator('.help-icon');await hint.focus();assert.equal(await hint.locator('.help-bubble').isVisible(),true);
 const positions=await page.locator('[data-field=commandName],[data-field=eventDate],[data-field=eventTime]').evaluateAll(xs=>xs.map(x=>x.getBoundingClientRect().top));assert.ok(Math.max(...positions)-Math.min(...positions)<2,'first-row controls align with and without help icons');
 const second=page.locator('.reminder[data-row="row-two"]');
 await second.locator('[data-field=label]').fill('Start till 2 days before');assert.equal(await second.locator('.heading h3').textContent(),'2. Start till 2 days before');
 await second.locator('.row-advanced').evaluate(el=>el.open=true);
 await second.locator('[data-field=label]').fill('');assert.equal(await second.locator('.heading h3').textContent(),'2. Reminder');await second.locator('[data-field=label]').fill('Second');
 await second.locator('[data-field="start.minutes"]').fill('-180');await second.locator('[data-field="finish.minutes"]').fill('-120');await second.locator('[data-action=save]').click();
 assert.equal(await page.locator('.reminder').first().getAttribute('data-row'),'row-two',await page.locator('#status').textContent());
 await page.waitForFunction(()=>{const el=document.querySelector('.reminder[data-row="row-two"]');const r=el.getBoundingClientRect();return r.top>=0&&r.top<innerHeight;});
 assert.equal(await second.locator('.row-advanced').evaluate(el=>el.open),true,'keep the edited reminder expanded after reordering');
 assert.equal(await second.locator('[data-field=label]').evaluate(el=>el===document.activeElement),true);
 await second.locator('[data-field="finish.minutes"]').fill('-90');assert.match(await page.locator('#timeline-conflicts').textContent(),/Overlapping periods.*Second.*First/);
 await second.locator('[data-action=save]').click();assert.match(await page.locator('#status').textContent(),/Overlapping periods/);
 await second.locator('[data-field="finish.minutes"]').fill('-120');
 const pool=second.locator('.pool label').first();await pool.hover();assert.match(await page.locator('#pool-preview p').textContent(),/Meet alpha/);assert.doesNotMatch(await page.locator('#pool-preview p').textContent(),/%event(time|when|countdown)%/);assert.match(await page.locator('#pool-preview small').textContent(),/%eventtime%/);
 await pool.locator('input').focus();assert.equal(await page.locator('#pool-preview').count(),1);await page.keyboard.press('Escape');assert.equal(await page.locator('#pool-preview').count(),0);
 await second.locator('[data-action=preview]').click();
 assert.match(await page.locator('#dialog-body').textContent(),/Simulated server time/);assert.doesNotMatch(await page.locator('#dialog-body').textContent(),/local time/i);
 assert.equal(await page.locator('#simulate-time + .clock-zone').textContent(),'ET');
 await page.locator('#simulate-time').fill('2026-10-22T19:00');
 const schedule=cfg.schedule,at=model.projectedOccurrences(schedule,Math.floor(Date.now()/1000)-86400,Math.floor(Date.now()/1000)+86400*89)[0]??model.scheduleEventUtc(schedule);
 const now=model.scheduleEventUtc({timeZone:'ET',eventDate:'2026-10-22',eventTime:'19:00'});
 assert.equal(await page.locator('#simulate-messages .preview').first().textContent(),model.previewMessage(d.Default['@fixture'].$AccountWide.messages[1].text,schedule,at,now,{guild:'alpha',zone:'Guild Hall',localHour:19}));
 assert.ok(await page.locator('[data-field=eventTime]').evaluate(el=>el.getBoundingClientRect().width<=180),'time field keeps its native icon close to the clock');
 await page.locator('#close-dialog').click();
 const saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;
 assert.equal(saved.reminders[1].id,'row-two');assert.equal(saved.reminders[1].finish.minutes,-120,'rejected overlap never changed saved data');assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function batchEventSharing(){
 const d=fixture(),a=d.Default['@fixture'].$AccountWide;
 setLuaValue(a.commands,2,{id:'command-two',name:'Fishing'});setLuaValue(a.messages,2,{id:'fish-message',commandId:'command-two',guildName:'alpha',guildIndex:4,text:'Fish with us!',useCount:2});a.commandGuildSettings['command-two']={alpha:{runAt:'STARTUP',populateSound:'DUEL_START',openStatusPanelOnRun:true}};a.chatChannels['command-two']={alpha:'Group'};
 const {page,errors}=await open(d);
 try{
 await page.locator('[data-view=transfer]').click();assert.equal(await page.locator('#legacy-transfer').evaluate(el=>el.open),false);
 assert.equal(await page.locator('.bulk-export-choice:checked').count(),2);await page.locator('#clear-export').click();assert.equal(await page.locator('.bulk-export-choice:checked').count(),0);await page.locator('#select-all-export').click();
 const pending=page.waitForEvent('download');await page.locator('#export-events').click();const stream=await (await pending).createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);const bundle=JSON.parse(Buffer.concat(chunks).toString());assert.equal(bundle.items.length,2);assert.equal(bundle.items[1].settings.openStatusPanelOnRun,true);assert.equal(bundle.items[1].outputChannel,'Group');assert.doesNotMatch(JSON.stringify(bundle),/lastUsedAt|useCount/);
 bundle.items[1].eventName='New Fishing';
 await page.locator('#import-events-file').setInputFiles({name:'events.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});await page.locator('#import-event-review').waitFor({state:'visible'});assert.equal(await page.locator('.bulk-import-choice').count(),2);assert.match(await page.locator('#import-event-review').textContent(),/Update/);assert.match(await page.locator('#import-event-review').textContent(),/Create/);
 await page.locator('#clear-import').click();await page.locator('.bulk-import-choice[value="1"]').check();await page.locator('#apply-event-import').click();assert.match(await page.locator('#status').textContent(),/Imported 1 event/);
 const out=(await downloadData(page)).Default['@fixture'].$AccountWide;assert.equal(Object.keys(out.commands).length,3);assert.equal(out.messages[1].useCount,5);assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function effectiveReminderDatesAndNumericBounds(){
 const d=fixture(),cfg=d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha;cfg.runAt='SCHEDULED';cfg.schedule.eventDate='2026-11-03';cfg.schedule.eventDurationMinutes=120;
 const {page,errors}=await open(d);
 try{
 await page.clock.setFixedTime(new Date('2026-11-01T12:00:00Z'));await page.locator('[data-field=eventDate]').dispatchEvent('input');
 const row=page.locator('.reminder').first(),summary=row.locator('[data-effective-times]');
 assert.match(await summary.textContent(),/Nov 3, 2026.*6:00 PM EST/);
 await row.locator('[data-field="start.minutes"]').fill('-180');assert.match(await summary.textContent(),/5:00 PM EST/);
 await row.locator('[data-field="start.kind"]').selectOption('DAY');await row.locator('[data-field="start.days"]').fill('-1');await row.locator('[data-field="start.time"]').fill('20:00');assert.match(await summary.textContent(),/Nov 2, 2026.*8:00 PM EST/);
 await page.locator('[data-field=eventTime]').fill('21:00');assert.match(await summary.textContent(),/Stops:.*9:00 PM EST/);
 await page.locator('[data-field=recurrenceInterval]').fill('-2');assert.notEqual(await page.locator('[data-field=recurrenceInterval]').inputValue(),'-2');
 await page.locator('[data-field=eventDurationMinutes]').fill('-5');assert.notEqual(await page.locator('[data-field=eventDurationMinutes]').inputValue(),'-5');
 await page.locator('[data-field=eventDurationMinutes]').fill('0');assert.equal(await page.locator('[data-field=eventDurationMinutes]').evaluate(el=>el.checkValidity()),true);
 await page.locator('[data-field=recurrenceInterval]').fill('0');assert.equal(await page.locator('[data-field=recurrenceInterval]').evaluate(el=>el.checkValidity()),false);
 assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function reminderAvailabilityEditing(){
 const d=fixture(),cfg=d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha;
 cfg.runAt='SCHEDULED';cfg.schedule.recurrence='NONE';cfg.schedule.eventDate='2026-10-27';
 const r=cfg.schedule.reminders[1];r.start={kind:'OFFSET',minutes:-2880};r.finish={kind:'OFFSET',minutes:0};
 const {page,errors}=await open(d);
 try{
 const card=page.locator('.reminder').first();await card.locator('.availability-settings summary').click();
 await card.locator('[data-availability=enabled]').check();await card.locator('[data-availability=allDay]').uncheck();
 await card.locator('[data-availability=start]').fill('07:00');await card.locator('[data-availability=end]').fill('22:00');
 await card.locator('[data-availability=maxPerDay]').fill('0');await card.locator('[data-action=save]').click();assert.match(await page.locator('#status').textContent(),/Maximum announcements/);
 await card.locator('[data-availability=maxPerDay]').fill('1');await card.locator('[data-availability=end]').fill('');await card.locator('[data-action=save]').click();assert.match(await page.locator('#status').textContent(),/Availability: choose valid/);
 await card.locator('[data-availability=end]').fill('22:00');await card.locator('[data-action=save]').click();
 let saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;
 assert.equal(saved.reminders[1].availability.maxPerDay,1);assert.equal(saved.reminders[1].availability.startMinute,420);assert.equal(saved.reminders[1].availability.weekdays[2],true);assert.match(writeSavedVariables(saved),/\[2\] = true/);
 await page.locator('[data-view=calendar]').click();await page.locator('#calendar [data-field=date]').fill('2026-10-26');await page.locator('#calendar [data-field=date]').dispatchEvent('change');
 const block=page.locator('.day-availability').filter({hasText:'Every'}).first();assert.equal(await block.count(),1);
 await block.focus();await page.keyboard.press('ArrowRight');await page.locator('[data-scope=DATE]').click();
 saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;
 assert.equal(saved.reminders[1].availability.dateOverrides['2026-10-26'].startMinute,425);
 assert.match(await page.locator('.availability-badge').first().textContent(),/Date override/);
 await page.locator('.availability-reset').first().click();
 saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;
 assert.equal(saved.reminders[1].availability.dateOverrides?.['2026-10-26'],undefined);
 await page.locator('.day-availability').first().focus();await page.keyboard.press('ArrowRight');await page.locator('[data-scope=WEEKDAY]').click();
 saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;
 assert.equal(saved.reminders[1].availability.weekdayOverrides[2].startMinute,425);
 await page.locator('[data-day-undo]').click();
 saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;
 assert.equal(saved.reminders[1].availability.weekdayOverrides?.[2],undefined);
 await page.locator('.day-availability').first().focus();await page.keyboard.press('ArrowRight');await page.locator('[data-scope=ALL]').click();
 saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;
 assert.equal(saved.reminders[1].availability.startMinute,425);assert.equal(saved.reminders[1].availability.maxPerDay,1);
 await page.screenshot({path:resolve(temp,'availability-day.png'),fullPage:true});
 await page.locator('[data-view=editor]').click();await page.locator('.availability-settings').evaluate(el=>el.open=true);await page.screenshot({path:resolve(temp,'availability-settings.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function availabilityBlockedDay(){
 const d=fixture(),cfg=d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha;cfg.runAt='SCHEDULED';
 const r=cfg.schedule.reminders[1];r.start={kind:'OFFSET',minutes:-2880};r.finish={kind:'OFFSET',minutes:0};r.availability={enabled:true,startMinute:420,endMinute:1320,weekdays:numeric([false,false,true,false,false,false,false])};
 const {page,errors}=await open(d);
 try{await page.locator('[data-view=calendar]').click();await page.locator('#calendar [data-field=date]').fill('2026-10-26');await page.locator('#calendar [data-field=date]').dispatchEvent('change');assert.equal(await page.locator('.day-unavailable').count(),1);assert.equal(await page.locator('.day-availability').count(),0);assert.deepEqual(errors,[]);}finally{await page.close();}
}

async function availabilityLongPromotion(){
 const d=fixture(),cfg=d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha;cfg.runAt='SCHEDULED';cfg.schedule.recurrence='NONE';cfg.schedule.eventDate='2027-01-24';
 const r=cfg.schedule.reminders[1];r.start={kind:'OFFSET',minutes:-144000};r.finish={kind:'OFFSET',minutes:0};r.availability={enabled:true,startMinute:420,endMinute:1320};
 const {page,errors}=await open(d);
 try{await page.locator('[data-view=calendar]').click();await page.locator('#calendar [data-field=date]').fill('2026-10-26');await page.locator('#calendar [data-field=date]').dispatchEvent('change');assert.ok(await page.locator('.day-availability').count()>0,'long promotion visible while actual event is months away');assert.deepEqual(errors,[]);}finally{await page.close();}
}

async function dragDayTimeline(){
 const d=fixture(),cfg=d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha;cfg.runAt='SCHEDULED';cfg.schedule.eventDurationMinutes=120;cfg.schedule.reminders[1].label='Example - Promotion';
 const {page,errors}=await open(d);
 try{
 await page.locator('[data-view=calendar]').click();await page.locator('#calendar [data-field=date]').fill('2026-10-27');await page.locator('#calendar [data-field=date]').dispatchEvent('change');await page.locator('#calendar [data-field=view]').selectOption('day');
 assert.deepEqual((await page.locator('.day-row-label small').allTextContents()).sort(),['Actual event','Promotion']);assert.match(await page.locator('.day-row-detail').first().textContent(),/^Promotion:/);assert.doesNotMatch(await page.locator('.day-row-detail').first().textContent(),/Example/);
 let block=page.locator('.day-block:not(.day-actual-event)'),track=block.locator('..');const original=await block.getAttribute('title'),r=await block.boundingBox(),t=await track.boundingBox();
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+t.width/28,r.y+r.height/2,{steps:6});assert.equal(await page.locator('#day-drag-feedback').count(),1);await page.mouse.up();
 assert.equal(await page.locator('#calendar').isVisible(),true);assert.match(await page.locator('#status').textContent(),/Timeline updated/);assert.notEqual(await page.locator('.day-block:not(.day-actual-event)').getAttribute('title'),original);
 let saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;assert.equal(saved.reminders[1].label,'Example - Promotion','day label cleanup does not rename stored reminders');assert.equal(saved.reminders[1].start.minutes,-60);assert.equal(saved.reminders[1].finish.minutes,60);
 await page.locator('[data-day-undo]').click();saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;assert.equal(saved.reminders[1].start.minutes,-120);
 await page.locator('.day-actual-event [data-edge=finish]').scrollIntoViewIfNeeded();const handle=await page.locator('.day-actual-event [data-edge=finish]').boundingBox(),eventTrack=await page.locator('.day-actual-event').locator('..').boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+eventTrack.width/56,handle.y+handle.height/2,{steps:4});await page.mouse.up();saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;assert.equal(saved.eventDurationMinutes,150);await page.locator('[data-day-undo]').click();
 await page.locator('.day-actual-event [data-edge=finish]').focus();await page.keyboard.press('ArrowRight');saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;assert.equal(saved.eventDurationMinutes,125);
 await page.locator('.day-actual-event').focus();await page.keyboard.press('ArrowRight');saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;assert.equal(saved.eventTime,'08:05 PM');
 await page.locator('[data-day-step="1"]').click();assert.equal(await page.locator('#calendar [data-field=date]').inputValue(),'2026-10-28');await page.locator('[data-day-step="-1"]').click();assert.equal(await page.locator('#calendar [data-field=date]').inputValue(),'2026-10-27');assert.deepEqual(errors,[]);
 }finally{await page.close();}
 const long=fixture(),s=long.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha; s.runAt='SCHEDULED';s.schedule.reminders[1].start.minutes=-3000;s.schedule.reminders[1].finish.minutes=600;
 const second=await open(long);
 try{await second.page.locator('[data-view=calendar]').click();await second.page.locator('#calendar [data-field=date]').fill('2026-10-27');await second.page.locator('#calendar [data-field=date]').dispatchEvent('change');await second.page.locator('#calendar [data-field=view]').selectOption('day');const b=second.page.locator('.day-block:not(.day-actual-event)');assert.equal(await b.locator('.day-continues').count(),2);assert.equal(await b.locator('[data-edge]').count(),0);assert.deepEqual(second.errors,[]);}finally{await second.page.close();}
}

async function overviewDefaultsAndPlainHelp(){
 const {page,errors}=await open(fixture());
 try{
 await page.clock.setFixedTime(new Date('2026-10-27T02:00:00Z'));
 const state=await page.locator('[data-field=eventState]').boundingBox(),apply=await page.locator('#save-event').boundingBox();assert.ok(Math.abs(state.y+state.height-apply.y-apply.height)<2,'state and Apply bottoms align');
 await page.locator('.reminder-type').first().focus();assert.match(await page.locator('.reminder-type').first().textContent(),/REPEATING REMINDER/);assert.equal(await page.locator('.reminder-type .help-bubble').first().isVisible(),true);
 assert.equal(await page.locator('#snapshot-help').count(),0);await page.locator('#latest-snapshot-button').focus();assert.equal(await page.locator('#snapshot-help-text').isVisible(),true);assert.match(await page.locator('#snapshot-help-text').textContent(),/separate copy into memory/);
 await page.locator('.important-time-guide summary').click();assert.match(await page.locator('.important-time-guide').textContent(),/%eventtime:tickets%/);
 await page.locator('[data-view=calendar]').click();assert.equal(await page.locator('#calendar [data-field=view]').inputValue(),'day');assert.equal(await page.locator('#calendar [data-field=date]').inputValue(),'2026-10-26');assert.match(await page.locator('[data-day-step="-1"]').textContent(),/Sun, Oct 25/);assert.match(await page.locator('[data-day-step="1"]').textContent(),/Tue, Oct 27/);
 const nav=await page.locator('.day-navigation').boundingBox(),dates=await page.locator('.day-date-controls').boundingBox(),instructions=await page.locator('.day-instructions').boundingBox();assert.ok(Math.abs(nav.x+nav.width/2-dates.x-dates.width/2)<2,'date controls are centered');assert.ok(instructions.y>=nav.y+nav.height,'drag instructions occupy their own line');
 await page.locator('#calendar [data-field=view]').selectOption('month');await page.locator('[data-view=editor]').click();await page.locator('[data-view=calendar]').click();assert.equal(await page.locator('#calendar [data-field=view]').inputValue(),'day');assert.equal(await page.locator('#calendar [data-field=date]').inputValue(),'2026-10-26');assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function rotatingEventControls(){
 const d=fixture(),a=d.Default['@fixture'].$AccountWide,s=a.commandGuildSettings['command-one'].alpha.schedule;
 s.eventDate=new Date(Date.now()+2*86400000).toISOString().slice(0,10);a.commandGuildSettings['command-one'].alpha.runAt='SCHEDULED';
 const {page,errors}=await open(d);
 try{
 await page.locator('[data-field=specialPattern]').selectOption('EVENT_ROTATION');
 assert.equal(await page.locator('#event-rotation-settings').isVisible(),true);assert.equal(await page.locator('#event-rotation-settings').evaluate(el=>el.open),true);
 await page.locator('#add-activity').click();await page.locator('#rotation-activities input').nth(0).fill('Aetherian Archive');
 await page.locator('#add-activity').click();await page.locator('#rotation-activities input').nth(1).fill('Hel Ra Citadel');
 await page.locator('#add-activity').click();await page.locator('#rotation-activities input').nth(2).fill('Sanctum Ophidia');
 await page.locator('#rotation-activities input').nth(0).fill('🌈'.repeat(80));assert.equal(await page.locator('#rotation-activities input').nth(0).evaluate(el=>el.checkValidity()),true);await page.locator('#rotation-activities input').nth(0).fill('Aetherian Archive');
 await page.locator('[data-field=rotationEvery]').fill('1');await page.locator('#save-event').click();
 assert.equal(await page.locator('#rotation-activities input').count(),3,await page.locator('#status').textContent());
 assert.match(await page.locator('.rotation-upcoming .rotation-occurrence').nth(0).textContent(),/Aetherian Archive/);assert.match(await page.locator('.rotation-upcoming .rotation-occurrence').nth(1).textContent(),/Hel Ra Citadel/);
 const firstDate=await page.locator('[data-cancel-occurrence]').first().getAttribute('data-cancel-occurrence');
 await page.locator('[data-cancel-occurrence]').first().click();await page.locator('#cancel-rotation-action').selectOption('POSTPONE');await page.locator('#confirm-cancel-occurrence').click();
 assert.equal(await page.locator('[data-undo-occurrence="'+firstDate+'"]').count(),1);assert.match(await page.locator('.rotation-upcoming .rotation-occurrence').nth(1).textContent(),/Aetherian Archive/);
 let saved=(await downloadData(page)).Default['@fixture'].$AccountWide;let out=saved.commandGuildSettings['command-one'].alpha.schedule;
 assert.equal(out.occurrenceExceptions[firstDate].action,'POSTPONE');assert.equal(out.rotationEvents[1].name,'Aetherian Archive');assert.equal(saved.messages[1].useCount,5);assert.equal(saved.messages[1].lastUsedAt,123);
 await page.locator('[data-undo-occurrence="'+firstDate+'"]').click();assert.match(await page.locator('.rotation-upcoming .rotation-occurrence').nth(1).textContent(),/Hel Ra Citadel/);
 await page.locator('#rotation-activities [data-activity-action=up]').nth(1).click();await page.locator('#save-event').click();
 assert.match(await page.locator('.rotation-upcoming .rotation-occurrence').nth(0).textContent(),/Hel Ra Citadel/);
 const message=page.locator('.message').first();await message.locator('summary').click();
 assert.equal(await message.locator('[data-insert-token] option[value="%eventactivity%"] ').count(),1);
 const activityId=await page.locator('#rotation-activities [data-activity-id]').first().getAttribute('data-activity-id');
 await message.locator('[data-field=variant]').selectOption(activityId);await message.locator('[data-action=save-message]').click();
 await page.locator('[data-cancel-occurrence]').first().click();await page.locator('#confirm-cancel-occurrence').click();
 saved=(await downloadData(page)).Default['@fixture'].$AccountWide;out=saved.commandGuildSettings['command-one'].alpha.schedule;
 assert.equal(out.messageVariants['message-one'],activityId);assert.equal(out.occurrenceExceptions[firstDate].action,'KEEP');
 assert.equal(out.rotationEvery,1);assert.equal(out.rotationEvents[1].name,'Hel Ra Citadel');assert.deepEqual(errors,[]);
 // Existing faction schedules expose exactly the same per-occurrence controls.
 await page.locator('[data-field=specialPattern]').selectOption('FACTION_ROTATION');await page.locator('#save-event').click();
 assert.equal(await page.locator('#event-rotation-settings').isVisible(),false);assert.equal(await page.locator('[data-undo-occurrence="'+firstDate+'"]').count(),1);await page.locator('[data-undo-occurrence="'+firstDate+'"]').click();
 assert.equal(await page.locator('[data-cancel-occurrence]').count()>0,true);
 }finally{await page.close();}
}

async function onceNoticeIgnoresInactiveFields(){
 const d=fixture(),cfg=d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha,s=cfg.schedule;cfg.runAt='SCHEDULED';s.eventDurationMinutes=0;s.recurrence='NONE';
 const row=s.reminders[1];row.label='Closed!';row.once=true;row.timeSensitive=true;row.intervalMinutes=0;row.start={kind:'OFFSET',minutes:0};row.finish={kind:'DAY',days:9999,time:'08:00 PM'};row.lateMinutes=5;
 d.Default['@fixture'].$AccountWide.messages[1].text='The auction has closed!';
 const {page,errors}=await open(d);
 try{
 const card=page.locator('.reminder').first();assert.equal(await card.locator('[data-field=intervalMinutes]').isVisible(),false);assert.equal(await card.locator('[data-finish-window]').isVisible(),false);
 assert.doesNotMatch(await card.locator('[data-effective-times]').textContent(),/Enter valid reminder values|No valid reminder window/,'inactive repeat and finish fields cannot block a one-time notice');assert.match(await card.locator('[data-effective-times]').textContent(),/Starts:/);
 await card.locator('[data-field="start.minutes"]').fill('');await card.locator('[data-action=save]').click();assert.match(await page.locator('#status').textContent(),/anchor|start/i);await card.locator('[data-field="start.minutes"]').fill('0');
 await card.locator('[data-action=preview]').click();assert.match(await page.locator('#simulate-messages').textContent(),/The auction has closed!/);await page.locator('#close-dialog').click();await card.locator('[data-action=save]').click();
 let saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule.reminders[1];assert.equal(saved.once,true);assert.equal(saved.start.minutes,0);assert.equal(saved.lateMinutes,5);assert.ok(saved.intervalMinutes>0);assert.equal(saved.finish.kind,'OFFSET');
 // Inactive late allowance is also harmless for a repeating reminder, while visible values stay strict.
 await card.locator('[data-field=once]').uncheck();await card.locator('[data-field="start.minutes"]').fill('-10');await card.locator('[data-field="finish.minutes"]').fill('0');await card.locator('[data-field=lateMinutes]').evaluate(el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await card.locator('[data-field=intervalMinutes]').fill('0');assert.match(await card.locator('[data-effective-times]').textContent(),/Repeat every/i);await card.locator('[data-field=intervalMinutes]').fill('15');await card.locator('[data-action=save]').click();saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule.reminders[1];assert.equal(saved.once,false);assert.equal(saved.intervalMinutes,15);assert.ok(saved.lateMinutes>0);
 assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function monthlyWeekdayControls(){
 const d=fixture(),cfg=d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha,s=cfg.schedule;cfg.runAt='SCHEDULED';s.recurrence='MONTHLY_WEEKDAY';s.eventDate='2026-10-28';
 const {page,errors}=await open(d);
 try{
 assert.equal(await page.locator('[data-field=recurrence] option:checked').textContent(),'Monthly on weekday');assert.equal(await page.locator('#monthly-weekday-rule').isVisible(),true);assert.equal(await page.locator('[data-field=monthlyWeek]').inputValue(),'4');assert.equal(await page.locator('[data-field=monthlyWeekday]').inputValue(),'4');
 await page.locator('[data-field=eventDate]').fill('2026-11-08');assert.equal(await page.locator('[data-field=monthlyWeek]').inputValue(),'2','legacy inferred ordinal follows anchor edits');assert.equal(await page.locator('[data-field=monthlyWeekday]').inputValue(),'1');
 await page.locator('[data-field=eventDate]').fill('2026-10-28');await page.locator('[data-field=monthlyWeek]').selectOption('LAST');await page.locator('[data-field=monthlyWeekday]').selectOption('1');assert.match(await page.locator('#monthly-weekday-help').textContent(),/Last Sunday/);
 const expectedNext=config=>{const now=Math.floor(Date.now()/1000),at=model.projectedOccurrences(config,now,now+400*86400)[0];return new Date(at*1000).toLocaleString('en-US',{timeZone:'America/New_York',weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});};
 assert.equal(await page.locator('#next-occurrence').inputValue(),expectedNext({...s,monthlyWeek:'LAST',monthlyWeekday:1}));
 await page.locator('[data-field=recurrenceInterval]').fill('2');assert.equal(await page.locator('#next-occurrence').inputValue(),expectedNext({...s,monthlyWeek:'LAST',monthlyWeekday:1,recurrenceInterval:2}));
 await page.locator('[data-field=eventDate]').fill('2026-11-01');assert.equal(await page.locator('[data-field=monthlyWeek]').inputValue(),'LAST','explicit Last selection survives anchor edits');assert.equal(await page.locator('[data-field=monthlyWeekday]').inputValue(),'1');
 await page.locator('#save-event').click();let saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;assert.equal(saved.monthlyWeek,'LAST');assert.equal(saved.monthlyWeekday,1);assert.equal(saved.recurrenceInterval,2);
 await page.locator('[data-field=monthlyWeek]').selectOption('5');assert.match(await page.locator('#monthly-weekday-help').textContent(),/skipped/);await page.locator('[data-field=eventDate]').fill('2027-02-01');await page.locator('[data-field=recurrenceInterval]').fill('12');const sparse=model.nextScheduleOccurrence({...s,eventDate:'2027-02-01',monthlyWeek:5,monthlyWeekday:1,recurrenceInterval:12},Math.floor(Date.now()/1000));assert.equal(await page.locator('#next-occurrence').inputValue(),new Date(sparse*1000).toLocaleString('en-US',{timeZone:'America/New_York',weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}),'next occurrence cannot fall back to an off-rule anchor');await page.locator('[data-field=recurrence]').selectOption('WEEKLY');assert.equal(await page.locator('#monthly-weekday-rule').isVisible(),false);await page.locator('#save-event').click();
 saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;assert.equal(saved.monthlyWeek,'LAST','hidden unsaved monthly controls do not overwrite the saved rule');assert.equal(saved.recurrence,'WEEKLY');assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function cachedGuildLegacyIdentity(){
 const d=fixture(),a=d.Default['@fixture'].$AccountWide,cfg=a.commandGuildSettings['command-one'].alpha;
 a.commandGuildSettings['command-one']={'New Guild':cfg};cfg.schedule.timeZone='PT';a.guildSchedulingTimeZones={'New Guild':'PT'};a.chatChannels={'command-one':{'New Guild':'Officer'}};
 a.guildRoster=numeric([{guildId:999,guildIndex:4,guildName:'New Guild'}]);a.guildRosterUpdatedAt=123;
 a.messages=numeric([{id:'old',commandId:'command-one',guildName:'Old Guild',guildIndex:4,text:'Old guild owner'},{id:'unknown',commandId:'command-one',guildIndex:4,text:'Unknown historical guild'}]);
 const {page,errors}=await open(d);
 try{await page.locator('#guild').selectOption('new guild');assert.equal(await page.locator('[data-field=commandName]').inputValue(),'Example');assert.equal(await page.locator('[data-field=outputChannel]').inputValue(),'Officer');assert.equal(await page.locator('#guild-timezone').inputValue(),'PT');assert.equal(await page.locator('.message').count(),0,'current delivery slot cannot claim historical unnamed messages');await page.locator('#add-message').click();assert.equal(await page.locator('.message').count(),1,'new messages can still use the known current slot');assert.deepEqual(errors,[]);}finally{await page.close();}
}

async function cachedGuildChoices(){
 const d=fixture(),a=d.Default['@fixture'].$AccountWide;a.commands={};a.messages={};a.commandGuildSettings={};a.chatChannels={};a.guildRoster=numeric([{guildId:101,guildIndex:4,guildName:'Alpha Guild'},{guildId:202,guildIndex:2,guildName:'Beta Guild'}]);a.guildRosterUpdatedAt=1234;
 d.Default={'@empty':d.Default['@other'],'@with-guilds':{$AccountWide:a}};
 const {page,errors}=await open(d);
 try{
 assert.equal(await page.locator('#account').inputValue(),'@with-guilds');assert.deepEqual(await page.locator('#guild option').allTextContents(),['Alpha Guild','Beta Guild']);assert.equal(await page.locator('.event-item').count(),0);
 await page.locator('#guild').selectOption('beta guild');page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept('First guild event'));
 await page.locator('#new-event').click();await page.locator('#form-name').fill('First guild event');await page.locator('#modal-submit').click();assert.equal(await page.locator('[data-field=commandName]').inputValue(),'First guild event');assert.equal(await page.locator('#guild').inputValue(),'beta guild');
 await page.locator('[data-field=settingsRunAt]').selectOption('SCHEDULED');await page.locator('#save-event').click();await page.locator('#add-message').click();await page.locator('#add-row').click();
 const saved=(await downloadData(page)).Default['@with-guilds'].$AccountWide;assert.equal(saved.messages[1].guildIndex,2);assert.equal(saved.messages[1].guildName,'beta guild');assert.equal(saved.guildRoster[1].guildName,'Alpha Guild');assert.equal(saved.guildRosterUpdatedAt,1234);assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function liveRotationProjection(){
 const d=fixture(),a=d.Default['@fixture'].$AccountWide,cfg=a.commandGuildSettings['command-one'].alpha,s=cfg.schedule;
 cfg.runAt='SCHEDULED';s.recurrence='BIWEEKLY';s.eventDate=new Date(Date.now()+2*86400000).toISOString().slice(0,10);s.specialPattern='EVENT_ROTATION';s.rotationEvents=numeric([{id:'a',name:'First activity'},{id:'b',name:'Second activity'}]);s.rotationEvery=1;
 const {page,errors}=await open(d);
 const dates=()=>page.locator('[data-cancel-occurrence]').evaluateAll(xs=>xs.map(x=>x.dataset.cancelOccurrence));
 try{
 const before=await dates();assert.equal((Date.parse(before[1])-Date.parse(before[0]))/86400000,14);
 await page.locator('[data-field=recurrence]').selectOption('WEEKLY');
 const weekly=await dates();assert.equal((Date.parse(weekly[1])-Date.parse(weekly[0]))/86400000,7,'upcoming rotation follows unsaved recurrence edits');
 assert.match(await page.locator('#rotation-occurrences').textContent(),/Preview.*Apply event settings/i);assert.equal(await page.locator('[data-cancel-occurrence]').first().isDisabled(),true);
 await page.locator('[data-field=recurrenceInterval]').fill('2');let intervalDates=await dates();assert.equal((Date.parse(intervalDates[1])-Date.parse(intervalDates[0]))/86400000,14);await page.locator('[data-field=recurrenceInterval]').fill('1');
 await page.locator('[data-field=rotationEvery]').fill('0');assert.equal(await page.locator('.rotation-upcoming').count(),0,'invalid frequency cannot leave stale projection rows visible');await page.locator('[data-field=rotationEvery]').fill('1');
 const changedDate=new Date(Date.now()+3*86400000).toISOString().slice(0,10);await page.locator('[data-field=eventDate]').fill(changedDate);assert.equal((await dates())[0],changedDate,'upcoming rotation follows unsaved anchor edits');
 await page.locator('[data-field=eventTime]').fill('19:00');assert.match(await page.locator('.rotation-upcoming strong').first().textContent(),/7:00 PM/);
 await page.locator('[data-field=rotationEvery]').fill('2');assert.match(await page.locator('.rotation-upcoming .rotation-occurrence').nth(1).textContent(),/First activity/);
 await page.locator('#rotation-activities input').first().fill('Renamed activity');assert.match(await page.locator('.rotation-upcoming .rotation-occurrence').nth(1).textContent(),/Renamed activity/);
 await page.locator('#save-event').click();assert.equal(await page.locator('[data-cancel-occurrence]').first().isDisabled(),false,await page.locator('#status').textContent());
 const saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;assert.equal(saved.recurrence,'WEEKLY');assert.equal(saved.eventDate,changedDate);assert.equal(saved.eventTime,'07:00 PM');assert.equal(saved.rotationEvery,2);assert.equal(saved.rotationEvents[1].name,'Renamed activity');assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function cancelActiveRotation(){
 const d=fixture(),s=d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule;
 const now=Math.floor(Date.now()/1000),parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date((now-1800)*1000)).map(p=>[p.type,p.value]));
 s.eventDate=`${parts.year}-${parts.month}-${parts.day}`;s.eventTime=String(Number(parts.hour)%12||12).padStart(2,'0')+':'+parts.minute+(Number(parts.hour)>=12?' PM':' AM');s.specialPattern='EVENT_ROTATION';s.rotationEvents=numeric([{id:'activity-one',name:'Underway activity'}]);s.rotationEvery=1;s.reminders[1].start.minutes=-120;s.reminders[1].finish.minutes=120;
 const {page,errors}=await open(d);
 try{const date=s.eventDate;assert.equal(await page.locator('[data-cancel-occurrence="'+date+'"]').count(),1,'live promotion without event duration can be cancelled');await page.locator('[data-cancel-occurrence="'+date+'"]').click();await page.locator('#confirm-cancel-occurrence').click();assert.equal(await page.locator('[data-undo-occurrence="'+date+'"]').count(),1,await page.locator('#status').textContent());assert.deepEqual(errors,[]);}finally{await page.close();}
}

async function messageNamesAndDragOrder(){
 const d=fixture(),a=d.Default['@fixture'].$AccountWide;
 setLuaValue(a.messages,2,{id:'second',commandId:'command-one',guildName:'alpha',guildIndex:4,text:'Second message',useCount:2});setLuaValue(a.messages,3,{id:'third',commandId:'command-one',guildName:'alpha',guildIndex:4,text:'Third message',useCount:3});
 const {page,errors}=await open(d);
 try{
 const first=page.locator('.message[data-id="message-one"]');await first.locator('summary').click();await first.locator('[data-field=messageName]').fill('Gathering reminder');assert.match(await first.locator('.message-summary-title').textContent(),/^Gathering reminder/);assert.match(await page.locator('[data-pool-message-label="message-one"]').first().textContent(),/^Gathering reminder/);assert.equal(await first.locator('[data-field=messageName]').getAttribute('maxlength'),'60');
 assert.equal(await first.locator('.message-character-count').textContent(),'13 characters · before substitutions');
 await first.locator('textarea').fill('Hi 🌈');assert.equal(await first.locator('.message-character-count').textContent(),'4 characters · before substitutions');
 await first.locator('[data-insert-token]').selectOption('%guild%');assert.equal(await first.locator('.message-character-count').textContent(),'11 characters · before substitutions');
 await first.locator('textarea').fill('Unsaved draft stays while sorting');
 await page.locator('.message[data-id="third"] .message-drag-handle').dragTo(first.locator('summary'),{targetPosition:{x:60,y:3}});
 assert.equal(await page.locator('.message').first().getAttribute('data-id'),'third');assert.equal(await first.evaluate(el=>el.open),true);assert.equal(await first.locator('textarea').inputValue(),'Unsaved draft stays while sorting');assert.equal(await first.locator('.message-character-count').textContent(),'33 characters · before substitutions');
 await page.locator('#add-message').click();assert.equal(await page.locator('.message').last().locator('[data-field=messageName]').inputValue(),'Message 4');
 const latest=parseSavedVariables(writeSavedVariables(d));latest.Default['@fixture'].$AccountWide.messages[1].useCount=99;await page.locator('#latest').setInputFiles({name:'SmartChatMsg.lua',mimeType:'text/plain',buffer:Buffer.from(writeSavedVariables(latest))});await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('for merging'));
 const saved=(await downloadData(page)).Default['@fixture'].$AccountWide;assert.equal(saved.messages[1].name,'Gathering reminder');assert.equal(saved.messages[1].displayOrder,2);assert.equal(saved.messages[1].useCount,99);assert.equal(saved.messages[1].text,'Hello %guild%');assert.equal(saved.messages[3].name,'Message 3');assert.equal(saved.messages[3].displayOrder,1);assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function sharedServerLibrary(){
 const original=fixture(),initialLua=writeSavedVariables(original),{page,errors}=await open(original);
 const files=new Map();let nextId=1;const add=(name,lua)=>{const id=(nextId++).toString(16).padStart(64,'0');const file={id,name,createdAt:'2026-10-26T12:00:00Z',bytes:Buffer.byteLength(lua),lua};files.set(id,file);return file;};
 const existing=add('Earlier copy',initialLua),state={saveGate:null,loadGate:null,onSave:null,onLoad:null};
 await page.route('**/api/library**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname,reply=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(path==='/api/library'&&request.method()==='GET')return reply(200,{files:[...files.values()].map(({lua,...metadata})=>metadata)});
   if(path==='/api/library'&&request.method()==='POST'){
     const payload=request.postDataJSON();state.onSave?.(payload);if(state.saveGate)await state.saveGate;
     if([...files.values()].some(file=>file.name.toLowerCase()===payload.name.trim().toLowerCase()))return reply(409,{error:'That name already exists; choose a unique name.'});
     const {lua,...file}=add(payload.name.trim(),payload.lua);return reply(201,{file});
   }
   const file=files.get(path.split('/').at(-1));state.onLoad?.();if(state.loadGate)await state.loadGate;
   return file?route.fulfill({status:200,contentType:'text/plain',body:file.lua}):reply(404,{error:'Shared file not found.'});
 });
 try{
   await page.locator('[data-field=commandName]').fill('Shared edit');await page.locator('#save-event').click();
   const latest=parseSavedVariables(initialLua);latest.Default['@fixture'].$AccountWide.messages[1].useCount=99;
   await page.locator('#latest').setInputFiles({name:'SmartChatMsg.lua',mimeType:'text/plain',buffer:Buffer.from(writeSavedVariables(latest))});await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('for merging'));
   await page.locator('#save-server').click();await page.locator('#library-list [data-library-id]').first().waitFor();await page.locator('#library-name').fill('Shared version');await page.locator('#library-save').click();await page.waitForFunction(()=>document.querySelector('#library-status')?.textContent.includes('Saved “Shared version”'));
   const saved=[...files.values()].find(file=>file.name==='Shared version'),savedData=parseSavedVariables(saved.lua).Default['@fixture'].$AccountWide;assert.equal(savedData.commands[1].name,'Shared edit');assert.equal(savedData.messages[1].useCount,99);
   await page.locator('#library-name').fill('SHARED VERSION');await page.locator('#library-save').click();await page.waitForFunction(()=>document.querySelector('#library-status')?.textContent.includes('already exists'));assert.equal(files.size,2);assert.equal(files.get(saved.id).lua,saved.lua);await page.locator('#close-dialog').click();
   await page.locator('[data-field=commandName]').fill('Before request');await page.locator('#save-event').click();await page.locator('#save-server').click();await page.locator('#library-name').fill('Delayed save');
   let releaseSave,saveStarted;state.saveGate=new Promise(resolve=>releaseSave=resolve);const saving=new Promise(resolve=>saveStarted=resolve);state.onSave=saveStarted;
   await page.locator('#library-save').click();await saving;await page.locator('#close-dialog').click();await page.locator('[data-field=commandName]').fill('Newer unsaved edit');await page.locator('#save-event').click();releaseSave();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('earlier copy'));state.saveGate=null;state.onSave=null;
   assert.equal(parseSavedVariables([...files.values()].find(file=>file.name==='Delayed save').lua).Default['@fixture'].$AccountWide.commands[1].name,'Before request');
   page.removeAllListeners('dialog');let declined=0;page.on('dialog',async dialog=>{declined++;await dialog.dismiss();});await page.locator('#server-library').click();await page.locator(`[data-library-id="${existing.id}"]`).waitFor();await page.locator(`[data-library-id="${existing.id}"]`).click();assert.equal(declined,1,'newer edits still trigger unsaved confirmation after an earlier save completes');assert.equal(await page.locator('[data-field=commandName]').inputValue(),'Newer unsaved edit');await page.locator('#close-dialog').click();
   page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept());await downloadData(page);
   await page.locator('#server-library').click();await page.locator(`[data-library-id="${existing.id}"]`).waitFor();let releaseLoad,loadStarted;state.loadGate=new Promise(resolve=>releaseLoad=resolve);const loading=new Promise(resolve=>loadStarted=resolve);state.onLoad=loadStarted;
   await page.locator(`[data-library-id="${existing.id}"]`).click();await loading;await page.locator('#close-dialog').click();await page.locator('[data-field=commandName]').fill('Edit while loading');await page.locator('#save-event').click();releaseLoad();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Server load canceled'));state.loadGate=null;state.onLoad=null;assert.equal(await page.locator('[data-field=commandName]').inputValue(),'Edit while loading');
   await page.locator('#server-library').click();await page.locator(`[data-library-id="${saved.id}"]`).waitFor();await page.locator(`[data-library-id="${saved.id}"]`).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Loaded shared configuration'));
   assert.equal(await page.locator('[data-field=commandName]').inputValue(),'Shared edit');await page.locator('[data-field=commandName]').fill('Changed after loading');await page.locator('#save-event').click();const downloaded=(await downloadData(page)).Default['@fixture'].$AccountWide;assert.equal(downloaded.commands[1].name,'Changed after loading');assert.equal(downloaded.messages[1].useCount,99);assert.equal(files.get(saved.id).lua,saved.lua,'loading/editing/downloading does not overwrite the server copy');
   await page.reload();await page.locator('#server-library').click();await page.locator(`[data-library-id="${existing.id}"]`).waitFor();assert.equal(await page.locator('#library-save').isDisabled(),true);await page.locator(`[data-library-id="${existing.id}"]`).click();await page.locator('#workspace').waitFor({state:'visible'});assert.equal(await page.locator('[data-field=commandName]').inputValue(),'Example');assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function newMessageOpens(){
 const {page,errors}=await open(fixture());
 try{await page.locator('#add-message').click();const card=page.locator('.message').last();await card.locator('textarea').waitFor({state:'visible'});assert.equal(await card.evaluate(el=>el.open),true);assert.equal(await card.locator('textarea').evaluate(el=>el===document.activeElement),true);assert.equal(await page.locator('.message').first().evaluate(el=>el.open),false);await card.locator('[data-field=messageName]').fill('A useful name');assert.match(await card.locator('.message-summary-title').textContent(),/A useful name/);assert.equal(await card.locator('.message-full-name').count(),0);assert.deepEqual(errors,[]);}finally{await page.close();}
}

async function deliverySliderClarity(){
 const d=fixture();d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.runAt='ON_DEMAND';const {page,errors}=await open(d);
 try{
 const repeat=page.locator('[data-command-option=reminderMinutes]'),retry=page.locator('[data-command-option=reminderRetryMinutes]'),range=page.locator('[data-command-slider=reminderRetryMinutes]'),cooldown=page.locator('[data-command-option=autoPopulateCooldownMinutes]');
 await repeat.fill('7');await cooldown.fill('25');await retry.fill('40');assert.equal(await retry.inputValue(),'25');assert.equal(await retry.getAttribute('max'),'25');assert.equal(await range.getAttribute('max'),'25');
 await repeat.fill('3');assert.equal(await retry.inputValue(),'25','changing repeat frequency does not cap retry to frequency');await cooldown.fill('15');assert.equal(await retry.inputValue(),'15');assert.equal(await range.getAttribute('max'),'15');await repeat.fill('0');assert.equal(await retry.inputValue(),'0');assert.equal(await range.isDisabled(),true);
 assert.match(await page.locator('[data-minute-control=reminderMinutes] label').textContent(),/Repeat Frequency/);assert.equal(await page.locator('.minute-slider>p:visible').count(),0);
 const retryHelp=page.locator('[data-minute-control=reminderRetryMinutes] .help-icon');await retryHelp.hover();assert.equal(await retryHelp.locator('.help-bubble').isVisible(),true);assert.equal(await retryHelp.locator('.help-bubble').textContent(),'How often to try sending again if send fails');
 assert.equal(await page.locator('[data-minute-control=autoPopulateCooldownMinutes] .help-bubble').textContent(),'Delay before trying to send again');
 const a=await page.locator('[data-command-option=autoPopulateOnZone]').boundingBox(),b=await page.locator('[data-command-option=openStatusPanelOnRun]').boundingBox();assert.ok(Math.abs(a.y-b.y)<3,'checkboxes share a row');const soundBox=await page.locator('[data-command-option=populateSound]').boundingBox();assert.ok(soundBox.x>b.x+b.width,'sound is to the right');assert.ok(Math.abs(soundBox.y+soundBox.height/2-a.y-a.height/2)<3,'sound is vertically centered');
 assert.doesNotMatch(await page.locator('.command-delivery').textContent(),/Zone population and timed repetition are alternatives/);assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function commandSlidersAndSounds(){
 const d=fixture(),cfg=d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha;cfg.runAt='ON_DEMAND';cfg.populateSound='CUSTOM_EXISTING_SOUND';
 const {page,errors}=await open(d);
 try{
 const sound=page.locator('[data-command-option=populateSound]');assert.equal(await sound.evaluate(el=>el.tagName),'SELECT');assert.equal(await sound.inputValue(),'CUSTOM_EXISTING_SOUND');
 for(const key of ['NONE','DUEL_START','DEFAULT_CLICK','POSITIVE_CLICK','NEGATIVE_CLICK','DIALOG_ACCEPT','DIALOG_DECLINE','NEW_NOTIFICATION','QUEST_SHARE_ACCEPTED','BOOK_ACQUIRED','ACHIEVEMENT_AWARDED','BATTLEGROUND_CAPTURE_FLAG_TAKEN','BATTLEGROUND_CAPTURE_FLAG_RETURNED','BATTLEGROUND_MEDAL_AWARDED','CHAMPION_POINT_GAINED','TELVAR_GAINED','TELVAR_LOST','TRADE_INVITE','GROUP_INVITE','LFG_ACCEPTED','JUSTICE_NOW_KOS','JUSTICE_STATE_CHANGED'])assert.equal(await sound.locator('option').evaluateAll((els,k)=>els.some(el=>el.value===k),key),true);
 const slider=key=>page.locator(`[data-command-slider="${key}"]`),exact=key=>page.locator(`[data-command-option="${key}"]`),duration=key=>page.locator(`[data-command-duration="${key}"]`);
 assert.equal(await slider('reminderMinutes').getAttribute('max'),'1440');assert.equal(await slider('reminderRetryMinutes').getAttribute('min'),'0');assert.equal(await slider('autoPopulateCooldownMinutes').getAttribute('min'),'15');assert.equal(await slider('autoPopulateCooldownMinutes').getAttribute('max'),'480');assert.equal(await duration('reminderMinutes').textContent(),'Off');assert.equal(await slider('reminderRetryMinutes').isDisabled(),true);
 await slider('reminderMinutes').focus();await page.keyboard.press('ArrowRight');assert.equal(await exact('reminderMinutes').inputValue(),'1');
 await exact('reminderMinutes').fill('125');assert.equal(await slider('reminderMinutes').inputValue(),'125');assert.match(await duration('reminderMinutes').textContent(),/2 hours 5 minutes/);assert.equal(await slider('reminderRetryMinutes').isDisabled(),false);
 await slider('autoPopulateCooldownMinutes').evaluate(el=>{el.value='480';el.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await exact('autoPopulateCooldownMinutes').inputValue(),'480');assert.match(await duration('autoPopulateCooldownMinutes').textContent(),/8 hours/);await sound.selectOption('DUEL_START');await page.locator('.command-delivery').screenshot({path:resolve(temp,'command-sliders-and-sounds.png')});
 await exact('autoPopulateCooldownMinutes').fill('1500');assert.match(await duration('autoPopulateCooldownMinutes').textContent(),/1 day 1 hour/);assert.match(await page.locator('[data-command-slider-note=autoPopulateCooldownMinutes]').textContent(),/beyond/);
 await sound.selectOption('ACHIEVEMENT_AWARDED');await page.locator('#save-event').click();const saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha;assert.equal(saved.reminderMinutes,125);assert.equal(saved.autoPopulateCooldownMinutes,1500);assert.equal(saved.populateSound,'ACHIEVEMENT_AWARDED');
 await page.locator('[data-command-option=autoPopulateOnZone]').check();assert.equal(await duration('reminderMinutes').textContent(),'Off');assert.equal(await slider('reminderRetryMinutes').isDisabled(),true);
 await page.locator('[data-field=settingsRunAt]').selectOption('SCHEDULED');assert.equal(await slider('reminderMinutes').isVisible(),false);assert.equal(await sound.isVisible(),true);assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function importantTimeCreationModal(){
 const {page,errors}=await open(fixture());let prompts=0;page.removeAllListeners('dialog');page.on('dialog',dialog=>{if(dialog.type()==='prompt')prompts++;dialog.dismiss();});
 try{await page.locator('#add-mark').click();await page.locator('#modal-submit').click();assert.match(await page.locator('#modal-error').textContent(),/unique lowercase key/);await page.locator('#form-key').fill('gathering');await page.locator('#form-key').press('Enter');assert.equal(await page.locator('.mark[data-id=gathering]').count(),1);assert.equal(prompts,0);assert.deepEqual(errors,[]);}finally{await page.close();}
}

async function creationModals(){
 const d=fixture();d.Default={'@empty':{ $AccountWide:{commands:{},messages:{},commandGuildSettings:{}}}};
 const {page,errors}=await open(d);let prompts=0;page.removeAllListeners('dialog');page.on('dialog',dialog=>{if(dialog.type()==='prompt')prompts++;dialog.dismiss();});
 try{
 await page.locator('#new-event').click();assert.equal(await page.locator('#form-guild').isVisible(),true);assert.equal(await page.locator('#form-name').isVisible(),true);
 await page.locator('#form-name').fill('   ');await page.locator('#modal-submit').click();assert.match(await page.locator('#modal-error').textContent(),/required/);assert.equal(await page.locator('.event-item').count(),0);
 await page.locator('#form-guild').fill('Alphabet Mafia');await page.locator('#form-name').fill('Recruit');await page.locator('#modal-cancel').click();assert.equal(await page.locator('.event-item').count(),0);
 await page.locator('#new-event').click();await page.locator('#form-guild').fill('Alphabet Mafia');await page.locator('#form-name').fill('Recruit');await page.locator('#form-name').press('Enter');assert.equal(await page.locator('#dialog').isVisible(),false);assert.equal(await page.locator('[data-field=commandName]').inputValue(),'Recruit');assert.equal(await page.locator('[data-field=settingsRunAt]').inputValue(),'ON_DEMAND');
 await page.locator('#new-event').click();assert.equal(await page.locator('#form-guild').getAttribute('readonly'),'');await page.keyboard.press('Escape');assert.equal(await page.locator('.event-item').count(),1);assert.equal(prompts,0);assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function commandNumericInputRules(){
 const d=fixture();d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.runAt='ON_DEMAND';const {page,errors}=await open(d);
 try{
 const repeat=page.locator('[data-command-option=reminderMinutes]');await repeat.fill('12');await repeat.focus();await page.keyboard.press('End');await page.keyboard.type('e-+.');assert.equal(await repeat.inputValue(),'12');
 const rejected=await repeat.evaluate(el=>{const transfer=new DataTransfer();transfer.setData('text/plain','-3');return !el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));});assert.equal(rejected,true);
 await repeat.fill('0');await page.locator('#save-event').click();const saved=(await downloadData(page)).Default['@fixture'].$AccountWide;assert.equal(saved.commandGuildSettings['command-one'].alpha.reminderMinutes,undefined);
 await page.locator('#account-settings').click();const timeout=page.locator('#account-revert-seconds');await timeout.fill('90');await timeout.focus();await page.keyboard.press('End');await page.keyboard.type('e-.+');assert.equal(await timeout.inputValue(),'90');assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function commandSettingAttributeEscaping(){
 const d=fixture(),a=d.Default['@fixture'].$AccountWide;a.commandGuildSettings['command-one'].alpha.runAt='ON_DEMAND';a.commandGuildSettings['command-one'].alpha.reminderMinutes='"><img data-injected="true">';a.revertChatSeconds='"><img data-injected="true">';a.commandGuildSettings['command-one'].alpha.schedule.reminders[1].availability={enabled:false,maxPerDay:'"><img data-injected="true">'};
 const {page,errors}=await open(d);
 try{assert.equal(await page.locator('[data-injected]').count(),0);await page.locator('#account-settings').click();assert.equal(await page.locator('#dialog [data-injected]').count(),0);assert.deepEqual(errors,[]);}finally{await page.close();}
}

async function accountAndCommandDefaults(){
 const d=fixture(),a=d.Default['@fixture'].$AccountWide;a.guildRoster=numeric([{guildIndex:4,guildId:101,guildName:'Alpha'},{guildIndex:2,guildId:102,guildName:'Beta'}]);a.guildSchedulingTimeZones.beta='PT';a.commandGuildSettings['command-one'].beta.schedule.timeZone='PT';a.commandGuildSettings['command-one'].alpha.runAt='ON_DEMAND';
 const {page,errors}=await open(d);
 try{
 await page.locator('[data-command-option=reminderMinutes]').fill('30');await page.locator('[data-command-option=reminderRetryMinutes]').fill('45');await page.locator('[data-command-option=populateSound]').selectOption('NONE');await page.locator('[data-command-option=openStatusPanelOnRun]').check();await page.locator('#save-event').click();
 let saved=(await downloadData(page)).Default['@fixture'].$AccountWide,cfg=saved.commandGuildSettings['command-one'].alpha;assert.equal(cfg.reminderMinutes,30);assert.equal(cfg.reminderRetryMinutes,45);assert.equal(cfg.populateSound,'NONE');assert.equal(cfg.openStatusPanelOnRun,true);
 await page.locator('#account-settings').click();await page.locator('#account-default-guild').selectOption('4');await page.locator('#account-revert-seconds').fill('90');await page.locator('#account-default-zone').selectOption('CT');await page.locator('#apply-account-settings').click();
 saved=(await downloadData(page)).Default['@fixture'].$AccountWide;assert.equal(saved.defaultGuildIndex,4);assert.equal(saved.revertChatSeconds,90);assert.equal(saved.schedulingTimeZone,'CT');assert.equal(saved.commandGuildSettings['command-one'].alpha.schedule.timeZone,'CT');assert.equal(saved.commandGuildSettings['command-one'].beta.schedule.timeZone,'PT');assert.equal(saved.messages[1].useCount,5);
 await page.locator('[data-field=settingsRunAt]').selectOption('SCHEDULED');for(const key of ['reminderMinutes','reminderRetryMinutes','autoPopulateCooldownMinutes'])assert.equal(await page.locator(`[data-command-option="${key}"]`).isVisible(),false);assert.equal(await page.locator('[data-command-option=populateSound]').isVisible(),true);assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function zoneCommandOption(){
 const d=fixture(),cfg=d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha;cfg.runAt='ON_DEMAND';cfg.reminderMinutes=15;cfg.lastUsedAt=123;cfg.lastAutoPopulateSentAtByZone={Stonefalls:456};
 const {page,errors}=await open(d);
 try{
 await page.locator('[data-command-option=autoPopulateOnZone]').check();await page.locator('[data-command-option=autoPopulateCooldownMinutes]').fill('90');await page.locator('#save-event').click();
 let saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha;assert.equal(saved.autoPopulateOnZone,true);assert.equal(saved.autoPopulateCooldownMinutes,90);assert.equal(saved.reminderMinutes,undefined);assert.equal(saved.lastUsedAt,123);assert.equal(saved.lastAutoPopulateSentAtByZone.Stonefalls,456);
 await page.locator('[data-command-option=autoPopulateCooldownMinutes]').fill('0');await page.locator('#save-event').click();assert.match(await page.locator('#status').textContent(),/Zone cooldown.*positive/i);
 await page.locator('[data-command-option=autoPopulateCooldownMinutes]').fill('90');await page.locator('[data-command-option=autoPopulateOnZone]').uncheck();await page.locator('#save-event').click();saved=(await downloadData(page)).Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha;assert.equal(saved.autoPopulateOnZone,false);assert.equal(saved.autoPopulateCooldownMinutes,90);
 await page.locator('[data-field=settingsRunAt]').selectOption('SCHEDULED');assert.equal(await page.locator('[data-command-option=autoPopulateOnZone]').isVisible(),false);assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function plainCommandMessagePool(){
 const d=fixture(),a=d.Default['@fixture'].$AccountWide;a.commandGuildSettings['command-one'].alpha.runAt='ON_DEMAND';
 setLuaValue(a.messages,2,{id:'message-two',commandId:'command-one',guildName:'alpha',text:'Not assigned to any reminder',useCount:7});
 const {page,errors}=await open(d);
 try{
 await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
 assert.equal(await page.locator('#reminder-timeline').isVisible(),false);assert.match(await page.locator('#message-library-title').textContent(),/Message pool/);assert.equal(await page.locator('.message').count(),2);
 const card=page.locator('.message').first();await card.locator('summary').click();assert.equal(await card.locator('[data-field=variant]').isVisible(),false);
 assert.equal(await card.locator('[data-insert-token] option').evaluateAll(els=>els.some(el=>el.value.startsWith('%event'))),false);
 for(const token of ['%timeofday%','%guild%','%zone%'])assert.equal(await card.locator('[data-insert-token] option').evaluateAll((els,t)=>els.some(el=>el.value===t),token),true);
 for(const token of ['%time%','%morning%','%greeting%'])assert.equal(await card.locator('[data-insert-token] option').evaluateAll((els,t)=>els.some(el=>el.value===t),token),false);
 const template='Good %greeting%, %guild%! Meet tomorrow at 8PM ET in %zone%. %eventwhen%';await card.locator('textarea').fill(template);await card.locator('[data-action=preview-message]').click();
 assert.equal(await page.locator('#message-preview-template').textContent(),template);assert.match(await page.locator('#message-preview-output').textContent(),/Good morning, alpha!/);assert.match(await page.locator('#message-preview-output').textContent(),/%eventwhen%/);
 await page.locator('#message-preview-zone').fill('My house');assert.match(await page.locator('#message-preview-output').textContent(),/My house/);await page.locator('#close-dialog').click();
 await page.locator('[data-field=settingsRunAt]').selectOption('SCHEDULED');assert.equal(await card.locator('[data-insert-token] option[value="%eventwhen%"]').count(),1);
 await page.locator('[data-field=settingsRunAt]').selectOption('STARTUP');assert.equal(await page.locator('#reminder-timeline').isVisible(),false);assert.equal(await card.locator('[data-insert-token] option[value="%eventwhen%"]').count(),0);
 assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function runModeRelevantFields(){
 const d=fixture();d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.schedule.reminders={};
 const {page,errors}=await open(d);
 try{
 await page.locator('[data-field=settingsRunAt]').selectOption('ON_DEMAND');
 for(const key of ['eventDate','eventTime','eventDurationMinutes','recurrence'])assert.equal(await page.locator(`[data-field="${key}"]`).isVisible(),false);
 assert.equal(await page.locator('#next-occurrence').isVisible(),false);assert.equal(await page.locator('#rows').isVisible(),false);
 await page.locator('#save-event').click();let a=(await downloadData(page)).Default['@fixture'].$AccountWide;assert.equal(a.commandGuildSettings['command-one'].alpha.runAt,'ON_DEMAND');assert.equal(a.commandGuildSettings['command-one'].alpha.schedule.eventDate,'2026-10-27');assert.equal(await page.locator('[data-insert-token] option[value="%eventtime%"]').count(),0,'on demand hides event tokens');
 await page.locator('[data-field=settingsRunAt]').selectOption('STARTUP');await page.locator('#save-event').click();assert.equal(await page.locator('[data-field=eventDate]').isVisible(),false);
 a=(await downloadData(page)).Default['@fixture'].$AccountWide;assert.equal(a.commandGuildSettings['command-one'].alpha.runAt,'STARTUP');
 await page.locator('[data-field=settingsRunAt]').selectOption('SCHEDULED');assert.equal(await page.locator('[data-field=eventDate]').isVisible(),true);assert.equal(await page.locator('#rows').isVisible(),true);
 page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.type()==='prompt'?dialog.accept('New on-demand entry'):dialog.accept());await page.locator('#new-event').click();await page.locator('#form-name').fill('New on-demand entry');await page.locator('#modal-submit').click();
 assert.equal(await page.locator('[data-field=settingsRunAt]').inputValue(),'ON_DEMAND');assert.equal(await page.locator('[data-field=eventTime]').isVisible(),false);
 await page.locator('[data-field=settingsRunAt]').selectOption('SCHEDULED');await page.locator('#save-event').click();assert.equal(await page.locator('[data-field=settingsRunAt]').inputValue(),'SCHEDULED');assert.equal(await page.locator('#rows').isVisible(),true);
 await page.locator('#add-row').click();assert.equal(await page.locator('[data-field=settingsRunAt]').inputValue(),'SCHEDULED');assert.equal(await page.locator('.reminder').count(),1);
 assert.deepEqual(errors,[]);
 }finally{await page.close();}
}

async function libraryIncompleteDraft(){
 const directory=await mkdtemp(resolve(temp,'library-draft-')),server=createServer({libraryDir:directory});let page;
 try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;
 page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 const d=fixture();d.Default['@fixture'].$AccountWide.commandGuildSettings['command-one'].alpha.runAt='SCHEDULED';
 await page.goto(origin);await page.locator('#open').setInputFiles({name:'SmartChatMsg.lua',mimeType:'text/plain',buffer:Buffer.from(writeSavedVariables(d))});await page.locator('#workspace').waitFor({state:'visible'});
 await page.locator('.reminder [data-action=remove]').click();await page.locator('#save-server').click();await page.locator('#library-name').fill('Unfinished event');await page.locator('#library-save').click();
 await page.waitForFunction(()=>document.querySelector('#library-status')?.textContent.includes('Saved “Unfinished event”'),{},{timeout:5000});
 assert.match(await page.locator('#library-status').textContent(),/draft.*no reminders/i);
 const files=(await(await fetch(origin+'/api/library')).json()).files;assert.equal(files.length,1);
 const saved=parseSavedVariables(await(await fetch(origin+'/api/library/'+files[0].id)).text()).Default['@fixture'].$AccountWide;
 assert.equal(Object.keys(saved.commandGuildSettings['command-one'].alpha.schedule.reminders).length,0);assert.equal(saved.messages[1].text,'Hello %guild%');assert.equal(saved.messages[1].useCount,5);
 await page.locator('#close-dialog').click();await page.locator('#export').click();assert.match(await page.locator('#status').textContent(),/no reminders.*add.*reminder/i);
 await page.locator('#server-library').click();await page.locator('[data-library-id]').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Loaded shared configuration'));assert.equal(await page.locator('.reminder').count(),0);assert.deepEqual(errors,[]);
 }finally{if(page)await page.close();if(server.listening)await new Promise(resolve=>server.close(resolve));for(const name of await readdir(directory))await unlink(resolve(directory,name));await rmdir(directory);}
}

async function libraryHttpIntegration(){
 const directory=await mkdtemp(resolve(temp,'library-http-')),server=createServer({libraryDir:directory});
 let page;
 try{
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   const origin=`http://127.0.0.1:${server.address().port}`;
   page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
   await page.goto(origin);await page.locator('#open').setInputFiles({name:'SmartChatMsg.lua',mimeType:'text/plain',buffer:Buffer.from(writeSavedVariables(fixture()))});await page.locator('#workspace').waitFor({state:'visible'});
   await page.locator('[data-field=commandName]').fill('Real HTTP save');await page.locator('#save-event').click();await page.locator('#save-server').click();await page.locator('#library-name').fill('HTTP snapshot');await page.locator('#library-save').click();await page.waitForFunction(()=>document.querySelector('#library-status')?.textContent.includes('Saved “HTTP snapshot”'));
   const files=(await(await fetch(origin+'/api/library')).json()).files;assert.equal(files.length,1);const stored=await(await fetch(origin+'/api/library/'+files[0].id)).text();assert.equal(parseSavedVariables(stored).Default['@fixture'].$AccountWide.commands[1].name,'Real HTTP save');
   await page.locator('#close-dialog').click();await page.locator('[data-field=commandName]').fill('Temporary local edit');await page.locator('#save-event').click();await page.locator('#server-library').click();await page.locator('[data-library-id]').waitFor();await page.locator('[data-library-id]').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Loaded shared configuration'));assert.equal(await page.locator('[data-field=commandName]').inputValue(),'Real HTTP save');assert.deepEqual(errors,[]);
 }finally{
   if(page)await page.close();if(server.listening)await new Promise(resolve=>server.close(resolve));
   for(const name of await readdir(directory))await unlink(resolve(directory,name));await rmdir(directory);
 }
}

try {
  await newMessageOpens();
  await deliverySliderClarity();
  await commandSlidersAndSounds();
  await importantTimeCreationModal();
  await creationModals();
  await commandNumericInputRules();
  await commandSettingAttributeEscaping();
  await accountAndCommandDefaults();
  await zoneCommandOption();
  await plainCommandMessagePool();
  await runModeRelevantFields();
  await libraryIncompleteDraft();
  await libraryHttpIntegration();
  await sharedServerLibrary();
  await onceNoticeIgnoresInactiveFields();
  await monthlyWeekdayControls();
  await cachedGuildLegacyIdentity();
  await cachedGuildChoices();
  await liveRotationProjection();
  await cancelActiveRotation();
  await rotatingEventControls();
  await availabilityLongPromotion();
  await reminderAvailabilityEditing();
  await availabilityBlockedDay();
  await messageNamesAndDragOrder();
  await overviewDefaultsAndPlainHelp();
  await dragDayTimeline();
  await effectiveReminderDatesAndNumericBounds();
  await batchEventSharing();
  await overlapCardHighlights();
  await timelineOrderingAndPoolPreview();
  await populatedAccountDefault();
  await dayTimeline();
  await clocksOccurrenceStatesAndHelp();
  await relevantSettingsAndMigration();
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
