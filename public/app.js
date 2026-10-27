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
  account()?.guildSchedulingTimeZones?.[model.guildKey(account()?.guildSchedulingTimeZones,guild)] ||
  account()?.schedulingTimeZone ||
  "ET";
const clone = (x) => model.cloneSavedData(x),
  account = () => data?.Default?.[accountName]?.$AccountWide,
  all = () => model.events(account()),
  selectedEvent = () =>
    all().find((e) => e.commandId === selected && e.guild.trim().toLowerCase() === guild.trim().toLowerCase()),
  guildEvents = () => all().filter((e) => e.guild.trim().toLowerCase() === guild.trim().toLowerCase()),
  list = () =>
    guildEvents().filter((e) => showCombined || !e.schedule.mergedInto);
const status = (s, error = false) => {
  $("#status").textContent = s;
  $("#status").classList.toggle("error", error);
};
function overlapNotes(schedule,conflicts=model.timelineConflicts(schedule)){
  return conflicts.map(c=>{
    const clock=t=>new Date(t*1000).toLocaleString('en-US',{timeZone:zoneNames[schedule.timeZone||'ET'],month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
    return `Overlapping periods: "${c.first.label||c.first.id}" and "${c.second.label||c.second.id}" at ${clock(c.start)}${c.end>c.start?' – '+clock(c.end):''}. End one period before the other begins.`;
  });
}
function requireValidTimeline(schedule, {allowIncompleteDrafts=false}={}) {
  if (schedule.timelineVersion !== 1) {const errors=model.validateEventRotation(schedule);if(errors.length)throw Error(errors.join(' '));return;}
  const errors = model.validateTimelineForAddon(schedule).filter(error=>!(allowIncompleteDrafts&&vals(schedule.reminders).length===0&&error==='Choose between one and 100 reminders.'));
  if (errors.length) throw Error(errors.join(" "));
  const overlaps=overlapNotes(schedule);if(overlaps.length)throw Error(overlaps.join(" "));
}
function validateEditedTimelines(snapshot = data, {allowIncompleteDrafts=false}={}) {
  for (const entry of model.accounts(snapshot))
    for (const event of model.events(entry.value)) {
      const original =
        base.Default?.[entry.name]?.$AccountWide?.commandGuildSettings?.[
          event.commandId
        ]?.[event.guild]?.schedule;
      if (
        event.settings.runAt === "SCHEDULED" && event.schedule.timelineVersion === 1 &&
        (JSON.stringify(event.schedule) !== JSON.stringify(original) || vals(event.schedule.reminders).length===0)
      ) {
        const empty=vals(event.schedule.reminders).length===0;
        const errors = [...model.validateTimelineForAddon(event.schedule).filter(error=>!(allowIncompleteDrafts&&empty&&error==='Choose between one and 100 reminders.')).map(error=>empty&&error==='Choose between one and 100 reminders.'?'This schedule has no reminders. Add a reminder period before downloading it for ESO; Save to server can preserve it as a draft.':error),...overlapNotes(event.schedule)];
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
 eventDate:'The event date and recurrence starting point. For Monthly on weekday, the Monthly on and Weekday choices determine actual dates from this starting point. Reminder days do not change the actual event.',
 eventTime:'The real event clock in the displayed scheduling timezone. Native clock controls use your browser clock format; the Lua file keeps an AM/PM clock.',
 recurrence:'How actual event dates repeat. Monthly on weekday lets you choose First through Fifth or Last, plus a weekday. Reminder windows repeat around each actual event occurrence.',
 monthlyWeek:'First through Fifth selects the numbered weekday. Last always selects the final matching weekday, whether the month has four or five. Fifth skips months without a fifth occurrence.',
 monthlyWeekday:'The weekday of the actual monthly event, not the days on which reminders may run.',
 recurrenceInterval:'A whole number of recurrence periods between occurrences. For example, 2 with Weekly means every other week.',
 specialPattern:'Use month-final pools, faction rotation, or Rotating event for an ordered list of trials or other activities.',
 rotationEvery:'Scheduled occurrences per activity before moving to the next name. The Event Date anchors the first entry. Cancelled occurrences can keep or postpone this progression.',
 rotationWeeks:'Number of weeks assigned to each faction before moving to the next faction in the list.',
 eventFold:'During the repeated clock hour when daylight saving time ends, choose the first or second occurrence.',
 eventDurationMinutes:'Optional whole minutes from event start to event end. Reminder windows stop at this end unless their advanced after-event exception is enabled. Leave blank for no event-end cap.',
 eventEnabled:'Check to allow scheduled reminders. Uncheck to disable them while retaining their configuration.',
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
 kind:'Choose elapsed minutes from the event, a calendar day at a server clock, or a reusable named important time.',
 days:'Whole calendar days relative to the actual event in its scheduling timezone. Negative days are before it; server clocks follow daylight saving time.',
 time:'A server clock in the displayed scheduling timezone. A nonexistent spring daylight-saving clock is rejected.',
 minutes:'Whole elapsed minutes relative to the actual event. Negative values are before it; positive values are after it.',
 offsetMinutes:'Whole elapsed minutes from the selected actual event occurrence. For recurring events, this important moment follows every occurrence with the same offset.',
 name:'Choose an important time defined below, such as ticket sales closing. Create one first if this list is empty.',
 markMode:'Use a reusable offset, or select a specific date and clock to calculate that offset from the next occurrence. Specific dates are converted to offsets, not stored as fixed future deadlines.',
 markDate:'Pick a date relative to the next actual event occurrence. Saving converts it into an offset that follows future recurring events.',
 markTime:'Pick a server clock in the event timezone. Saving converts the selected date and clock into elapsed offset minutes.',
};
function helpText(key){return fieldHelp[key]||fieldHelp[key.split('.').at(-1)]||'';}
function helpAttributes(key){const text=helpText(key);return text?` title="${esc(text)}" data-help="${esc(text)}" aria-description="${esc(text)}"`:'';}
function clockNative(value){const m=/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(value||''));if(!m)return /^\d{2}:\d{2}$/.test(value||'')?value:'';return String((Number(m[1])%12)+(m[3].toUpperCase()==='PM'?12:0)).padStart(2,'0')+':'+m[2];}
function clockStored(value){const m=/^(\d{2}):(\d{2})$/.exec(String(value||''));if(!m)return '';const h=Number(m[1]);return String(h%12||12).padStart(2,'0')+':'+m[2]+' '+(h>=12?'PM':'AM');}
function numberLimits(key){const suffix=key.split('.').at(-1);if(suffix==='rotationEvery')return [1,1000];if(['recurrenceInterval','rotationWeeks'].includes(suffix))return [1,1000000];if(suffix==='lateMinutes')return [1,1440];if(suffix==='intervalMinutes')return [1,5256000];if(suffix==='days')return [-3650,3650];if(['minutes','offsetMinutes'].includes(suffix))return [-5256000,5256000];if(suffix==='eventDurationMinutes')return [0,5256000];return [undefined,undefined];}
const input=(label,key,value,type='text')=>{const [min,max]=numberLimits(key), numeric=type==='number'?` step="1"${min!==undefined?` min="${min}" max="${max}"`:''}`:'', clock=type==='time'||key==='eventTime'||key.endsWith('.time');if(clock)type='time';return `<label${helpAttributes(key)}>${esc(label)}${clock?'<span class="clock-control">':''}<input data-field="${key}" type="${type}" value="${esc(clock?clockNative(value):value)}"${numeric}${clock?' step="60"':''}${helpAttributes(key)}>${clock?`<span class="clock-zone">${esc(guildZone())}</span></span>`:''}</label>`;};
const select=(label,key,value,options)=>`<label${helpAttributes(key)}>${esc(label)}<select data-field="${key}"${helpAttributes(key)}>${opts(options,value)}</select></label>`;
const check=(label,key,value)=>`<label class="check"${helpAttributes(key)}><input type="checkbox" data-field="${key}" ${value?'checked':''}${helpAttributes(key)}>${esc(label)}</label>`;
const stateOf=value=>value.paused?'PAUSED':value.enabled===false?'DISABLED':'ENABLED';
function applyState(value,key){if(!value[key])return value;value.enabled=value[key]!=='DISABLED';value.paused=value[key]==='PAUSED';delete value[key];return value;}
function currentEventDraft(){const e=selectedEvent(),panel=document.querySelector('#detail>.panel.event-settings');const v=panel?fields(panel):{};const d={...e.schedule,...v,timeZone:guildZone()};if(d.eventDurationMinutes===null)delete d.eventDurationMinutes;d.rotationFactions=typeof d.rotationFactions==='string'?tableArray(d.rotationFactions.split(',').map(x=>x.trim()).filter(Boolean)):d.rotationFactions;const activities=panel?.querySelectorAll('[data-activity-id]');if(activities?.length)d.rotationEvents=tableArray([...activities].map(row=>({id:row.dataset.activityId,name:row.querySelector('input').value.trim()})));else if(d.specialPattern==='EVENT_ROTATION')d.rotationEvents={};d.weekdays={};if(document.querySelector('#use-event-weekdays')?.checked)panel.querySelectorAll('[data-weekday]:checked').forEach(x=>setLuaValue(d.weekdays,Number(x.dataset.weekday),true));return d;}
function projectedNext(draft){return model.nextScheduleOccurrence(draft,Math.floor(Date.now()/1000));}
function refreshNextOccurrence(){const field=document.querySelector('#next-occurrence');if(!field)return;try{const d=currentEventDraft(),next=projectedNext(d);field.value=next===null?'No upcoming occurrence within the supported date range':new Date(next*1000).toLocaleString('en-US',{timeZone:zoneNames[d.timeZone],weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});renderRotationOccurrences(selectedEvent(),d);}catch{field.value='Choose a valid event date, clock and recurrence';const panel=document.querySelector('#rotation-occurrences');if(panel&&!panel.hidden)panel.innerHTML='<h2>Upcoming rotation</h2><p class="help">Choose valid event settings to preview upcoming rotations.</p>';}}
function wireWholeNumberInputs(root,selector='input[type=number]'){
 root.querySelectorAll(selector).forEach(input=>{if(input.type!=='number'||input.dataset.wholeNumberBound)return;input.dataset.wholeNumberBound='true';let previous=/^\d*$/.test(input.value)?input.value:'';
  const reject=()=>status('Use blank, zero, or positive whole numbers only.',true);
  input.addEventListener('keydown',ev=>{if(!ev.ctrlKey&&!ev.metaKey&&['-','+','.','e','E'].includes(ev.key))ev.preventDefault();});
  input.addEventListener('beforeinput',ev=>{if(ev.data&&!/^\d+$/.test(ev.data)){ev.preventDefault();reject();}});
  input.addEventListener('paste',ev=>{const text=ev.clipboardData?.getData('text/plain')||'';if(!/^\d*$/.test(text)){ev.preventDefault();reject();}});
  input.addEventListener('input',()=>{if(/^\d*$/.test(input.value))previous=input.value;else {input.value=previous;reject();}});
 });
}
function showInputModal({title,intro,fields,submitLabel,onSubmit}){
 const modal=document.querySelector('#dialog'),close=document.querySelector('#close-dialog');
 $('#dialog-body').innerHTML=`<form id="site-input-form" novalidate><h2>${esc(title)}</h2><p class="help">${esc(intro||'')}</p>${fields.map(field=>`<label>${esc(field.label)}<input id="form-${esc(field.key)}" data-modal-field="${esc(field.key)}" value="${esc(field.value||'')}" maxlength="${field.maxLength||160}" ${field.readonly?'readonly aria-readonly="true"':''} autocomplete="off"></label>`).join('')}<p id="modal-error" role="alert" class="modal-error"></p><div class="actions"><button id="modal-submit" type="submit" class="gold">${esc(submitLabel||'Create')}</button><button id="modal-cancel" type="button">Cancel</button></div></form>`;
 close.hidden=true;modal.addEventListener('close',()=>{close.hidden=false;},{once:true});
 $('#modal-cancel').onclick=()=>modal.close();
 $('#site-input-form').onsubmit=ev=>{ev.preventDefault();const values={};for(const field of fields){const input=document.getElementById('form-'+field.key);values[field.key]=input.value.trim();if(!values[field.key]){$('#modal-error').textContent=field.label+' is required.';input.setAttribute('aria-invalid','true');input.focus();return;}input.removeAttribute('aria-invalid');}
  try{onSubmit(values);modal.close();}catch(error){$('#modal-error').textContent=error.message;}
 };
 modal.showModal();requestAnimationFrame(()=>$('#site-input-form input:not([readonly])')?.focus());
}
const commandSoundKeys=['NONE','DUEL_START','DEFAULT_CLICK','POSITIVE_CLICK','NEGATIVE_CLICK','DIALOG_ACCEPT','DIALOG_DECLINE','NEW_NOTIFICATION','QUEST_SHARE_ACCEPTED','BOOK_ACQUIRED','ACHIEVEMENT_AWARDED','BATTLEGROUND_CAPTURE_FLAG_TAKEN','BATTLEGROUND_CAPTURE_FLAG_RETURNED','BATTLEGROUND_MEDAL_AWARDED','CHAMPION_POINT_GAINED','TELVAR_GAINED','TELVAR_LOST','TRADE_INVITE','GROUP_INVITE','LFG_ACCEPTED','JUSTICE_NOW_KOS','JUSTICE_STATE_CHANGED'];
function minuteSliderMarkup({key,label,help,value,min,max,ticks,exactMin=0}){
 const n=Number(value||0),position=Number.isFinite(n)?Math.max(min,Math.min(max,n)):min;
 return `<div class="minute-slider" data-minute-control="${key}"><div class="minute-slider-heading"><label for="slider-${key}" data-help="${esc(help||'')}">${label}</label><div class="minute-slider-value"><output data-command-duration="${key}"></output><span class="minute-slider-exact"><input aria-label="${label}, exact minutes" type="number" min="${exactMin}" max="5256000" step="1" data-command-option="${key}" value="${esc(value??'')}"><span>min</span></span></div></div><input id="slider-${key}" type="range" data-command-slider="${key}" min="${min}" max="${max}" step="1" value="${position}"><div class="minute-slider-ticks" aria-hidden="true">${ticks.map(([n,text])=>`<span style="left:${100*(n-min)/(max-min)}%">${text}</span>`).join('')}</div><p class="help" data-command-slider-note="${key}"></p></div>`;
}
function commandDeliveryMarkup(event){
 const c=event.settings,current=String(c.populateSound||'DUEL_START').trim().toUpperCase(),sounds=commandSoundKeys.includes(current)?commandSoundKeys:[...commandSoundKeys,current];
 const controls=[{key:'reminderMinutes',label:'Repeat Frequency',help:'Off stops timed repetition; manual use remains available.',value:c.reminderMinutes,min:0,max:1440,ticks:[[0,'Off'],[360,'6h'],[720,'12h'],[1080,'18h'],[1440,'24h']]},{key:'reminderRetryMinutes',label:'Retry Delay',help:'How often to try sending again if send fails',value:c.reminderRetryMinutes??0,min:0,max:60,ticks:[[0,'Off'],[15,'15m'],[30,'30m'],[45,'45m'],[60,'1h']]},{key:'autoPopulateCooldownMinutes',label:'Cooldown',help:'Delay before trying to send again',value:c.autoPopulateCooldownMinutes??60,min:15,max:480,exactMin:1,ticks:[[15,'15m'],[120,'2h'],[240,'4h'],[360,'6h'],[480,'8h']]}];
 return `<section class="command-delivery"><h3>Command delivery</h3><div id="ordinary-delivery"><p class="help">Drag a slider or type exact minutes. The duration label updates with your selection.</p><div class="minute-slider-list">${controls.map(minuteSliderMarkup).join('')}</div></div><div class="command-delivery-flags"><label class="check"><input type="checkbox" data-command-option="autoPopulateOnZone" ${c.autoPopulateOnZone?'checked':''}>Auto Populate Chat on Zone</label><label class="check"><input type="checkbox" data-command-option="openStatusPanelOnRun" ${c.openStatusPanelOnRun?'checked':''}>Open Status Panel on Run</label><label class="command-sound-field">Notify Sound<select data-command-option="populateSound">${opts(sounds.map(key=>[key,key==='NONE'?'NONE — Silent':key==='DUEL_START'?'DUEL_START — Default':key]),current)}</select></label></div></section>`;
}
function refreshCommandDelivery(){
 const panel=document.querySelector('.event-settings'),read=key=>panel?.querySelector(`[data-command-option="${key}"]`);if(!read('reminderMinutes'))return;
 document.querySelector('#ordinary-delivery').hidden=editorIsScheduled();
 read('autoPopulateOnZone').closest('label').hidden=editorIsScheduled();
 const frequency=Number(read('reminderMinutes').value),cooldown=Number(read('autoPopulateCooldownMinutes').value),retryCap=Number.isInteger(frequency)&&frequency>0&&Number.isInteger(cooldown)&&cooldown>0?Math.min(frequency,cooldown):0;
 read('reminderRetryMinutes').max=String(retryCap);
 if(!editorIsScheduled()&&Number(read('reminderRetryMinutes').value)>retryCap)read('reminderRetryMinutes').value=String(retryCap);
 const retryDisabled=editorIsScheduled()||read('autoPopulateOnZone').checked||!(Number(read('reminderMinutes').value)>0);
 read('reminderRetryMinutes').disabled=retryDisabled;
 for(const key of ['reminderMinutes','reminderRetryMinutes','autoPopulateCooldownMinutes']){
  const input=read(key),range=panel.querySelector(`[data-command-slider="${key}"]`),output=panel.querySelector(`[data-command-duration="${key}"]`),note=panel.querySelector(`[data-command-slider-note="${key}"]`),n=input.value===''?0:Number(input.value),valid=Number.isInteger(n)&&n>=0;
  if(key==='reminderRetryMinutes'){
   const maximum=Math.min(60,retryCap);range.max=String(maximum);
   const ticks=[...new Set([0,Math.floor(maximum/4),Math.floor(maximum/2),Math.floor(3*maximum/4),maximum])];
   range.parentElement.querySelector('.minute-slider-ticks').innerHTML=ticks.map(value=>`<span style="left:${maximum?100*value/maximum:0}%">${value===0?'Off':value===60?'1h':value+'m'}</span>`).join('');
  }
  const position=valid?Math.max(Number(range.min),Math.min(Number(range.max),n)):Number(range.min);
  range.value=String(position);range.style.setProperty('--slider-fill',(Number(range.max)>Number(range.min)?100*(position-Number(range.min))/(Number(range.max)-Number(range.min)):0)+'%');
  range.disabled=key==='reminderRetryMinutes'&&retryDisabled;range.closest('.minute-slider').classList.toggle('is-disabled',range.disabled);
  const text=valid?(n===0?(key==='autoPopulateCooldownMinutes'?'Enter positive minutes':'Off'):model.formatRepeatInterval(n)):'Enter whole minutes';output.textContent=text;
  range.setAttribute('aria-valuetext',position===0?'Off':model.formatRepeatInterval(position));
  note.hidden=!(valid&&n>0&&(n<Number(range.min)||n>Number(range.max)));
  note.textContent=note.hidden?'':'Exact value is beyond the slider range and will be preserved.';
  if(!range.dataset.sliderBound){range.dataset.sliderBound='true';range.addEventListener('input',()=>{input.value=range.value;input.dispatchEvent(new Event('input',{bubbles:true}));});input.addEventListener('input',refreshCommandDelivery);}
 }
}
function readCommandDelivery(panel){
 const read=key=>panel.querySelector(`[data-command-option="${key}"]`),sound=read('populateSound').value.trim().toUpperCase()||'DUEL_START',out={populateSound:sound,openStatusPanelOnRun:read('openStatusPanelOnRun').checked};
 if(!/^[A-Z0-9_]{1,200}$/.test(sound))throw Error('Notify Sound: use an ESO sound key or NONE.');
 if(panel.querySelector('[data-field=settingsRunAt]').value==='SCHEDULED')return out;
 const zone=read('autoPopulateOnZone').checked,repeat=read('reminderMinutes').value===''||Number(read('reminderMinutes').value)===0?null:Number(read('reminderMinutes').value),retry=Number(read('reminderRetryMinutes').value||0),cooldown=Number(read('autoPopulateCooldownMinutes').value);
 if(!zone&&repeat!==null&&(!Number.isInteger(repeat)||repeat<1||repeat>5256000))throw Error('Repeat Frequency must be a positive whole number, or blank/0 to turn it off.');
 if(!zone&&repeat&&(!Number.isInteger(retry)||retry<0||retry>5256000))throw Error('Retry Delay must be zero or a positive whole number.');
 if(!Number.isInteger(cooldown)||cooldown<1||cooldown>5256000)throw Error('Zone cooldown must be a positive whole number.');
 out.autoPopulateOnZone=zone;out.autoPopulateCooldownMinutes=cooldown;out.reminderMinutes=zone||repeat===null?undefined:repeat;out.reminderRetryMinutes=zone||!repeat?0:Math.min(retry,repeat,cooldown);
 return out;
}
function editorIsScheduled(){return (document.querySelector('#detail [data-field=settingsRunAt]')?.value||selectedEvent()?.settings.runAt)==='SCHEDULED';}
function insertableTokens(schedule){const scheduled=editorIsScheduled();return ['%timeofday%','%guild%','%zone%',...(scheduled?['%eventwhen%','%eventtime%','%eventdate%','%eventcountdown%','%eventtime-1h%','%eventcountdown-1h%',...(schedule.specialPattern==='FACTION_ROTATION'?['%eventfaction%']:schedule.specialPattern==='EVENT_ROTATION'?['%eventactivity%']:[]),...Object.keys(schedule.importantTimes||{}).flatMap(key=>['eventwhen','eventtime','eventdate','eventcountdown'].map(token=>'%'+token+':'+key+'%'))]:[])];}
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
    const preferred=availableAccounts.find(hasContent)||availableAccounts.find(a=>model.guildNames(a.value).size>0)||availableAccounts[0];
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
    a.guildSchedulingTimeZones?.[model.guildKey(a.guildSchedulingTimeZones,guild)] || "",
  );
  $("#guild-timezone").disabled = !guild;
}
$('#account-settings').onclick=()=>{
 const a=account(),target=accountName,roster=vals(a.guildRoster),choices=[['','No default guild'],...roster.map(g=>[String(g.guildIndex),g.guildName])];
 if(a.defaultGuildIndex&&!roster.some(g=>g.guildIndex===a.defaultGuildIndex))choices.push([String(a.defaultGuildIndex),'Current slot '+a.defaultGuildIndex+' (not in saved roster)']);
 $('#dialog-body').innerHTML=`<h2>Account settings — ${esc(target)}</h2><p class="help">These defaults belong to this account. Apply command and message edits before changing account settings.</p><div class="grid"><label>Default guild<select id="account-default-guild">${opts(choices,String(a.defaultGuildIndex||''))}</select></label><label>Chat timeout / revert delay (seconds)<input id="account-revert-seconds" type="number" min="30" max="5256000" step="1" value="${esc(a.revertChatSeconds??60)}"></label><label>Default scheduling timezone<select id="account-default-zone">${opts(['ET','CT','MT','PT'],a.schedulingTimeZone||'ET')}</select></label></div><p class="help">Default guild is used by slash commands without a guild parameter. Timeout is how long an unsent prepared message stays in chat (minimum 30 seconds). Changing the default timezone keeps entered event dates and clocks for guilds using the account default; their UTC moments change. Explicit guild timezone overrides are retained. Cooldowns and usage history remain unchanged.</p><p id="account-settings-error" role="alert"></p><button id="apply-account-settings" class="gold">Apply account settings</button>`;
 wireWholeNumberInputs($('#dialog-body'));
 $('#apply-account-settings').onclick=()=>{try{
  if(accountName!==target)throw Error('The selected account changed. Reopen account settings.');
  const seconds=Number($('#account-revert-seconds').value),zone=$('#account-default-zone').value,slot=$('#account-default-guild').value;
  if(!Number.isInteger(seconds)||seconds<30||seconds>5256000)throw Error('Chat timeout must be a whole number of seconds, at least 30.');
  const changes=[];
  if(zone!==(a.schedulingTimeZone||'ET'))for(const event of model.events(a)){
   const override=a.guildSchedulingTimeZones?.[model.guildKey(a.guildSchedulingTimeZones,event.guild)];if(override)continue;
   const draft={...event.schedule,timeZone:zone};
   if(event.settings.runAt==='SCHEDULED'&&draft.eventDate&&model.scheduleEventUtc(draft)===null)throw Error(event.command.name+' / '+event.guild+': this clock does not exist or needs a daylight-saving choice in '+zone+'. Update the event first.');
   if(event.settings.schedule)changes.push(event.settings.schedule);
  }
  if(slot==='')delete a.defaultGuildIndex;else a.defaultGuildIndex=Number(slot);
  a.revertChatSeconds=seconds;a.schedulingTimeZone=zone;changes.forEach(schedule=>schedule.timeZone=zone);
  changed();$('#dialog').close();render();status('Account settings updated. Download or save the configuration to keep them.');
 }catch(error){$('#account-settings-error').textContent=error.message;}};
 $('#dialog').showModal();
};
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
  if (override) a.guildSchedulingTimeZones[model.guildKey(a.guildSchedulingTimeZones,guild)] = override;
  else delete a.guildSchedulingTimeZones[model.guildKey(a.guildSchedulingTimeZones,guild)];
  for (const event of guildEvents())
    if (event.settings.schedule) event.settings.schedule.timeZone = zone;
  changed();
  render();
};
function refreshGuilds() {
  const a = account();
  const names=model.guildNames(a),guilds=[...names.keys()].sort();
  $('#guild').innerHTML=opts(guilds.map(key=>[key,names.get(key)]));
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
      .filter((m) => m.guildName.trim().toLowerCase() === e.guild.trim().toLowerCase())
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
        m.guildIndex === slot && m.guildName.trim().toLowerCase() !== e.guild.trim().toLowerCase(),
    )
  )
    return null;
  return slot;
}
function deliveryGuildSlot(e){return model.guildIndexFromRoster(account(),e.guild)??guildSlot(e);}
function eventMessages(e) {
  const slot = guildSlot(e);
  return model.orderedMessageEntries(vals(account().messages).filter(
    (m) =>
      m.commandId === e.commandId &&
      (typeof m.guildName === "string" && m.guildName.trim()
        ? m.guildName.trim().toLowerCase() === e.guild.trim().toLowerCase()
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
    ["DAY", "Day and server time"],
    ["MARK", "Important time"],
  ])}${
    a.kind === "DAY"
      ? input("Days from event", prefix + ".days", a.days ?? 0, "number") +
        input(
          "Server clock",
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
 const values=pattern==='MONTH_FINAL'?['ALL','REGULAR','FINAL']:pattern==='FACTION_ROTATION'?['ALL',...vals(schedule.rotationFactions||{1:'AD',2:'EP',3:'DC'}).filter(code=>['AD','EP','DC'].includes(code))]:pattern==='EVENT_ROTATION'?[['ALL','All activities'],...vals(schedule.rotationEvents).map(a=>[a.id,a.name])]:['ALL'];
 const choices=[...new Set(values)];
 if(current&&!choices.some(choice=>(Array.isArray(choice)?choice[0]:choice)===current))return [...choices,[current,current+' (not active for this pattern)']];
 return choices;
}
function legacyMigrationBanner(event) {
 if(event.schedule.timelineVersion===1)return '';
 return `<section class="panel migration" id="migration-panel"><p class="eyebrow">LEGACY SCHEDULE</p><h2>Switch this event to the new reminder timeline</h2><ol><li>Enter the <strong>actual event date and time</strong> at the top of this page, such as Tuesday Tours on Tuesday at 8 PM. Set the recurrence and click <strong>Apply event settings</strong> to save changes to the event and weekday override.</li><li>Choose <strong>Review and convert this event</strong>. Review the reminder periods before confirming.</li><li>If older helper commands belong to this event, combine them afterward in <strong>Combine &amp; transfer</strong>.</li></ol><p class="help">Conversion keeps message IDs, usage and cooldown history, and a backup of the original schedule. Nothing changes in ESO until you download and install the updated file.</p><button class="gold" id="convert-legacy">Review and convert this event</button></section>`;
}
function showField(root,key,show){const field=root.querySelector(`[data-field="${key}"]`);if(field)field.closest('label').hidden=!show;}
function refreshEventRelevance(){
 const panel=document.querySelector('#detail>.panel.event-settings');if(!panel)return;
 const scheduled=panel.querySelector('[data-field=settingsRunAt]').value==='SCHEDULED';
 refreshCommandDelivery();
 const title=document.querySelector('#message-library-title');if(title)title.innerHTML='Message library'+' <span class="badge">'+eventMessages(selectedEvent()).length+(scheduled?' VARIANTS':' MESSAGES')+'</span>';
 const help=document.querySelector('#message-library-help');if(help)help.textContent=scheduled?'Drag and drop to reorder messages. Names are not sent in chat. Order is for display; eligible messages are selected at random.':'Edit the templates used by this command and guild. Choose which are eligible in Message pool above. Drag and drop changes display order, not selection order.';
 panel.querySelector('.eyebrow').textContent=scheduled?'EVENT SETTINGS':'COMMAND SETTINGS';
 const nameLabel=panel.querySelector('[data-field=commandName]').closest('label'),caption=nameLabel.querySelector('.field-caption');
 if(caption)caption.firstChild.textContent=scheduled?'Event name':'Command name';else if(nameLabel.firstChild?.nodeType===Node.TEXT_NODE)nameLabel.firstChild.textContent=scheduled?'Event name':'Command name';
 panel.querySelector('#save-event').textContent=scheduled?'Apply event settings':'Apply command settings';
 const modeBadge=panel.querySelector('.heading>.badge');if(modeBadge)modeBadge.textContent=scheduled?(selectedEvent().schedule.timelineVersion===1?'TIMELINE':'LEGACY SCHEDULE'):(panel.querySelector('[data-field=settingsRunAt]').value==='STARTUP'?'STARTUP':'ON DEMAND');
 document.querySelectorAll('.message [data-insert-token]').forEach(menu=>{menu.innerHTML='<option value="">Insert substitution...</option>'+opts(insertableTokens(selectedEvent().schedule));});
 for(const key of ['eventDate','eventTime','eventDurationMinutes','recurrence','eventEnabled'])showField(panel,key,scheduled);
 panel.querySelector('#next-occurrence').closest('label').hidden=!scheduled;
 panel.querySelector('#schedule-timezone').closest('label').hidden=!scheduled;
 for(const id of ['reminder-timeline','important-times','event-clock-options','event-schedule-help','migration-panel']){const el=document.getElementById(id);if(el)el.hidden=!scheduled;}
 document.querySelector('#ordinary-message-pool').hidden=scheduled;
 const recurrence=panel.querySelector('[data-field=recurrence]').value;
 const repeating=scheduled&&recurrence!=='NONE';
 document.querySelector('#monthly-weekday-rule').hidden=!scheduled||recurrence!=='MONTHLY_WEEKDAY';
 const monthlyWeek=panel.querySelector('[data-field=monthlyWeek]'),monthlyDay=panel.querySelector('[data-field=monthlyWeekday]');
 document.querySelector('#monthly-weekday-help').textContent=monthlyWeek.value==='LAST'?'Last '+monthlyDay.selectedOptions[0].textContent+' of each selected month, including months with four or five occurrences.':monthlyWeek.value==='5'?'Fifth '+monthlyDay.selectedOptions[0].textContent+' only; months without a fifth occurrence are skipped.':'The '+monthlyWeek.selectedOptions[0].textContent.toLowerCase()+' '+monthlyDay.selectedOptions[0].textContent+' of each selected month. Event Date anchors the first eligible month.';
 const faction=repeating&&panel.querySelector('[data-field=specialPattern]').value==='FACTION_ROTATION';
 showField(panel,'recurrenceInterval',repeating);showField(panel,'specialPattern',repeating);
 showField(panel,'rotationWeeks',faction);showField(panel,'rotationFactions',faction);
 const pattern=repeating?panel.querySelector('[data-field=specialPattern]').value:'NONE';
 const rotationSettings=document.querySelector('#event-rotation-settings');rotationSettings.hidden=pattern!=='EVENT_ROTATION';if(pattern==='EVENT_ROTATION')rotationSettings.open=true;
 document.querySelector('#rotation-occurrences').hidden=!scheduled||!['EVENT_ROTATION','FACTION_ROTATION'].includes(pattern)&&!Object.keys(selectedEvent().schedule.occurrenceExceptions||{}).length;
 document.querySelectorAll('.message [data-field=variant]').forEach(field=>{const value=field.value;field.closest('label').hidden=pattern==='NONE';field.innerHTML=opts(variantChoices({...currentEventDraft(),specialPattern:pattern},value),value);});

 const weekday=scheduled&&['DAILY','WEEKLY','BIWEEKLY'].includes(recurrence);
 document.querySelector('#weekday-options').hidden=!weekday;
 const enabled=document.querySelector('#use-event-weekdays').checked;
 document.querySelector('#event-weekday-choices').hidden=!enabled;
 const count=panel.querySelectorAll('[data-weekday]:checked').length;
 const date=panel.querySelector('[data-field=eventDate]').value;
 const weekdayName=/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(date+'T12:00:00Z').toLocaleDateString(undefined,{weekday:'long',timeZone:'UTC'}):'the event date';
 document.querySelector('#weekday-explanation').textContent='Leave this off for an event that always happens on the weekday in Event Date (for example, a Saturday raffle). Turn it on only if the event itself happens on other or multiple weekdays, such as Tuesday AND Thursday. This does not restrict reminder days. '+(enabled?(count===0?'No override days selected; the event date determines the weekday.':count===7?'All seven selected: an event occurs every day in each eligible period.':count+' event day(s) selected in each eligible period.'):(recurrence==='DAILY'?'Default: the daily recurrence determines event dates.':'Default: follow '+weekdayName+' from the event date.'));
}
function activityEditorRow(activity){
 const row=document.createElement('div');row.className='rotation-activity';row.dataset.activityId=activity.id;
 row.innerHTML=`<label>Activity name<input value="${esc(activity.name)}" maxlength="160" aria-label="Rotating activity name"></label><div class="actions"><button type="button" data-activity-action="up" aria-label="Move activity earlier">↑</button><button type="button" data-activity-action="down" aria-label="Move activity later">↓</button><button type="button" data-activity-action="remove" class="danger">Remove</button></div>`;
 return row;
}
function bindRotationEditor(event){
 const container=document.querySelector('#rotation-activities');
 vals(event.schedule.rotationEvents).forEach(activity=>container.append(activityEditorRow(activity)));
 const refresh=()=>{refreshEventRelevance();refreshNextOccurrence();};
 document.querySelector('#add-activity').onclick=()=>{
  if(container.children.length>=50){status('Choose at most 50 activities.',true);return;}
  const row=activityEditorRow({id:crypto.randomUUID(),name:'Activity '+(container.children.length+1)});container.append(row);editRevision++;refresh();row.querySelector('input').focus();
 };
 container.addEventListener('input',ev=>{if(ev.target.matches('input'))ev.target.setCustomValidity([...ev.target.value.trim()].length>80?'Use at most 80 characters.':'');refresh();});
 container.onclick=ev=>{
  const button=ev.target.closest('[data-activity-action]');if(!button)return;
  const row=button.closest('[data-activity-id]'),action=button.dataset.activityAction;
  if(action==='up'&&row.previousElementSibling)container.insertBefore(row,row.previousElementSibling);
  else if(action==='down'&&row.nextElementSibling)container.insertBefore(row.nextElementSibling,row);
  else if(action==='remove'){
   if(!confirm('Remove this activity? Messages assigned only to it will use All activities when you apply event settings.'))return;
   row.remove();document.querySelectorAll('.message [data-field=variant]').forEach(field=>{if(field.value===row.dataset.activityId)field.value='ALL';});
  }
  editRevision++;refresh();
 };
 renderRotationOccurrences(event);
}
function serverOccurrenceDate(schedule,at){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zoneNames[schedule.timeZone||'ET'],year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at*1000)).map(x=>[x.type,x.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
function rotationProjectionKey(s){
 const pattern=s.specialPattern||'NONE';
 return JSON.stringify([s.eventDate,clockNative(s.eventTime),s.timeZone||guildZone(),s.eventFold||'FIRST',s.recurrence||'NONE',s.recurrence==='MONTHLY_WEEKDAY'?model.monthlyWeekdayRule(s):null,Number(s.recurrenceInterval??1),Array.from({length:7},(_,i)=>!!s.weekdays?.[i+1]),pattern,s.eventDurationMinutes??null,pattern==='EVENT_ROTATION'?[Number(s.rotationEvery??1),vals(s.rotationEvents).map(a=>[a.id,a.name])]:pattern==='FACTION_ROTATION'?[Number(s.rotationWeeks??4),vals(s.rotationFactions||{1:'AD',2:'EP',3:'DC'})]:null]);
}
function renderRotationOccurrences(event,s=currentEventDraft()){
 const panel=document.querySelector('#rotation-occurrences');if(!panel)return;
 if(document.querySelector('[data-field=settingsRunAt]')?.value!=='SCHEDULED'){panel.hidden=true;return;}
 const pending=rotationProjectionKey(s)!==rotationProjectionKey(event.schedule);
 const rotating=['EVENT_ROTATION','FACTION_ROTATION'].includes(s.specialPattern);
 const hasExceptions=Object.keys(s.occurrenceExceptions||{}).length>0;panel.hidden=!rotating&&!hasExceptions;if(!rotating&&!hasExceptions){panel.innerHTML='<p class="help">Apply event settings to see upcoming rotation occurrences.</p>';return;}
 const clock=at=>new Date(at*1000).toLocaleString('en-US',{timeZone:zoneNames[s.timeZone||'ET'],weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
 try{
  if(model.scheduleEventUtc(s)===null||!Number.isInteger(Number(s.recurrenceInterval??1))||Number(s.recurrenceInterval??1)<1||s.specialPattern==='EVENT_ROTATION'&&(!Number.isInteger(s.rotationEvery)||s.rotationEvery<1)||s.specialPattern==='FACTION_ROTATION'&&(!Number.isInteger(s.rotationWeeks)||s.rotationWeeks<1))throw Error('Choose valid event settings to preview upcoming rotations.');
  const now=Math.floor(Date.now()/1000),past=model.projectedOccurrences(s,now-399*86400,now,{includeCancelled:true}),future=model.projectedOccurrences(s,now,now+399*86400,{includeCancelled:true});
  const upcoming=[...new Set([...past,...future])].filter(at=>at>=now||(s.eventDurationMinutes&&at+s.eventDurationMinutes*60>now)||model.reminderWindows(s,at,{includeCancelled:true}).some(w=>w.start<=now&&w.end>now)).slice(0,8);
  const dates=new Set(upcoming.map(at=>serverOccurrenceDate(s,at)));
  const rows=upcoming.map(at=>{
   const date=serverOccurrenceDate(s,at),action=model.occurrenceCancellation(s,at),selection=s.specialPattern==='EVENT_ROTATION'?model.rotationActivityName(s,at):({AD:'Aldmeri Dominion',EP:'Ebonheart Pact',DC:'Daggerfall Covenant'}[model.eventVariant(s,at)]||'');
   return `<div class="rotation-occurrence ${action?'cancelled':''}"><div><strong>${esc(clock(at))}</strong><span>${esc(selection||(rotating?'No activity selected':'Event'))}${action?' · Cancelled — '+(action==='KEEP'?'rotation keeps moving':'selection postponed'):''}</span></div>${action?`<button data-undo-occurrence="${date}" ${pending?'disabled':''}>Undo cancellation</button>`:`<button data-cancel-occurrence="${date}" ${rotating&&!pending?'':'disabled'}>Cancel occurrence…</button>`}</div>`;
  }).join('');
  const earlier=Object.entries(s.occurrenceExceptions||{}).filter(([date])=>!dates.has(date)).sort(([a],[b])=>a.localeCompare(b));
  panel.innerHTML=`<h2>Upcoming rotation</h2><p class="help">${pending?'Preview of your edits. Apply event settings to save and enable cancellation actions.':'Based on applied event settings.'} Cancel skips all reminders for that occurrence. Keep rotation moving consumes its place; Postpone selection holds its place. Undo removes the exception and recalculates future selections.</p><div class="rotation-upcoming">${rows||'<p class="help">No occurrences in the next 400 days.</p>'}</div>${earlier.length?`<details><summary>Other saved cancellations (${earlier.length})</summary>${earlier.map(([date,x])=>`<div class="rotation-occurrence"><span>${esc(date)} · ${x.action==='POSTPONE'?'Selection postponed':'Rotation keeps moving'}</span><button data-undo-occurrence="${esc(date)}" ${pending?'disabled':''}>Undo cancellation</button></div>`).join('')}</details>`:''}`;
  panel.querySelectorAll('[data-cancel-occurrence]').forEach(button=>button.onclick=()=>{
   const date=button.dataset.cancelOccurrence;
   $('#dialog-body').innerHTML=`<h2>Cancel ${esc(date)}</h2><p>Only this occurrence is cancelled. Messages and the recurring schedule stay saved.</p><label>Rotation after cancellation<select id="cancel-rotation-action"><option value="KEEP">Keep rotation moving</option><option value="POSTPONE">Postpone selection</option></select></label><p class="help">Keep rotation moving skips this selection. Postpone selection delays progression by one scheduled occurrence. For faction blocks, that postpones the rotation by the time between this date and the next scheduled occurrence.</p><button id="confirm-cancel-occurrence" class="danger">Cancel this occurrence</button>`;
   $('#confirm-cancel-occurrence').onclick=()=>{updateOccurrence(date,$('#cancel-rotation-action').value);$('#dialog').close();};$('#dialog').showModal();
  });
  panel.querySelectorAll('[data-undo-occurrence]').forEach(button=>button.onclick=()=>{if(confirm('Undo cancellation for '+button.dataset.undoOccurrence+'? Future rotation selections will be recalculated.'))updateOccurrence(button.dataset.undoOccurrence,null);});
  function updateOccurrence(date,action){
   const candidate=clone(event.schedule);candidate.occurrenceExceptions??={};if(action)candidate.occurrenceExceptions[date]={action};else delete candidate.occurrenceExceptions[date];
   try{requireValidTimeline(candidate);}catch(error){status(error.message,true);return;}
   event.schedule.occurrenceExceptions=candidate.occurrenceExceptions;changed();refreshNextOccurrence();status(action?'Cancelled '+date+'. Its reminders are skipped; the rotation has been recalculated.':'Cancellation removed for '+date+'. The rotation has been recalculated.');
  }
 }catch(error){panel.innerHTML='<h2>Upcoming rotation</h2><p class="help">'+esc(error.message)+'</p>';}
}
function reminderBadge(row){
  const label=row.once?'◆ ONE-TIME NOTICE':'↻ REPEATING REMINDER';
  const text=row.once?(row.onceUntilFinish?'Sends one message per event occurrence, anytime within this period. It does not repeat when the interval passes.':'Sends one message per event occurrence at its trigger time, with the configured late allowance. It does not repeat within this period.'):'Selects a message from this pool repeatedly while the period is open, using Repeat every. Cooldowns and other activity can delay preparation.';
  return `<span class="badge reminder-type" tabindex="0" role="note" aria-label="${esc(label+'. '+text)}">${label}<span class="help-bubble">${esc(text)} Messages are prepared in ESO chat; you still press Enter to send.</span></span>`;
}
function availabilityMarkup(row,zone){
 const a=row.availability||{},clock=m=>`${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
 const full=(a.startMinute??0)===0&&(a.endMinute??1440)===1440;
 return `<details class="availability-settings" ${a.enabled?'open':''}><summary>Availability — allowed days, hours and daily limit</summary><label class="check"><input type="checkbox" data-availability="enabled" ${a.enabled?'checked':''}>Limit when this reminder may run</label><div data-availability-options ${a.enabled?'':'hidden'}><p class="help">These are announcement days, not event recurrence days. The reminder must also be inside its overall promotion period. All clocks use server time (${esc(zone)}).</p><div class="actions weekdays">${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d,i)=>`<label class="check"><input type="checkbox" data-availability-day="${i+1}" ${!a.weekdays||a.weekdays[i+1]?'checked':''}>${d.slice(0,3)}</label>`).join('')}</div><label class="check"><input type="checkbox" data-availability="allDay" ${full?'checked':''}>All day</label><div class="grid" data-availability-hours ${full?'hidden':''}><label>From<div class="clock-control"><input type="time" data-availability="start" value="${clock(a.startMinute??420)}"><span>${esc(zone)}</span></div></label><label>Until<div class="clock-control"><input type="time" data-availability="end" value="${clock(a.endMinute??1320)}"><span>${esc(zone)}</span></div></label></div><label>Maximum announcements per server day (optional)<input type="number" min="1" max="1000" step="1" data-availability="maxPerDay" value="${esc(a.maxPerDay??'')}" placeholder="Unlimited"></label><p class="help" data-availability-summary></p><p class="help">Confirmed sends and matching announcements from other players count toward the daily limit. Preparing a message does not count. Send once still means once per event occurrence.</p><div data-availability-overrides></div></div></details>`;
}
function availabilityFields(card){
 const read=k=>card.querySelector(`[data-availability="${k}"]`),previous=card._availability||{};
 const a={...clone(previous),enabled:read('enabled').checked};
 if(!a.enabled)return a;
 a.weekdays={};card.querySelectorAll('[data-availability-day]:checked').forEach(el=>setLuaValue(a.weekdays,Number(el.dataset.availabilityDay),true));
 const minute=value=>/^\d{2}:\d{2}$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):NaN;
 a.startMinute=read('allDay').checked?0:minute(read('start').value);
 const end=minute(read('end').value);
 a.endMinute=read('allDay').checked?1440:end===0?1440:end;
 if(read('maxPerDay').value==='')delete a.maxPerDay;else a.maxPerDay=Number(read('maxPerDay').value);
 return a;
}
function refreshAvailability(card){
 const a=availabilityFields(card),read=k=>card.querySelector(`[data-availability="${k}"]`);
 card.querySelector('[data-availability-options]').hidden=!a.enabled;
 card.querySelector('[data-availability-hours]').hidden=read('allDay').checked;
 const summary=card.querySelector('[data-availability-summary]');
 summary.textContent=(a.maxPerDay?`Up to ${a.maxPerDay} announcement${a.maxPerDay===1?'':'s'} per server calendar day. `:'No daily limit. ')+(read('allDay').checked?'Eligible all day.':'Eligible during the selected hours; an earlier finish clock continues into the next day.');
 const overrides=card.querySelector('[data-availability-overrides]');overrides.replaceChildren();
 for(const [key,title] of [['dateOverrides','Date'],['weekdayOverrides','Weekday']])for(const [id,hours] of Object.entries(a[key]||{})){
  const line=document.createElement('div');line.className='availability-override';
  const name=key==='weekdayOverrides'?['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][Number(id)-1]:id;
  const clock=m=>String(Math.floor(m/60)%24).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
  const text=document.createElement('span');text.textContent=`${title} override: ${name} · ${clock(hours.startMinute)}–${clock(hours.endMinute)}`;
  const reset=document.createElement('button');reset.type='button';reset.textContent='Reset '+title.toLowerCase();reset.onclick=()=>{delete card._availability[key][id];refreshAvailability(card);card.dispatchEvent(new Event('input',{bubbles:true}));};
  line.append(text,reset);overrides.append(line);
 }
}
function refreshReminderRelevance(card){
 const once=card.querySelector('[data-field=once]').checked;
 const whole=card.querySelector('[data-field=onceUntilFinish]').checked;
 const badge=card.querySelector('.reminder-type');if(badge)badge.outerHTML=reminderBadge({once,onceUntilFinish:whole});
 showField(card,'intervalMinutes',!once);showField(card,'lateMinutes',once&&!whole);
 showField(card,'onceUntilFinish',once);
 card.querySelector('[data-finish-window]').hidden=once&&!whole;
}
// Inactive controls must not block once-only or repeating reminders. Keep the
// unused metadata valid for SavedVariables/import without changing delivery mode.
function reminderFields(card){
 const value=fields(card),integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
 value.availability=availabilityFields(card);
 if(value.once&&!integer(value.intervalMinutes,1,5256000))value.intervalMinutes=60;
 if((!value.once||value.onceUntilFinish)&&!integer(value.lateMinutes,1,1440))value.lateMinutes=5;
 if(value.once&&!value.onceUntilFinish){
  const a=value.finish,valid=a&&(a.kind==='OFFSET'&&integer(a.minutes,-5256000,5256000)||a.kind==='DAY'&&integer(a.days,-3650,3650)&&/^\d{1,2}:\d{2} [AP]M$/.test(a.time)||a.kind==='MARK'&&typeof a.name==='string'&&a.name.trim());
  if(!valid)value.finish=value.start?{...value.start}:undefined;
 }
 return value;
}
function reminderFieldError(card,value=reminderFields(card)){
 if(!value.once&&(!Number.isInteger(value.intervalMinutes)||value.intervalMinutes<1||value.intervalMinutes>5256000))return 'Repeat every: enter a positive whole number of minutes.';
 if(value.once&&!value.onceUntilFinish&&(!Number.isInteger(value.lateMinutes)||value.lateMinutes<1||value.lateMinutes>1440))return 'Late allowance: enter a whole number from 1 to 1440 minutes.';
 const a=value.availability;
 if(a?.enabled){
  if(!Number.isInteger(a.startMinute)||a.startMinute<0||a.startMinute>1439||!Number.isInteger(a.endMinute)||a.endMinute<1||a.endMinute>1440||a.startMinute===a.endMinute)return 'Availability: choose valid, different start and finish clocks (or All day).';
  if(a.maxPerDay!==undefined&&(!Number.isInteger(a.maxPerDay)||a.maxPerDay<1||a.maxPerDay>1000))return 'Maximum announcements per day must be a whole number from 1 to 1000, or blank.';
 }
 const invalid=[...card.querySelectorAll('input[data-field]')].find(input=>{for(let node=input;node&&node!==card;node=node.parentElement)if(node.hidden)return false;return !input.checkValidity();});
 if(invalid){const label=({intervalMinutes:'Repeat every',lateMinutes:'Late allowance'})[invalid.dataset.field]||invalid.dataset.field.replace('.',' ');return label+': '+invalid.validationMessage;}
 return null;
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
function renderDetail(focusReminderId = null,focusMessageId = null,expandNewMessage = false) {
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
  const pendingRunAt=preserveScroll?document.querySelector('#detail [data-field=settingsRunAt]')?.value:undefined;
  const s = (e.settings.schedule ??= {}),
    messages = eventMessages(e),
    rows = model.orderedReminderRows(s,projectedNext(s)??model.scheduleEventUtc(s));
  const monthlyRule=model.monthlyWeekdayRule(s);let monthlyRulePinned=s.monthlyWeek!==undefined||s.monthlyWeekday!==undefined;
  $("#detail").innerHTML =
    `<section class="panel event-settings"><div class="heading"><div><p class="eyebrow">EVENT SETTINGS</p><h2>${esc(e.command?.name)}</h2></div><span class="badge">${s.timelineVersion === 1 ? "TIMELINE" : "LEGACY SCHEDULE"}</span></div><div class="grid">${input("Event name", "commandName", e.command.name)}${input("Event Date", "eventDate", s.eventDate || "", "date")}${input("Event Start Time", "eventTime", s.eventTime || "08:00 PM")}<label data-help="The next actual event occurrence, calculated live from the current unsaved date, clock, recurrence, interval and weekday controls.">Next occurrence <span class="readonly-tag">Read only</span><input id="next-occurrence" readonly aria-live="polite"></label>${input("Event duration (minutes, optional)","eventDurationMinutes",s.eventDurationMinutes??"","number")}<label title="Read only here. Change Guild timezone in the toolbar above; all event clocks use that timezone.">Scheduling timezone (guild) <span class="readonly-tag">Read only</span><input id="schedule-timezone" value="${esc(guildZone())}" readonly aria-description="Change Guild timezone in the toolbar above."><small class="help">Change using Guild timezone in the toolbar.</small></label>${select("Output channel", "outputChannel", account().chatChannels?.[e.commandId]?.[model.guildKey(account().chatChannels?.[e.commandId],guild)] || "Guild", ["Guild", "Officer", "Zone", "Group"])}${select(
      "Run at",
      "settingsRunAt",
      pendingRunAt || e.settings.runAt || "ON_DEMAND",
      [
        ["ON_DEMAND", "On demand"],
        ["STARTUP", "Startup"],
        ["SCHEDULED", "Scheduled"],
      ],
    )}${select("Recurrence", "recurrence", s.recurrence || "NONE", [["NONE","Does not repeat"],["DAILY","Daily"],["WEEKLY","Weekly"],["BIWEEKLY","Every other week"],["MONTHLY_DATE","Monthly on the same date"],["MONTHLY_WEEKDAY","Monthly on weekday"]])}<div id="monthly-weekday-rule" class="monthly-weekday-rule">${select("Monthly on","monthlyWeek",monthlyRule.monthlyWeek??1,[[1,"First"],[2,"Second"],[3,"Third"],[4,"Fourth"],[5,"Fifth"],["LAST","Last"]])}${select("Weekday","monthlyWeekday",monthlyRule.monthlyWeekday??1,[[1,"Sunday"],[2,"Monday"],[3,"Tuesday"],[4,"Wednesday"],[5,"Thursday"],[6,"Friday"],[7,"Saturday"]])}<p id="monthly-weekday-help" class="help"></p></div>${select("Special pattern", "specialPattern", s.specialPattern || "NONE", [["NONE","None"],["MONTH_FINAL","Last event of month"],["FACTION_ROTATION","Faction rotation"],["EVENT_ROTATION","Rotating event"]])}${input("Recurrence interval", "recurrenceInterval", s.recurrenceInterval || 1, "number")}${input("Rotation weeks per faction", "rotationWeeks", s.rotationWeeks || 4, "number")}${input("Faction order (comma separated)", "rotationFactions", vals(s.rotationFactions).join(", ") || "AD, EP, DC")}${select(
      "Ambiguous DST clock",
      "eventFold",
      s.eventFold || "FIRST",
      [
        ["FIRST", "First occurrence"],
        ["SECOND", "Second occurrence"],
      ],
    )}</div>${commandDeliveryMarkup(e)}<details id="event-rotation-settings" open><summary>Rotating event</summary><p class="help">The Event Date anchors the first activity. Names follow this order and repeat automatically, including while you are offline. Use <code>%eventactivity%</code> in messages for the selected name.</p>${input("Occurrences per activity","rotationEvery",s.rotationEvery||1,"number")}<div id="rotation-activities"></div><button id="add-activity" type="button">+ Add activity</button><p class="help">Upcoming selections update as you edit. Apply event settings to save these changes.</p></details><details id="weekday-options" ${vals(s.weekdays).some(Boolean)?'open':''}><summary>Event happens on multiple weekdays (advanced)</summary><label class="check"><input id="use-event-weekdays" type="checkbox" ${vals(s.weekdays).some(Boolean)?'checked':''}>Choose event weekdays instead of following Event Date</label><p class="help" id="weekday-explanation"></p><div class="actions weekdays" id="event-weekday-choices">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => `<label class="check"><input type="checkbox" data-weekday="${i + 1}" ${s.weekdays?.[i + 1] ? "checked" : ""}>${d.slice(0, 3)}</label>`).join("")}</div></details><div class="actions" style="margin-top:18px">${check("Enabled", "eventEnabled", s.enabled!==false&&!s.paused)}<button id="save-event" class="gold">Apply event settings</button></div></section><section class="panel" id="rotation-occurrences"></section><section class="panel" id="reminder-timeline"><div class="heading"><h2>Reminder timeline</h2><button id="add-row" class="gold">+ Add reminder</button></div>${s.timelineVersion !== 1 ? '<p class="help">This event still uses legacy scheduling. Convert this schedule to review its existing timing and message pools before adding reminders.</p>' : ""}<p class="help">Periods are automatically ordered by start time when applied. Windows cannot overlap within this event; one may finish exactly when the next starts.</p><div id="timeline-conflicts" class="timeline-conflicts" role="alert"></div><div id="rows">${rows.map((r, i) => `<article class="reminder ${r.once ? "milestone" : ""}" data-row="${esc(r.id)}"><div class="heading"><h3>${i + 1}. ${esc(r.label || "Reminder")}</h3>${reminderBadge(r)}</div><p class="effective-reminder-time" data-effective-times></p><p class="reminder-overlap-warning" data-overlap-warning hidden></p><div class="grid">${input("Reminder label", "label", r.label || "")}${select("Reminder state","rowState",stateOf(r),[["ENABLED","Enabled"],["PAUSED","Paused"],["DISABLED","Disabled"]])}${input("Repeat every (minutes)", "intervalMinutes", r.intervalMinutes ?? 60, "number")}${input("Late allowance (minutes)", "lateMinutes", r.lateMinutes ?? 5, "number")}</div><h3>Starts</h3><div class="grid">${anchorMarkup(r.start, "start", s)}</div><div data-finish-window><h3>Finishes</h3><div class="grid">${anchorMarkup(r.finish || r.start, "finish", s)}</div></div><div class="actions">${check("Send once", "once", r.once)}${check("Time-sensitive", "timeSensitive", r.timeSensitive)}${check("Allow a brief notice after event end (advanced)","allowAfterEventEnd",r.allowAfterEventEnd)}${check("Allow this announcement anytime within its window", "onceUntilFinish", r.onceUntilFinish)}</div>${availabilityMarkup(r,s.timeZone)}<details class="row-advanced"><summary>Advanced event-end exception</summary>${check("Allow a brief announcement after the event ends","allowAfterEventEnd",r.allowAfterEventEnd)}</details><p class="help">Choose a message pool. The addon selects a message from this pool when the reminder is due.</p><div class="pool">${messages.map((m, j) => `<label class="check" title="${esc(m.text)}"><input type="checkbox" data-message="${esc(m.id)}" ${vals(r.messageIds).includes(m.id) ? "checked" : ""}><span data-pool-message-label="${esc(m.id)}">${esc(model.messageDisplayName(m,j))}: ${esc(m.text)}</span></label>`).join("") || '<span class="help">Add a message below first.</span>'}</div><div class="actions"><button data-action="save">Apply reminder</button><button data-action="preview">Preview here</button><button data-action="remove" class="danger">Remove</button></div></article>`).join("") || '<div class="empty">No timeline reminders yet.</div>'}</div></section><section class="panel" id="important-times"><div class="heading"><h2>Important times</h2><button id="add-mark">+ Add time</button></div><p class="help">Name an important moment, such as doors opening or ticket sales closing, and reuse it in reminder anchors.</p><details class="important-time-guide" id="important-time-guide"><summary>How to use important times</summary><ol><li>Add a key such as <code>tickets</code>, with a label such as Ticket sales close.</li><li>Use <strong>-60</strong> minutes for one hour before the event (-30 means 30 minutes before). Positive values mean after. Click <strong>Apply</strong>.</li><li>For a reminder start or stop, choose <strong>Anchor → Important time</strong> and select it.</li><li>In messages, use <code>%eventwhen:tickets%</code>, <code>%eventtime:tickets%</code>, <code>%eventdate:tickets%</code> or <code>%eventcountdown:tickets%</code>. The key after the colon must match the key you created.</li></ol><p class="help">For an 8 PM event, tickets at -60 means 7 PM on that event day. It follows each recurring event automatically. The Pick date and time option calculates the same reusable offset, not a separate one-off date.</p></details>${Object.entries(
      s.importantTimes || {},
    )
      .map(
        ([id, m]) =>
          `<div class="grid mark" data-id="${esc(id)}">${input("Label", "label", m.label)}${input("Minutes from event", "offsetMinutes", m.offsetMinutes, "number")}<div class="actions"><button data-action="save-mark">Apply</button><button data-action="remove-mark" class="danger">Remove</button></div></div>`,
      )
      .join(
        "",
      )}</section><section class="panel" id="ordinary-message-pool"></section><section class="panel"><div class="heading"><h2 id="message-library-title">Message library <span class="badge">${messages.length} VARIANTS</span></h2><button id="add-message">+ Add message</button></div><p class="help" id="message-library-help">Drag and drop a message handle to reorder messages. Optional names are limited to 60 characters and are not sent in chat. Order is for display only; selection remains randomized.</p>${ambiguousMessages(e) ? '<p class="help" role="alert">Some legacy messages have no guild name and their guild slot cannot be resolved safely. They are omitted from this editor and remain untouched in the file.</p>' : ""}${messages.map((m, i) => `<details class="message" data-id="${esc(m.id)}"><summary><span class="message-drag-handle" draggable="true" tabindex="0" role="button" aria-label="Reorder ${esc(model.messageDisplayName(m,i))}; drag or use Up and Down arrows">↕</span><span class="message-summary-title">${esc(model.messageDisplayName(m,i))} ${m.locked ? " - Locked" : ""} - ${esc(m.text.slice(0, 65))}${m.text.length > 65 ? "..." : ""}</span></summary>${input("Message name (optional)","messageName",model.messageDisplayName(m,i))}${select("Variant", "variant", s.messageVariants?.[m.id] || "ALL", variantChoices(s,s.messageVariants?.[m.id]||"ALL"))}<textarea aria-label="Message ${i + 1}" ${m.locked ? "readonly" : ""}>${esc(m.text)}</textarea><div class="message-character-count" aria-live="polite" title="Template length before substitutions; the completed chat message may have a different length."></div><div class="actions"><button data-action="save-message" ${m.locked ? "disabled" : ""}>Apply message</button><button data-action="preview-message">Preview announcement</button><button data-action="delete-message" class="danger" ${m.locked ? "disabled" : ""}>Delete message</button><select data-insert-token aria-label="Insert substitution"><option value="">Insert substitution...</option>${opts(insertableTokens(s))}</select></div></details>`).join("")}</section>`;
  renderOrdinaryMessagePool(e);
  function refreshOverlapWarning(){
    const note=document.querySelector('#timeline-conflicts'),cards=[...document.querySelectorAll('#rows .reminder')],byId=new Map(cards.map(card=>[card.dataset.row,card]));
    cards.forEach(card=>{card.classList.remove('has-overlap');card.querySelector('[data-overlap-warning]').hidden=true;card.removeAttribute('aria-describedby');});
    try{
      const candidate=clone(currentEventDraft());candidate.reminders=tableArray(rows.map(r=>{
        const card=byId.get(r.id);return card?{...clone(r),...reminderFields(card)}:r;
      }));
      document.querySelectorAll('#detail .mark').forEach(el=>{if(candidate.importantTimes?.[el.dataset.id])Object.assign(candidate.importantTimes[el.dataset.id],fields(el));});
      const conflicts=candidate.timelineVersion===1?model.timelineConflicts(candidate):[],notes=overlapNotes(candidate,conflicts),affected=new Map();
      const label=row=>`${cards.findIndex(card=>card.dataset.row===row.id)+1}. ${row.label||'Reminder'}`;
      const add=(row,other)=>{if(!affected.has(row.id))affected.set(row.id,new Set());affected.get(row.id).add(row.id===other.id?'another occurrence of this reminder':label(other));};
      conflicts.forEach(conflict=>{add(conflict.first,conflict.second);add(conflict.second,conflict.first);});
      for(const [id,others] of affected){const card=byId.get(id);if(!card)continue;const warning=card.querySelector('[data-overlap-warning]');warning.id='reminder-overlap-'+cards.indexOf(card);warning.textContent='Overlaps '+[...others].join('; ')+'. Adjust the start or finish to resolve this.';warning.hidden=false;card.classList.add('has-overlap');card.setAttribute('aria-describedby',warning.id);}
      note.textContent=notes.join(' ');note.hidden=!notes.length;
    }catch{note.hidden=true;}
  }
  refreshOverlapWarning();
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
          const row={...clone(rows.find(r=>r.id===card.dataset.row)),...reminderFields(card)};
          const fieldError=reminderFieldError(card,row);if(fieldError)throw Error(fieldError);
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
    refreshOverlapWarning();refreshEffectiveTimes();
  };
  detail.onchange=()=>{editRevision++;refreshOverlapWarning();refreshEffectiveTimes();};
  const eventPanel=document.querySelector('#detail>.panel.event-settings');
  wireWholeNumberInputs(eventPanel,'input[data-command-option]');
  bindRotationEditor(e);
  const fold=eventPanel.querySelector('[data-field=eventFold]').closest('label');
  const advanced=document.createElement('details');advanced.id='event-clock-options';advanced.innerHTML='<summary>Advanced clock options</summary>';advanced.open=s.eventFold==='SECOND';fold.parentElement.append(advanced);advanced.append(fold);
  if(s.timelineVersion!==1)eventPanel.insertAdjacentHTML('afterend',legacyMigrationBanner(e));
  eventPanel.querySelectorAll('[data-field=settingsRunAt],[data-field=recurrence],[data-field=specialPattern],[data-field=eventDate],[data-field=monthlyWeek],[data-field=monthlyWeekday],[data-weekday],#use-event-weekdays').forEach(control=>control.addEventListener('change',refreshEventRelevance));
  eventPanel.querySelectorAll('[data-field=monthlyWeek],[data-field=monthlyWeekday]').forEach(control=>control.addEventListener('change',()=>{monthlyRulePinned=true;}));
  const inferMonthlyRule=()=>{if(!monthlyRulePinned){const rule=model.monthlyWeekdayRule({eventDate:eventPanel.querySelector('[data-field=eventDate]').value});eventPanel.querySelector('[data-field=monthlyWeek]').value=String(rule.monthlyWeek??1);eventPanel.querySelector('[data-field=monthlyWeekday]').value=String(rule.monthlyWeekday??1);}refreshEventRelevance();};
  eventPanel.querySelector('[data-field=eventDate]').addEventListener('input',inferMonthlyRule);eventPanel.querySelector('[data-field=eventDate]').addEventListener('change',inferMonthlyRule);
  eventPanel.querySelector('[data-command-option=autoPopulateOnZone]').addEventListener('change',ev=>{if(ev.target.checked)eventPanel.querySelector('[data-command-option=reminderMinutes]').value='';refreshCommandDelivery();});
  eventPanel.querySelector('[data-command-option=reminderMinutes]').addEventListener('input',ev=>{if(Number(ev.target.value)>0)eventPanel.querySelector('[data-command-option=autoPopulateOnZone]').checked=false;refreshCommandDelivery();});
  refreshEventRelevance();
  eventPanel.querySelectorAll('input,select').forEach(el=>{el.addEventListener('input',refreshNextOccurrence);el.addEventListener('change',refreshNextOccurrence);});refreshNextOccurrence();
  $("#save-event").onclick = () => {
    const p = $("#detail>.panel");
    let delivery;try{delivery=readCommandDelivery(p);}catch(error){status(error.message,true);return;}
    if(p.querySelector('[data-field=settingsRunAt]').value!=='SCHEDULED'){
      const name=p.querySelector('[data-field=commandName]').value.trim();if(name)e.command.name=name;
      account().chatChannels??={};account().chatChannels[e.commandId]??={};account().chatChannels[e.commandId][model.guildKey(account().chatChannels[e.commandId],guild)]=p.querySelector('[data-field=outputChannel]').value;
      e.settings.runAt=p.querySelector('[data-field=settingsRunAt]').value;Object.assign(e.settings,delivery);
      changed();renderList();return;
    }
    if([...p.querySelectorAll("input[data-field]")].some(el=>!el.checkValidity())){p.querySelectorAll("input[data-field]").forEach(el=>el.reportValidity());status("Use valid clocks and whole numbers within their allowed ranges.",true);return;}
    const v = fields(p);
    const rotationDraft=currentEventDraft();v.rotationFactions=rotationDraft.rotationFactions;if(rotationDraft.rotationEvents)v.rotationEvents=rotationDraft.rotationEvents;
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
    if(candidate.specialPattern==='EVENT_ROTATION'){const ids=new Set(vals(candidate.rotationEvents).map(a=>a.id));candidate.messageVariants=clone(s.messageVariants||{});for(const [id,variant] of Object.entries(candidate.messageVariants))if(variant!=='ALL'&&!ids.has(variant))candidate.messageVariants[id]='ALL';v.messageVariants=candidate.messageVariants;}
    delete candidate.commandName;
    delete candidate.outputChannel;
    delete candidate.settingsRunAt;
    if(candidate.eventDurationMinutes===null)delete candidate.eventDurationMinutes;
    if(candidate.eventDurationMinutes===null)delete candidate.eventDurationMinutes;
    if(candidate.recurrence==='NONE')candidate.specialPattern='NONE';
    try {
      requireValidTimeline(candidate,{allowIncompleteDrafts:true});
    } catch (error) {
      status(error.message, true);
      return;
    }
    account().chatChannels ??= {};
    account().chatChannels[e.commandId] ??= {};
    account().chatChannels[e.commandId][model.guildKey(account().chatChannels[e.commandId],guild)] = v.outputChannel;
    e.settings.runAt = v.settingsRunAt;Object.assign(e.settings,delivery);
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
      card._availability=clone(r.availability||{});refreshAvailability(card);
      card.querySelectorAll('[data-availability],[data-availability-day]').forEach(el=>el.addEventListener('change',()=>refreshAvailability(card)));
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
              const update = reminderFields(card);const fieldError=reminderFieldError(card,update);if(fieldError){status(fieldError,true);return;}
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
    showInputModal({title:'Add important time',intro:'Use a short lowercase key, such as tickets or gathering, in reminder anchors and message substitutions.',fields:[{key:'key',label:'Important time key',value:'tickets',maxLength:64}],submitLabel:'Add time',onSubmit:values=>{
      const name=values.key;if(!/^[a-z][a-z0-9_]*$/.test(name)||Object.hasOwn(s.importantTimes||{},name))throw Error('Choose a unique lowercase key beginning with a letter.');
      s.importantTimes??={};s.importantTimes[name]={label:name,offsetMinutes:-30};changed();renderDetail();
    }});
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
    const messageId=crypto.randomUUID();
    append(account().messages, {
      name:model.nextMessageName(existingMessages),displayOrder:existingMessages.length+1,
      id: messageId,
      commandId: e.commandId,
      guildName: guild,
      ...(deliveryGuildSlot(e) ? { guildIndex: deliveryGuildSlot(e) } : {}),
      text: "New event announcement",
      useCount: 0,
    });
    changed();
    renderDetail(null,messageId,true);
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
        const name=model.messageDisplayName(message,index);el.querySelector('.message-summary-title').textContent=name+(message.locked?' - Locked':'')+' - '+message.text.slice(0,65)+(message.text.length>65?'...':'');
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
      const messageArea=el.querySelector('textarea');
      const updateCharacterCount=()=>{el.querySelector('.message-character-count').textContent=`${Array.from(messageArea.value).length} characters · before substitutions`;};
      messageArea.addEventListener('input',updateCharacterCount);
      updateCharacterCount();
      el.querySelector('[data-action=preview-message]').onclick=()=>previewLibraryMessage(e,el.querySelector('textarea').value,model.messageDisplayName(message,index));
      el.querySelector("[data-insert-token]").onchange = (ev) => {
        const area = el.querySelector("textarea");
        if (area.readOnly) return;
        area.setRangeText(
          ev.target.value,
          area.selectionStart,
          area.selectionEnd,
          "end",
        );
        area.dispatchEvent(new Event("input", {bubbles:true}));
        area.focus();
        ev.target.value = "";
      };
      el.querySelector("[data-action=delete-message]").onclick = () => {
        const m = messages.find((m) => m.id === el.dataset.id);
        if (
          m.locked ||
          !confirm(
            editorIsScheduled()?"Delete this message and remove it from every reminder pool?":"Delete this message from this command and guild?",
          )
        )
          return;
        account().messages = tableArray(
          vals(account().messages).filter((item) => item.id !== m.id),
        );
        for (const event of all()) {
          const schedule = event.settings.schedule;
          if(event.settings.disabledMessageIds)delete event.settings.disabledMessageIds[m.id];
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
        document.querySelectorAll('[data-pool-message-label]').forEach(label=>{if(label.dataset.poolMessageLabel===m.id)label.textContent=model.messageDisplayName(m,messages.indexOf(m))+': '+m.text;});
        if(editorIsScheduled()){
          s.messageVariants ??= {};
          s.messageVariants[m.id] = el.querySelector("select[data-field=variant]").value;
        }
        changed();
      };
    });
  decorateFieldLabels();refreshEffectiveTimes();
  document.querySelectorAll('#detail details').forEach(d=>{const key=detailKey(d);if(openDetails.has(key))d.open=openDetails.get(key);});
  if(focusMessageId){requestAnimationFrame(()=>{const message=[...document.querySelectorAll('#detail .message')].find(el=>el.dataset.id===focusMessageId);if(message){if(expandNewMessage){message.open=true;const area=message.querySelector('textarea');area?.focus({preventScroll:true});area?.select();}else message.querySelector('.message-drag-handle')?.focus({preventScroll:true});message.scrollIntoView({block:'nearest',behavior:'instant'});}});}
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
  if(out.monthlyWeek!==undefined&&out.monthlyWeek!=="LAST")out.monthlyWeek=Number(out.monthlyWeek);if(out.monthlyWeekday!==undefined)out.monthlyWeekday=Number(out.monthlyWeekday);
  if(out.recurrence!==undefined&&out.recurrence!=="MONTHLY_WEEKDAY"){delete out.monthlyWeek;delete out.monthlyWeekday;}
  if(Object.hasOwn(out,"eventEnabled")){out.enabled=out.eventEnabled;out.paused=false;delete out.eventEnabled;}
  applyState(out,"eventState");applyState(out,"rowState");
  if(out.markMode){if(out.markMode==='DATE'){try{const d=currentEventDraft(),at=projectedNext(d)??model.scheduleEventUtc(d),target=model.scheduleEventUtc({eventDate:out.markDate,eventTime:out.markTime,timeZone:d.timeZone,eventFold:d.eventFold});out.offsetMinutes=target===null?NaN:(target-at)/60;}catch{out.offsetMinutes=NaN;}}delete out.markMode;delete out.markDate;delete out.markTime;}
  return out;
}
$("#new-event").onclick = () => {
  const a=account(),target=accountName,currentGuild=guild;
  showInputModal({title:'New guild entry',intro:'Create a command and message pool. New entries start as On Demand; choose Scheduled later if you need event reminders.',fields:[{key:'guild',label:'Guild name',value:currentGuild?(model.guildNames(a).get(currentGuild)||currentGuild):'',readonly:!!currentGuild},{key:'name',label:'Command / event name'}],submitLabel:'Create entry',onSubmit:values=>{
  if(accountName!==target)throw Error('The selected account changed. Reopen this form.');
  const g=values.guild.toLowerCase(),name=values.name;
  const id = crypto.randomUUID();
  a.commands ??= {};
  append(a.commands, {
    id,
    name: name.trim(),
  });
  a.commandGuildSettings ??= {};
  a.commandGuildSettings[id] = {
    [g]: {
      runAt: "ON_DEMAND",
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
  }});
};
function renderOrdinaryMessagePool(event){
 const panel=document.querySelector('#ordinary-message-pool');if(!panel)return;
 const messages=eventMessages(event);
 panel.innerHTML=`<div class="heading"><h2>Message pool</h2><span class="badge" data-pool-count aria-live="polite"></span></div><p class="help">Check the messages this command may choose. Unchecked messages remain saved and recognizable when another player sends them.</p><div class="pool">${messages.map((message,index)=>`<label class="check"><input type="checkbox" data-message="${esc(message.id)}" data-ordinary-message="${esc(message.id)}" ${event.settings.disabledMessageIds?.[message.id]===true?'':'checked'}><span data-pool-message-label="${esc(message.id)}">${esc(model.messageDisplayName(message,index))}: ${esc(message.text)}</span></label>`).join('')||'<p class="help">Add a message to the library below to populate this pool.</p>'}</div><p class="pool-empty-note" data-pool-empty hidden>No messages enabled. This command will not prepare a message until one is enabled.</p>`;
 const summary=()=>{const boxes=[...panel.querySelectorAll('[data-ordinary-message]')],count=boxes.filter(x=>x.checked).length;panel.querySelector('[data-pool-count]').textContent=count+' of '+boxes.length+' enabled';panel.querySelector('[data-pool-empty]').hidden=count!==0;boxes.forEach(box=>box.closest('label').classList.toggle('pool-message-off',!box.checked));};
 panel.querySelectorAll('[data-ordinary-message]').forEach(box=>box.onchange=()=>{const id=box.dataset.ordinaryMessage;event.settings.disabledMessageIds??={};if(box.checked)delete event.settings.disabledMessageIds[id];else event.settings.disabledMessageIds[id]=true;if(!Object.keys(event.settings.disabledMessageIds).length)delete event.settings.disabledMessageIds;changed();summary();});
 summary();attachPoolPreviews(panel,event,null);
}
function attachPoolPreviews(card,event,row){
  let bubble;
  const close=()=>{bubble?.remove();bubble=null;card.querySelectorAll('[aria-describedby="pool-preview"]').forEach(el=>el.removeAttribute('aria-describedby'));};
  const show=label=>{
    close();const id=label.querySelector('[data-message]')?.dataset.message;
    const message=eventMessages(event).find(m=>m.id===id);if(!message)return;
    let output=message.text,caption='Full message template';
    try{
      if(!row){const now=Math.floor(Date.now()/1000),zone=guildZone(),hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:zoneNames[zone],hour:'numeric',hourCycle:'h23'}).format(new Date(now*1000)));output=model.previewCommandMessage(message.text,now,{guild,zone:'Guild Hall',timeZone:zone,localHour:hour});caption='Command preview · '+new Date(now*1000).toLocaleString('en-US',{timeZone:zoneNames[zone],timeZoneName:'short'});}
      else {
      const schedule=event.schedule,at=projectedNext(schedule)??model.scheduleEventUtc(schedule),draft={...clone(row),...reminderFields(card)};
      const window=model.reminderWindows({...schedule,reminders:tableArray([draft])},at).find(w=>w.row.id===draft.id);
      if(window){const now=draft.once?window.start:Math.floor((window.start+window.end)/2);output=model.previewMessage(message.text,schedule,at,now,{guild,zone:'Guild Hall'});caption='Preview inside this announcement period · '+new Date(now*1000).toLocaleString('en-US',{timeZone:zoneNames[schedule.timeZone||'ET'],timeZoneName:'short'});}
      }
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
function previewLibraryMessage(event,template,name){
 const scheduled=editorIsScheduled(),zone=guildZone(),now=Math.floor(Date.now()/1000);
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zoneNames[zone],year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now*1000)).map(p=>[p.type,p.value]));
 $('#dialog-body').innerHTML=`<h2>${esc(name)} — announcement preview</h2><p class="help">${scheduled?'Uses the next scheduled event and the simulated server clock.':'Uses this command’s shared message pool, without a scheduled event. Dates and times written in the text can create a countdown when recognized.'} Previewing does not send, save or consume cooldowns.</p><div class="grid two"><label>Simulated server time<div class="clock-control"><input id="message-preview-now" type="datetime-local" value="${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}"><span>${esc(zone)}</span></div></label><label>Sample player zone<input id="message-preview-zone" value="Guild Hall"></label></div><h3>Template</h3><pre id="message-preview-template" class="message-preview-text"></pre><h3>Announcement</h3><pre id="message-preview-output" class="message-preview-text" aria-live="polite"></pre><p class="help" id="message-preview-note"></p><p class="help">The zone is a sample; ESO uses your actual player zone. Unknown or unavailable substitutions remain visible in the text.</p>`;
 $('#message-preview-template').textContent=template;
 const render=()=>{
  try{
   const [date,time]=$('#message-preview-now').value.split('T'),stamp=model.scheduleEventUtc({eventDate:date,eventTime:time,timeZone:zone});if(stamp===null||!Number.isFinite(stamp))throw Error('Choose a valid server date and clock.');
   const context={guild,zone:$('#message-preview-zone').value,timeZone:zone,localHour:Number(time.split(':')[0])};
   const schedule=scheduled?currentEventDraft():null,at=scheduled?(model.nextScheduleOccurrence(schedule,stamp)??model.scheduleEventUtc(schedule)):null;
   const output=scheduled&&Number.isFinite(at)?model.previewMessage(template,schedule,at,stamp,context):model.previewCommandMessage(template,stamp,context);
   $('#message-preview-output').textContent=output;$('#message-preview-note').textContent=Array.from(output).length+' characters after substitutions'+(!scheduled?' · No scheduled event or phase is used.':'.');
  }catch(error){$('#message-preview-output').textContent='';$('#message-preview-note').textContent=error.message;}
 };
 $('#message-preview-now').oninput=render;$('#message-preview-zone').oninput=render;render();$('#dialog').showModal();
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
  const previewZone=e.schedule.timeZone||'ET';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zoneNames[previewZone],year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(sim*1000)).map(x=>[x.type,x.value]));
  const serverDate=`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  $("#dialog-body").innerHTML =
    `<h2>Preview - ${esc(r.label)}</h2><p class="help">Simulate a time inside this reminder. The addon chooses from the eligible pool and always requires Enter.</p><div class="grid two"><label>Simulated server time<span class="clock-control"><input id="simulate-time" type="datetime-local" value="${serverDate}"><span class="clock-zone">${esc(previewZone)}</span></span></label><label>Simulated player zone<input id="simulate-zone" value="Guild Hall"></label></div><p id="simulate-status" class="help"></p><div id="simulate-messages"></div><p class="help">Event, deadline, faction, guild and zone substitutions use this simulated time. Additional natural-language date/time parsing and actual player context are applied in ESO.</p>`;
  function update() {
    const [previewDate,previewClock]=$('#simulate-time').value.split('T');
    const now=model.scheduleEventUtc({timeZone:previewZone,eventDate:previewDate,eventTime:previewClock,eventFold:e.schedule.eventFold});
    if(now===null){$('#simulate-status').textContent='Choose a valid server date and time; this clock may not exist during the daylight-saving transition.';$('#simulate-messages').replaceChildren();return;}
    const hour=Number(previewClock.split(':')[0]),
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
// Find occurrences whose reminders or event bars can reach the visible range.
// Query recurrence in bounded chunks; availability itself expands only this view.
function calendarOccurrences(schedule,from,to){
 const anchor=model.scheduleEventUtc(schedule),bases=Number.isFinite(anchor)?model.reminderWindows(schedule,anchor,{uncapped:true}):[];
 const starts=[0,...bases.map(w=>w.start-anchor)],ends=[Number(schedule.eventDurationMinutes||0)*60,...bases.map(w=>w.end-anchor)];
 const low=Math.max(Date.UTC(2000,0,1)/1000,from-Math.max(...ends)-2*86400),high=Math.min(Date.UTC(2100,0,2)/1000,to-Math.min(...starts)+2*86400);
 const results=new Set();for(let a=low;a<=high;){const b=Math.min(high,a+399*86400);for(const at of model.projectedOccurrences(schedule,a,b))results.add(at);a=b+1;}
 return [...results].sort((a,b)=>a-b);
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
      (account().chatChannels?.[e.commandId]?.[model.guildKey(account().chatChannels?.[e.commandId],guild)] || "Guild") !== calChannel
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
      for (const at of calendarOccurrences(e.schedule,start,end)) {
        if (calKind === "all" && at < end && at + Number(e.schedule.eventDurationMinutes || 0)*60 >= start)
          items.push({
            at,
            end: at + Number(e.schedule.eventDurationMinutes || 0)*60,
            e,
            label: "Actual event",eventAtUtc:at,
            milestone: !Number(e.schedule.eventDurationMinutes),
            event: true,
          });
        const effective=model.effectiveReminderWindows(e.schedule, at, start, end);
        if(calMode==='day')for(const base of model.reminderWindows(e.schedule,at)){
          if(!base.row.availability?.enabled||base.end<=start||base.start>=end||effective.some(w=>w.row.id===base.row.id))continue;
          if(calState==='active'&&(base.row.enabled===false||base.row.paused))continue;
          if(calKind==='milestones'&&!base.row.once||calKind==='windows'&&base.row.once)continue;
          items.push({at:base.start,end:base.end,e,label:base.row.label,rowId:base.row.id,eventAtUtc:at,blocked:true,interval:base.row.intervalMinutes});
        }
        for (const w of effective) {
          if(calState==='active'&&(w.row.enabled===false||w.row.paused))continue;
          if (w.end < start || w.start >= end) continue;
          if (
            (calKind === "milestones" && !w.row.once) ||
            (calKind === "windows" && w.row.once)
          )
            continue;
          items.push({
            at: w.start,
            end: w.end,rowId:w.row.id,eventAtUtc:at,availability:w.availabilityDate?w:null,
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
      button.innerHTML = `${item.milestone ? "◆" : "↻"} ${esc(item.e.command.name)}<small>${esc(item.label)}${item.interval ? " / Every " + model.formatRepeatInterval(item.interval) : ""}</small><small>${esc(clock)}</small>`;
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
function dayReminderLabel(eventName,label){
 const text=String(label||''),name=String(eventName||'').trim();
 if(!name||!text.toLowerCase().startsWith(name.toLowerCase()))return text;
 const suffix=text.slice(name.length),short=suffix.replace(/^\s*[-–—:]\s*/,'');
 return short!==suffix&&short.trim()?short:text;
}
function chooseAvailabilityScope(item,apply){
 const date=item.availability.availabilityDate,day=new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'});
 $('#dialog-body').innerHTML=`<h2>Change allowed hours</h2><p>Choose which windows should use these hours. The overall promotion period and daily limit stay unchanged.</p><p class="help">This window opens ${esc(date)} (${esc(day)}). Overnight continuations belong to their opening date. Date overrides take priority over weekday overrides, then usual hours.</p><div class="availability-scopes"><button data-scope="DATE">Only ${esc(date)}</button><button data-scope="WEEKDAY">Every ${esc(day)}</button><button data-scope="ALL">All eligible days — usual hours</button></div><p class="help">Changing usual hours keeps any existing date and weekday overrides. Close to cancel.</p>`;
 $('#dialog-body').querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>{$('#dialog').close();apply(b.dataset.scope);});$('#dialog').showModal();
}
function renderDayTimeline(items,from,until,zone){
  const root=document.querySelector('#calendar-grid');root.className='day-timeline-scroll';
  const nav=document.createElement('div');nav.className='day-navigation';nav.innerHTML='<div class="day-date-controls"><button data-day-step="-1">← Previous day</button><button data-day-today>Today</button><button data-day-step="1">Next day →</button></div><button data-day-undo>Undo last timeline edit</button>';
  const instructions=document.createElement('p');instructions.className='help day-instructions';instructions.textContent='5-minute snapping · Drag a block to move; drag a visible end to resize.';
  nav.querySelectorAll('[data-day-step]').forEach(b=>{const date=new Date(calDate+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+Number(b.dataset.dayStep));b.textContent=(Number(b.dataset.dayStep)<0?'← ':'')+date.toLocaleDateString('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'})+(Number(b.dataset.dayStep)>0?' →':'');b.setAttribute('aria-label','View '+date.toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long',year:'numeric',month:'long',day:'numeric'}));});
  nav.querySelectorAll('[data-day-step]').forEach(b=>b.onclick=()=>{const d=new Date(calDate+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+Number(b.dataset.dayStep));calDate=d.toISOString().slice(0,10);renderCalendar();});
  nav.querySelector('[data-day-today]').onclick=()=>{calDate='';renderCalendar();};
  const undo=nav.querySelector('[data-day-undo]');undo.disabled=!dayTimelineUndo||dayTimelineUndo.account!==accountName||dayTimelineUndo.guild!==guild;
  undo.onclick=()=>{try{const edit=dayTimelineUndo,event=all().find(e=>e.commandId===edit.commandId&&e.guild.trim().toLowerCase()===guild.trim().toLowerCase());if(!event||JSON.stringify(event.schedule)!==edit.after)throw Error('This event changed since the drag; Undo cannot overwrite newer edits.');event.settings.schedule=clone(edit.before);selected=event.commandId;dayTimelineUndo=null;changed();renderCalendar();status('Timeline edit undone.');}catch(error){status(error.message,true);}};
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
      const reminderLabel=dayReminderLabel(item.e.command.name,item.label);
      const row=document.createElement('div');row.className='day-timeline-row';
      const label=document.createElement('div');label.className='day-row-label';label.innerHTML=`<strong>${esc(item.e.command.name)}</strong><small>${esc(reminderLabel)}</small>`;
      const track=document.createElement('div');track.className='day-track';addContext(track);
      ticks.forEach(t=>{const line=document.createElement('span');line.className='day-gridline';line.style.left=x(t)+'%';track.append(line);});
      if(item.blocked){
        const blocked=document.createElement('span');blocked.className='day-availability-base day-unavailable';blocked.style.left=x(item.at)+'%';blocked.style.width=(x(item.end)-x(item.at))+'%';blocked.textContent='Not eligible during this view';track.append(blocked);row.append(label,track);shell.append(row);continue;
      }
      if(item.availability){
        const base=document.createElement('span');base.className='day-availability-base';base.style.left=x(item.availability.baseStart)+'%';base.style.width=(x(item.availability.baseEnd)-x(item.availability.baseStart))+'%';track.append(base);
        const source=item.availability.availabilitySource;
        const badge=document.createElement('span');badge.className='availability-badge';badge.textContent=(source==='DATE'?'Date override':source==='WEEKDAY'?'Weekday override':'Usual hours')+(item.availability.row.availability.maxPerDay?' · Up to '+item.availability.row.availability.maxPerDay+'/day':'');label.append(badge);
        if(source!=='USUAL'){
          const reset=document.createElement('button');reset.className='availability-reset';reset.textContent='Reset '+(source==='DATE'?'date':'weekday');reset.onclick=()=>{try{const before=clone(item.e.schedule),result=model.resetReminderAvailability(before,item.rowId,item.availability.availabilityDate,source);item.e.settings.schedule=result.schedule;dayTimelineUndo={account:accountName,guild,commandId:item.e.commandId,before,after:JSON.stringify(result.schedule)};changed();renderCalendar();status(result.notice||'Override reset. Inherited hours now apply.');}catch(error){status(error.message,true);}};label.append(reset);
        }
      }
      const button=document.createElement('button');button.className='day-block' +(item.milestone?' day-milestone':'')+(item.event?' day-actual-event':'')+(item.availability?' day-availability '+item.availability.availabilitySource.toLowerCase():'');
      button.style.left=x(item.at)+'%';button.style.width=(item.milestone?0:Math.max(.3,x(item.end)-x(item.at)))+'%';
      // Each frequency gets a stable color, so a changed cadence is visible.
      const frequency=Number(item.interval||0);button.style.background=item.event?hue:(item.milestone||item.once)?'#b58a3b':`hsl(${(frequencies.indexOf(frequency)*137.508+205)%360} 45% 38%)`;
      const frequencyText=item.event?'Event in progress':item.milestone?'Once':item.once?'Once within window':`Every ${model.formatRepeatInterval(frequency)}`;
      const detail=`${reminderLabel}: ${clock(item.at)}${item.end!==item.at?' – '+clock(item.end):''} · ${frequencyText}`;
      button.textContent=item.milestone?'◆':frequencyText;button.title=detail;button.setAttribute('aria-label',detail);
      const clippedStart=item.at<from,clippedFinish=item.end>until;
      for(const [edge,clipped,arrow] of [['start',clippedStart,'◀'],['finish',clippedFinish,'▶']]){
        if(clipped){const marker=document.createElement('span');marker.className='day-continues '+edge;marker.textContent=arrow;marker.title='Continues '+(edge==='start'?'before':'after')+' the visible range; navigate to its actual edge to resize.';button.append(marker);}
        else if(item.availability&&(edge==='start'?item.availability.clipStart:item.availability.clipEnd)){const marker=document.createElement('span');marker.className='day-continues '+edge;marker.textContent='│';marker.title='Limited by the overall promotion '+(edge==='start'?'start':'finish')+'; edit the promotion period to extend this edge.';button.append(marker);}
        else if(!item.milestone&&item.e.schedule.timelineVersion===1){const handle=document.createElement('span');handle.className='day-resize '+edge;handle.dataset.edge=edge;handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label','Resize '+edge+' of '+item.label);button.append(handle);}
      }
      let suppressClick=false;
      const apply=(edge,delta)=>{
        if(!delta)return;
        const commit=scope=>{try{
          const before=clone(item.e.schedule),result=item.availability?model.editReminderAvailability(before,item.eventAtUtc,item.rowId,item.availability.availabilityDate,scope,edge,delta):model.editDayTimeline(before,item.eventAtUtc,item.event?null:item.rowId,edge,delta);
          item.e.settings.schedule=result.schedule;selected=item.e.commandId;changed();
          dayTimelineUndo={account:accountName,guild,commandId:item.e.commandId,before,after:JSON.stringify(item.e.settings.schedule)};
          renderCalendar();status('Timeline updated.'+(result.notice?' '+result.notice:''));
        }catch(error){renderCalendar();status(error.message,true);}};
        if(item.availability)chooseAvailabilityScope(item,commit);else commit();
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
          feedback.textContent=reminderLabel+': '+fullClock(start)+(item.milestone?'':' → '+fullClock(end));feedback.style.left=Math.max(8,Math.min(ev.clientX,innerWidth-360))+'px';feedback.style.top=Math.max(8,ev.clientY-66)+'px';
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
      account().chatChannels?.[event.commandId]?.[model.guildKey(account().chatChannels?.[event.commandId],guild)] || "Guild";
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
      const staged = stageImport(p, {...e,deliveryGuildIndex:model.guildIndexFromRoster(account(),e.guild)}, account().messages, guild);
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
      for(const key of ['rotationEvents','rotationEvery','occurrenceExceptions'])if(staged.schedule[key]===undefined)delete e.schedule[key];
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
function prepareCurrentLua(options={}){
  if(!data)throw Error('Open a SavedVariables file first.');
  validateEditedTimelines(data,options);
  const result=model.mergeSavedVariables(base,data,latest||base);
  if(result.conflicts.length){
    const detail=result.conflicts.map(c=>`${c.path}\nEdited: ${JSON.stringify(c.edited)}\nLatest: ${JSON.stringify(c.latest)}`).join('\n\n');
    throw Error('Configuration conflicts · save stopped\n\n'+detail+'\n\nResolve these edits in a fresh snapshot before saving or downloading.');
  }
  for(const entry of model.accounts(result.data))for(const event of model.events(entry.value)){
    const original=base.Default?.[entry.name]?.$AccountWide?.commandGuildSettings?.[event.commandId]?.[event.guild]?.schedule;
    if(event.schedule.timelineVersion===1&&JSON.stringify(event.schedule)!==JSON.stringify(original))event.schedule.reminders=tableArray(model.orderedReminderRows(event.schedule));
  }
  validateEditedTimelines(result.data,options);return writeSavedVariables(result.data);
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
  $('#dialog-body').innerHTML=`<h2>Shared server library</h2><p class="help">Full Lua configurations saved here are public: anyone can load all their accounts and messages, including locked messages. Names must be unique; saved files cannot be overwritten. Apply editor changes before saving. Empty reminder timelines can be saved as drafts; finish them before downloading for ESO.</p><section class="library-save"><label>Save current configuration as<input id="library-name" maxlength="120" placeholder="For example: Alphabet Mafia — November v1" ${data?'':'disabled'}></label><button id="library-save" class="gold" ${data?'':'disabled'}>Save to server</button></section>${data?'':'<p class="help">Open a local file or load a shared configuration before saving.</p>'}<div class="heading"><h3>Saved configurations</h3><button id="library-refresh">Refresh list</button></div><p id="library-status" role="status" class="help">Loading saved files…</p><div id="library-list"></div><p class="help">Loading opens a copy in this editor. It does not change your ESO files or remap accounts. Use event import/export to transfer events into another account. Download updated Lua when you are ready to install it.</p>`;
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
      const lua=prepareCurrentLua({allowIncompleteDrafts:true}),revision=editRevision;
      const drafts=model.accounts(parseSavedVariables(lua)).flatMap(entry=>model.events(entry.value).filter(e=>e.settings.runAt==='SCHEDULED'&&e.schedule.timelineVersion===1&&vals(e.schedule.reminders).length===0).map(e=>`${entry.name} / ${e.guild} / ${e.command.name}`));
      const draftNote=drafts.length?' Draft with no reminders: '+drafts.join('; ')+'. Add reminder periods before downloading for ESO.':'';
      await libraryRequest('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,lua})});
      const unchanged=revision===editRevision;if(unchanged)dirty=false;field.value='';if(isActive())await refresh();libraryStatus(`Saved “${name}”. This name is now reserved; choose a different name for future versions.`+draftNote);status(unchanged?`Saved a shared server copy named “${name}”. Local ESO files are unchanged.`:`Saved the earlier copy named “${name}”. Newer workspace edits were not marked as saved.`);
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
