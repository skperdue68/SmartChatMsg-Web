import { portableEvent, stageImport } from "/portable.js";
import {
  parseSavedVariables,
  writeSavedVariables,
  setLuaValue,
} from "/lua-data.js";
import * as model from "/model.js";
const $ = (s) => document.querySelector(s),
  vals = (o) => Object.values(o || {}),
  esc = (x) =>
    String(x ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let lastRenderedKey;
let base,
  data,
  latest,
  accountName,
  guild,
  selected,
  dirty = false,
  filename = "SmartChatMsg.lua",
  currentView = "editor",
  showCombined = false;
const guildZone = () =>
  account()?.guildSchedulingTimeZones?.[guild] ||
  account()?.schedulingTimeZone ||
  "ET";
const clone = (x) => model.cloneSavedData(x),
  account = () => data?.Default?.[accountName]?.$AccountWide,
  all = () => model.events(account()),
  selectedEvent = () =>
    all().find((e) => e.commandId === selected && e.guild === guild),
  guildEvents = () => all().filter((e) => e.guild === guild),
  list = () =>
    guildEvents().filter((e) => showCombined || !e.schedule.mergedInto);
const status = (s, error = false) => {
  $("#status").textContent = s;
  $("#status").classList.toggle("error", error);
};
function requireValidTimeline(schedule) {
  if (schedule.timelineVersion !== 1) return;
  const errors = model.validateTimelineForAddon(schedule);
  if (errors.length) throw Error(errors.join(" "));
}
function validateEditedTimelines(snapshot = data) {
  for (const entry of model.accounts(snapshot))
    for (const event of model.events(entry.value)) {
      const original =
        base.Default?.[entry.name]?.$AccountWide?.commandGuildSettings?.[
          event.commandId
        ]?.[event.guild]?.schedule;
      if (
        event.schedule.timelineVersion === 1 &&
        JSON.stringify(event.schedule) !== JSON.stringify(original)
      ) {
        const errors = model.validateTimelineForAddon(event.schedule);
        if (errors.length)
          throw Error(
            `${entry.name} / ${event.guild} / ${event.command.name}: ${errors.join(" ")}`,
          );
      }
    }
}
function changed() {
  dirty = true;
  status(
    "Unsaved configuration changes · Download updated Lua when your review is complete.",
  );
}
const opts = (options, value) =>
  options
    .map((x) => {
      const [v, l] = Array.isArray(x) ? x : [x, x];
      return `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(l)}</option>`;
    })
    .join("");
const input = (label, key, value, type = "text") =>
  `<label>${esc(label)}<input data-field="${key}" type="${type}" value="${esc(value)}"></label>`;
const select = (label, key, value, options) =>
  `<label>${esc(label)}<select data-field="${key}">${opts(options, value)}</select></label>`;
const check = (label, key, value) =>
  `<label class="check"><input type="checkbox" data-field="${key}" ${value ? "checked" : ""}>${esc(label)}</label>`;
function tableArray(items) {
  const t = {};
  items.forEach((v, i) => setLuaValue(t, i + 1, v));
  return t;
}
function append(table, value) {
  setLuaValue(
    table,
    Math.max(0, ...Object.keys(table).map(Number).filter(Number.isFinite)) + 1,
    value,
  );
}
function dialog(title, text) {
  $("#dialog-body").innerHTML = `<h2>${esc(title)}</h2><pre>${esc(text)}</pre>`;
  $("#dialog").showModal();
}
$("#close-dialog").onclick = () => $("#dialog").close();
async function readFile(file) {
  if (!file) throw Error("Choose a file.");
  if (file.size > 20 * 1024 * 1024)
    throw Error("Choose a file smaller than 20 MB.");
  return parseSavedVariables(await file.text());
}
$("#open").onchange = async (e) => {
  try {
    if (
      dirty &&
      !confirm("Discard the current unsaved edits and open another file?")
    )
      return;
    const f = e.target.files[0];
    const parsed = await readFile(f);
    if (!model.accounts(parsed).length)
      throw Error("No account-wide SmartChatMsg data found.");
    base = parsed;
    data = clone(base);
    latest = null;
    dirty = false;
    filename = f.name.replace(/\.txt$/i, ".lua");
    $("#workspace").hidden = false;
    $("#welcome").hidden = true;
    $("#account").innerHTML = opts(model.accounts(data).map((a) => a.name));
    accountName = $("#account").value;
    refreshGuilds();
    status(`Opened ${f.name}. Choose the account and guild you want to edit.`);
  } catch (err) {
    status(err.message, true);
  } finally {
    e.target.value = "";
  }
};
$("#latest").onchange = async (e) => {
  try {
    latest = await readFile(e.target.files[0]);
    status(
      "Latest snapshot loaded. Export will preserve its runtime history and report simultaneous configuration edits.",
    );
  } catch (err) {
    status(err.message, true);
  } finally {
    e.target.value = "";
  }
};
$("#account").onchange = () => {
  accountName = $("#account").value;
  refreshGuilds();
};
$("#guild").onchange = () => {
  guild = $("#guild").value;
  selected = null;
  render();
};
$("#search").oninput = renderList;
$("#show-combined").onchange = (e) => {
  showCombined = e.target.checked;
  render();
};
function renderGuildTimezone() {
  const a = account();
  $("#guild-timezone").innerHTML = opts(
    [
      ["", "Account default (" + (a.schedulingTimeZone || "ET") + ")"],
      "ET",
      "CT",
      "MT",
      "PT",
    ],
    a.guildSchedulingTimeZones?.[guild] || "",
  );
  $("#guild-timezone").disabled = !guild;
}
$("#guild-timezone").onchange = () => {
  const a = account(),
    override = $("#guild-timezone").value,
    zone = override || a.schedulingTimeZone || "ET";
  if (
    !confirm(
      `Set ${guild} scheduling timezone to ${zone}? All schedules for this guild keep their entered dates and clock times. Their UTC moments change. Other guilds remain unchanged.`,
    )
  ) {
    renderGuildTimezone();
    return;
  }
  a.guildSchedulingTimeZones ??= {};
  if (override) a.guildSchedulingTimeZones[guild] = override;
  else delete a.guildSchedulingTimeZones[guild];
  for (const event of guildEvents())
    if (event.settings.schedule) event.settings.schedule.timeZone = zone;
  changed();
  render();
};
function refreshGuilds() {
  const a = account();
  const guilds = [
    ...new Set([
      ...all().map((e) => e.guild),
      ...vals(a.messages)
        .map((m) => m.guildName?.trim().toLowerCase())
        .filter(Boolean),
    ]),
  ].sort();
  $("#guild").innerHTML = opts(guilds);
  guild = $("#guild").value;
  selected = null;
  render();
}
function render() {
  renderGuildTimezone();
  renderList();
  if (currentView === "calendar") renderCalendar();
  if (currentView === "transfer") renderTransfer();
}
function renderList() {
  const entries = list().filter((e) =>
    (e.command?.name || "")
      .toLowerCase()
      .includes($("#search").value.toLowerCase()),
  );
  if (!selected || !list().some((e) => e.commandId === selected))
    selected = entries[0]?.commandId;
  $("#events").innerHTML =
    entries
      .map(
        (e) =>
          `<button class="event-item ${selected === e.commandId ? "active" : ""}" data-id="${esc(e.commandId)}"><strong>${esc((e.command?.name || "Unnamed event") + (e.schedule.mergedInto ? " [Combined]" : ""))}</strong><span>${esc(e.schedule?.eventDate || "Unscheduled")} · ${esc(e.schedule?.recurrence || "NONE")}</span></button>`,
      )
      .join("") || '<p class="empty">No events for this guild.</p>';
  $("#events")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => {
          selected = b.dataset.id;
          renderList();
        }),
    );
  renderDetail();
}
function guildSlot(e) {
  const named = vals(account().messages).filter(
    (m) =>
      typeof m.guildName === "string" &&
      m.guildName.trim() &&
      Number.isInteger(m.guildIndex),
  );
  const candidates = new Set(
    named
      .filter((m) => m.guildName.trim().toLowerCase() === e.guild)
      .map((m) => m.guildIndex),
  );
  for (const field of ["guildIndex", "lastUsedGuildIndex"])
    if (Number.isInteger(e.settings[field])) candidates.add(e.settings[field]);
  if (candidates.size !== 1) return null;
  const slot = [...candidates][0];
  if (
    slot < 1 ||
    slot > 5 ||
    named.some(
      (m) =>
        m.guildIndex === slot && m.guildName.trim().toLowerCase() !== e.guild,
    )
  )
    return null;
  return slot;
}
function eventMessages(e) {
  const slot = guildSlot(e);
  return vals(account().messages).filter(
    (m) =>
      m.commandId === e.commandId &&
      (typeof m.guildName === "string" && m.guildName.trim()
        ? m.guildName.trim().toLowerCase() === e.guild
        : slot !== null && m.guildIndex === slot),
  );
}
function ambiguousMessages(e) {
  return (
    guildSlot(e) === null &&
    vals(account().messages).some(
      (m) =>
        m.commandId === e.commandId && (!m.guildName || !m.guildName.trim()),
    )
  );
}
function anchorMarkup(a, prefix, s) {
  a = a || {
    kind: "OFFSET",
    minutes: 0,
  };
  return `${select("Anchor", prefix + ".kind", a.kind || "OFFSET", [
    ["OFFSET", "Minutes from event"],
    ["DAY", "Day and local time"],
    ["MARK", "Important time"],
  ])}${
    a.kind === "DAY"
      ? input("Days from event", prefix + ".days", a.days ?? 0, "number") +
        input(
          "Local clock (e.g. 08:00 PM)",
          prefix + ".time",
          a.time || "08:00 PM",
        )
      : a.kind === "MARK"
        ? select(
            "Important time",
            prefix + ".name",
            a.name || "",
            Object.entries(s.importantTimes || {}).map(([id, v]) => [
              id,
              v.label || id,
            ]),
          )
        : input(
            "Minutes (negative = before)",
            prefix + ".minutes",
            a.minutes ?? 0,
            "number",
          )
  }`;
}
function renderDetail() {
  const renderKey = accountName + "|" + guild + "|" + selected,
    preserveScroll = lastRenderedKey === renderKey,
    scrollY = window.scrollY;
  lastRenderedKey = renderKey;
  const e = selectedEvent();
  if (!e) {
    $("#detail").innerHTML =
      '<div class="panel empty">Choose a guild event, or create a new event.</div>';
    return;
  }
  const s = (e.settings.schedule ??= {}),
    messages = eventMessages(e),
    rows = vals(s.reminders);
  $("#detail").innerHTML =
    `<section class="panel"><div class="heading"><div><p class="eyebrow">EVENT SETTINGS</p><h2>${esc(e.command?.name)}</h2></div><span class="badge">${s.timelineVersion === 1 ? "TIMELINE" : "LEGACY SCHEDULE"}</span></div><div class="grid">${input("Event name", "commandName", e.command.name)}${input("Actual event date", "eventDate", s.eventDate || "", "date")}${input("Actual event clock", "eventTime", s.eventTime || "08:00 PM")}<label>Scheduling timezone (guild)<input value="${esc(guildZone())}" readonly></label>${select("Output channel", "outputChannel", account().chatChannels?.[e.commandId]?.[guild] || "Guild", ["Guild", "Officer", "Zone", "Group"])}${select(
      "Run at",
      "settingsRunAt",
      e.settings.runAt || "ON_DEMAND",
      [
        ["ON_DEMAND", "On demand"],
        ["STARTUP", "Startup"],
        ["SCHEDULED", "Scheduled"],
      ],
    )}${select("Recurrence", "recurrence", s.recurrence || "NONE", ["NONE", "DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY_DATE", "MONTHLY_WEEKDAY"])}${select("Special pattern", "specialPattern", s.specialPattern || "NONE", ["NONE", "MONTH_FINAL", "FACTION_ROTATION"])}${input("Recurrence interval", "recurrenceInterval", s.recurrenceInterval || 1, "number")}${input("Rotation weeks per faction", "rotationWeeks", s.rotationWeeks || 4, "number")}${input("Faction order (comma separated)", "rotationFactions", vals(s.rotationFactions).join(", ") || "AD, EP, DC")}${select(
      "Ambiguous DST clock",
      "eventFold",
      s.eventFold || "FIRST",
      [
        ["FIRST", "First occurrence"],
        ["SECOND", "Second occurrence"],
      ],
    )}</div><p class="help">Weekly weekdays (leave empty to use the event date's weekday)</p><div class="actions weekdays">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => `<label class="check"><input type="checkbox" data-weekday="${i + 1}" ${s.weekdays?.[i + 1] ? "checked" : ""}>${d.slice(0, 3)}</label>`).join("")}</div><div class="actions" style="margin-top:18px">${check("Enabled", "enabled", s.enabled !== false)}${check("Paused", "paused", s.paused)}<button id="save-event" class="gold">Apply event settings</button></div><p class="help">Enter the real event date and time. Reminder offsets are measured from this moment; calendar-day anchors use the event timezone.</p></section><section class="panel"><div class="heading"><h2>Reminder timeline</h2>${s.timelineVersion !== 1 ? '<button id="convert-legacy">Review legacy conversion</button>' : ""}<button id="add-row" class="gold">+ Add reminder</button></div>${s.timelineVersion !== 1 ? '<p class="help">This event still uses legacy scheduling. Convert this schedule to review its existing timing and message pools before adding reminders.</p>' : ""}<div id="rows">${rows.map((r, i) => `<article class="reminder ${r.once ? "milestone" : ""}" data-row="${esc(r.id)}"><div class="heading"><h3>${i + 1}. ${esc(r.label || "Reminder")}</h3><span class="badge">${r.once ? "◆ MILESTONE" : "↻ FREQUENCY WINDOW"}</span></div><div class="grid">${input("Reminder label", "label", r.label || "")}${input("Repeat every (minutes)", "intervalMinutes", r.intervalMinutes ?? 60, "number")}${input("Late allowance (minutes)", "lateMinutes", r.lateMinutes ?? 5, "number")}</div><h3>Starts</h3><div class="grid">${anchorMarkup(r.start, "start", s)}</div><h3>Finishes</h3><div class="grid">${anchorMarkup(r.finish || r.start, "finish", s)}</div><div class="actions">${check("Send once", "once", r.once)}${check("Time-sensitive", "timeSensitive", r.timeSensitive)}${check("Once may send until window finishes", "onceUntilFinish", r.onceUntilFinish)}</div><p class="help">Choose a message pool. The addon selects a message from this pool when the reminder is due.</p><div class="pool">${messages.map((m, j) => `<label class="check"><input type="checkbox" data-message="${esc(m.id)}" ${vals(r.messageIds).includes(m.id) ? "checked" : ""}><span>${j + 1}. ${esc(m.text)}</span></label>`).join("") || '<span class="help">Add a message below first.</span>'}</div><div class="actions"><button data-action="save">Apply reminder</button><button data-action="preview">Preview here</button><button data-action="up" ${i === 0 ? "disabled" : ""}>↑</button><button data-action="down" ${i === rows.length - 1 ? "disabled" : ""}>↓</button><button data-action="remove" class="danger">Remove</button></div></article>`).join("") || '<div class="empty">No timeline reminders yet.</div>'}</div></section><section class="panel"><div class="heading"><h2>Important times</h2><button id="add-mark">+ Add time</button></div><p class="help">Name an important moment, such as doors opening or ticket sales closing, and reuse it in reminder anchors.</p>${Object.entries(
      s.importantTimes || {},
    )
      .map(
        ([id, m]) =>
          `<div class="grid mark" data-id="${esc(id)}">${input("Label", "label", m.label)}${input("Minutes from event", "offsetMinutes", m.offsetMinutes, "number")}<div class="actions"><button data-action="save-mark">Apply</button><button data-action="remove-mark" class="danger">Remove</button></div></div>`,
      )
      .join(
        "",
      )}</section><section class="panel"><div class="heading"><h2>Message library <span class="badge">${messages.length} VARIANTS</span></h2><button id="add-message">+ Add message</button></div><p class="help">Existing IDs, usage and private locks are preserved. Dynamic placeholders are expanded by the addon.</p>${ambiguousMessages(e) ? '<p class="help" role="alert">Some legacy messages have no guild name and their guild slot cannot be resolved safely. They are omitted from this editor and remain untouched in the file.</p>' : ""}${messages.map((m, i) => `<details class="message" data-id="${esc(m.id)}"><summary>Message ${i + 1} ${m.locked ? " - Locked" : ""} - ${esc(m.text.slice(0, 65))}${m.text.length > 65 ? "..." : ""}</summary><div class="heading"><strong>Message ${i + 1}</strong>${select("Variant", "variant", s.messageVariants?.[m.id] || "ALL", ["ALL", "REGULAR", "FINAL", "AD", "EP", "DC"])}</div><textarea aria-label="Message ${i + 1}" ${m.locked ? "readonly" : ""}>${esc(m.text)}</textarea><div class="actions"><button data-action="save-message" ${m.locked ? "disabled" : ""}>Apply message</button><button data-action="delete-message" class="danger" ${m.locked ? "disabled" : ""}>Delete message</button><select data-insert-token aria-label="Insert substitution"><option value="">Insert substitution...</option>${opts(["%guild%", "%greeting%", "%zone%", ...Object.keys(s.importantTimes || {}).flatMap((key) => ["eventwhen", "eventtime", "eventdate", "eventcountdown"].map((token) => "%" + token + ":" + key + "%"))])}</select></div></details>`).join("")}</section>`;
  $("#save-event").onclick = () => {
    const p = $("#detail>.panel");
    const v = fields(p);
    if (
      v.settingsRunAt === "SCHEDULED" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(v.eventDate) ||
        !/^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(v.eventTime))
    ) {
      status("Use an event date and a clock such as 08:00 PM.", true);
      return;
    }
    const candidate = { ...clone(s), ...v, timeZone: guildZone() };
    delete candidate.commandName;
    delete candidate.outputChannel;
    delete candidate.settingsRunAt;
    try {
      requireValidTimeline(candidate);
    } catch (error) {
      status(error.message, true);
      return;
    }
    account().chatChannels ??= {};
    account().chatChannels[e.commandId] ??= {};
    account().chatChannels[e.commandId][guild] = v.outputChannel;
    e.settings.runAt = v.settingsRunAt;
    delete v.outputChannel;
    delete v.settingsRunAt;
    v.timeZone = guildZone();
    e.command.name = v.commandName.trim() || e.command.name;
    delete v.commandName;
    v.weekdays = {};
    p.querySelectorAll("[data-weekday]:checked").forEach((x) =>
      setLuaValue(v.weekdays, Number(x.dataset.weekday), true),
    );
    v.rotationFactions = tableArray(
      v.rotationFactions
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    );
    Object.assign(s, v);
    changed();
    renderList();
  };
  if ($("#convert-legacy"))
    $("#convert-legacy").onclick = () => convertLegacy(e);
  $("#add-row").onclick = () => {
    if (s.timelineVersion !== 1) {
      convertLegacy(e);
      return;
    }
    s.timelineVersion = 1;
    s.mode = "EVENT";
    s.reminders ??= {};
    append(s.reminders, {
      id: crypto.randomUUID(),
      label: "New reminder",
      start: {
        kind: "OFFSET",
        minutes: -60,
      },
      finish: {
        kind: "OFFSET",
        minutes: 0,
      },
      once: false,
      timeSensitive: false,
      intervalMinutes: 30,
      lateMinutes: 5,
      messageIds: tableArray(messages.map((m) => m.id)),
    });
    changed();
    renderDetail();
  };
  $("#rows")
    .querySelectorAll(".reminder")
    .forEach((card) => {
      const r = rows.find((r) => r.id === card.dataset.row);
      function bindAnchorSelectors() {
        card.querySelectorAll('select[data-field$=".kind"]').forEach(
          (sel) =>
            (sel.onchange = () => {
              const key = sel.dataset.field.split(".")[0],
                anchor = {
                  kind: sel.value,
                  ...(sel.value === "DAY"
                    ? { days: 0, time: "08:00 PM" }
                    : sel.value === "MARK"
                      ? { name: Object.keys(s.importantTimes || {})[0] || "" }
                      : { minutes: 0 }),
                };
              sel.closest(".grid").innerHTML = anchorMarkup(anchor, key, s);
              bindAnchorSelectors();
            }),
        );
      }
      bindAnchorSelectors();
      card.querySelectorAll("[data-action]").forEach(
        (b) =>
          (b.onclick = () => {
            const action = b.dataset.action;
            if (action === "save" || action === "preview") {
              const update = fields(card);
              if (update.intervalMinutes < 1 || update.lateMinutes < 0) {
                status(
                  "Repeat interval must be positive and late allowance cannot be negative.",
                  true,
                );
                return;
              }
              const candidate = clone(s),
                candidateRow = {
                  ...clone(r),
                  ...update,
                  messageIds: tableArray(
                    [...card.querySelectorAll("[data-message]:checked")].map(
                      (x) => x.dataset.message,
                    ),
                  ),
                };
              const key = Object.keys(candidate.reminders).find(
                (k) => candidate.reminders[k].id === r.id,
              );
              candidate.reminders[key] = candidateRow;
              try {
                requireValidTimeline(candidate);
              } catch (error) {
                status(error.message, true);
                return;
              }
              Object.assign(r, candidateRow);
              if (r.intervalMinutes < 1 || r.lateMinutes < 0) {
                status(
                  "Repeat interval must be positive and late allowance cannot be negative.",
                  true,
                );
                return;
              }
              changed();
              if (action === "preview") preview(e, r);
              else renderDetail();
            } else if (action === "remove") {
              s.reminders = tableArray(rows.filter((x) => x !== r));
              changed();
              renderDetail();
            } else {
              const i = rows.indexOf(r),
                j = i + (action === "up" ? -1 : 1);
              [rows[i], rows[j]] = [rows[j], rows[i]];
              s.reminders = tableArray(rows);
              changed();
              renderDetail();
            }
          }),
      );
    });
  $("#add-mark").onclick = () => {
    s.importantTimes ??= {};
    const name = prompt(
      "Important time key (letters, digits, underscore; e.g. tickets):",
      "tickets",
    );
    if (!name) return;
    if (
      !/^[a-z][a-z0-9_]*$/.test(name) ||
      Object.hasOwn(s.importantTimes, name)
    ) {
      status("Choose a unique lowercase key beginning with a letter.", true);
      return;
    }
    s.importantTimes[name] = {
      label: name,
      offsetMinutes: -30,
    };
    changed();
    renderDetail();
  };
  $("#detail")
    .querySelectorAll(".mark")
    .forEach((el) =>
      el.querySelectorAll("button").forEach(
        (b) =>
          (b.onclick = () => {
            if (b.dataset.action === "remove-mark") {
              if (
                rows.some((r) =>
                  [r.start, r.finish].some(
                    (a) => a?.kind === "MARK" && a.name === el.dataset.id,
                  ),
                )
              ) {
                status(
                  "This important time is used by a reminder. Change its anchors first.",
                  true,
                );
                return;
              }
              delete s.importantTimes[el.dataset.id];
            } else {
              const candidate = clone(s);
              Object.assign(
                candidate.importantTimes[el.dataset.id],
                fields(el),
              );
              try {
                requireValidTimeline(candidate);
              } catch (error) {
                status(error.message, true);
                return;
              }
              Object.assign(s.importantTimes[el.dataset.id], fields(el));
            }
            changed();
            renderDetail();
          }),
      ),
    );
  $("#add-message").onclick = () => {
    account().messages ??= {};
    append(account().messages, {
      id: crypto.randomUUID(),
      commandId: e.commandId,
      guildName: guild,
      ...(guildSlot(e) ? { guildIndex: guildSlot(e) } : {}),
      text: "New event announcement",
      useCount: 0,
    });
    changed();
    renderDetail();
  };
  $("#detail")
    .querySelectorAll(".message")
    .forEach((el) => {
      el.querySelector("[data-insert-token]").onchange = (ev) => {
        const area = el.querySelector("textarea");
        if (area.readOnly) return;
        area.setRangeText(
          ev.target.value,
          area.selectionStart,
          area.selectionEnd,
          "end",
        );
        area.focus();
        ev.target.value = "";
      };
      el.querySelector("[data-action=delete-message]").onclick = () => {
        const m = messages.find((m) => m.id === el.dataset.id);
        if (
          m.locked ||
          !confirm(
            "Delete this message and remove it from every reminder pool?",
          )
        )
          return;
        account().messages = tableArray(
          vals(account().messages).filter((item) => item.id !== m.id),
        );
        for (const event of all()) {
          const schedule = event.settings.schedule;
          if (!schedule) continue;
          if (schedule.messageVariants) delete schedule.messageVariants[m.id];
          if (schedule.messagePhases) delete schedule.messagePhases[m.id];
          for (const row of vals(schedule.reminders))
            row.messageIds = tableArray(
              vals(row.messageIds).filter((id) => id !== m.id),
            );
        }
        changed();
        renderDetail();
      };
      el.querySelector("[data-action=save-message]").onclick = () => {
        const m = messages.find((m) => m.id === el.dataset.id);
        if (m.locked) return;
        m.text = el.querySelector("textarea").value;
        s.messageVariants ??= {};
        s.messageVariants[m.id] = el.querySelector(
          "select[data-field=variant]",
        ).value;
        changed();
      };
    });
  if (preserveScroll)
    requestAnimationFrame(() =>
      window.scrollTo({
        top: scrollY,
        behavior: "instant",
      }),
    );
}
function fields(root) {
  const out = {};
  root.querySelectorAll("[data-field]").forEach((el) => {
    const keys = el.dataset.field.split(".");
    let obj = out;
    keys.slice(0, -1).forEach((k) => (obj = obj[k] ??= {}));
    obj[keys.at(-1)] =
      el.type === "checkbox"
        ? el.checked
        : el.type === "number"
          ? Number(el.value)
          : el.value;
  });
  return out;
}
$("#new-event").onclick = () => {
  const a = account();
  let g = guild;
  if (!g)
    g = prompt("Guild name (exact game guild name):")?.trim().toLowerCase();
  if (!g) return;
  const name = prompt("Event name:");
  if (!name?.trim()) return;
  const id = crypto.randomUUID();
  a.commands ??= {};
  append(a.commands, {
    id,
    name: name.trim(),
  });
  a.commandGuildSettings ??= {};
  a.commandGuildSettings[id] = {
    [g]: {
      runAt: "SCHEDULED",
      schedule: {
        enabled: true,
        paused: false,
        mode: "EVENT",
        timelineVersion: 1,
        eventDate: new Date().toISOString().slice(0, 10),
        eventTime: "08:00 PM",
        timeZone:
          a.guildSchedulingTimeZones?.[g] || a.schedulingTimeZone || "ET",
        recurrence: "NONE",
        specialPattern: "NONE",
        reminders: {},
        importantTimes: {},
        messageVariants: {},
      },
    },
  };
  changed();
  refreshGuilds();
  $("#guild").value = g;
  guild = g;
  selected = id;
  render();
};
function preview(e, r) {
  let at, window;
  try {
    const from = Math.floor(Date.now() / 1000) - 86400;
    at =
      model.projectedOccurrences(e.schedule, from, from + 86400 * 90)[0] ??
      model.scheduleEventUtc(e.schedule);
    if (at)
      window = model
        .reminderWindows(e.schedule, at)
        .find((w) => w.row.id === r.id);
  } catch {}
  const sim = window
    ? Math.floor((window.start + window.end) / 2)
    : at || Math.floor(Date.now() / 1000);
  const localDate = new Date(
    sim * 1000 - new Date(sim * 1000).getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16);
  $("#dialog-body").innerHTML =
    `<h2>Preview - ${esc(r.label)}</h2><p class="help">Simulate a time inside this reminder. The addon chooses from the eligible pool and always requires Enter.</p><div class="grid two"><label>Simulated local time<input id="simulate-time" type="datetime-local" value="${localDate}"></label><label>Simulated player zone<input id="simulate-zone" value="Guild Hall"></label></div><p id="simulate-status" class="help"></p><div id="simulate-messages"></div><p class="help">Event, deadline, faction, guild and zone substitutions use this simulated time. Additional natural-language date/time parsing and actual player context are applied in ESO.</p>`;
  function update() {
    const now = Math.floor(
        new Date($("#simulate-time").value).getTime() / 1000,
      ),
      hour = new Date(now * 1000).getHours(),
      tod = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening",
      tokens = {
        timeofday: tod,
        greeting: tod,
        time: tod,
        guild,
        zone: $("#simulate-zone").value,
      };
    const eligible =
      at && model.messagesForReminder
        ? model.messagesForReminder(e.schedule, r, at, eventMessages(e))
        : eventMessages(e).filter((m) => vals(r.messageIds).includes(m.id));
    const state =
      at && model.simulateReminder
        ? model.simulateReminder(e.schedule, r, at, now)
        : null;
    $("#simulate-status").textContent =
      `${state?.status || "No projected event"} - ${e.schedule.timeZone} event timezone - ${eligible.length} eligible message(s)`;
    $("#simulate-messages").replaceChildren();
    for (const m of eligible) {
      const p = document.createElement("div");
      p.className = "preview";
      p.textContent = model.previewMessage(m.text,e.schedule,at,now,{guild,zone:$("#simulate-zone").value,localHour:hour});
      $("#simulate-messages").append(p);
    }
    if (!eligible.length)
      $("#simulate-messages").textContent = "No messages in the eligible pool.";
  }
  $("#simulate-time").oninput = update;
  $("#simulate-zone").oninput = update;
  update();
  $("#dialog").showModal();
}
document.querySelectorAll("nav button").forEach(
  (b) =>
    (b.onclick = () => {
      currentView = b.dataset.view;
      document
        .querySelectorAll("nav button")
        .forEach((x) => x.classList.toggle("active", x === b));
      ["editor", "calendar", "transfer"].forEach(
        (id) => ($("#" + id).hidden = id !== currentView),
      );
      if (currentView === "editor") renderList();
      if (currentView === "calendar") renderCalendar();
      if (currentView === "transfer") renderTransfer();
    }),
);
let calMode = "week",
  calDate = "",
  calKind = "all",
  calChannel = "all",
  calState = "active";
const zoneNames = {
  ET: "America/New_York",
  CT: "America/Chicago",
  MT: "America/Denver",
  PT: "America/Los_Angeles",
};
function calendarBoundary(dateKey, zone) {
  const value = model.scheduleEventUtc({
    eventDate: dateKey,
    eventTime: "12:00 AM",
    timeZone: zone,
    eventFold: "FIRST",
  });
  if (!Number.isFinite(value)) throw Error("Invalid overview date.");
  return value;
}
function renderCalendar() {
  const el = $("#calendar"),
    zone = guildZone(),
    timeZone = zoneNames[zone];
  if (!calDate) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(new Date())
        .map((p) => [p.type, p.value]),
    );
    calDate = parts.year + "-" + parts.month + "-" + parts.day;
  }
  el.innerHTML = `<div class="heading"><div><p class="eyebrow">THE BIG PICTURE</p><h2>Guild schedule</h2></div><span class="badge">${esc(guild)} / ${esc(zone)}</span></div><div class="grid">${select(
    "View",
    "view",
    calMode,
    [
      ["week", "Week"],
      ["month", "Month"],
    ],
  )}${input("Starting date", "date", calDate, "date")}${select(
    "Show",
    "kind",
    calKind,
    [
      ["all", "All events and reminders"],
      ["windows", "Frequency windows"],
      ["milestones", "Milestones"],
    ],
  )}${select("Output channel", "channel", calChannel, ["all", "Guild", "Officer", "Zone", "Group"])}${select(
    "Schedule state",
    "state",
    calState,
    [
      ["active", "Enabled schedules"],
      ["all", "All configured schedules"],
      ["paused", "Paused schedules"],
      ["disabled", "Disabled schedules"],
    ],
  )}</div><p class="help">Dates and clocks use this guild's ${esc(zone)} scheduling timezone. Clock labels reflect daylight saving time. Coral edges indicate overlapping frequency windows.</p><div class="calendar-grid" id="calendar-grid"></div>`;
  el.querySelector("[data-field=view]").onchange = (e) => {
    calMode = e.target.value;
    renderCalendar();
  };
  el.querySelector("[data-field=date]").onchange = (e) => {
    calDate = e.target.value;
    renderCalendar();
  };
  el.querySelector("[data-field=kind]").onchange = (e) => {
    calKind = e.target.value;
    renderCalendar();
  };
  el.querySelector("[data-field=channel]").onchange = (e) => {
    calChannel = e.target.value;
    renderCalendar();
  };
  el.querySelector("[data-field=state]").onchange = (e) => {
    calState = e.target.value;
    renderCalendar();
  };
  // A UTC civil-date cursor is only a calendar counter. Actual day boundaries
  // are resolved separately in the guild timezone, including DST transitions.
  const civil = new Date(calDate + "T12:00:00Z");
  if (!Number.isFinite(+civil)) return;
  if (calMode === "month") civil.setUTCDate(1);
  const days =
    calMode === "week"
      ? 7
      : new Date(
          Date.UTC(civil.getUTCFullYear(), civil.getUTCMonth() + 1, 0),
        ).getUTCDate();
  const endCivil = new Date(civil);
  endCivil.setUTCDate(endCivil.getUTCDate() + days);
  const start = calendarBoundary(civil.toISOString().slice(0, 10), zone),
    end = calendarBoundary(endCivil.toISOString().slice(0, 10), zone),
    items = [];
  for (const e of list()) {
    if (e.settings.runAt !== "SCHEDULED" && calState !== "all") continue;
    if (
      calChannel !== "all" &&
      (account().chatChannels?.[e.commandId]?.[guild] || "Guild") !== calChannel
    )
      continue;
    if (
      (calState === "active" &&
        (e.schedule.enabled === false || e.schedule.paused)) ||
      (calState === "paused" && !e.schedule.paused) ||
      (calState === "disabled" && e.schedule.enabled !== false)
    )
      continue;
    try {
      if ((e.schedule.timeZone || zone) !== zone)
        throw Error(
          "Schedule timezone differs from the guild. Set the guild timezone explicitly to align its schedules.",
        );
      for (const at of model.projectedOccurrences(
        e.schedule,
        start - 86400 * 32,
        end + 86400 * 32,
      )) {
        if (calKind === "all" && at >= start && at < end)
          items.push({
            at,
            end: at,
            e,
            label: "Actual event",
            milestone: true,
            event: true,
          });
        for (const w of model.reminderWindows(e.schedule, at)) {
          if (w.end < start || w.start >= end) continue;
          if (
            (calKind === "milestones" && !w.row.once) ||
            (calKind === "windows" && w.row.once)
          )
            continue;
          items.push({
            at: w.start,
            end: w.end,
            e,
            label: w.row.label,
            milestone: w.row.once,
            interval: w.row.intervalMinutes,
          });
        }
      }
    } catch (err) {
      status(
        "Some calendar entries could not be projected: " + err.message,
        true,
      );
    }
  }
  for (let i = 0; i < days; i++) {
    const date = new Date(civil);
    date.setUTCDate(date.getUTCDate() + i);
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    const key = date.toISOString().slice(0, 10),
      from = calendarBoundary(key, zone),
      until = calendarBoundary(next.toISOString().slice(0, 10), zone);
    const day = document.createElement("div");
    day.className = "calendar-day";
    day.dataset.date = key;
    day.innerHTML = `<b>${esc(date.toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }))}</b>`;
    for (const item of items.filter(
      (x) => x.at < until && (x.milestone ? x.at >= from : x.end > from),
    )) {
      const overlap =
        !item.milestone &&
        items.some(
          (x) =>
            x !== item && !x.milestone && x.at < item.end && x.end > item.at,
        );
      const button = document.createElement("button");
      button.className = "calendar-event" + (overlap ? " overlap" : "");
      button.dataset.kind = item.event
        ? "event"
        : item.milestone
          ? "milestone"
          : "window";
      const clockAt = (t) =>
        new Date(t * 1000).toLocaleTimeString("en-US", {
          timeZone,
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        });
      const clock = item.milestone
        ? clockAt(item.at)
        : item.at <= from && item.end >= until
          ? "All day"
          : clockAt(Math.max(item.at, from)) +
            " - " +
            clockAt(Math.min(item.end, until));
      button.title =
        item.label +
        " / " +
        new Date(item.at * 1000).toLocaleString("en-US", { timeZone }) +
        " - " +
        new Date(item.end * 1000).toLocaleString("en-US", { timeZone }) +
        " " +
        zone +
        "; estimated eligibility, not guaranteed delivery.";
      button.innerHTML = `${item.milestone ? "◆" : "↻"} ${esc(item.e.command.name)}<small>${esc(item.label)}${item.interval ? " / " + item.interval + "m" : ""}</small><small>${esc(clock)}</small>`;
      button.onclick = () => {
        selected = item.e.commandId;
        document.querySelector("[data-view=editor]").click();
        renderList();
      };
      day.append(button);
    }
    $("#calendar-grid").append(day);
  }
}
function anchorText(a, s) {
  if (a.kind === "DAY") return `${a.days} days at ${a.time}`;
  if (a.kind === "MARK") return s.importantTimes?.[a.name]?.label || a.name;
  return `${a.minutes >= 0 ? "+" : ""}${a.minutes} minutes`;
}
function timelineReview(schedule) {
  return vals(schedule.reminders)
    .map(
      (r) =>
        `${r.label}: ${anchorText(r.start, schedule)} -> ${anchorText(r.finish || r.start, schedule)}; ${r.once ? "once during window" : "every " + r.intervalMinutes + " minutes"}; ${vals(r.messageIds).length} message(s)`,
    )
    .join("\n");
}
function parentTokenEdits(event,offset) {
  return eventMessages(event).map(m=>({m,text:model.rewriteLegacyEventTokens(m.text,offset||0)})).filter(edit=>{
    if(edit.m.locked && edit.text!==edit.m.text)throw Error('Locked message needs an event-token adjustment. Unlock it explicitly before conversion: '+event.command.name);
    return edit.text!==edit.m.text;
  });
}
function convertLegacy(e) {
  try {
    const panel=$("#detail>.panel"), actualDate=panel.querySelector('[data-field=eventDate]').value, actualTime=panel.querySelector('[data-field=eventTime]').value;
    if(!actualDate||!actualTime)throw Error('Enter the true actual event date and time before reviewing conversion.');
    const candidate={...clone(e.schedule),eventDate:actualDate,eventTime:actualTime,timeZone:guildZone()};
    const converted=model.mapLegacyTimelineUsage(e.schedule,model.legacyToTimeline(e.schedule,eventMessages(e),candidate),e.settings);
    const edits=parentTokenEdits(e,converted.legacyEventOffsetMinutes);
    requireValidTimeline(converted);
    const tokenReview=edits.map(edit=>edit.m.text+' -> '+edit.text).join('\n');
    if(!confirm(`Convert ${e.command.name} using this actual event?\n${converted.eventDate} ${converted.eventTime} ${converted.timeZone}\n\n${timelineReview(converted)}\n\n${edits.length} message template(s) adjusted to the actual event:\n${tokenReview}\n\nOriginal configuration will be retained as a backup. No timing is inferred from the event name.`))return;
    converted.legacyTimelineBackup??=clone(e.schedule);
    converted.legacyTimelineBackup.messageTexts??=Object.fromEntries(eventMessages(e).map(m=>[m.id,m.text]));
    delete converted.legacyEventOffsetMinutes;
    Object.assign(e.schedule,converted);
    for(const edit of edits)edit.m.text=edit.text;
    changed();renderDetail();
  }catch(err){status('Conversion stopped: '+err.message,true);}
}
function combineEvents(events) {
  try {
    const parent = events.find((e) => e.commandId === selected),
      sources = events.filter((e) =>
        [...$("#sources").selectedOptions].some((o) => o.value === e.commandId),
      );
    if (!sources.length) throw Error("Select at least one helper command.");
    const channel = (event) =>
      account().chatChannels?.[event.commandId]?.[guild] || "Guild";
    const recurrence = (schedule) =>
      JSON.stringify([
        schedule.recurrence || "NONE",
        schedule.recurrenceInterval || 1,
        Object.entries(schedule.weekdays || {})
          .filter(([, v]) => v === true)
          .map(([k]) => k)
          .sort(),
      ]);
    for (const source of sources) {
      if (channel(source) !== channel(parent))
        throw Error(
          "Output channels differ. Explicitly choose matching channels before combining " +
            source.command.name +
            ".",
        );
      if (recurrence(source.schedule) !== recurrence(parent.schedule))
        throw Error(
          "Recurrence rules differ. Explicitly align recurrence before combining " +
            source.command.name +
            ".",
        );
    }
    const parentSchedule = model.mapLegacyTimelineUsage(
        parent.schedule,
        model.legacyToTimeline(parent.schedule, eventMessages(parent)),
        parent.settings,
      ),
      plans = sources.map((source) => ({
        source,
        schedule: model.mapLegacyTimelineUsage(
          source.schedule,
          model.legacyToTimeline(
            source.schedule,
            eventMessages(source),
            parentSchedule,
          ),
          source.settings,
        ),
      }));
    const next = clone(parentSchedule);
    next.legacyTimelineBackup ??= clone(parent.schedule);
    next.legacyTimelineBackup.messageTexts ??= Object.fromEntries(eventMessages(parent).map(m=>[m.id,m.text]));
    next.legacyTimelineBackup.merged ??= {};
    for (const source of sources)
      next.legacyTimelineBackup.merged[source.commandId] = {
        command: clone(source.command),
        settings: clone(source.settings),
        channel: channel(source),
        messageIds: tableArray(eventMessages(source).map((m) => m.id)),
        messageTexts: Object.fromEntries(
          eventMessages(source).map((m) => [m.id, m.text]),
        ),
      };
    next.reminders ??= {};
    next.importantTimes ??= {};
    next.messageVariants ??= {};
    const edits = parentTokenEdits(parent,parentSchedule.legacyEventOffsetMinutes);
    for (const { source, schedule } of plans) {
      if (
        source.schedule.specialPattern &&
        source.schedule.specialPattern !== "NONE" &&
        source.schedule.specialPattern !== parentSchedule.specialPattern
      )
        throw Error(
          "Choose matching parent special pattern before combining " +
            source.command.name +
            ".",
        );
      next.legacyTimelineBackup.merged[source.commandId].legacyEventOffsetMinutes=schedule.legacyEventOffsetMinutes||0;
      const marks = new Map(),
        rowIds = new Map();
      for (const [key, mark] of Object.entries(schedule.importantTimes || {})) {
        let target = key;
        if (
          next.importantTimes[key] &&
          next.importantTimes[key].offsetMinutes !== mark.offsetMinutes
        )
          target = "time_" + crypto.randomUUID().replaceAll("-", "");
        marks.set(key, target);
        next.importantTimes[target] = mark;
      }
      for (const row of vals(schedule.reminders)) {
        const copied = clone(row);
        copied.legacySourceCommandId=source.commandId;
        copied.legacySourceRowId=row.id;
        copied.label = source.command.name + " - " + copied.label;
        if (vals(next.reminders).some((r) => r.id === copied.id))
          copied.id = crypto.randomUUID();
        rowIds.set(row.id, copied.id);
        for (const anchor of [copied.start, copied.finish])
          if (anchor?.kind === "MARK")
            anchor.name = marks.get(anchor.name) || anchor.name;
        append(next.reminders, copied);
      }
      next.timelineUsage ??= {};
      for (const [key, usage] of Object.entries(schedule.timelineUsage || {})) {
        const index = key.indexOf(":"),
          newKey =
            index >= 0
              ? key.slice(0, index + 1) +
                (rowIds.get(key.slice(index + 1)) || key.slice(index + 1))
              : key;
        const existing = next.timelineUsage[newKey] || {};
        next.timelineUsage[newKey] = {
          ...existing,
          ...usage,
          completed: !!(existing.completed || usage.completed),
        };
        for (const field of ["lastSentAt", "nextDueAt", "peerAt"])
          if (Number.isFinite(existing[field]) || Number.isFinite(usage[field]))
            next.timelineUsage[newKey][field] = Math.max(
              existing[field] || 0,
              usage[field] || 0,
            );
      }
      Object.assign(next.messageVariants, schedule.messageVariants || {});
      for (const m of eventMessages(source)) {
        if (
          !source.schedule.specialPattern ||
          source.schedule.specialPattern === "NONE"
        )
          next.messageVariants[m.id] = "ALL";
        let text = m.text;
        for (const [key, target] of marks)
          if (key !== target)
            text = text.replaceAll(":" + key + "%", ":" + target + "%");
        if (model.rewriteLegacyEventTokens)
          text = model.rewriteLegacyEventTokens(
            text,
            schedule.legacyEventOffsetMinutes || 0,
          );
        if (m.locked && text !== m.text)
          throw Error(
            "Locked message needs an event-token adjustment. Unlock it explicitly before combining: " +
              source.command.name,
          );
        edits.push({
          m,
          text,
        });
      }
    }
    requireValidTimeline(next);
    if (
      !confirm(
        `Keep actual event: ${parent.command.name}\n${next.eventDate} ${next.eventTime} ${next.timeZone}\n\n${timelineReview(next)}\n\nCombine ${sources.length} helper command(s), retain every message ID and usage record, back up source settings, and pause source schedules?`,
      )
    )
      return;

    delete next.legacyEventOffsetMinutes;
    Object.assign(parent.schedule, next);
    for (const { source } of plans) {
      source.schedule.mergedInto = parent.commandId;
      source.schedule.paused = true;
    }
    for (const { m, text } of edits) {
      m.commandId = parent.commandId;
      m.text = text;
    }
    changed();
    renderTransfer();
  } catch (err) {
    status("Combination stopped: " + err.message, true);
  }
}
function renderTransfer() {
  const events = list().filter((e) => !e.schedule.mergedInto);
  $("#transfer").innerHTML =
    `<div class="heading"><h2>Combine legacy helpers</h2><span class="badge">EXPLICIT REVIEW</span></div><p class="help">Choose a parent event with the true event date and clock. Move existing message IDs from selected helper commands into it. Source configuration is retained as a backup; source schedules are paused to prevent duplicate delivery. No dates or reminder timing are inferred from command names.</p><div class="grid two">${select(
      "Keep parent event",
      "parent",
      selected,
      events.map((e) => [e.commandId, e.command.name]),
    )}<label>Helper commands to combine<select id="sources" multiple size="6">${opts(events.filter((e) => e.commandId !== selected).map((e) => [e.commandId, e.command.name]))}</select></label></div><div class="actions" style="margin-top:15px"><button id="review-combine">Review combination</button><button id="portable-export">Export selected timeline JSON</button><label class="button">Import timeline JSON<input id="portable-import" type="file" accept=".json" hidden></label></div><p class="help">Portable JSON includes the selected event's schedule and unlocked messages. Review the destination guild and message content before import.</p>`;
  $("#transfer [data-field=parent]").onchange = (e) => {
    selected = e.target.value;
    renderTransfer();
  };
  $("#review-combine").onclick = () => combineEvents(events);
  $("#portable-export").onclick = () => {
    try {
      const e = selectedEvent();
      if (e.schedule.timelineVersion !== 1)
        throw Error("Convert this event to a timeline before portable export.");
      download(
        JSON.stringify(portableEvent(e, eventMessages(e)), null, 2),
        "SmartChatMsg-timeline.json",
        "application/json",
      );
    } catch (err) {
      status(err.message, true);
    }
  };
  $("#portable-import").onchange = async (ev) => {
    try {
      const f = ev.target.files[0];
      if (!f || f.size > 2 * 1024 * 1024)
        throw Error("Choose a timeline JSON smaller than 2 MB.");
      const e = selectedEvent(),
        p = JSON.parse(await f.text());
      const staged = stageImport(p, e, account().messages, guild);
      if (staged.schedule.timeZone !== guildZone())
        throw Error(
          "The imported timezone differs from this guild. Set the guild timezone explicitly before import.",
        );
      if (
        !confirm(
          `Replace timeline configuration for ${e.command.name} in ${guild}? Existing messages and runtime fields remain.`,
        )
      )
        return;
      for (const m of staged.messages) append(account().messages, m);
      Object.assign(e.schedule, staged.schedule);
      changed();
      renderTransfer();
    } catch (err) {
      status(err.message, true);
    }
  };
}
function download(text, name, type = "text/plain") {
  const url = URL.createObjectURL(
    new Blob([text], {
      type,
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#export").onclick = () => {
  try {
    validateEditedTimelines();
    const result = model.mergeSavedVariables(base, data, latest || base);
    if (result.conflicts.length) {
      dialog(
        "Configuration conflicts · export stopped",
        result.conflicts
          .map(
            (c) =>
              `${c.path}\nEdited: ${JSON.stringify(c.edited)}\nLatest: ${JSON.stringify(c.latest)}`,
          )
          .join("\n\n") +
          "\n\nResolve these edits in a fresh snapshot before downloading.",
      );
      return;
    }
    if (
      !confirm(
        "Exit ESO completely before replacing SavedVariables. Keep a backup of the current SmartChatMsg.lua.\n\nDownload the reviewed configuration now?",
      )
    )
      return;
    validateEditedTimelines(result.data);
    download(writeSavedVariables(result.data), "SmartChatMsg.lua");
    dirty = false;
    status(
      "Downloaded SmartChatMsg.lua. Exit ESO, back up the original, then replace it with this file.",
    );
  } catch (err) {
    status(err.message, true);
  }
};
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
