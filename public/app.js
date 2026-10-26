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
const fieldHelp = {
 eventDate:'The real event date. Recurrence starts from this date; reminder days do not change the actual event.',
 eventTime:'The real event clock in the displayed scheduling timezone. Native clock controls use your browser clock format; the Lua file keeps an AM/PM clock.',
 recurrence:'How actual event dates repeat. Reminder windows repeat around each actual event occurrence.',
 recurrenceInterval:'A whole number of recurrence periods between occurrences. For example, 2 with Weekly means every other week.',
 specialPattern:'Use month-final message pools or rotate faction pools across recurring events.',
 rotationWeeks:'Number of weeks assigned to each faction before moving to the next faction in the list.',
 eventFold:'During the repeated clock hour when daylight saving time ends, choose the first or second occurrence.',
 eventDurationMinutes:'Optional whole minutes from event start to event end. Reminder windows stop at this end unless their advanced after-event exception is enabled. Leave blank for no event-end cap.',
 eventState:'Enabled allows scheduling. Paused temporarily stops it while keeping configuration. Disabled turns it off. No state sends chat automatically: Enter is always required.',
 rowState:'Enabled allows this reminder. Paused temporarily suspends this row. Disabled excludes it while keeping its timing and messages.',
 settingsRunAt:'Scheduled uses event timing. On demand and Startup do not expand event substitutions or run this reminder timeline.',
 outputChannel:'The destination chat channel used by this command for the selected guild.',
 intervalMinutes:'Whole minutes between eligible announcements in this window. Normal command, guild and channel pacing and duplicate protection still apply.',
 lateMinutes:'Grace in whole minutes after a one-time milestone begins. If it is not confirmed before this deadline, it expires. Preparing a draft does not complete it.',
 once:'A one-time milestone completes only when its announcement is confirmed. An expired milestone and its pending draft are skipped.',
 onceUntilFinish:'Permit this one-time announcement anywhere from the start anchor until the finish anchor. Without this, the grace period defines its deadline.',
 timeSensitive:'Bypass ordinary reminder intervals and shared pacing for a precise announcement. Startup hold, user chat and relevant duplicate protection still apply. Enter is always required.',
 allowAfterEventEnd:'Advanced exception for a brief event-ended notice. This reminder may finish after the configured event duration; keep its own finish or grace short.',
 kind:'Choose elapsed minutes from the event, a calendar day at a local clock, or a reusable named important time.',
 days:'Whole calendar days relative to the actual event in its scheduling timezone. Negative days are before it; local clocks follow daylight saving time.',
 time:'A local clock in the displayed scheduling timezone. A nonexistent spring daylight-saving clock is rejected.',
 minutes:'Whole elapsed minutes relative to the actual event. Negative values are before it; positive values are after it.',
 offsetMinutes:'Whole elapsed minutes from the selected actual event occurrence. For recurring events, this important moment follows every occurrence with the same offset.',
 name:'Choose an important time defined below, such as ticket sales closing. Create one first if this list is empty.',
 markMode:'Use a reusable offset, or select a specific date and clock to calculate that offset from the next occurrence. Specific dates are converted to offsets, not stored as fixed future deadlines.',
 markDate:'Pick a date relative to the next actual event occurrence. Saving converts it into an offset that follows future recurring events.',
 markTime:'Pick a local clock in the event timezone. Saving converts the selected date and clock into elapsed offset minutes.',
};
function helpText(key){return fieldHelp[key]||fieldHelp[key.split('.').at(-1)]||'';}
function helpAttributes(key){const text=helpText(key);return text?` title="${esc(text)}" data-help="${esc(text)}" aria-description="${esc(text)}"`:'';}
function clockNative(value){const m=/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(value||''));if(!m)return /^\d{2}:\d{2}$/.test(value||'')?value:'';return String((Number(m[1])%12)+(m[3].toUpperCase()==='PM'?12:0)).padStart(2,'0')+':'+m[2];}
function clockStored(value){const m=/^(\d{2}):(\d{2})$/.exec(String(value||''));if(!m)return '';const h=Number(m[1]);return String(h%12||12).padStart(2,'0')+':'+m[2]+' '+(h>=12?'PM':'AM');}
function numberLimits(key){const suffix=key.split('.').at(-1);if(['recurrenceInterval','rotationWeeks'].includes(suffix))return [1,1000000];if(suffix==='lateMinutes')return [1,1440];if(suffix==='intervalMinutes')return [1,5256000];if(suffix==='days')return [-3650,3650];if(['minutes','offsetMinutes'].includes(suffix))return [-5256000,5256000];if(suffix==='eventDurationMinutes')return [0,5256000];return [undefined,undefined];}
const input=(label,key,value,type='text')=>{const [min,max]=numberLimits(key), numeric=type==='number'?` step="1"${min!==undefined?` min="${min}" max="${max}"`:''}`:'', clock=type==='time'||key==='eventTime'||key.endsWith('.time');if(clock)type='time';return `<label${helpAttributes(key)}>${esc(label)}<input data-field="${key}" type="${type}" value="${esc(clock?clockNative(value):value)}"${numeric}${clock?' step="60"':''}${helpAttributes(key)}></label>`;};
const select=(label,key,value,options)=>`<label${helpAttributes(key)}>${esc(label)}<select data-field="${key}"${helpAttributes(key)}>${opts(options,value)}</select></label>`;
const check=(label,key,value)=>`<label class="check"${helpAttributes(key)}><input type="checkbox" data-field="${key}" ${value?'checked':''}${helpAttributes(key)}>${esc(label)}</label>`;
const stateOf=value=>value.paused?'PAUSED':value.enabled===false?'DISABLED':'ENABLED';
function applyState(value,key){if(!value[key])return value;value.enabled=value[key]!=='DISABLED';value.paused=value[key]==='PAUSED';delete value[key];return value;}
function currentEventDraft(){const e=selectedEvent(),panel=document.querySelector('#detail>.panel.event-settings');const v=panel?fields(panel):{};const d={...e.schedule,...v,timeZone:guildZone()};if(d.eventDurationMinutes===null)delete d.eventDurationMinutes;d.weekdays={};if(document.querySelector('#use-event-weekdays')?.checked)panel.querySelectorAll('[data-weekday]:checked').forEach(x=>setLuaValue(d.weekdays,Number(x.dataset.weekday),true));return d;}
function projectedNext(draft){const now=Math.floor(Date.now()/1000),anchor=model.scheduleEventUtc(draft);if(anchor===null)return null;return model.projectedOccurrences(draft,now,now+400*86400)[0]??(anchor>=now?anchor:null);}
function refreshNextOccurrence(){const field=document.querySelector('#next-occurrence');if(!field)return;try{const d=currentEventDraft(),next=projectedNext(d);field.value=next===null?'No upcoming occurrence in the preview range':new Date(next*1000).toLocaleString('en-US',{timeZone:zoneNames[d.timeZone],weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});}catch{field.value='Choose a valid event date, clock and recurrence';}}
function insertableTokens(schedule){const scheduled=selectedEvent()?.settings.runAt==='SCHEDULED';return ['%guild%','%greeting%','%zone%',...(scheduled?['%eventwhen%','%eventtime%','%eventdate%','%eventcountdown%','%eventtime-1h%','%eventcountdown-1h%',...(schedule.specialPattern==='FACTION_ROTATION'?['%eventfaction%']:[]),...Object.keys(schedule.importantTimes||{}).flatMap(key=>['eventwhen','eventtime','eventdate','eventcountdown'].map(token=>'%'+token+':'+key+'%'))]:[])];}
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
          "Local clock",
          prefix + ".time",
          a.time || "08:00 PM",
        )
      : a.kind === "MARK"
        ? select(
            "Important time",
            prefix + ".name",
            a.name || "",
            [["","Choose an important time"],...Object.entries(s.importantTimes || {}).map(([id, v]) => [
              id,
              v.label || id,
            ])],
          )+'<button type="button" class="create-important-time">+ Create important time</button>'
        : input(
            "Minutes (negative = before)",
            prefix + ".minutes",
            a.minutes ?? 0,
            "number",
          )
  }`;
}
function variantChoices(schedule,current){
 const pattern=schedule.specialPattern;
 const values=pattern==='MONTH_FINAL'?['ALL','REGULAR','FINAL']:pattern==='FACTION_ROTATION'?['ALL',...vals(schedule.rotationFactions||{1:'AD',2:'EP',3:'DC'}).filter(code=>['AD','EP','DC'].includes(code))]:['ALL'];
 const choices=[...new Set(values)];
 if(current&&!choices.includes(current))return [...choices,[current,current+' (not active for this pattern)']];
 return choices;
}
function legacyMigrationBanner(event) {
 if(event.schedule.timelineVersion===1)return '';
 return `<section class="panel migration" id="migration-panel"><p class="eyebrow">LEGACY SCHEDULE</p><h2>Switch this event to the new reminder timeline</h2><ol><li>Enter the <strong>actual event date and time</strong> at the top of this page, such as Tuesday Tours on Tuesday at 8 PM. Set the recurrence and click <strong>Apply event settings</strong> to save changes to the event and weekday override.</li><li>Choose <strong>Review and convert this event</strong>. Review the reminder periods before confirming.</li><li>If older helper commands belong to this event, combine them afterward in <strong>Combine &amp; transfer</strong>.</li></ol><p class="help">Conversion keeps message IDs, usage and cooldown history, and a backup of the original schedule. Nothing changes in ESO until you download and install the updated file.</p><button class="gold" id="convert-legacy">Review and convert this event</button></section>`;
}
function showField(root,key,show){const field=root.querySelector(`[data-field="${key}"]`);if(field)field.closest('label').hidden=!show;}
function refreshEventRelevance(){
 const panel=document.querySelector('#detail>.panel.event-settings');if(!panel)return;
 const recurrence=panel.querySelector('[data-field=recurrence]').value;
 const repeating=recurrence!=='NONE';
 const faction=repeating&&panel.querySelector('[data-field=specialPattern]').value==='FACTION_ROTATION';
 showField(panel,'recurrenceInterval',repeating);showField(panel,'specialPattern',repeating);
 showField(panel,'rotationWeeks',faction);showField(panel,'rotationFactions',faction);
 const pattern=repeating?panel.querySelector('[data-field=specialPattern]').value:'NONE';
 document.querySelectorAll('.message [data-field=variant]').forEach(field=>{const value=field.value;field.closest('label').hidden=pattern==='NONE';field.innerHTML=opts(variantChoices({...selectedEvent().schedule,specialPattern:pattern},value),value);});

 const weekday=['DAILY','WEEKLY','BIWEEKLY'].includes(recurrence);
 document.querySelector('#weekday-options').hidden=!weekday;
 const enabled=document.querySelector('#use-event-weekdays').checked;
 document.querySelector('#event-weekday-choices').hidden=!enabled;
 const count=panel.querySelectorAll('[data-weekday]:checked').length;
 const date=panel.querySelector('[data-field=eventDate]').value;
 const weekdayName=/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(date+'T12:00:00Z').toLocaleDateString(undefined,{weekday:'long',timeZone:'UTC'}):'the event date';
 document.querySelector('#weekday-explanation').textContent='Leave this off for an event that always happens on the weekday in Event Date (for example, a Saturday raffle). Turn it on only if the event itself happens on other or multiple weekdays, such as Tuesday AND Thursday. This does not restrict reminder days. '+(enabled?(count===0?'No override days selected; the event date determines the weekday.':count===7?'All seven selected: an event occurs every day in each eligible period.':count+' event day(s) selected in each eligible period.'):(recurrence==='DAILY'?'Default: the daily recurrence determines event dates.':'Default: follow '+weekdayName+' from the event date.'));
}
function refreshReminderRelevance(card){
 const once=card.querySelector('[data-field=once]').checked;
 const whole=card.querySelector('[data-field=onceUntilFinish]').checked;
 showField(card,'intervalMinutes',!once);showField(card,'lateMinutes',once&&!whole);
 showField(card,'onceUntilFinish',once);
 card.querySelector('[data-finish-window]').hidden=once&&!whole;
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
    `<section class="panel event-settings"><div class="heading"><div><p class="eyebrow">EVENT SETTINGS</p><h2>${esc(e.command?.name)}</h2></div><span class="badge">${s.timelineVersion === 1 ? "TIMELINE" : "LEGACY SCHEDULE"}</span></div><div class="grid">${input("Event name", "commandName", e.command.name)}${input("Event Date", "eventDate", s.eventDate || "", "date")}${input("Event Start Time", "eventTime", s.eventTime || "08:00 PM")}<label data-help="The next actual event occurrence, calculated live from the current unsaved date, clock, recurrence, interval and weekday controls.">Next occurrence <span class="readonly-tag">Read only</span><input id="next-occurrence" readonly aria-live="polite"></label>${input("Event duration (minutes, optional)","eventDurationMinutes",s.eventDurationMinutes??"","number")}<label title="Read only here. Change Guild timezone in the toolbar above; all event clocks use that timezone.">Scheduling timezone (guild) <span class="readonly-tag">Read only</span><input value="${esc(guildZone())}" readonly aria-description="Change Guild timezone in the toolbar above."><small class="help">Change using Guild timezone in the toolbar.</small></label>${select("Output channel", "outputChannel", account().chatChannels?.[e.commandId]?.[guild] || "Guild", ["Guild", "Officer", "Zone", "Group"])}${select(
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
    )}</div><details id="weekday-options" ${vals(s.weekdays).some(Boolean)?'open':''}><summary>Event happens on multiple weekdays (advanced)</summary><label class="check"><input id="use-event-weekdays" type="checkbox" ${vals(s.weekdays).some(Boolean)?'checked':''}>Choose event weekdays instead of following Event Date</label><p class="help" id="weekday-explanation"></p><div class="actions weekdays" id="event-weekday-choices">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => `<label class="check"><input type="checkbox" data-weekday="${i + 1}" ${s.weekdays?.[i + 1] ? "checked" : ""}>${d.slice(0, 3)}</label>`).join("")}</div></details><div class="actions" style="margin-top:18px">${select("Event state", "eventState", stateOf(s), [["ENABLED","Enabled"],["PAUSED","Paused"],["DISABLED","Disabled"]])}<button id="save-event" class="gold">Apply event settings</button></div><p class="help">Enter the real event date and time. Reminder offsets are measured from this moment; calendar-day anchors use the event timezone.</p></section><section class="panel"><div class="heading"><h2>Reminder timeline</h2><button id="add-row" class="gold">+ Add reminder</button></div>${s.timelineVersion !== 1 ? '<p class="help">This event still uses legacy scheduling. Convert this schedule to review its existing timing and message pools before adding reminders.</p>' : ""}<div id="rows">${rows.map((r, i) => `<article class="reminder ${r.once ? "milestone" : ""}" data-row="${esc(r.id)}"><div class="heading"><h3>${i + 1}. ${esc(r.label || "Reminder")}</h3><span class="badge">${r.once ? "◆ MILESTONE" : "↻ FREQUENCY WINDOW"}</span></div><div class="grid">${input("Reminder label", "label", r.label || "")}${select("Reminder state","rowState",stateOf(r),[["ENABLED","Enabled"],["PAUSED","Paused"],["DISABLED","Disabled"]])}${input("Repeat every (minutes)", "intervalMinutes", r.intervalMinutes ?? 60, "number")}${input("Late allowance (minutes)", "lateMinutes", r.lateMinutes ?? 5, "number")}</div><h3>Starts</h3><div class="grid">${anchorMarkup(r.start, "start", s)}</div><div data-finish-window><h3>Finishes</h3><div class="grid">${anchorMarkup(r.finish || r.start, "finish", s)}</div></div><div class="actions">${check("Send once", "once", r.once)}${check("Time-sensitive", "timeSensitive", r.timeSensitive)}${check("Allow a brief notice after event end (advanced)","allowAfterEventEnd",r.allowAfterEventEnd)}${check("Allow this announcement anytime within its window", "onceUntilFinish", r.onceUntilFinish)}</div><details class="row-advanced"><summary>Advanced event-end exception</summary>${check("Allow a brief announcement after the event ends","allowAfterEventEnd",r.allowAfterEventEnd)}</details><p class="help">Choose a message pool. The addon selects a message from this pool when the reminder is due.</p><div class="pool">${messages.map((m, j) => `<label class="check"><input type="checkbox" data-message="${esc(m.id)}" ${vals(r.messageIds).includes(m.id) ? "checked" : ""}><span>${j + 1}. ${esc(m.text)}</span></label>`).join("") || '<span class="help">Add a message below first.</span>'}</div><div class="actions"><button data-action="save">Apply reminder</button><button data-action="preview">Preview here</button><button data-action="up" ${i === 0 ? "disabled" : ""}>↑</button><button data-action="down" ${i === rows.length - 1 ? "disabled" : ""}>↓</button><button data-action="remove" class="danger">Remove</button></div></article>`).join("") || '<div class="empty">No timeline reminders yet.</div>'}</div></section><section class="panel"><div class="heading"><h2>Important times</h2><button id="add-mark">+ Add time</button></div><p class="help">Name an important moment, such as doors opening or ticket sales closing, and reuse it in reminder anchors.</p>${Object.entries(
      s.importantTimes || {},
    )
      .map(
        ([id, m]) =>
          `<div class="grid mark" data-id="${esc(id)}">${input("Label", "label", m.label)}${input("Minutes from event", "offsetMinutes", m.offsetMinutes, "number")}<div class="actions"><button data-action="save-mark">Apply</button><button data-action="remove-mark" class="danger">Remove</button></div></div>`,
      )
      .join(
        "",
      )}</section><section class="panel"><div class="heading"><h2>Message library <span class="badge">${messages.length} VARIANTS</span></h2><button id="add-message">+ Add message</button></div><p class="help">Existing IDs, usage and private locks are preserved. Dynamic placeholders are expanded by the addon.</p>${ambiguousMessages(e) ? '<p class="help" role="alert">Some legacy messages have no guild name and their guild slot cannot be resolved safely. They are omitted from this editor and remain untouched in the file.</p>' : ""}${messages.map((m, i) => `<details class="message" data-id="${esc(m.id)}"><summary>Message ${i + 1} ${m.locked ? " - Locked" : ""} - ${esc(m.text.slice(0, 65))}${m.text.length > 65 ? "..." : ""}</summary><div class="heading"><strong>Message ${i + 1}</strong>${select("Variant", "variant", s.messageVariants?.[m.id] || "ALL", variantChoices(s,s.messageVariants?.[m.id]||"ALL"))}</div><textarea aria-label="Message ${i + 1}" ${m.locked ? "readonly" : ""}>${esc(m.text)}</textarea><div class="actions"><button data-action="save-message" ${m.locked ? "disabled" : ""}>Apply message</button><button data-action="delete-message" class="danger" ${m.locked ? "disabled" : ""}>Delete message</button><select data-insert-token aria-label="Insert substitution"><option value="">Insert substitution...</option>${opts(insertableTokens(s))}</select></div></details>`).join("")}</section>`;
  const eventPanel=document.querySelector('#detail>.panel.event-settings');
  const fold=eventPanel.querySelector('[data-field=eventFold]').closest('label');
  const advanced=document.createElement('details');advanced.id='event-clock-options';advanced.innerHTML='<summary>Advanced clock options</summary>';advanced.open=s.eventFold==='SECOND';fold.parentElement.append(advanced);advanced.append(fold);
  if(s.timelineVersion!==1)eventPanel.insertAdjacentHTML('afterend',legacyMigrationBanner(e));
  eventPanel.querySelectorAll('[data-field=recurrence],[data-field=specialPattern],[data-field=eventDate],[data-weekday],#use-event-weekdays').forEach(control=>control.addEventListener('change',refreshEventRelevance));
  refreshEventRelevance();
  eventPanel.querySelectorAll('input,select').forEach(el=>{el.addEventListener('input',refreshNextOccurrence);el.addEventListener('change',refreshNextOccurrence);});refreshNextOccurrence();
  document.querySelectorAll('[data-help]').forEach(el=>{
    el.title=el.dataset.help;
    if(el.tagName==='LABEL'){
      const hint=document.createElement('span');hint.className='help-icon';hint.tabIndex=0;hint.setAttribute('role','note');hint.setAttribute('aria-label',el.dataset.help);
      hint.append(document.createTextNode('?'));const bubble=document.createElement('span');bubble.className='help-bubble';bubble.textContent=el.dataset.help;hint.append(bubble);
      hint.addEventListener('click',ev=>{ev.preventDefault();hint.classList.toggle('show-help');});
      el.insertBefore(hint,el.querySelector('input,select,textarea'));
    }
  });
  document.querySelectorAll('#detail input[readonly],#detail textarea[readonly]').forEach(el=>{
    el.setAttribute('aria-readonly','true');
    const owner=el.closest('label');
    if(owner?.querySelector('.readonly-tag'))return;
    const badge=document.createElement('span');badge.className='readonly-tag';badge.textContent='Read only';el.before(badge);
  });
  $("#save-event").onclick = () => {
    const p = $("#detail>.panel");
    if([...p.querySelectorAll("input")].some(el=>!el.checkValidity())){p.querySelectorAll("input").forEach(el=>el.reportValidity());status("Use valid clocks and whole numbers within their allowed ranges.",true);return;}
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
    if(candidate.eventDurationMinutes===null)delete candidate.eventDurationMinutes;
    if(candidate.eventDurationMinutes===null)delete candidate.eventDurationMinutes;
    if(candidate.recurrence==='NONE')candidate.specialPattern='NONE';
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
    v.weekdays=clone(s.weekdays||{});
    if(['DAILY','WEEKLY','BIWEEKLY'].includes(v.recurrence)){
      v.weekdays={};
      if($('#use-event-weekdays').checked)p.querySelectorAll('[data-weekday]:checked').forEach(x=>setLuaValue(v.weekdays,Number(x.dataset.weekday),true));
    }
    if(v.recurrence==='NONE')v.specialPattern='NONE';
    v.rotationFactions = tableArray(
      v.rotationFactions
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    );
    if(v.eventDurationMinutes===null){delete s.eventDurationMinutes;delete v.eventDurationMinutes;}
    if(v.eventDurationMinutes===null){delete s.eventDurationMinutes;delete v.eventDurationMinutes;}
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
      card.addEventListener("click",ev=>{if(ev.target.closest(".create-important-time"))$("#add-mark").click();});
      refreshReminderRelevance(card);
      card.querySelectorAll('[data-field=once],[data-field=onceUntilFinish]').forEach(control=>control.addEventListener('change',()=>refreshReminderRelevance(card)));
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
  document.querySelectorAll('.mark').forEach(el=>{const d=currentEventDraft(),at=projectedNext(d)??model.scheduleEventUtc(d),mark=s.importantTimes[el.dataset.id],target=at+mark.offsetMinutes*60,parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zoneNames[d.timeZone],year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(target*1000)).map(x=>[x.type,x.value]));el.insertAdjacentHTML('beforeend','<div class="grid">'+select('Define important time','markMode','OFFSET',[["OFFSET","Minutes before / after event"],["DATE","Pick date and time"]])+input('Important date','markDate',parts.year+'-'+parts.month+'-'+parts.day,'date')+input('Important clock','markTime',parts.hour+':'+parts.minute,'time')+'</div><p class="help">Date/time choices use '+esc(d.timeZone)+' and become an offset from the selected next occurrence, so they follow recurring events.</p>');const update=()=>{const dateMode=el.querySelector('[data-field=markMode]').value==='DATE';showField(el,'markDate',dateMode);showField(el,'markTime',dateMode);showField(el,'offsetMinutes',!dateMode);};el.querySelector('[data-field=markMode]').onchange=update;update();});
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
          ? (el.dataset.field==="eventDurationMinutes"&&el.value===""?null:el.value===""?NaN:Number(el.value))
          : el.type === "time" ? clockStored(el.value) : el.value;
  });
  applyState(out,"eventState");applyState(out,"rowState");
  if(out.markMode){if(out.markMode==='DATE'){try{const d=currentEventDraft(),at=projectedNext(d)??model.scheduleEventUtc(d),target=model.scheduleEventUtc({eventDate:out.markDate,eventTime:out.markTime,timeZone:d.timeZone,eventFold:d.eventFold});out.offsetMinutes=target===null?NaN:(target-at)/60;}catch{out.offsetMinutes=NaN;}}delete out.markMode;delete out.markDate;delete out.markTime;}
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
          if(calState==='active'&&(w.row.enabled===false||w.row.paused))continue;
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
            label: w.row.label+(w.row.paused?" [Paused]":w.row.enabled===false?" [Disabled]":""),
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
    const panel=$("#detail>.panel"), actualDate=panel.querySelector('[data-field=eventDate]').value, actualTime=clockStored(panel.querySelector('[data-field=eventTime]').value);
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
