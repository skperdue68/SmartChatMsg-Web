import { portableEvent, stageImport, exportEventBundle, readEventBundle, reviewEventImport, importEventBundle } from "/portable.js";
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
let editRevision=0;
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
function overlapNotes(schedule){
  return model.timelineConflicts(schedule).map(c=>{
    const clock=t=>new Date(t*1000).toLocaleString('en-US',{timeZone:zoneNames[schedule.timeZone||'ET'],month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
    return `Overlapping periods: "${c.first.label||c.first.id}" and "${c.second.label||c.second.id}" at ${clock(c.start)}${c.end>c.start?' – '+clock(c.end):''}. End one period before the other begins.`;
  });
}
function requireValidTimeline(schedule) {
  if (schedule.timelineVersion !== 1) return;
  const errors = model.validateTimelineForAddon(schedule);
  if (errors.length) throw Error(errors.join(" "));
  const overlaps=overlapNotes(schedule);if(overlaps.length)throw Error(overlaps.join(" "));
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
        const errors = [...model.validateTimelineForAddon(event.schedule),...overlapNotes(event.schedule)];
        if (errors.length)
          throw Error(
            `${entry.name} / ${event.guild} / ${event.command.name}: ${errors.join(" ")}`,
          );
      }
    }
}
function changed() {
  editRevision++;
  const schedule=selectedEvent()?.schedule;if(schedule?.timelineVersion===1)schedule.reminders=tableArray(model.orderedReminderRows(schedule,projectedNext(schedule)??model.scheduleEventUtc(schedule)));
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
 messageName:'Optional short editor label, up to 60 characters. It is saved with the message but is never included in outgoing chat.',
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
const input=(label,key,value,type='text')=>{const [min,max]=numberLimits(key), numeric=type==='number'?` step="1"${min!==undefined?` min="${min}" max="${max}"`:''}`:'', clock=type==='time'||key==='eventTime'||key.endsWith('.time');if(clock)type='time';return `<label${helpAttributes(key)}>${esc(label)}${clock?'<span class="clock-control">':''}<input data-field="${key}" type="${type}" value="${esc(clock?clockNative(value):value)}"${numeric}${clock?' step="60"':''}${helpAttributes(key)}>${clock?`<span class="clock-zone">${esc(guildZone())}</span></span>`:''}</label>`;};
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
function installWorkspace(parsed,sourceName){
    if (!model.accounts(parsed).length)
      throw Error("No account-wide SmartChatMsg data found.");
    editRevision++;
    base = parsed;
    data = clone(base);
    latest = null;
    dirty = false;dayTimelineUndo=null;pendingEventImport=null;calMode='day';calDate='';
    filename = sourceName.replace(/\.txt$/i, ".lua");
    $("#workspace").hidden = false;
    $("#welcome").hidden = true;
    const availableAccounts=model.accounts(data);
    const hasContent=a=>Object.keys(a.value.commands||{}).length>0||Object.keys(a.value.messages||{}).length>0;
    const preferred=availableAccounts.find(hasContent)||availableAccounts[0];
    $("#account").innerHTML = opts(availableAccounts.map(a=>[a.name,a.name+(hasContent(a)?'':' (no saved commands)')]),preferred.name);
    accountName = $("#account").value;
    refreshGuilds();
    status(`Opened ${sourceName}. Account: ${accountName}${guild ? " / " + guild : " — no saved guild events in this account"}. Switch accounts above if needed.`);
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
    installWorkspace(parsed,f.name);
  } catch (err) {
    status(err.message, true);
  } finally {
    e.target.value = "";
  }
};
const snapshotButton=document.querySelector('#latest-snapshot-button');
snapshotButton.onkeydown=ev=>{if(ev.target===snapshotButton&&['Enter',' '].includes(ev.key)){ev.preventDefault();document.querySelector('#latest').click();}};
snapshotButton.onclick=ev=>{if(ev.target.closest('.help-bubble'))ev.preventDefault();};
$("#latest").onchange = async (e) => {
  try {
    const file=e.target.files[0];if(!file)return;
    latest = await readFile(file);editRevision++;
    status(`Read ${file.name} for merging when you download. Your current edits and the file on disk have not been overwritten.`);
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
  return model.orderedMessageEntries(vals(account().messages).filter(
    (m) =>
      m.commandId === e.commandId &&
      (typeof m.guildName === "string" && m.guildName.trim()
        ? m.guildName.trim().toLowerCase() === e.guild
        : slot !== null && m.guildIndex === slot),
  ));
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
function reminderBadge(row){
  const label=row.once?'◆ ONE-TIME NOTICE':'↻ REPEATING REMINDER';
  const text=row.once?(row.onceUntilFinish?'Sends one message per event occurrence, anytime within this period. It does not repeat when the interval passes.':'Sends one message per event occurrence at its trigger time, with the configured late allowance. It does not repeat within this period.'):'Selects a message from this pool repeatedly while the period is open, using Repeat every. Cooldowns and other activity can delay preparation.';
  return `<span class="badge reminder-type" tabindex="0" role="note" aria-label="${esc(label+'. '+text)}">${label}<span class="help-bubble">${esc(text)} Messages are prepared in ESO chat; you still press Enter to send.</span></span>`;
}
function refreshReminderRelevance(card){
 const once=card.querySelector('[data-field=once]').checked;
 const whole=card.querySelector('[data-field=onceUntilFinish]').checked;
 const badge=card.querySelector('.reminder-type');if(badge)badge.outerHTML=reminderBadge({once,onceUntilFinish:whole});
 showField(card,'intervalMinutes',!once);showField(card,'lateMinutes',once&&!whole);
 showField(card,'onceUntilFinish',once);
 card.querySelector('[data-finish-window]').hidden=once&&!whole;
}
function decorateFieldLabels(root=document.querySelector('#detail')){
  root.querySelectorAll('.readonly-tag').forEach(el=>el.remove());
  root.querySelectorAll('input[readonly],textarea[readonly]').forEach(el=>{
    el.setAttribute('aria-readonly','true');
    if(!el.title)el.title='Read only';
  });
  root.querySelectorAll('label:not(.button)').forEach(label=>{
    let caption=label;
    if(!label.classList.contains('check')){caption=document.createElement('span');caption.className='field-caption';
      [...label.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).forEach(node=>caption.append(node));label.prepend(caption);}
    if(label.dataset.help){
      const hint=document.createElement('span');hint.className='help-icon';hint.tabIndex=0;hint.setAttribute('role','note');hint.setAttribute('aria-label',label.dataset.help);
      hint.append(document.createTextNode('?'));const bubble=document.createElement('span');bubble.className='help-bubble';bubble.textContent=label.dataset.help;hint.append(bubble);
      hint.addEventListener('click',ev=>{ev.preventDefault();hint.classList.toggle('show-help');});caption.append(hint);
    }
  });
  root.querySelectorAll('[data-help]').forEach(el=>{el.removeAttribute('title');if(el.dataset.help)el.setAttribute('aria-description',el.dataset.help);});
}
function renderDetail(focusReminderId = null,focusMessageId = null) {
  document.querySelector("#pool-preview")?.remove();
  const renderKey = accountName + "|" + guild + "|" + selected,
    preserveScroll = lastRenderedKey === renderKey,
    scrollY = window.scrollY;
  const detailKey=d=>d.id?'id:'+d.id:d.closest('.reminder')?'row:'+d.closest('.reminder').dataset.row+':'+[...d.closest('.reminder').querySelectorAll('details')].indexOf(d):d.closest('.message')?'message:'+d.closest('.message').dataset.id:null;
  const openDetails=new Map(preserveScroll?[...document.querySelectorAll('#detail details')].map(d=>[detailKey(d),d.open]).filter(([key])=>key):[]);
  const messageDrafts=new Map(preserveScroll?[...document.querySelectorAll('#detail .message')].map(el=>[el.dataset.id,{text:el.querySelector('textarea')?.value,variant:el.querySelector('[data-field=variant]')?.value}]):[]);
  lastRenderedKey = renderKey;
  const e = selectedEvent();
  if (!e) {
    $("#detail").innerHTML =
      '<div class="panel empty">Choose a guild event, or create a new event.</div>';
    return;
  }
  const s = (e.settings.schedule ??= {}),
    messages = eventMessages(e),
    rows = model.orderedReminderRows(s,projectedNext(s)??model.scheduleEventUtc(s));
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
    )}</div><details id="weekday-options" ${vals(s.weekdays).some(Boolean)?'open':''}><summary>Event happens on multiple weekdays (advanced)</summary><label class="check"><input id="use-event-weekdays" type="checkbox" ${vals(s.weekdays).some(Boolean)?'checked':''}>Choose event weekdays instead of following Event Date</label><p class="help" id="weekday-explanation"></p><div class="actions weekdays" id="event-weekday-choices">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => `<label class="check"><input type="checkbox" data-weekday="${i + 1}" ${s.weekdays?.[i + 1] ? "checked" : ""}>${d.slice(0, 3)}</label>`).join("")}</div></details><div class="actions" style="margin-top:18px">${select("Event state", "eventState", stateOf(s), [["ENABLED","Enabled"],["PAUSED","Paused"],["DISABLED","Disabled"]])}<button id="save-event" class="gold">Apply event settings</button></div><p class="help">Enter the real event date and time. Reminder offsets are measured from this moment; calendar-day anchors use the event timezone.</p></section><section class="panel"><div class="heading"><h2>Reminder timeline</h2><button id="add-row" class="gold">+ Add reminder</button></div>${s.timelineVersion !== 1 ? '<p class="help">This event still uses legacy scheduling. Convert this schedule to review its existing timing and message pools before adding reminders.</p>' : ""}<p class="help">Periods are automatically ordered by start time when applied. Windows cannot overlap within this event; one may finish exactly when the next starts.</p><div id="timeline-conflicts" class="timeline-conflicts" role="alert"></div><div id="rows">${rows.map((r, i) => `<article class="reminder ${r.once ? "milestone" : ""}" data-row="${esc(r.id)}"><div class="heading"><h3>${i + 1}. ${esc(r.label || "Reminder")}</h3>${reminderBadge(r)}</div><p class="effective-reminder-time" data-effective-times></p><div class="grid">${input("Reminder label", "label", r.label || "")}${select("Reminder state","rowState",stateOf(r),[["ENABLED","Enabled"],["PAUSED","Paused"],["DISABLED","Disabled"]])}${input("Repeat every (minutes)", "intervalMinutes", r.intervalMinutes ?? 60, "number")}${input("Late allowance (minutes)", "lateMinutes", r.lateMinutes ?? 5, "number")}</div><h3>Starts</h3><div class="grid">${anchorMarkup(r.start, "start", s)}</div><div data-finish-window><h3>Finishes</h3><div class="grid">${anchorMarkup(r.finish || r.start, "finish", s)}</div></div><div class="actions">${check("Send once", "once", r.once)}${check("Time-sensitive", "timeSensitive", r.timeSensitive)}${check("Allow a brief notice after event end (advanced)","allowAfterEventEnd",r.allowAfterEventEnd)}${check("Allow this announcement anytime within its window", "onceUntilFinish", r.onceUntilFinish)}</div><details class="row-advanced"><summary>Advanced event-end exception</summary>${check("Allow a brief announcement after the event ends","allowAfterEventEnd",r.allowAfterEventEnd)}</details><p class="help">Choose a message pool. The addon selects a message from this pool when the reminder is due.</p><div class="pool">${messages.map((m, j) => `<label class="check" title="${esc(m.text)}"><input type="checkbox" data-message="${esc(m.id)}" ${vals(r.messageIds).includes(m.id) ? "checked" : ""}><span data-pool-message-label="${esc(m.id)}">${esc(model.messageDisplayName(m,j))}: ${esc(m.text)}</span></label>`).join("") || '<span class="help">Add a message below first.</span>'}</div><div class="actions"><button data-action="save">Apply reminder</button><button data-action="preview">Preview here</button><button data-action="remove" class="danger">Remove</button></div></article>`).join("") || '<div class="empty">No timeline reminders yet.</div>'}</div></section><section class="panel"><div class="heading"><h2>Important times</h2><button id="add-mark">+ Add time</button></div><p class="help">Name an important moment, such as doors opening or ticket sales closing, and reuse it in reminder anchors.</p><details class="important-time-guide" id="important-time-guide"><summary>How to use important times</summary><ol><li>Add a key such as <code>tickets</code>, with a label such as Ticket sales close.</li><li>Use <strong>-60</strong> minutes for one hour before the event (-30 means 30 minutes before). Positive values mean after. Click <strong>Apply</strong>.</li><li>For a reminder start or stop, choose <strong>Anchor → Important time</strong> and select it.</li><li>In messages, use <code>%eventwhen:tickets%</code>, <code>%eventtime:tickets%</code>, <code>%eventdate:tickets%</code> or <code>%eventcountdown:tickets%</code>. The key after the colon must match the key you created.</li></ol><p class="help">For an 8 PM event, tickets at -60 means 7 PM on that event day. It follows each recurring event automatically. The Pick date and time option calculates the same reusable offset, not a separate one-off date.</p></details>${Object.entries(
      s.importantTimes || {},
    )
      .map(
        ([id, m]) =>
          `<div class="grid mark" data-id="${esc(id)}">${input("Label", "label", m.label)}${input("Minutes from event", "offsetMinutes", m.offsetMinutes, "number")}<div class="actions"><button data-action="save-mark">Apply</button><button data-action="remove-mark" class="danger">Remove</button></div></div>`,
      )
      .join(
        "",
      )}</section><section class="panel"><div class="heading"><h2>Message library <span class="badge">${messages.length} VARIANTS</span></h2><button id="add-message">+ Add message</button></div><p class="help">Drag a message handle to reorder, or focus it and use Up/Down arrows. Optional names are limited to 60 characters and are not sent in chat. Order is for display only; selection remains randomized.</p>${ambiguousMessages(e) ? '<p class="help" role="alert">Some legacy messages have no guild name and their guild slot cannot be resolved safely. They are omitted from this editor and remain untouched in the file.</p>' : ""}${messages.map((m, i) => `<details class="message" data-id="${esc(m.id)}"><summary><span class="message-drag-handle" draggable="true" tabindex="0" role="button" aria-label="Reorder ${esc(model.messageDisplayName(m,i))}; drag or use Up and Down arrows">↕</span><span class="message-summary-title">${esc(model.messageDisplayName(m,i))} ${m.locked ? " - Locked" : ""} - ${esc(m.text.slice(0, 65))}${m.text.length > 65 ? "..." : ""}</span></summary>${input("Message name (optional)","messageName",model.messageDisplayName(m,i))}<div class="heading"><strong class="message-full-name">${esc(model.messageDisplayName(m,i))}</strong>${select("Variant", "variant", s.messageVariants?.[m.id] || "ALL", variantChoices(s,s.messageVariants?.[m.id]||"ALL"))}</div><textarea aria-label="Message ${i + 1}" ${m.locked ? "readonly" : ""}>${esc(m.text)}</textarea><div class="actions"><button data-action="save-message" ${m.locked ? "disabled" : ""}>Apply message</button><button data-action="delete-message" class="danger" ${m.locked ? "disabled" : ""}>Delete message</button><select data-insert-token aria-label="Insert substitution"><option value="">Insert substitution...</option>${opts(insertableTokens(s))}</select></div></details>`).join("")}</section>`;
  function refreshOverlapWarning(){
    const note=document.querySelector('#timeline-conflicts');
    try{
      const candidate=clone(currentEventDraft());candidate.reminders=tableArray(rows.map(r=>{
        const card=[...document.querySelectorAll('#rows .reminder')].find(el=>el.dataset.row===r.id);
        return card?{...clone(r),...fields(card)}:r;
      }));
      const notes=candidate.timelineVersion===1?overlapNotes(candidate):[];note.textContent=notes.join(' ');note.hidden=!notes.length;
    }catch{note.hidden=true;}
  }
  document.querySelector('#rows').addEventListener('input',refreshOverlapWarning);document.querySelector('#rows').addEventListener('change',refreshOverlapWarning);refreshOverlapWarning();
  function refreshEffectiveTimes(){
    const cards=[...document.querySelectorAll('#rows .reminder')];
    try{
      const panel=document.querySelector('#detail>.panel.event-settings');
      if([...panel.querySelectorAll('input[type=number]')].some(el=>!el.checkValidity()))throw Error('Enter valid event settings to calculate reminder times.');
      const draft=currentEventDraft();draft.importantTimes=clone(draft.importantTimes||{});
      document.querySelectorAll('#detail .mark').forEach(el=>{const v=fields(el);if(draft.importantTimes[el.dataset.id])Object.assign(draft.importantTimes[el.dataset.id],v);});
      const at=projectedNext(draft)??model.scheduleEventUtc(draft);
      if(!Number.isFinite(at))throw Error('Choose a valid event date and start time.');
      const clock=t=>new Date(t*1000).toLocaleString('en-US',{timeZone:zoneNames[draft.timeZone],month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
      for(const card of cards){
        const summary=card.querySelector('[data-effective-times]');
        try{
          const row={...clone(rows.find(r=>r.id===card.dataset.row)),...fields(card)};
          if([...card.querySelectorAll('input[data-field]')].some(el=>!el.checkValidity()))throw Error('Enter valid reminder values to calculate its times.');
          for(const anchor of [row.start,...(row.once&&!row.onceUntilFinish?[]:[row.finish])]){
            if(anchor?.kind==='OFFSET'&&!Number.isFinite(anchor.minutes))throw Error('Enter a valid minute offset.');
            if(anchor?.kind==='DAY'&&(!Number.isFinite(anchor.days)||!anchor.time))throw Error('Choose a valid day offset and clock.');
            if(anchor?.kind==='MARK'&&!Number.isFinite(draft.importantTimes[anchor.name]?.offsetMinutes))throw Error('Choose a valid important time.');
          }
          const window=model.reminderWindows({...draft,reminders:tableArray([row])},at)[0];
          if(!window)throw Error('No valid reminder window: check its start/stop times, event duration and daylight-saving clock.');
          summary.textContent=`Starts: ${clock(window.start)} · Stops: ${clock(window.end)} · Event: ${clock(at)}`;
          summary.classList.remove('invalid');
        }catch(error){summary.textContent=error.message;summary.classList.add('invalid');}
      }
    }catch(error){for(const card of cards){const summary=card.querySelector('[data-effective-times]');summary.textContent=error.message;summary.classList.add('invalid');}}
  }
  const numericValues=new WeakMap();
  const nonnegative=el=>el?.matches?.('input[type=number][min]')&&Number(el.min)>=0;
  document.querySelectorAll('#detail input[type=number][min]').forEach(el=>{if(nonnegative(el))numericValues.set(el,Number(el.value)>=0?el.value:'');});
  const detail=document.querySelector('#detail');
  detail.onkeydown=ev=>{if(nonnegative(ev.target)&&!ev.ctrlKey&&!ev.metaKey&&['-','+','e','E','.'].includes(ev.key))ev.preventDefault();};
  detail.onbeforeinput=ev=>{if(nonnegative(ev.target)&&ev.data?.includes('-'))ev.preventDefault();};
  detail.oninput=ev=>{
    editRevision++;
    const el=ev.target;
    if(nonnegative(el)){
      if(el.value!==''&&Number(el.value)<0){el.value=numericValues.get(el)||'';status(el.dataset.field==='eventDurationMinutes'?'Event duration must be zero or a positive whole number.':'This field requires a positive whole number.',true);}
      else numericValues.set(el,el.value);
    }
    refreshEffectiveTimes();
  };
  detail.onchange=()=>{editRevision++;refreshEffectiveTimes();};
  const eventPanel=document.querySelector('#detail>.panel.event-settings');
  const fold=eventPanel.querySelector('[data-field=eventFold]').closest('label');
  const advanced=document.createElement('details');advanced.id='event-clock-options';advanced.innerHTML='<summary>Advanced clock options</summary>';advanced.open=s.eventFold==='SECOND';fold.parentElement.append(advanced);advanced.append(fold);
  if(s.timelineVersion!==1)eventPanel.insertAdjacentHTML('afterend',legacyMigrationBanner(e));
  eventPanel.querySelectorAll('[data-field=recurrence],[data-field=specialPattern],[data-field=eventDate],[data-weekday],#use-event-weekdays').forEach(control=>control.addEventListener('change',refreshEventRelevance));
  refreshEventRelevance();
  eventPanel.querySelectorAll('input,select').forEach(el=>{el.addEventListener('input',refreshNextOccurrence);el.addEventListener('change',refreshNextOccurrence);});refreshNextOccurrence();
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
    candidate.weekdays=currentEventDraft().weekdays;
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
      const labelInput=card.querySelector('[data-field=label]'),heading=card.querySelector('.heading h3');
      heading.setAttribute('aria-live','polite');
      labelInput.addEventListener('input',()=>{heading.textContent=`${rows.indexOf(r)+1}. ${labelInput.value.trim()||'Reminder'}`;});
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
              const anchorGrid=sel.closest(".grid");anchorGrid.innerHTML = anchorMarkup(anchor, key, s);
              decorateFieldLabels(anchorGrid);bindAnchorSelectors();refreshEffectiveTimes();
            }),
        );
      }
      bindAnchorSelectors();
      card.addEventListener("click",ev=>{if(ev.target.closest(".create-important-time"))$("#add-mark").click();const badge=ev.target.closest(".reminder-type");if(badge)badge.classList.toggle("show-help");});
      attachPoolPreviews(card,e,r);
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
              else renderDetail(r.id);
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
  document.querySelectorAll('.mark').forEach(el=>{const d=currentEventDraft(),at=projectedNext(d)??model.scheduleEventUtc(d),mark=s.importantTimes[el.dataset.id],target=at+mark.offsetMinutes*60,parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zoneNames[d.timeZone],year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(target*1000)).map(x=>[x.type,x.value]));el.insertAdjacentHTML('afterbegin','<p class="help mark-key">Message key: <code>'+esc(el.dataset.id)+'</code> · Example: <code>%eventtime:'+esc(el.dataset.id)+'%</code></p>');el.insertAdjacentHTML('beforeend','<div class="grid">'+select('Define important time','markMode','OFFSET',[["OFFSET","Minutes before / after event"],["DATE","Pick date and time"]])+input('Important date','markDate',parts.year+'-'+parts.month+'-'+parts.day,'date')+input('Important clock','markTime',parts.hour+':'+parts.minute,'time')+'</div><p class="help">Date/time choices use '+esc(d.timeZone)+' and become an offset from the selected next occurrence, so they follow recurring events.</p>');const update=()=>{const dateMode=el.querySelector('[data-field=markMode]').value==='DATE';showField(el,'markDate',dateMode);showField(el,'markTime',dateMode);showField(el,'offsetMinutes',!dateMode);};el.querySelector('[data-field=markMode]').onchange=update;update();});
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
    const existingMessages=eventMessages(e);existingMessages.forEach((message,i)=>message.displayOrder=i+1);
    append(account().messages, {
      name:model.nextMessageName(existingMessages),displayOrder:existingMessages.length+1,
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
  let draggedMessageId=null;
  const reorderLibrary=(sourceId,targetId,after)=>{
    const reordered=model.reorderMessageEntries(eventMessages(e),sourceId,targetId,after),updates=new Map(reordered.map(m=>[m.id,m]));
    vals(account().messages).forEach(m=>{if(updates.has(m.id))Object.assign(m,updates.get(m.id));});
    changed();renderDetail(null,sourceId);
  };
  $("#detail")
    .querySelectorAll(".message")
    .forEach((el) => {
      const message=messages.find(m=>m.id===el.dataset.id),index=messages.indexOf(message),nameInput=el.querySelector('[data-field=messageName]'),handle=el.querySelector('.message-drag-handle');
      nameInput.maxLength=60;
      nameInput.oninput=()=>{
        if(nameInput.value.length>60){nameInput.setCustomValidity('Use at most 60 characters.');nameInput.reportValidity();return;}nameInput.setCustomValidity('');
        if(nameInput.value.trim())message.name=nameInput.value.trim();else delete message.name;
        const name=model.messageDisplayName(message,index);el.querySelector('.message-summary-title').textContent=name+(message.locked?' - Locked':'')+' - '+message.text.slice(0,65)+(message.text.length>65?'...':'');el.querySelector('.message-full-name').textContent=name;
        handle.setAttribute('aria-label','Reorder '+name+'; drag or use Up and Down arrows');
        document.querySelectorAll('[data-pool-message-label]').forEach(label=>{if(label.dataset.poolMessageLabel===message.id)label.textContent=name+': '+message.text;});changed();
      };
      handle.onclick=ev=>{ev.preventDefault();ev.stopPropagation();};
      handle.onkeydown=ev=>{if(!['ArrowUp','ArrowDown'].includes(ev.key))return;ev.preventDefault();ev.stopPropagation();const next=index+(ev.key==='ArrowUp'?-1:1);if(messages[next])reorderLibrary(message.id,messages[next].id,ev.key==='ArrowDown');};
      handle.ondragstart=ev=>{draggedMessageId=message.id;ev.dataTransfer.effectAllowed='move';ev.dataTransfer.setData('text/plain',message.id);};
      handle.ondragend=()=>{draggedMessageId=null;document.querySelectorAll('.message').forEach(card=>card.classList.remove('message-drop-before','message-drop-after'));};
      el.ondragover=ev=>{if(!draggedMessageId||draggedMessageId===message.id)return;ev.preventDefault();ev.dataTransfer.dropEffect='move';const rect=el.querySelector('summary').getBoundingClientRect(),after=ev.clientY>rect.y+rect.height/2;el.classList.toggle('message-drop-before',!after);el.classList.toggle('message-drop-after',after);};
      el.ondragleave=ev=>{if(!el.contains(ev.relatedTarget))el.classList.remove('message-drop-before','message-drop-after');};
      el.ondrop=ev=>{if(!draggedMessageId)return;ev.preventDefault();ev.stopPropagation();const rect=el.querySelector('summary').getBoundingClientRect(),source=draggedMessageId;draggedMessageId=null;reorderLibrary(source,message.id,ev.clientY>rect.y+rect.height/2);};
      const draft=messageDrafts.get(message.id);if(draft){if(draft.text!==undefined)el.querySelector('textarea').value=draft.text;if(draft.variant!==undefined)el.querySelector('[data-field=variant]').value=draft.variant;}
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
  decorateFieldLabels();refreshEffectiveTimes();
  document.querySelectorAll('#detail details').forEach(d=>{const key=detailKey(d);if(openDetails.has(key))d.open=openDetails.get(key);});
  if(focusMessageId){requestAnimationFrame(()=>{const message=[...document.querySelectorAll('#detail .message')].find(el=>el.dataset.id===focusMessageId);if(message){message.querySelector('.message-drag-handle')?.focus({preventScroll:true});message.scrollIntoView({block:'nearest',behavior:'instant'});}});}
  else if(focusReminderId){
    requestAnimationFrame(()=>{
      const card=[...document.querySelectorAll('#rows .reminder')].find(el=>el.dataset.row===focusReminderId);
      if(!card)return;
      card.querySelector('[data-field=label]')?.focus({preventScroll:true});
      card.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});
      window.scrollBy({top:-16,behavior:'instant'});
    });
  }else if (preserveScroll)
    requestAnimationFrame(() =>window.scrollTo({top:scrollY,behavior:'instant'}));
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
function attachPoolPreviews(card,event,row){
  let bubble;
  const close=()=>{bubble?.remove();bubble=null;card.querySelectorAll('[aria-describedby="pool-preview"]').forEach(el=>el.removeAttribute('aria-describedby'));};
  const show=label=>{
    close();const id=label.querySelector('[data-message]')?.dataset.message;
    const message=eventMessages(event).find(m=>m.id===id);if(!message)return;
    let output=message.text,caption='Full message template';
    try{
      const schedule=event.schedule,at=projectedNext(schedule)??model.scheduleEventUtc(schedule),draft={...clone(row),...fields(card)};
      const window=model.reminderWindows({...schedule,reminders:tableArray([draft])},at).find(w=>w.row.id===draft.id);
      if(window){const now=draft.once?window.start:Math.floor((window.start+window.end)/2);output=model.previewMessage(message.text,schedule,at,now,{guild,zone:'Guild Hall'});caption='Preview inside this announcement period · '+new Date(now*1000).toLocaleString('en-US',{timeZone:zoneNames[schedule.timeZone||'ET'],timeZoneName:'short'});}
    }catch{}
    bubble=document.createElement('div');bubble.id='pool-preview';bubble.className='pool-preview-tooltip';bubble.setAttribute('role','tooltip');
    const heading=document.createElement('strong');heading.textContent=caption;const text=document.createElement('p');text.textContent=output;
    const template=document.createElement('small');template.textContent='Template: '+message.text;bubble.append(heading,text,template);document.body.append(bubble);
    label.querySelector('input').setAttribute('aria-describedby','pool-preview');
    const rect=label.getBoundingClientRect(),width=bubble.getBoundingClientRect().width,height=bubble.getBoundingClientRect().height;
    bubble.style.left=Math.max(8,Math.min(rect.left,innerWidth-width-8))+'px';
    bubble.style.top=Math.max(8,Math.min(rect.bottom+6,innerHeight-height-8))+'px';
  };
  card.querySelectorAll('.pool label').forEach(label=>{
    label.removeAttribute('title');
    label.addEventListener('mouseenter',()=>show(label));label.addEventListener('mouseleave',close);
    label.addEventListener('focusin',()=>show(label));label.addEventListener('focusout',close);
    label.addEventListener('keydown',ev=>{if(ev.key==='Escape')close();});
  });
  // A rerender must not leave a detached card's tooltip behind.
  card.addEventListener('click',ev=>{if(ev.target.closest('[data-action]'))close();});
}
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
    `<h2>Preview - ${esc(r.label)}</h2><p class="help">Simulate a time inside this reminder. The addon chooses from the eligible pool and always requires Enter.</p><div class="grid two"><label>Simulated local time<span class="clock-control"><input id="simulate-time" type="datetime-local" value="${localDate}"><span class="clock-zone">${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}</span></span></label><label>Simulated player zone<input id="simulate-zone" value="Guild Hall"></label></div><p id="simulate-status" class="help"></p><div id="simulate-messages"></div><p class="help">Event, deadline, faction, guild and zone substitutions use this simulated time. Additional natural-language date/time parsing and actual player context are applied in ESO.</p>`;
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
      const enteringOverview=b.dataset.view==='calendar'&&currentView!=='calendar';
      currentView = b.dataset.view;
      if(enteringOverview){calMode='day';calDate='';}
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
let calMode = "day",
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
      ["day", "Day timeline"],
      ["week", "Week"],
      ["month", "Month"],
    ],
  )}${input("Starting date", "date", calDate, "date")}${select(
    "Show",
    "kind",
    calKind,
    [
      ["all", "All events and reminders"],
      ["windows", "Repeating reminders"],
      ["milestones", "One-time notices"],
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
    calMode === "day" ? 1 : calMode === "week"
      ? 7
      : new Date(
          Date.UTC(civil.getUTCFullYear(), civil.getUTCMonth() + 1, 0),
        ).getUTCDate();
  const endCivil = new Date(civil);
  endCivil.setUTCDate(endCivil.getUTCDate() + days);
  const start = calendarBoundary(civil.toISOString().slice(0, 10), zone)-(calMode==='day'?7200:0),
    end = calendarBoundary(endCivil.toISOString().slice(0, 10), zone)+(calMode==='day'?7200:0),
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
        if (calKind === "all" && at < end && at + Number(e.schedule.eventDurationMinutes || 0)*60 >= start)
          items.push({
            at,
            end: at + Number(e.schedule.eventDurationMinutes || 0)*60,
            e,
            label: "Actual event",eventAtUtc:at,
            milestone: !Number(e.schedule.eventDurationMinutes),
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
            end: w.end,rowId:w.row.id,eventAtUtc:at,
            e,
            label: w.row.label+(w.row.paused?" [Paused]":w.row.enabled===false?" [Disabled]":""),
            milestone: w.row.once&&!w.row.onceUntilFinish,once:w.row.once,
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
  if(calMode === "day"){renderDayTimeline(items,start,end,zone);return;}
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
    day.innerHTML = `<button class="day-drilldown" title="Open this day as a wide timeline">${esc(date.toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }))}</button>`;
    day.querySelector('.day-drilldown').onclick=()=>{calDate=key;calMode='day';renderCalendar();};
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
let dayTimelineUndo=null;
function renderDayTimeline(items,from,until,zone){
  const root=document.querySelector('#calendar-grid');root.className='day-timeline-scroll';
  const nav=document.createElement('div');nav.className='day-navigation';nav.innerHTML='<div class="day-date-controls"><button data-day-step="-1">← Previous day</button><button data-day-today>Today</button><button data-day-step="1">Next day →</button></div><button data-day-undo>Undo last timeline edit</button>';
  const instructions=document.createElement('p');instructions.className='help day-instructions';instructions.textContent='5-minute snapping · Drag a block to move; drag a visible end to resize.';
  nav.querySelectorAll('[data-day-step]').forEach(b=>{const date=new Date(calDate+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+Number(b.dataset.dayStep));b.textContent=(Number(b.dataset.dayStep)<0?'← ':'')+date.toLocaleDateString('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'})+(Number(b.dataset.dayStep)>0?' →':'');b.setAttribute('aria-label','View '+date.toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long',year:'numeric',month:'long',day:'numeric'}));});
  nav.querySelectorAll('[data-day-step]').forEach(b=>b.onclick=()=>{const d=new Date(calDate+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+Number(b.dataset.dayStep));calDate=d.toISOString().slice(0,10);renderCalendar();});
  nav.querySelector('[data-day-today]').onclick=()=>{calDate='';renderCalendar();};
  const undo=nav.querySelector('[data-day-undo]');undo.disabled=!dayTimelineUndo||dayTimelineUndo.account!==accountName||dayTimelineUndo.guild!==guild;
  undo.onclick=()=>{try{const edit=dayTimelineUndo,event=all().find(e=>e.commandId===edit.commandId&&e.guild===guild);if(!event||JSON.stringify(event.schedule)!==edit.after)throw Error('This event changed since the drag; Undo cannot overwrite newer edits.');event.settings.schedule=clone(edit.before);selected=event.commandId;dayTimelineUndo=null;changed();renderCalendar();status('Timeline edit undone.');}catch(error){status(error.message,true);}};
  root.before(nav,instructions);
  const visible=items.filter(x=>x.at<until&&(x.milestone?x.at>=from:x.end>from));
  const clock=t=>new Date(t*1000).toLocaleTimeString('en-US',{timeZone:zoneNames[zone],hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  const x=t=>100*(Math.max(from,Math.min(until,t))-from)/(until-from);
  const colors=['#397fa8','#9966bb','#318c74','#b27b31','#b65276','#546fba','#8b8634'];
  const shell=document.createElement('div');shell.className='day-timeline';
  const header=document.createElement('div');header.className='day-timeline-row day-timeline-header';
  header.innerHTML='<strong>Event / announcement</strong><div class="day-track"></div>';
  const ticks=[];for(let t=from;t<until;t+=3600)ticks.push(t);
  const addContext=track=>{for(const [a,b,text] of [[from,from+7200,'Previous day'],[until-7200,until,'Next day']]){const shade=document.createElement('span');shade.className='day-context';shade.style.left=x(a)+'%';shade.style.width=(x(b)-x(a))+'%';shade.title=text;track.append(shade);}};
  addContext(header.lastElementChild);header.querySelectorAll('.day-context').forEach(el=>el.textContent=el.title);
  ticks.forEach(t=>{const label=document.createElement('span');label.className='day-hour';label.style.left=x(t)+'%';label.textContent=new Date(t*1000).toLocaleTimeString('en-US',{timeZone:zoneNames[zone],hour:'numeric',hourCycle:'h23'});label.title=new Date(t*1000).toLocaleString('en-US',{timeZone:zoneNames[zone],timeZoneName:'short'});header.lastElementChild.append(label);});shell.append(header);
  const frequencies=[...new Set(visible.filter(x=>!x.event&&!x.milestone).map(x=>Number(x.interval||0)))].sort((a,b)=>a-b);
  const groups=new Map();visible.forEach(item=>{if(!groups.has(item.e.commandId))groups.set(item.e.commandId,[]);groups.get(item.e.commandId).push(item);});
  let colorIndex=0;
  for(const group of groups.values()){
    group.sort((a,b)=>Number(b.event)-Number(a.event)||a.at-b.at);
    const hue=colors[colorIndex++%colors.length];
    for(const item of group){
      const row=document.createElement('div');row.className='day-timeline-row';
      const label=document.createElement('div');label.className='day-row-label';label.innerHTML=`<strong>${esc(item.e.command.name)}</strong><small>${esc(item.label)}</small>`;
      const track=document.createElement('div');track.className='day-track';addContext(track);
      ticks.forEach(t=>{const line=document.createElement('span');line.className='day-gridline';line.style.left=x(t)+'%';track.append(line);});
      const button=document.createElement('button');button.className='day-block'+(item.milestone?' day-milestone':'')+(item.event?' day-actual-event':'');
      button.style.left=x(item.at)+'%';button.style.width=(item.milestone?0:Math.max(.3,x(item.end)-x(item.at)))+'%';
      // Each frequency gets a stable color, so a changed cadence is visible.
      const frequency=Number(item.interval||0);button.style.background=item.event?hue:(item.milestone||item.once)?'#b58a3b':`hsl(${(frequencies.indexOf(frequency)*137.508+205)%360} 45% 38%)`;
      const frequencyText=item.event?'Event in progress':item.milestone?'Once':item.once?'Once within window':`Every ${frequency} minutes`;
      const detail=`${item.e.command.name} — ${item.label}: ${clock(item.at)}${item.end!==item.at?' – '+clock(item.end):''} · ${frequencyText}`;
      button.textContent=item.milestone?'◆':frequencyText;button.title=detail;button.setAttribute('aria-label',detail);
      const clippedStart=item.at<from,clippedFinish=item.end>until;
      for(const [edge,clipped,arrow] of [['start',clippedStart,'◀'],['finish',clippedFinish,'▶']]){
        if(clipped){const marker=document.createElement('span');marker.className='day-continues '+edge;marker.textContent=arrow;marker.title='Continues '+(edge==='start'?'before':'after')+' the visible range; navigate to its actual edge to resize.';button.append(marker);}
        else if(!item.milestone&&item.e.schedule.timelineVersion===1){const handle=document.createElement('span');handle.className='day-resize '+edge;handle.dataset.edge=edge;handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label','Resize '+edge+' of '+item.label);button.append(handle);}
      }
      let suppressClick=false;
      const apply=(edge,delta)=>{
        if(!delta)return;
        try{
          const before=clone(item.e.schedule),result=model.editDayTimeline(before,item.eventAtUtc,item.event?null:item.rowId,edge,delta);
          item.e.settings.schedule=result.schedule;selected=item.e.commandId;changed();
          dayTimelineUndo={account:accountName,guild,commandId:item.e.commandId,before,after:JSON.stringify(item.e.settings.schedule)};
          renderCalendar();status('Timeline updated.'+(result.notice?' '+result.notice:''));
        }catch(error){renderCalendar();status(error.message,true);}
      };
      button.onclick=ev=>{if(suppressClick||ev.target.closest('[data-edge]')){suppressClick=false;ev.preventDefault();return;}selected=item.e.commandId;document.querySelector('[data-view=editor]').click();renderList();};
      if(item.e.schedule.timelineVersion===1){
        button.classList.add('day-editable');let drag=null;
        button.onpointerdown=ev=>{
          if(ev.button!==0)return;button.removeAttribute('title');drag={x:ev.clientX,edge:ev.target.closest('[data-edge]')?.dataset.edge||'move',delta:0,moved:false};button.setPointerCapture(ev.pointerId);
        };
        button.onpointermove=ev=>{
          if(!drag)return;const pixels=ev.clientX-drag.x;if(Math.abs(pixels)>4)drag.moved=true;if(!drag.moved)return;
          drag.delta=Math.round(pixels/track.getBoundingClientRect().width*(until-from)/300)*5;
          const start=item.at+(drag.edge==='finish'?0:drag.delta*60),end=item.end+(drag.edge==='start'?0:drag.delta*60);
          button.style.left=x(start)+'%';button.style.width=(item.milestone?0:Math.max(.3,x(end)-x(start)))+'%';button.classList.add('day-dragging');
          let feedback=document.querySelector('#day-drag-feedback');if(!feedback){feedback=document.createElement('div');feedback.id='day-drag-feedback';feedback.setAttribute('role','status');document.body.append(feedback);}
          const fullClock=t=>new Date(t*1000).toLocaleString('en-US',{timeZone:zoneNames[zone],month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
          feedback.textContent=item.label+': '+fullClock(start)+(item.milestone?'':' → '+fullClock(end));feedback.style.left=Math.max(8,Math.min(ev.clientX,innerWidth-360))+'px';feedback.style.top=Math.max(8,ev.clientY-66)+'px';
        };
        button.onpointerup=ev=>{if(!drag)return;const saved=drag;drag=null;document.querySelector('#day-drag-feedback')?.remove();if(!saved.moved)button.title=detail;if(saved.moved){suppressClick=true;ev.preventDefault();if(saved.delta)apply(saved.edge,saved.delta);else renderCalendar();}};
        button.onpointercancel=()=>{drag=null;document.querySelector('#day-drag-feedback')?.remove();renderCalendar();};
        button.onkeydown=ev=>{if(ev.key==='Escape'&&drag){drag=null;document.querySelector('#day-drag-feedback')?.remove();renderCalendar();ev.preventDefault();return;}if(!['ArrowLeft','ArrowRight'].includes(ev.key))return;ev.preventDefault();ev.stopPropagation();apply(ev.target.closest('[data-edge]')?.dataset.edge||'move',ev.key==='ArrowRight'?5:-5);};
      }
      track.append(button);row.append(label,track);shell.append(row);
      const note=document.createElement('div');note.className='day-row-detail';note.textContent=detail;shell.append(note);
    }
  }
  if(!visible.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='No matching events or announcements on this day.';shell.append(empty);}
  root.append(shell);
  const help=document.createElement('p');help.className='help';help.textContent=`Times use ${zone}. Blocks show eligible announcement windows, not guaranteed sends. Each announcement has its own row to keep overlaps visible. Shaded margins show two hours of the previous/next day. Arrows indicate hidden ends; those ends cannot be resized. Event bars show the configured duration. Moving an event changes its recurring anchor: minute-offset reminders follow, fixed day/clock reminders retain their clocks. On daylight-saving transitions, the axis includes the actual 23 or 25 hours (hover hour labels to identify the timezone). Click a block to edit its event.`;root.before(help);
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
    `<details id="legacy-transfer"><summary>Advanced: legacy conversion and older single-event tools</summary><div class="heading"><h2>Combine legacy helpers</h2><span class="badge">EXPLICIT REVIEW</span></div><p class="help">Choose a parent event with the true event date and clock. Move existing message IDs from selected helper commands into it. Source configuration is retained as a backup; source schedules are paused to prevent duplicate delivery. No dates or reminder timing are inferred from command names.</p><div class="grid two">${select(
      "Keep parent event",
      "parent",
      selected,
      events.map((e) => [e.commandId, e.command.name]),
    )}<label>Helper commands to combine<select id="sources" multiple size="6">${opts(events.filter((e) => e.commandId !== selected).map((e) => [e.commandId, e.command.name]))}</select></label></div><div class="actions" style="margin-top:15px"><button id="review-combine">Review combination</button><button id="portable-export">Export selected timeline JSON</button><label class="button">Import timeline JSON<input id="portable-import" type="file" accept=".json" hidden></label></div><p class="help">Portable JSON includes the selected event's schedule and unlocked messages. Review the destination guild and message content before import.</p></details>`;
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
        JSON.stringify((requireValidTimeline(e.schedule),portableEvent(e, eventMessages(e))), null, 2),
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
      requireValidTimeline(staged.schedule);
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
  renderSharingPanels();
}
let pendingEventImport=null,exportAllGuilds=false;
function renderSharingPanels(){
  const exportable=(exportAllGuilds?all():guildEvents()).filter(e=>!e.schedule.mergedInto);
  const unavailable=e=>e.command.locked?'Locked command':e.settings.runAt==='SCHEDULED'&&e.schedule.timelineVersion!==1?'Convert legacy schedule first':null;
  let review=[];if(pendingEventImport)review=reviewEventImport(pendingEventImport,account());
  $('#transfer').insertAdjacentHTML('afterbegin',`<section class="sharing-panel"><p class="eyebrow">SHARE YOUR PLANS</p><h2>Export events</h2><p class="help">Share selected events or all events. Includes messages, announcement periods, recurrence, output channel, sound and command options. Private locked messages and cooldown history stay on your machine.</p><label class="check"><input id="export-all-guilds" type="checkbox" ${exportAllGuilds?'checked':''}>Include all guilds in this account</label><div class="actions"><button id="select-all-export">Select all</button><button id="clear-export">Clear selection</button></div><div class="sharing-list">${exportable.map(e=>`<label class="check"><input class="bulk-export-choice" type="checkbox" value="${esc(e.commandId+'|'+e.guild.toLowerCase())}" ${unavailable(e)?'disabled':'checked'}><span><strong>${esc(e.command.name)}</strong> · ${esc(e.guild)}<small>${esc(unavailable(e)||e.settings.runAt||'On demand')}</small></span></label>`).join('')||'<p class="help">No events in this account/guild.</p>'}</div><button id="export-events" class="gold">Export selected events</button></section><section class="sharing-panel"><h2>Import events</h2><p class="help">Destination account: <strong>${esc(accountName)}</strong>. Load an event JSON export, review the list, then choose what to import. Guilds match by name, events by command name. Nothing changes until you apply the selection.</p><label class="button gold">Choose import file<input id="import-events-file" type="file" accept=".json" hidden></label>${pendingEventImport?`<div class="actions"><button id="select-all-import">Select all available</button><button id="clear-import">Clear selection</button></div><div class="sharing-list" id="import-event-review">${review.map(r=>`<label class="check"><input class="bulk-import-choice" type="checkbox" value="${r.index}" ${r.reason?'disabled':'checked'}><span><strong>${esc(r.entry.eventName)}</strong> · ${esc(r.entry.guild)}<small>${esc(r.action)} · ${esc(r.reason||r.entry.messages.length+' message(s)')}${r.entry.outputChannel?' · '+esc(r.entry.outputChannel):''}</small></span></label>`).join('')}</div><p class="help">Updates replace the selected event configuration. Local runtime history, locked messages and unselected events remain. Imports do not change account-wide defaults. Skipped items are not imported.</p><button id="apply-event-import" class="gold">Import selected events</button>`:''}</section><p class="help">For a full backup or editing your own file, use Open SavedVariables and Download updated Lua in the top toolbar. Shared event JSON is a separate format.</p>`);
  $('#export-all-guilds').onchange=ev=>{exportAllGuilds=ev.target.checked;renderTransfer();};
  const checkAll=(selector,checked)=>document.querySelectorAll(selector+':not(:disabled)').forEach(el=>el.checked=checked);
  $('#select-all-export').onclick=()=>checkAll('.bulk-export-choice',true);$('#clear-export').onclick=()=>checkAll('.bulk-export-choice',false);
  $('#export-events').onclick=()=>{try{
    const selected=[...document.querySelectorAll('.bulk-export-choice:checked')].map(el=>el.value);
    const bundle=readEventBundle(exportEventBundle(account(),exportAllGuilds?null:guild,selected));
    bundle.items.forEach(item=>{if(item.schedule)requireValidTimeline(item.schedule);});
    download(JSON.stringify(bundle,null,2),'SmartChatMsg-events.json','application/json');status(`Exported ${bundle.items.length} event(s).`);
  }catch(error){status(error.message,true);}};
  $('#import-events-file').onchange=async ev=>{try{
    const file=ev.target.files[0];if(!file||file.size>20*1024*1024)throw Error('Choose an event JSON export smaller than 20 MB.');
    pendingEventImport=readEventBundle(JSON.parse(await file.text()));renderTransfer();status('Review the import list and choose which events to apply.');
    $('#import-event-review')?.scrollIntoView({block:'nearest'});
  }catch(error){status(error.message,true);}finally{ev.target.value='';}};
  if(pendingEventImport){
    $('#select-all-import').onclick=()=>checkAll('.bulk-import-choice',true);$('#clear-import').onclick=()=>checkAll('.bulk-import-choice',false);
    $('#apply-event-import').onclick=()=>{try{
      const selected=[...document.querySelectorAll('.bulk-import-choice:checked')].map(el=>Number(el.value));if(!selected.length)throw Error('Select at least one available event to import.');
      const result=importEventBundle(account(),pendingEventImport,selected);
      if(!result.applied.length)throw Error(result.skipped.join(' ')||'No events selected.');
      if(!confirm(`Import ${result.applied.length} event(s) into ${accountName}? Existing matching event settings will be updated; local runtime history and locked messages remain.\n\n${result.applied.join('\n')}`))return;
      data.Default[accountName].$AccountWide=result.account;pendingEventImport=null;changed();refreshGuilds();renderTransfer();
      status(`Imported ${result.applied.length} event(s). Download updated Lua to install in ESO.${result.skipped.length?' Skipped: '+result.skipped.join('; '):''}`);
    }catch(error){status(error.message,true);}};
  }
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
function prepareCurrentLua(){
  if(!data)throw Error('Open a SavedVariables file first.');
  validateEditedTimelines();
  const result=model.mergeSavedVariables(base,data,latest||base);
  if(result.conflicts.length){
    const detail=result.conflicts.map(c=>`${c.path}\nEdited: ${JSON.stringify(c.edited)}\nLatest: ${JSON.stringify(c.latest)}`).join('\n\n');
    throw Error('Configuration conflicts · save stopped\n\n'+detail+'\n\nResolve these edits in a fresh snapshot before saving or downloading.');
  }
  for(const entry of model.accounts(result.data))for(const event of model.events(entry.value)){
    const original=base.Default?.[entry.name]?.$AccountWide?.commandGuildSettings?.[event.commandId]?.[event.guild]?.schedule;
    if(event.schedule.timelineVersion===1&&JSON.stringify(event.schedule)!==JSON.stringify(original))event.schedule.reminders=tableArray(model.orderedReminderRows(event.schedule));
  }
  validateEditedTimelines(result.data);return writeSavedVariables(result.data);
}
$('#export').onclick=()=>{
  try{
    const lua=prepareCurrentLua();
    if(!confirm('Exit ESO completely before replacing SavedVariables. Keep a backup of the current SmartChatMsg.lua.\n\nDownload the reviewed configuration now?'))return;
    download(lua,'SmartChatMsg.lua');dirty=false;status('Downloaded SmartChatMsg.lua. Exit ESO, back up the original, then replace it with this file.');
  }catch(error){if(error.message.startsWith('Configuration conflicts'))dialog('Configuration conflicts · export stopped',error.message);else status(error.message,true);}
};
async function libraryRequest(path,options={}){
  const response=await fetch('/api/library'+path,options);
  if(!response.ok){const body=await response.json().catch(()=>null);throw Error(body?.error||`Unable to access the server library (HTTP ${response.status}).`);}
  return response;
}
async function showServerLibrary(focusSave=false){
  $('#dialog-body').innerHTML=`<h2>Shared server library</h2><p class="help">Full Lua configurations saved here are public: anyone can load all their accounts and messages, including locked messages. Names must be unique; saved files cannot be overwritten. Apply editor changes before saving.</p><section class="library-save"><label>Save current configuration as<input id="library-name" maxlength="120" placeholder="For example: Alphabet Mafia — November v1" ${data?'':'disabled'}></label><button id="library-save" class="gold" ${data?'':'disabled'}>Save to server</button></section>${data?'':'<p class="help">Open a local file or load a shared configuration before saving.</p>'}<div class="heading"><h3>Saved configurations</h3><button id="library-refresh">Refresh list</button></div><p id="library-status" role="status" class="help">Loading saved files…</p><div id="library-list"></div><p class="help">Loading opens a copy in this editor. It does not change your ESO files or remap accounts. Use event import/export to transfer events into another account. Download updated Lua when you are ready to install it.</p>`;
  $('#dialog').showModal();let requestVersion=0;const listNode=$('#library-list');
  const isActive=()=>$('#dialog').open&&$('#library-list')===listNode;
  const libraryStatus=(text,error=false)=>{const el=$('#library-status');if(isActive()&&el){el.textContent=text;el.classList.toggle('error',error);}};
  async function refresh(){
    if(!isActive())return;const version=++requestVersion;
    try{
      const payload=await(await libraryRequest('')).json();if(version!==requestVersion||!isActive())return;
      if(!Array.isArray(payload.files))throw Error('The server returned an invalid library list.');
      const files=payload.files.filter(file=>/^[a-f0-9]{64}$/.test(file.id)&&typeof file.name==='string');
      $('#library-list').innerHTML=files.map(file=>`<button class="library-file" data-library-id="${esc(file.id)}"><strong>${esc(file.name)}</strong><small>Saved ${esc(new Date(file.createdAt).toLocaleString())} · ${esc(Math.ceil(file.bytes/1024))} KB</small></button>`).join('')||'<p class="empty">No configurations saved yet.</p>';
      $('#library-list').querySelectorAll('[data-library-id]').forEach(button=>button.onclick=async()=>{
        if(dirty&&!confirm('Discard unsaved edits and load this shared configuration?'))return;
        button.disabled=true;const revision=editRevision;
        try{
          const lua=await(await libraryRequest('/'+button.dataset.libraryId)).text();
          if(!isActive()){status('Server load canceled. Your current workspace was not replaced.');return;}
          if(revision!==editRevision)throw Error('Your workspace changed while loading. Click the saved name again to review replacing it.');
          const parsed=parseSavedVariables(lua),name=files.find(file=>file.id===button.dataset.libraryId).name;
          installWorkspace(parsed,name+'.lua');$('#dialog').close();status(`Loaded shared configuration “${name}”. Choose the account and guild to edit; local ESO files are unchanged.`);
        }catch(error){libraryStatus(error.message,true);button.disabled=false;}
      });
      libraryStatus(`${files.length} saved configuration(s). Click a name to load it.`);
    }catch(error){if(version===requestVersion)libraryStatus(error.message,true);}
  }
  $('#library-refresh').onclick=refresh;
  $('#library-save').onclick=async()=>{
    const button=$('#library-save'),field=$('#library-name'),name=field.value.trim();
    if(!name){libraryStatus('Enter a unique name for this configuration.',true);field.focus();return;}
    button.disabled=true;field.disabled=true;
    try{
      const lua=prepareCurrentLua(),revision=editRevision;
      await libraryRequest('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,lua})});
      const unchanged=revision===editRevision;if(unchanged)dirty=false;field.value='';if(isActive())await refresh();libraryStatus(`Saved “${name}”. This name is now reserved; choose a different name for future versions.`);status(unchanged?`Saved a shared server copy named “${name}”. Local ESO files are unchanged.`:`Saved the earlier copy named “${name}”. Newer workspace edits were not marked as saved.`);
    }catch(error){libraryStatus(error.message,true);}
    finally{button.disabled=false;field.disabled=false;}
  };
  if(focusSave&&data)$('#library-name').focus();await refresh();
}
$('#server-library').onclick=()=>showServerLibrary();
$('#save-server').onclick=()=>showServerLibrary(true);
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
