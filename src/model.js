import {
  parseSavedVariables,
  writeSavedVariables,
  setLuaValue,
  isLuaNumericKey,
} from "./lua-data.js";
export const cloneSavedData = (data) =>
  parseSavedVariables(writeSavedVariables(data));
const object = (x) => x !== null && typeof x === "object";
const values = (x) => (object(x) ? Object.values(x) : []);
const norm = (x) =>
  String(x ?? "")
    .trim()
    .toLowerCase();
export function accounts(data) {
  return Object.entries(data.Default || {})
    .filter(([, a]) => object(a?.$AccountWide))
    .map(([name, a]) => ({ name, value: a.$AccountWide }));
}
export function guildKey(table,name){return Object.keys(table||{}).find(key=>norm(key)===norm(name))??norm(name);}
function cachedGuilds(account){
 account=account?.value||account||{};
 return values(account.guildRoster).filter(entry=>object(entry)&&typeof entry.guildName==='string'&&entry.guildName.trim()&&Number.isInteger(entry.guildIndex)&&entry.guildIndex>=1&&entry.guildIndex<=5);
}
export function guildIndexFromRoster(account,name){
 const indices=new Set(cachedGuilds(account).filter(entry=>norm(entry.guildName)===norm(name)).map(entry=>entry.guildIndex));
 return indices.size===1?[...indices][0]:undefined;
}
export function guildNames(account,{currentOnly=false}={}){
 account=account?.value||account||{};const names=new Map();
 const add=name=>{if(typeof name==='string'&&name.trim()&&!names.has(norm(name)))names.set(norm(name),name.trim());};
 cachedGuilds(account).forEach(entry=>add(entry.guildName));if(currentOnly&&object(account.guildRoster)&&Number.isFinite(account.guildRosterUpdatedAt))return names;values(account.messages).forEach(entry=>add(entry?.guildName));
 events(account).forEach(event=>add(event.guild));Object.keys(account.guildSchedulingTimeZones||{}).forEach(add);values(account.chatChannels).forEach(channels=>Object.keys(channels||{}).forEach(add));
 return names;
}
export function events(account) {
  account = account.value || account;
  const result = [];
  for (const command of values(account.commands)) {
    const commandMessages = values(account.messages).filter(
      (m) => m.commandId === command.id,
    );
    for (const [guild, settings] of Object.entries(
      account.commandGuildSettings?.[command.id] || {},
    )) {
      const indices = new Set(
        commandMessages
          .filter(
            (m) =>
              m.guildName &&
              norm(m.guildName) === norm(guild) &&
              Number.isInteger(m.guildIndex),
          )
          .map((m) => m.guildIndex),
      );
      for (const value of [settings.guildIndex, settings.lastUsedGuildIndex])
        if (Number.isInteger(value)) indices.add(value);
      if (/^\d+$/.test(guild)) indices.add(Number(guild));
      const guildIndex = indices.size === 1 ? [...indices][0] : undefined;
      const ambiguousGuildIndex = indices.size > 1;
      const omitted = commandMessages.some(
        (m) =>
          !m.guildName &&
          (guildIndex === undefined || m.guildIndex !== guildIndex),
      );
      result.push({
        commandId: command.id,
        command,
        guild,
        guildIndex,
        ambiguousGuildIndex,
        warnings: omitted
          ? [
              "Some messages have no unambiguous guild identity and were omitted.",
            ]
          : [],
        settings,
        schedule: settings.schedule || {},
        messages: commandMessages.filter((m) =>
          m.guildName
            ? norm(m.guildName) === norm(guild)
            : guildIndex !== undefined && m.guildIndex === guildIndex,
        ),
      });
    }
  }
  return result;
}
const equal = (a, b) => {
  if (a === b) return true;
  if (!object(a) || !object(b)) return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every(
      (k) =>
        Object.hasOwn(b, k) &&
        isLuaNumericKey(a, k) === isLuaNumericKey(b, k) &&
        equal(a[k], b[k]),
    )
  );
};
const runtime = (k) =>
  /^(lastUsedAt|useCount|lastUsedParamText|lastUsedGuildIndex|lastAutoPopulateSentAtByZone|observedChatCooldowns|completedOccurrences|timelineDeliveries|timelineHistory|timelineUsage|availabilityUsage|nextDue.*|completed|last.*At|.*Cooldowns)$/.test(
    k,
  );
export function orderedMessageEntries(messages){
  return values(messages).map((message,index)=>({message,index,rank:Number.isInteger(message.displayOrder)&&message.displayOrder>0&&message.displayOrder<=1000000?message.displayOrder:index+1})).sort((a,b)=>a.rank-b.rank||a.index-b.index).map(x=>x.message);
}
export function messageDisplayName(message,index){return typeof message.name==='string'&&message.name.trim()?message.name.trim():`Message ${index+1}`;}
export function reorderMessageEntries(messages,sourceId,targetId,after=false){
  const ordered=orderedMessageEntries(messages).map((message,index)=>({...cloneSavedData(message),name:messageDisplayName(message,index)}));
  const source=ordered.findIndex(m=>m.id===sourceId);if(source<0||!ordered.some(m=>m.id===targetId))throw Error('Choose messages from the same event to reorder.');
  if(sourceId!==targetId){const [message]=ordered.splice(source,1),target=ordered.findIndex(m=>m.id===targetId);ordered.splice(target+(after?1:0),0,message);}
  return ordered.map((message,index)=>({...message,displayOrder:index+1}));
}
export function nextMessageName(messages){
  const ordered=orderedMessageEntries(messages),numbers=ordered.map((m,i)=>/^Message (\d+)$/i.exec(messageDisplayName(m,i))).filter(Boolean).map(m=>Number(m[1]));
  return `Message ${Math.max(ordered.length,0,...numbers)+1}`;
}
export function mergeSavedVariables(base, edited, latest = base) {
  const conflicts = [];
  function validate(node, path = []) {
    if (!object(node)) return;
    const ids = new Set();
    for (const [key, value] of Object.entries(node)) {
      if (object(value) && typeof value.id === "string") {
        if (ids.has(value.id))
          conflicts.push({
            path: [...path, key, "id"].join("."),
            base: undefined,
            edited: value.id,
            latest: "Duplicate stable ID",
          });
        ids.add(value.id);
      }
      validate(value, [...path, key]);
    }
  }
  validate(edited);
  validate(latest);
  if (conflicts.length) return { data: cloneSavedData(latest), conflicts };
  function merge(b, e, l, path = []) {
    if(['guildRoster','guildRosterUpdatedAt'].includes(path.at(-1)))return l===undefined?e:l;
    if (runtime(path.at(-1) || "")) {
      if (path.at(-1) === "timelineUsage" && object(e)) {
        const locate = (root) => {
            let node = root;
            for (const key of path.slice(0, -1))
              node = node?.[key] ?? values(node).find((x) => x?.id === key);
            return node;
          },
          parent = locate(edited),
          prior = locate(base);
        if (
          parent?.timelineVersion === 1 &&
          object(parent.legacyTimelineBackup)
        ) {
          const out = cloneSavedData(l || {}),
            oldIds = new Set(values(prior?.reminders).map((r) => r.id)),
            newIds = new Set(values(parent.reminders).map((r) => r.id));
          for (const [key, usage] of Object.entries(e)) {
            const id = key.slice(key.indexOf(":") + 1);
            if (
              !Object.hasOwn(out, key) &&
              newIds.has(id) &&
              (!oldIds.has(id) || prior?.timelineVersion !== 1)
            )
              out[key] = cloneSavedData(usage);
          }
          return out;
        }
      }
      return l;
    }
    if (equal(b, e)) return l;
    if (equal(e, l)) return l;
    if (path.at(-1) === 'rotationEvents' && object(b) && object(e) && object(l)) {
      const order=x=>values(x).map(a=>a.id), bo=order(b),eo=order(e),lo=order(l);
      let chosen=equal(bo,lo)?eo:lo;
      if(!equal(bo,eo)&&!equal(bo,lo)&&!equal(eo,lo))conflicts.push({path:path.join('.')+'.order',base:bo,edited:eo,latest:lo});
      const out={};let index=1;
      for(const id of new Set([...chosen,...eo,...lo,...bo])){
        const byId=x=>values(x).find(a=>a.id===id);
        const value=merge(byId(b),byId(e),byId(l),[...path,id]);
        if(value!==undefined)setLuaValue(out,index++,value);
      }
      return out;
    }
    if (object(b) && object(e) && object(l)) {
      const entities = (x) =>
        Object.entries(x).length > 0 &&
        Object.values(x).every((v) => object(v) && typeof v.id === "string");
      if (entities(b) && entities(e) && entities(l)) {
        const index = (x) => {
          const map = new Map();
          for (const [key, value] of Object.entries(x)) {
            if (map.has(value.id)) {
              conflicts.push({
                path: [...path, key, "id"].join("."),
                base: b,
                edited: e,
                latest: l,
              });
              return null;
            }
            map.set(value.id, { key, value });
          }
          return map;
        };
        const bi = index(b),
          ei = index(e),
          li = index(l);
        if (!bi || !ei || !li) return l;
        const out = cloneSavedData(l);
        let next =
          Math.max(0, ...Object.keys(out).map(Number).filter(Number.isFinite)) +
          1;
        for (const id of new Set([...bi.keys(), ...ei.keys()])) {
          const bv = bi.get(id),
            ev = ei.get(id),
            lv = li.get(id),
            value = merge(bv?.value, ev?.value, lv?.value, [...path, id]);
          if (lv)
            setLuaValue(
              out,
              isLuaNumericKey(l, lv.key) ? Number(lv.key) : lv.key,
              value,
            );
          else if (value !== undefined) {
            const key = ev?.key ?? bv.key;
            setLuaValue(
              out,
              Object.hasOwn(out, key)
                ? next++
                : isLuaNumericKey(e, key) || isLuaNumericKey(b, key)
                  ? Number(key)
                  : key,
              value,
            );
          }
        }
        return out;
      }
      const out = cloneSavedData(l);
      for (const k of new Set([...Object.keys(b), ...Object.keys(e)])) {
        const value = merge(b[k], e[k], l[k], [...path, k]);
        const keySource =
          Object.hasOwn(b, k) &&
          Object.hasOwn(e, k) &&
          isLuaNumericKey(b, k) === isLuaNumericKey(e, k) &&
          Object.hasOwn(l, k)
            ? l
            : Object.hasOwn(e, k)
              ? e
              : b;
        setLuaValue(out, k, value, isLuaNumericKey(keySource, k));
      }
      return out;
    }
    if (equal(b, l)) return e;
    conflicts.push({ path: path.join("."), base: b, edited: e, latest: l });
    return l;
  }
  const data = cloneSavedData(merge(base, edited, latest));
  refreshMigratedRuntime(data, base, latest, conflicts);
  return { data, conflicts };
}
const zones = {
  ET: "America/New_York",
  CT: "America/Chicago",
  MT: "America/Denver",
  PT: "America/Los_Angeles",
  UTC: "UTC",
};
const formats = new Map();
function civil(t, zone) {
  zone = zones[zone] || zone || zones.ET;
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formats.set(zone, f);
  }
  const p = Object.fromEntries(
    f
      .formatToParts(new Date(t * 1000))
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, +x.value]),
  );
  return [p.year, p.month, p.day, p.hour, p.minute, p.second];
}
const stamp = (c) =>
  Date.UTC(c[0], c[1] - 1, c[2], c[3] || 0, c[4] || 0, c[5] || 0) / 1000;
function utc(c, z, fold) {
  const target = stamp(c),
    found = [];
  for (const delta of [-43200, 0, 43200]) {
    const sample = target + delta,
      offset = stamp(civil(sample, z)) - sample,
      candidate = target - offset;
    if (equal(civil(candidate, z), c) && !found.includes(candidate))
      found.push(candidate);
  }
  found.sort((a, b) => a - b);
  return found.length
    ? fold === "SECOND" || /^(EST|CST|MST|PST)$/.test(fold)
      ? found.at(-1)
      : found[0]
    : null;
}
function clock(s) {
  const m = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(String(s || ""));
  if (!m) return null;
  let h = +m[1],
    n = +m[2];
  if (n > 59 || h > (m[3] ? 12 : 23) || (m[3] && h < 1)) return null;
  if (m[3]) h = (h % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
  return [h, n, 0];
}
function date(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const c = m.slice(1).map(Number);
  return equal(civil(stamp(c), "UTC").slice(0, 3), c) ? c : null;
}
export function monthlyWeekdayRule(schedule = {}) {
  const anchor=date(schedule.eventDate||schedule.startDate);
  return {
    monthlyWeek:schedule.monthlyWeek ?? (anchor?Math.floor((anchor[2]-1)/7)+1:undefined),
    monthlyWeekday:schedule.monthlyWeekday ?? (anchor?new Date(stamp(anchor)*1000).getUTCDay()+1:undefined),
  };
}
export function validateMonthlyWeekdayRule(schedule = {}) {
  const errors=[];
  if(schedule.monthlyWeek!==undefined && schedule.monthlyWeek!=='LAST' && (!Number.isInteger(schedule.monthlyWeek)||schedule.monthlyWeek<1||schedule.monthlyWeek>5))errors.push('Monthly week must be 1 through 5 or LAST.');
  if(schedule.monthlyWeekday!==undefined && (!Number.isInteger(schedule.monthlyWeekday)||schedule.monthlyWeekday<1||schedule.monthlyWeekday>7))errors.push('Monthly weekday must be 1 through 7 (Sunday through Saturday).');
  return errors;
}
function nominalOccurrences(schedule, fromUtc, toUtc, unlimited = false, firstOnly = false) {
  if (!Number.isFinite(fromUtc) || !Number.isFinite(toUtc) || toUtc < fromUtc)
    return [];
  if (!unlimited && toUtc - fromUtc > 400 * 86400)
    throw Error("Preview is limited to 400 days.");
  const z = schedule.timeZone || "ET",
    d = date(schedule.eventDate || schedule.startDate),
    t = clock(schedule.eventTime || schedule.startTime);
  if (!d || !t) return [];
  const anchor = stamp(d),
    rec = schedule.recurrence || "NONE",
    interval = Math.max(
      1,
      Math.floor(+schedule.interval || +schedule.recurrenceInterval || 1),
    ),
    weekday = new Date(anchor * 1000).getUTCDay(),
    monthly = monthlyWeekdayRule(schedule),
    wanted = Object.entries(schedule.weekdays || {})
      .filter(([, v]) => v === true)
      .map(([k]) => Number(k) - 1);
  const result = [];
  const start = Math.max(anchor, Math.floor((fromUtc - 86400) / 86400) * 86400),
    end = toUtc + 86400;
  for (let day = start; day <= end; day += 86400) {
    const dayDate = new Date(day * 1000), c = [dayDate.getUTCFullYear(),dayDate.getUTCMonth()+1,dayDate.getUTCDate()],
      diff = Math.round((day - anchor) / 86400),
      dow = new Date(day * 1000).getUTCDay(),
      months = (c[0] - d[0]) * 12 + c[1] - d[1];
    if(c[0]>2099)break;
    let yes = false;
    if (rec === "NONE") yes = diff === 0;
    else if (rec === "DAILY")
      yes = diff % interval === 0 && (!wanted.length || wanted.includes(dow));
    else if (rec === "WEEKLY" || rec === "BIWEEKLY")
      yes =
        Math.floor((diff + weekday) / 7) %
          (interval * (rec === "BIWEEKLY" ? 2 : 1)) ===
          0 && (wanted.length ? wanted.includes(dow) : dow === weekday);
    else if (rec === "MONTHLY_DATE")
      yes = months % interval === 0 && c[2] === d[2];
    else if (rec === "MONTHLY_WEEKDAY")
      yes =
        months % interval === 0 &&
        dow === monthly.monthlyWeekday-1 &&
        (monthly.monthlyWeek==='LAST'
          ? new Date(Date.UTC(c[0],c[1]-1,c[2]+7)).getUTCMonth()!==c[1]-1
          : Math.floor((c[2]-1)/7)+1===monthly.monthlyWeek);
    if (yes) {
      const occurrence = utc([...c, ...t], z, schedule.eventFold);
      if (occurrence !== null && occurrence >= fromUtc && occurrence <= toUtc) {
        result.push(occurrence);
        if(firstOnly)return result;
      }
    }
  }
  return result;
}
const nominalCache = new Map();
function nominalHistory(schedule, at) {
  const key = JSON.stringify([schedule.eventDate,schedule.startDate,schedule.eventTime,schedule.startTime,schedule.timeZone,schedule.eventFold,schedule.recurrence,schedule.interval,schedule.recurrenceInterval,schedule.weekdays,schedule.monthlyWeek,schedule.monthlyWeekday]);
  let cached = nominalCache.get(key);
  if (!cached || cached.until < at) {
    const anchor = scheduleEventUtc(schedule);
    const interval=Math.max(1,Math.floor(+schedule.interval||+schedule.recurrenceInterval||1));
    const cadenceDays=schedule.recurrence?.startsWith('MONTHLY')?32:['WEEKLY','BIWEEKLY'].includes(schedule.recurrence)?14:7;
    const until = Math.min(at + Math.max(400,interval*cadenceDays) * 86400, Date.UTC(2101,0,1)/1000);
    cached = {until, occurrences: Number.isFinite(anchor) ? nominalOccurrences(schedule,anchor,until,true) : []};
    if (nominalCache.size >= 32) nominalCache.delete(nominalCache.keys().next().value);
    nominalCache.set(key,cached);
  }
  return cached.occurrences;
}
const civilDateKey = (schedule, at) => civil(at,schedule.timeZone||'ET').slice(0,3).map((n,i)=>String(n).padStart(i?2:4,'0')).join('-');
export function occurrenceCancellation(schedule, atUtc) {
  if (!Number.isFinite(atUtc)) return null;
  const action = schedule.occurrenceExceptions?.[civilDateKey(schedule,atUtc)]?.action;
  return ['KEEP','POSTPONE'].includes(action) && nominalOccurrences(schedule,atUtc,atUtc).includes(atUtc) ? action : null;
}
export function projectedOccurrences(schedule, fromUtc, toUtc, options = {}) {
  const occurrences = nominalOccurrences(schedule,fromUtc,toUtc);
  return options.includeCancelled ? occurrences : occurrences.filter(at=>!occurrenceCancellation(schedule,at));
}
export function nextScheduleOccurrence(schedule, fromUtc = Date.now()/1000, options = {}) {
  // Allow UTC spill from the final supported civil date in western timezones.
  const end=Date.UTC(2100,0,2)/1000;
  if(!Number.isFinite(fromUtc)||fromUtc>end)return null;
  if((schedule.recurrence||'NONE')==='NONE') {
    const at=scheduleEventUtc(schedule);
    return Number.isFinite(at)&&at>=fromUtc&&at<=end&&nominalOccurrences(schedule,at,at).length&&(options.includeCancelled||!occurrenceCancellation(schedule,at))?at:null;
  }
  while(fromUtc<=end){
    const next=nominalOccurrences(schedule,fromUtc,end,true,true)[0];
    if(next===undefined)return null;
    const action=schedule.occurrenceExceptions?.[civilDateKey(schedule,next)]?.action;
    if(options.includeCancelled||!['KEEP','POSTPONE'].includes(action))return next;
    fromUtc=next+1;
  }
  return null;
}
export function plannedOccurrences(schedule, fromUtc, toUtc) {
  return nominalOccurrences(schedule,fromUtc,toUtc,true);
}
function postponements(schedule, atUtc) {
  if (!Object.values(schedule.occurrenceExceptions||{}).some(e=>e?.action==='POSTPONE')) return {count:0,days:0};
  const history = nominalHistory(schedule,atUtc); let count=0,days=0;
  history.dateIndex ??= new Map(history.map((at,i)=>[civilDateKey(schedule,at),i]));
  for(const [key,exception] of Object.entries(schedule.occurrenceExceptions||{})) {
    const i=history.dateIndex.get(key);
    if(exception?.action!=='POSTPONE'||i===undefined||history[i]>=atUtc)continue;
    count++;
    if(history[i+1]!==undefined) days+=(stamp(civil(history[i+1],schedule.timeZone||'ET').slice(0,3))-stamp(civil(history[i],schedule.timeZone||'ET').slice(0,3)))/86400;
  }
  return {count,days};
}
export function rotationActivityName(schedule,atUtc) {
  if(schedule.specialPattern!=='EVENT_ROTATION')return null;
  return values(schedule.rotationEvents).find(activity=>activity.id===eventVariant(schedule,atUtc))?.name ?? null;
}
export function resolveReminderAnchor(schedule,eventAtUtc,a) {
 const z=schedule.timeZone||"ET";
    if (!a) return null;
    const kind = a.kind || a.type;
    if (kind === "OFFSET")
      return eventAtUtc + (+a.minutes || +a.offsetMinutes || 0) * 60;
    if (kind === "MARK") {
      const mark = schedule.importantTimes?.[a.name || a.mark];
      return mark ? eventAtUtc + (+mark.offsetMinutes || 0) * 60 : null;
    }
    if (kind === "DAY") {
      const c = civil(eventAtUtc, z),
        day = civil(stamp(c.slice(0, 3)) + (+a.days || 0) * 86400, "UTC").slice(
          0,
          3,
        ),
        t = clock(a.time);
      return t ? utc([...day, ...t], z, a.fold) : null;
    }
    return null;
  }

export function reminderCalendarFields(schedule,eventAtUtc,anchor){
 const at=resolveReminderAnchor(schedule,eventAtUtc,anchor);if(!Number.isFinite(at))return {date:'',time:''};
 const c=civil(at,schedule.timeZone||'ET');return {date:c.slice(0,3).map((n,i)=>String(n).padStart(i?2:4,'0')).join('-'),time:String(c[3]%12||12).padStart(2,'0')+':'+String(c[4]).padStart(2,'0')+(c[3]>=12?' PM':' AM'),fold:anchor?.fold};
}
export function reminderCalendarAnchor(schedule,eventAtUtc,dateValue,timeValue,original){
 const previous=reminderCalendarFields(schedule,eventAtUtc,original);
 if(previous.date===dateValue&&previous.time===timeValue)return {...original};
 const d=date(dateValue),t=clock(timeValue);if(!d||!t)throw Error('Choose a valid period date and server time.');
 const fold=original?.fold,target=utc([...d,...t],schedule.timeZone||'ET',fold);
 if(!Number.isFinite(target))throw Error('This period clock does not exist or is ambiguous. Choose a valid server time.');
 const event=civil(eventAtUtc,schedule.timeZone||'ET');
 return {kind:'DAY',days:Math.round((stamp(d)-stamp(event.slice(0,3)))/86400),time:timeValue,...(fold?{fold}:{})};
}
export function reminderWindows(schedule, eventAtUtc, options = {}) {
  if (!options.includeCancelled && occurrenceCancellation(schedule,eventAtUtc)) return [];
  const z = schedule.timeZone || "ET";
  return values(schedule.reminders).flatMap((row) => {
    const start = resolveReminderAnchor(schedule,eventAtUtc,row.start);
    let end =
        row.once && !row.onceUntilFinish
          ? start + Number(row.lateMinutes ?? 5) * 60
          : resolveReminderAnchor(schedule,eventAtUtc,row.finish);
    if(!options.uncapped && schedule.eventDurationMinutes!==undefined && !row.allowAfterEventEnd){
      const ending=eventAtUtc+schedule.eventDurationMinutes*60;
      if(!(row.once && start===ending))end=Math.min(end,ending);
    }
    return start === null || end === null || end <= start
      ? []
      : [{ row, start, end, eventAtUtc }];
  });
}
export function normalizeReminderAvailability(value) {
  if(value===undefined)return undefined;
  if(!object(value)||Array.isArray(value))throw Error('Availability must be a table.');
  const exact=(table,keys,label)=>{if(!object(table)||Array.isArray(table)||Object.keys(table).some(k=>!keys.includes(k)))throw Error(`Invalid ${label}.`);};
  const integer=(x,min,max)=>Number.isInteger(x)&&x>=min&&x<=max;
  const hours=entry=>{exact(entry,['startMinute','endMinute'],'availability hours');const start=entry.startMinute??0,end=entry.endMinute??1440;if(!integer(start,0,1439)||!integer(end,1,1440)||start===end)throw Error('Availability hours must define a nonempty window of at most 24 hours.');return {startMinute:start,endMinute:end};};
  exact(value,['enabled','weekdays','startMinute','endMinute','maxPerDay','weekdayOverrides','dateOverrides'],'availability');
  if(value.enabled!==undefined&&typeof value.enabled!=='boolean')throw Error('Availability enabled must be boolean.');
  const out={enabled:value.enabled===true,...hours({...(value.startMinute!==undefined?{startMinute:value.startMinute}:{}),...(value.endMinute!==undefined?{endMinute:value.endMinute}:{})})};
  if(value.maxPerDay!==undefined){if(!integer(value.maxPerDay,1,1000))throw Error('Daily maximum must be a whole number from 1 to 1000.');out.maxPerDay=value.maxPerDay;}
  if(value.weekdays!==undefined){if(!object(value.weekdays)||Array.isArray(value.weekdays))throw Error('Availability weekdays must be a table.');out.weekdays={};for(const [key,allowed]of Object.entries(value.weekdays)){if(!/^[1-7]$/.test(key)||typeof allowed!=='boolean')throw Error('Invalid availability weekday.');setLuaValue(out.weekdays,Number(key),allowed);}}
  for(const field of ['weekdayOverrides','dateOverrides'])if(value[field]!==undefined){if(!object(value[field])||Array.isArray(value[field]))throw Error('Availability overrides must be a table.');out[field]={};for(const [key,entry]of Object.entries(value[field])){if(field==='weekdayOverrides'?!/^[1-7]$/.test(key):!date(key))throw Error('Invalid availability override date or weekday.');setLuaValue(out[field],field==='weekdayOverrides'?Number(key):key,hours(entry));}}
  return out;
}
export function availabilityForDate(schedule,row,dateKey) {
  const d=date(dateKey);if(!d)throw Error('Choose a valid availability date.');
  const a=row.availability||{},enabled=a.enabled===true,weekday=new Date(stamp(d)*1000).getUTCDay()+1;
  const override=a.dateOverrides?.[dateKey]||a.weekdayOverrides?.[weekday];
  const source=a.dateOverrides?.[dateKey]?'DATE':a.weekdayOverrides?.[weekday]?'WEEKDAY':'USUAL';
  const hours={startMinute:override?.startMinute??a.startMinute??0,endMinute:override?.endMinute??a.endMinute??1440};
  return {enabled,allowed:!enabled||a.weekdays===undefined||a.weekdays?.[weekday]===true,dateKey,weekday,source,hours,...hours,maxPerDay:a.maxPerDay,availabilityDate:dateKey,availabilityWeekday:weekday,availabilitySource:source};
}
export function effectiveReminderWindows(schedule,eventAtUtc,fromUtc,toUtc,options={}) {
  if(!Number.isFinite(fromUtc)||!Number.isFinite(toUtc)||toUtc<fromUtc)return [];
  if(toUtc-fromUtc>400*86400)throw Error('Availability preview is limited to 400 days.');
  const result=[],zone=schedule.timeZone||'ET';
  for(const base of reminderWindows(schedule,eventAtUtc,options)){
    if(base.end<=fromUtc||base.start>toUtc)continue;
    if(base.row.availability?.enabled!==true){result.push(base);continue;}
    const first=Math.max(stamp(civil(fromUtc,zone).slice(0,3))-86400,stamp(civil(base.start,zone).slice(0,3))-86400),last=Math.min(stamp(civil(toUtc,zone).slice(0,3)),stamp(civil(base.end,zone).slice(0,3)));
    for(let day=first;day<=last;day+=86400){
      const d=civil(day,'UTC').slice(0,3),key=d.map((n,i)=>String(n).padStart(i?2:4,'0')).join('-'),a=availabilityForDate(schedule,base.row,key);
      if(!a.allowed)continue;
      const startMinute=a.startMinute,endMinute=a.endMinute,endDay=day+(endMinute<=startMinute||endMinute===1440?86400:0),ed=civil(endDay,'UTC').slice(0,3);
      const rawStart=utc([...d,Math.floor(startMinute/60),startMinute%60,0],zone,'FIRST'),rawEnd=utc([...ed,Math.floor((endMinute%1440)/60),endMinute%60,0],zone,'SECOND');
      if(rawStart===null||rawEnd===null)continue;
      const start=Math.max(base.start,rawStart),end=Math.min(base.end,rawEnd);
      if(end<=start||end<=fromUtc||start>toUtc)continue;
      result.push({...base,start,end,availabilityDate:key,availabilityWeekday:a.weekday,availabilitySource:a.source,hours:a.hours,rawStart,rawEnd,baseStart:base.start,baseEnd:base.end,clipStart:start>rawStart,clipEnd:end<rawEnd});
    }
  }
  return result.sort((a,b)=>a.start-b.start);
}
function availabilityCount(schedule,row,dateKey) {
  const stored=schedule.availabilityUsage?.[`${row.id}:${dateKey}`];
  if(stored!==undefined)return Math.max(0,+stored.count||0);
  const candidates=[row,...Object.entries(schedule.timelineUsage||{}).filter(([key])=>key.endsWith(':'+row.id)).map(([,usage])=>usage)];
  return candidates.some(usage=>['lastSentAt','peerAt'].some(key=>Number.isFinite(usage[key])&&civilDateKey(schedule,usage[key])===dateKey))?1:0;
}
export function availabilityStatus(schedule,row,eventAtUtc,nowUtc) {
  const single={...schedule,reminders:{1:row}},base=reminderWindows(single,eventAtUtc)[0],dateKey=civilDateKey(schedule,nowUtc),enabled=row.availability?.enabled===true,maxPerDay=enabled?row.availability.maxPerDay:undefined,count=availabilityCount(schedule,row,dateKey);
  const slices=base?effectiveReminderWindows(single,eventAtUtc,nowUtc,Math.min(base.end,nowUtc+400*86400)):[],window=slices.find(w=>w.start<=nowUtc&&w.end>nowUtc),nextWindow=slices.find(w=>w.end>nowUtc);
  let nextEligibleAt=null;
  for(const slice of slices){let candidate=Math.max(nowUtc,slice.start);for(let days=0;candidate<slice.end&&days<=401;days++){
    const key=civilDateKey(schedule,candidate);if(!maxPerDay||availabilityCount(schedule,row,key)<maxPerDay){nextEligibleAt=candidate;break;}
    const nextDay=civil(stamp(civil(candidate,schedule.timeZone||'ET').slice(0,3))+86400,'UTC').slice(0,3);candidate=utc([...nextDay,0,0,0],schedule.timeZone||'ET','FIRST');if(candidate===null)break;
  }if(nextEligibleAt!==null)break;}
  const status=!base||nowUtc>=base.end?'EXPIRED':nowUtc<base.start?'UPCOMING':maxPerDay&&count>=maxPerDay?'DAILY_LIMIT':window?'AVAILABLE':'OUTSIDE_HOURS';
  return {status,available:status==='AVAILABLE',eligible:status==='AVAILABLE',count,maxPerDay,remaining:maxPerDay===undefined?null:Math.max(0,maxPerDay-count),dateKey,window,nextWindow,nextEligibleAt};
}
function validateAvailabilityEdit(schedule,eventAtUtc,dateKey){
  const errors=validateTimelineForAddon(schedule);if(errors.length)throw Error(errors.join(' '));
  const conflicts=timelineConflicts(schedule,{dateKeys:[dateKey]});if(conflicts.length)throw Error('Availability hours overlap another reminder.');
}
export function editReminderAvailability(source,eventAtUtc,rowId,dateKey,scope,edge,deltaMinutes){
  if(!['DATE','WEEKDAY','ALL'].includes(scope)||!['move','start','finish'].includes(edge)||!Number.isInteger(deltaMinutes))throw Error('Invalid availability edit.');
  const schedule=cloneSavedData(source),row=values(schedule.reminders).find(r=>r.id===rowId);if(!row)throw Error('Choose a reminder.');
  const current=availabilityForDate(schedule,row,dateKey);if(!current.enabled||!current.allowed)throw Error('Choose an eligible availability day.');
  let start=current.startMinute,end=current.endMinute;if(end<start)end+=1440;
  if(edge==='move'){start+=deltaMinutes;end+=deltaMinutes;}else if(edge==='start')start+=deltaMinutes;else end+=deltaMinutes;
  if(start<0||start>=1440||end<=start||end>start+1440||end>2880)throw Error('Hours must open on the same date and last no more than 24 hours.');
  const hours={startMinute:start,endMinute:end>1440?end-1440:end};
  row.availability=normalizeReminderAvailability(row.availability);
  if(scope==='DATE'){row.availability.dateOverrides??={};row.availability.dateOverrides[dateKey]=hours;}
  else if(scope==='WEEKDAY'){row.availability.weekdayOverrides??={};setLuaValue(row.availability.weekdayOverrides,current.weekday,hours);}
  else Object.assign(row.availability,hours);
  validateAvailabilityEdit(schedule,eventAtUtc,dateKey);
  return {schedule,notice:scope==='ALL'?'Usual hours updated; date and weekday overrides remain.':scope==='DATE'?'Hours updated for this opening date.':'Hours updated for this weekday.'};
}
export function resetReminderAvailability(source,rowId,dateKey,scope){
  if(!['DATE','WEEKDAY'].includes(scope))throw Error('Choose a date or weekday override to reset.');
  const schedule=cloneSavedData(source),row=values(schedule.reminders).find(r=>r.id===rowId);if(!row)throw Error('Choose a reminder.');
  const current=availabilityForDate(schedule,row,dateKey);
  if(scope==='DATE')delete row.availability?.dateOverrides?.[dateKey];else if(row.availability?.weekdayOverrides)setLuaValue(row.availability.weekdayOverrides,current.weekday,undefined);
  validateAvailabilityEdit(schedule,scheduleEventUtc(schedule),dateKey);
  return {schedule,notice:scope==='DATE'?'Date override reset.':'Weekday override reset.'};
}
// Resolve with the same anchors as delivery; do not compare DAY/MARK text.
export function orderedReminderRows(schedule, eventAtUtc = scheduleEventUtc(schedule)) {
  const starts = new Map(reminderWindows(schedule,eventAtUtc,{uncapped:true}).map(w=>[w.row.id,w.start]));
  return values(schedule.reminders).slice().sort((a,b)=>(starts.get(a.id)??Infinity)-(starts.get(b.id)??Infinity));
}
export function timelineConflicts(schedule, options={}) {
  const anchor=scheduleEventUtc(schedule);
  if(!Number.isFinite(anchor))return [];
  // Only actual occurrences create windows; an explicit monthly anchor can be a date bound.
  const first=nextScheduleOccurrence(schedule,anchor);
  if(first===null)return [];
  const occurrences=projectedOccurrences(schedule,first,first+400*86400);
  let windows;
  if(!values(schedule.reminders).some(row=>row.availability?.enabled===true))windows=occurrences.flatMap(at=>reminderWindows(schedule,at));
  else {
    const bases=reminderWindows(schedule,first),ranges=new Map();
    const addRange=(from,to)=>ranges.set(`${from}:${to}`,[from,to]);
    for(const base of bases)addRange(base.start,Math.min(base.end,base.start+400*86400));
    for(const key of new Set([...values(schedule.reminders).flatMap(row=>Object.keys(row.availability?.dateOverrides||{})),...(options.dateKeys||[])])){
      const d=date(key);if(d)addRange(stamp(d)-2*86400,stamp(d)+3*86400);
    }
    const minOffset=Math.min(0,...bases.map(w=>w.start-first)),maxOffset=Math.max(0,...bases.map(w=>w.end-first)),unique=new Map();
    for(const [from,to]of ranges.values()){
      const candidates=nominalOccurrences(schedule,from-maxOffset,to-minOffset,true);
      for(const at of candidates){
        for(const window of effectiveReminderWindows(schedule,at,from,to))unique.set(`${at}:${window.row.id}:${window.start}:${window.end}`,window);
        const conflict=conflictsForWindows([...unique.values()],true);if(conflict.length)return conflict;
      }
    }
    windows=[...unique.values()];
  }
  return conflictsForWindows(windows);
}
function conflictsForWindows(windows, firstOnly=false) {
  windows.sort((a,b)=>a.start-b.start);
  const conflicts=[],seen=new Set();let active=[];
  for(const current of windows){
    active=active.filter(w=>w.row.once&&!w.row.onceUntilFinish?w.start>=current.start:w.end>current.start);
    for(const previous of active){
      // Fixed once notices are points; once-within-window periods retain their full range.
      const previousPoint=previous.row.once&&!previous.row.onceUntilFinish,currentPoint=current.row.once&&!current.row.onceUntilFinish;
      const overlaps=previousPoint?previous.start===current.start:previous.end>current.start;
      if(!overlaps)continue;
      const key=[previous.row.id,current.row.id].sort().join('|');
      if(seen.has(key))continue;seen.add(key);
      conflicts.push({first:previous.row,second:current.row,start:current.start,end:previousPoint||currentPoint?current.start:Math.min(previous.end,current.end)});
      if(firstOnly)return conflicts;
    }
    active.push(current);
  }
  return conflicts;
}
export function editDayTimeline(source,eventAtUtc,rowId,edge,deltaMinutes){
  if(source.timelineVersion!==1)throw Error('Convert this legacy schedule before dragging.');
  if(!['move','start','finish'].includes(edge)||!Number.isInteger(deltaMinutes)||!Number.isFinite(eventAtUtc))throw Error('Invalid timeline edit.');
  const schedule=cloneSavedData(source),zone=schedule.timeZone||'ET';let notice='';
  const formatClock=c=>`${String(c[3]%12||12).padStart(2,'0')}:${String(c[4]).padStart(2,'0')} ${c[3]>=12?'PM':'AM'}`;
  const foldAt=t=>utc(civil(t,zone),zone,'FIRST')===t?'FIRST':'SECOND';
  const shiftEvent=()=>{
    const old=civil(eventAtUtc,zone),next=civil(eventAtUtc+deltaMinutes*60,zone),base=civil(scheduleEventUtc(source),zone);
    const days=Math.round((stamp(next.slice(0,3))-stamp(old.slice(0,3)))/86400),newDate=civil(stamp(base.slice(0,3))+days*86400,'UTC');
    const cycle=(schedule.recurrence==='BIWEEKLY'?2:1)*(schedule.interval||schedule.recurrenceInterval||1);
    if(days&&['WEEKLY','BIWEEKLY'].includes(schedule.recurrence)&&cycle>1){
      const anchorWeekday=new Date(stamp(base.slice(0,3))*1000).getUTCDay(),anchorShift=Math.floor((anchorWeekday+days)/7);
      if(Object.entries(schedule.weekdays||{}).some(([key,value])=>value&&Math.floor((Number(key)-1+days)/7)!==anchorShift))throw Error('Moving across this week boundary would change the multi-week weekday pattern. Edit recurrence/weekday settings instead.');
    }
    if(schedule.recurrence==='MONTHLY_WEEKDAY'&&(schedule.monthlyWeek!==undefined||schedule.monthlyWeekday!==undefined))Object.assign(schedule,monthlyWeekdayRule(source));
    schedule.eventDate=`${newDate[0]}-${String(newDate[1]).padStart(2,'0')}-${String(newDate[2]).padStart(2,'0')}`;
    schedule.eventTime=formatClock(next);schedule.eventFold=foldAt(eventAtUtc+deltaMinutes*60);
    schedule.eventAtUtc=scheduleEventUtc(schedule);if(schedule.eventAtUtc===null)throw Error('This clock does not exist at the recurrence anchor.');
    const weekdays={};for(const [key,value] of Object.entries(schedule.weekdays||{}))if(value)setLuaValue(weekdays,((Number(key)-1+days)%7+7)%7+1,true);schedule.weekdays=weekdays;
    if(!projectedOccurrences(schedule,eventAtUtc+deltaMinutes*60-1,eventAtUtc+deltaMinutes*60+1).includes(eventAtUtc+deltaMinutes*60))throw Error('This move cannot preserve the selected occurrence with the current recurrence pattern. Edit recurrence settings instead.');
    notice='Event recurrence updated; minute-offset reminders follow it, fixed calendar clocks retain their clock time.';
  };
  if(rowId===null){
    if(edge==='move'||edge==='start')shiftEvent();
    if(edge!=='move'){
      if(!Number.isInteger(source.eventDurationMinutes))throw Error('Set an event duration before resizing.');
      schedule.eventDurationMinutes=source.eventDurationMinutes+(edge==='finish'?deltaMinutes:-deltaMinutes);
      if(schedule.eventDurationMinutes<0)throw Error('Event duration cannot be negative.');
    }
  }else{
    const row=values(schedule.reminders).find(r=>r.id===rowId),window=reminderWindows(source,eventAtUtc).find(w=>w.row.id===rowId);
    if(!row||!window)throw Error('This reminder has no editable window.');
    if(row.once&&!row.onceUntilFinish&&edge!=='move')throw Error('Move a one-time marker; its expiry is edited in settings.');
    const anchorAt=(original,t)=>{
      if(original?.kind==='DAY'){
        const c=civil(t,zone),event=civil(eventAtUtc,zone);
        return {kind:'DAY',days:Math.round((stamp(c.slice(0,3))-stamp(event.slice(0,3)))/86400),time:formatClock(c),fold:foldAt(t)};
      }
      if(original?.kind==='MARK')notice='Moved important-time edge is now an independent offset; the shared important time is unchanged.';
      return {kind:'OFFSET',minutes:Math.round((t-eventAtUtc)/60)};
    };
    if(edge==='move'||edge==='start')row.start=anchorAt(row.start,window.start+deltaMinutes*60);
    if((!row.once||row.onceUntilFinish)&&(edge==='move'||edge==='finish'))row.finish=anchorAt(row.finish,window.end+deltaMinutes*60);
    const nextWindow=reminderWindows(schedule,eventAtUtc).find(w=>w.row.id===rowId);
    if(!nextWindow)throw Error('Reminder start must be before its stop time and within event duration.');
    if(edge==='finish'&&nextWindow.end!==window.end+deltaMinutes*60)throw Error('Reminder stop cannot exceed event duration; change duration or the event-end exception first.');
    if(edge==='move'&&(!row.once||row.onceUntilFinish)&&nextWindow.end-nextWindow.start!==window.end-window.start)throw Error('Moving here would shorten the window at the event end.');
  }
  const errors=validateTimelineForAddon(schedule);if(errors.length)throw Error(errors.join(' '));
  const conflicts=timelineConflicts(schedule);if(conflicts.length)throw Error(`Overlapping periods: ${conflicts[0].first.label} and ${conflicts[0].second.label}.`);
  const sorted=orderedReminderRows(schedule);schedule.reminders={};sorted.forEach((row,i)=>setLuaValue(schedule.reminders,i+1,row));
  return {schedule,notice};
}
export function eventVariant(schedule, eventAtUtc) {
  const zone = schedule.timeZone || "ET";
  if (schedule.specialPattern === "EVENT_ROTATION") {
    const activities=values(schedule.rotationEvents), history=nominalHistory(schedule,eventAtUtc);
    const ordinal=history.filter(at=>at<eventAtUtc).length-postponements(schedule,eventAtUtc).count;
    return activities.length ? activities[Math.floor(Math.max(0,ordinal)/Math.max(1,+schedule.rotationEvery||1))%activities.length].id : 'ALL';
  }
  if (schedule.specialPattern === "FACTION_ROTATION") {
    const anchor = scheduleEventUtc(schedule);
    const days =
      (stamp(civil(eventAtUtc, zone).slice(0, 3)) -
        stamp(civil(anchor, zone).slice(0, 3))) /
      86400;
    const factions = values(
      schedule.rotationFactions || { 1: "AD", 2: "EP", 3: "DC" },
    ).filter((x) => ["AD", "EP", "DC"].includes(x));
    return factions.length
      ? factions[
          Math.floor(
            Math.floor(Math.max(0, days - postponements(schedule,eventAtUtc).days) / 7) /
              Math.max(1, +schedule.rotationWeeks || 4),
          ) % factions.length
        ]
      : "ALL";
  }
  if (schedule.specialPattern === "MONTH_FINAL") {
    const current = civil(eventAtUtc, zone),
      next = projectedOccurrences(
        schedule,
        eventAtUtc + 1,
        eventAtUtc + 400 * 86400,
      )[0];
    if (next === undefined) return "FINAL";
    const upcoming = civil(next, zone);
    return current[0] !== upcoming[0] || current[1] !== upcoming[1]
      ? "FINAL"
      : "REGULAR";
  }
  return "ALL";
}
export function messageVariant(schedule, messageId) {
  const v = schedule.messageVariants?.[messageId];
  if(schedule.specialPattern === "EVENT_ROTATION") return v === "ALL" || values(schedule.rotationEvents).some(a=>a.id===v) ? v : "ALL";
  if (schedule.specialPattern === "FACTION_ROTATION")
    return ["ALL", "AD", "EP", "DC"].includes(v) ? v : "ALL";
  if (schedule.specialPattern === "MONTH_FINAL")
    return ["ALL", "REGULAR", "FINAL"].includes(v) ? v : "REGULAR";
  return "ALL";
}
export function messagesForReminder(schedule, row, eventAtUtc, messages) {
  const selected = new Set(values(row.messageIds)),
    pool = values(messages).filter((m) => selected.has(m.id));
  let variant = eventVariant(schedule, eventAtUtc);
  if (
    schedule.specialPattern === "MONTH_FINAL" &&
    variant === "FINAL" &&
    !pool.some((m) => messageVariant(schedule, m.id) === "FINAL")
  )
    variant = "REGULAR";
  return pool.filter(
    (m) =>
      !schedule.specialPattern ||
      schedule.specialPattern === "NONE" ||
      messageVariant(schedule, m.id) === "ALL" ||
      messageVariant(schedule, m.id) === variant,
  );
}
export function simulateReminder(schedule, row, eventAtUtc, nowUtc) {
  const window = reminderWindows(
    { ...schedule, reminders: { 1: row } },
    eventAtUtc,
  )[0];
  if(schedule.paused)return {...window,status:"PAUSED"};
  if(schedule.enabled===false)return {...window,status:"DISABLED"};
  if(row.paused)return {...window,status:"PAUSED"};
  if(row.enabled===false)return {...window,status:"DISABLED"};
  if (!window) return { status: "EXPIRED" };
  const usage = schedule.timelineUsage?.[`${eventAtUtc}:${row.id}`] || {};
  const status =
    nowUtc < window.start
      ? "UPCOMING"
      : nowUtc >= window.end
        ? "EXPIRED"
        : row.once && usage.completed
          ? "COMPLETE"
          : Math.max(
                +usage.nextDueAt || 0,
                +usage.lastSentAt + (+row.intervalMinutes || 60) * 60 || 0,
              ) > nowUtc
            ? "COOLDOWN"
            : "READY";
  const availability=availabilityStatus(schedule,row,eventAtUtc,nowUtc);
  return { ...window, status:status==='READY'&&!availability.available?availability.status:status, usage, availability };
}
export function scheduleEventUtc(schedule) {
  const d = date(schedule.eventDate || schedule.startDate),
    t = clock(schedule.eventTime || schedule.startTime);
  if (d && t)
    return utc(
      [...d, ...t],
      schedule.timeZone || "ET",
      schedule.eventFold ?? schedule.startFold,
    );
  if (
    schedule.eventDate !== undefined ||
    schedule.eventTime !== undefined ||
    schedule.startDate !== undefined ||
    schedule.startTime !== undefined
  )
    return null;
  return schedule.eventAtUtc ?? schedule.startsAtUtc ?? null;
}
function legacyOccurrenceSchedule(schedule) {
  if (!schedule.timelineVersion && ["WINDOW", "REMINDER"].includes(schedule.mode)) {
    return { ...schedule, eventDate: schedule.startDate, eventTime: schedule.startTime, eventFold: schedule.startFold, eventAtUtc: schedule.startsAtUtc };
  }
  return schedule;
}
export function legacyTechnicalEventUtc(schedule) {
  return scheduleEventUtc(legacyOccurrenceSchedule(schedule));
}
export function rewriteLegacyEventTokens(text, offsetMinutes) {
  return String(text).replace(
    /%(eventtime|eventcountdown|eventwhen|eventdate)((?:[+-]\d+[mhd])?)%/gi,
    (whole, kind, tail) => {
      let minutes = offsetMinutes;
      for (const m of tail.matchAll(/([+-])(\d+)([mhd])/gi))
        minutes +=
          (m[1] === "-" ? -1 : 1) *
          Number(m[2]) *
          { m: 1, h: 60, d: 1440, w: 10080 }[m[3].toLowerCase()];
      return `%${kind}${minutes ? `${minutes < 0 ? "-" : "+"}${Math.abs(minutes) % 1440 === 0 ? Math.abs(minutes) / 1440 + "d" : Math.abs(minutes) % 60 === 0 ? Math.abs(minutes) / 60 + "h" : Math.abs(minutes) + "m"}` : ""}%`;
    },
  );
}
export function legacyToTimeline(
  schedule,
  messages,
  parentSchedule = schedule,
) {
  const parentAnchor = scheduleEventUtc(parentSchedule);
  let target = parentAnchor;
  const original = legacyTechnicalEventUtc(schedule),
    zone = schedule.timeZone || "ET";
  if (target === null || original === null)
    throw Error(
      "Choose valid actual event dates and clocks before conversion.",
    );
  if (schedule !== parentSchedule) {
    const cadence = (s) => {
      const rec = s.recurrence || "NONE",
        interval = s.recurrenceInterval ?? s.interval ?? 1;
      return rec === "BIWEEKLY"
        ? `WEEKLY:${interval * 2}`
        : `${rec}:${interval}`;
    };
    if (cadence(schedule) !== cadence(parentSchedule))
      throw Error(
        "Review incompatible source and parent recurrence cadences before combining.",
      );
    const rec = schedule.recurrence || "NONE",
      sd = date(legacyOccurrenceSchedule(schedule).eventDate || schedule.startDate),
      pd = date(parentSchedule.eventDate || parentSchedule.startDate);
    if (rec === "MONTHLY_DATE" && sd?.[2] !== pd?.[2])
      throw Error("Monthly source and parent must use the same calendar day.");
    if (
      rec === "MONTHLY_WEEKDAY" &&
      (monthlyWeekdayRule(legacyOccurrenceSchedule(schedule)).monthlyWeek !== monthlyWeekdayRule(parentSchedule).monthlyWeek ||
        monthlyWeekdayRule(legacyOccurrenceSchedule(schedule)).monthlyWeekday !== monthlyWeekdayRule(parentSchedule).monthlyWeekday)
    )
      throw Error(
        "Monthly source and parent must use the same ordinal weekday.",
      );
    if (
      Object.values(schedule.weekdays || {}).filter((v) => v === true).length >
        1 ||
      Object.values(parentSchedule.weekdays || {}).filter((v) => v === true)
        .length > 1
    )
      throw Error(
        "Choose one unambiguous weekday per source before combining.",
      );
  }
  if (
    schedule !== parentSchedule &&
    (schedule.specialPattern || "NONE") !== "NONE" &&
    (schedule.specialPattern || "NONE") !==
      (parentSchedule.specialPattern || "NONE")
  )
    throw Error(
      "Review incompatible source and parent special patterns before combining.",
    );
  if ((parentSchedule.timeZone || "ET") !== zone)
    throw Error(
      "Review matching source and parent timezones before combining reminders.",
    );
  let source = original;
  const monthly=['MONTHLY_DATE','MONTHLY_WEEKDAY'].includes(schedule.recurrence);
  if(monthly){
    const sourceSchedule=legacyOccurrenceSchedule(schedule),sd=civil(original,zone).slice(0,3),pd=civil(target,zone).slice(0,3),interval=schedule.recurrenceInterval??schedule.interval??1;
    if(((sd[0]-pd[0])*12+sd[1]-pd[1])%interval!==0)throw Error('Review incompatible source and parent monthly recurrence phases before combining.');
    const commonDate=stamp(sd)>stamp(pd)?sd:pd,from=utc([...commonDate,0,0,0],zone,'FIRST');
    target=nextScheduleOccurrence(parentSchedule,from,{includeCancelled:true});
    source=nextScheduleOccurrence(sourceSchedule,from,{includeCancelled:true});
    if(target===null||source===null||!equal(civil(target,zone).slice(0,3),civil(source,zone).slice(0,3)))throw Error('Choose an unambiguous matching monthly source occurrence.');
  }
  if (schedule !== parentSchedule && !monthly) {
    const recurrence = schedule.recurrence || "NONE";
    if (recurrence === "NONE") {
      if (Math.abs(source - target) > 14 * 86400)
        throw Error(
          "The source date cannot be aligned unambiguously with this event.",
        );
    } else {
      const candidates = projectedOccurrences(
        legacyOccurrenceSchedule(schedule),
        target - 200 * 86400,
        target + 200 * 86400,
      ).sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
      if (
        !candidates.length ||
        (candidates[1] &&
          Math.abs(candidates[0] - target) === Math.abs(candidates[1] - target))
      )
        throw Error("Choose an unambiguous matching source occurrence.");
      source = candidates[0];
    }
  }
  const sourceDate = civil(source, zone).slice(0, 3),
    targetDate = civil(target, zone).slice(0, 3),
    deltaDays = Math.round(
      (stamp(sourceDate) - stamp(civil(original, zone).slice(0, 3))) / 86400,
    ),
    offsetMinutes = Math.round((source - target) / 60);
  const shift = (field) => {
    const d = date(schedule[field + "Date"]),
      t = clock(schedule[field + "Time"]);
    if (d && t)
      return utc(
        [...civil(stamp(d) + deltaDays * 86400, "UTC").slice(0, 3), ...t],
        zone,
        schedule[field + "Fold"],
      );
    const raw = schedule[field === "start" ? "startsAtUtc" : "endsAtUtc"];
    if (Number.isFinite(raw)) {
      const c = civil(raw, zone);
      return utc(
        [
          ...civil(stamp(c.slice(0, 3)) + deltaDays * 86400, "UTC").slice(0, 3),
          ...c.slice(3),
        ],
        zone,
        schedule[field + "Fold"],
      );
    }
    return null;
  };
  const anchor = (value, elapsed = false) => {
    if (elapsed)
      return { kind: "OFFSET", minutes: Math.round((value - target) / 60) };
    const c = civil(value, zone);
    return {
      kind: "DAY",
      days: Math.round((stamp(c.slice(0, 3)) - stamp(targetDate)) / 86400),
      time: `${String(c[3] % 12 || 12).padStart(2, "0")}:${String(c[4]).padStart(2, "0")} ${c[3] >= 12 ? "PM" : "AM"}`,
    };
  };
  const result = cloneSavedData(schedule);
  result.legacyTimelineBackup = cloneSavedData(schedule);
  result.timelineVersion = 1;
  result.mode = "EVENT";
  result.reminders = {};
  result.importantTimes = cloneSavedData(schedule.importantTimes || {});
  result.messageVariants = cloneSavedData(schedule.messageVariants || {});
  result.legacyEventOffsetMinutes = offsetMinutes;
  if (
    schedule !== parentSchedule &&
    (schedule.specialPattern || "NONE") === "NONE"
  )
    for (const message of values(messages))
      result.messageVariants[message.id] = "ALL";
  for (const key of [
    "eventDate",
    "eventTime",
    "eventFold",
    "eventAtUtc",
    "timeZone",
  ])
    if (parentSchedule[key] !== undefined) result[key] = parentSchedule[key];
  // Matching occurrences align reminder offsets; the parent's original bound still defines recurrence and rotation phase.
  result.eventAtUtc = parentAnchor;
  const actual = civil(parentAnchor, zone);
  result.eventDate = parentSchedule.eventDate ?? `${actual[0]}-${String(actual[1]).padStart(2, "0")}-${String(actual[2]).padStart(2, "0")}`;
  result.eventTime = parentSchedule.eventTime ?? `${String(actual[3] % 12 || 12).padStart(2, "0")}:${String(actual[4]).padStart(2, "0")} ${actual[3] >= 12 ? "PM" : "AM"}`;
  result.eventFold = parentSchedule.eventFold ?? parentSchedule.startFold ?? 'FIRST';
  for(const key of ['recurrence','recurrenceInterval','interval','monthlyWeek','monthlyWeekday','weekdays','specialPattern','rotationWeeks','rotationFactions','rotationEvents','rotationEvery','occurrenceExceptions']){
    if(parentSchedule[key]!==undefined)result[key]=object(parentSchedule[key])?cloneSavedData(parentSchedule[key]):parentSchedule[key];
    else delete result[key];
  }
  result.promotionDays = 0;
  result.endDelayMinutes = Math.max(
    1,
    Number(parentSchedule.endDelayMinutes ?? 60),
  );
  if (schedule.timelineVersion === 1) {
    for (const mark of values(result.importantTimes))
      mark.offsetMinutes = (+mark.offsetMinutes || 0) + offsetMinutes;
    let index = 1;
    for (const row of values(schedule.reminders)) {
      const copy = cloneSavedData(row);
      for (const field of ["start", "finish"]) {
        const a = copy[field];
        if (a?.kind === "OFFSET") a.minutes += offsetMinutes;
        else if (a?.kind === "DAY")
          a.days += Math.round((stamp(sourceDate) - stamp(targetDate)) / 86400);
      }
      setLuaValue(result.reminders, index++, copy);
    }
    return mapLegacyTimelineUsage(schedule, result);
  }
  let start = shift("start"),
    finish = shift("end");
  const mode = schedule.mode || "EVENT";
  if (mode === "EVENT" && schedule.promotionDays !== undefined) {
    const day = civil(
        stamp(sourceDate) - (+schedule.promotionDays || 0) * 86400,
        "UTC",
      ).slice(0, 3),
      time =
        +schedule.promotionDays === 0
          ? [0, 0, 0]
          : civil(source, zone).slice(3);
    start = utc([...day, ...time], zone, schedule.eventFold);
    finish = source + Number(schedule.endDelayMinutes ?? 60) * 60;
  }
  if (mode === "REMINDER") {
    start = source;
    finish = source + 120;
  }
  if (start === null || finish === null || finish <= start)
    throw Error("The source reminder window cannot be resolved.");
  const midnight = utc([...sourceDate, 0, 0, 0], zone),
    soon = schedule.startingSoonEnabled
      ? source - (+schedule.startingSoonMinutes || 120) * 60
      : source;
  const ranges =
    mode === "EVENT"
      ? [
          ["BEFORE", "Before event day", start, Math.min(midnight, soon)],
          [
            "DAY",
            "On event day",
            Math.max(start, midnight),
            Math.min(soon, source),
          ],
          ...(schedule.startingSoonEnabled
            ? [["SOON", "Starting soon", Math.max(start, soon), source]]
            : []),
          ["LIVE", "After event starts", source, finish],
        ]
      : [
          [
            "ANY",
            mode === "REMINDER" ? "One-time reminder" : "While active",
            start,
            finish,
          ],
        ];
  let index = 1;
  for (const [phase, label, from, to] of ranges) {
    if (to <= from) continue;
    const elapsed = phase === "SOON" || phase === "LIVE",
      once = mode === "REMINDER" || schedule.phaseOnce?.[phase] === true,
      row = {
        id:
          globalThis.crypto?.randomUUID?.() || `legacy-${Date.now()}-${index}`,
        label,
        legacyPhase: phase,
        start: anchor(
          from,
          elapsed ||
            (mode === "EVENT" &&
              (from === source ||
                (schedule.startingSoonEnabled && from === soon))),
        ),
        finish: anchor(
          to,
          elapsed ||
            (mode === "EVENT" &&
              (to === source || (schedule.startingSoonEnabled && to === soon))),
        ),
        once,
        onceUntilFinish: once,
        intervalMinutes:
          schedule.phaseIntervals?.[phase] || schedule.intervalMinutes || 15,
        lateMinutes: Math.min(1440, Math.max(1, Math.ceil((to - from) / 60))),
        timeSensitive: false,
        messageIds: {},
      };
    let mi = 1;
    for (const message of values(messages)) {
      const assignments = schedule.messagePhases?.[message.id];
      if (!assignments || assignments.ANY || assignments[phase])
        setLuaValue(row.messageIds, mi++, message.id);
    }
    setLuaValue(result.reminders, index++, row);
  }
  if (!values(result.reminders).length)
    throw Error("No reminder periods were found to convert.");
  return mapLegacyTimelineUsage(schedule, result);
}
export function validateEventRotation(schedule = {}) {
  const errors=validateMonthlyWeekdayRule(schedule), activities=values(schedule.rotationEvents), ids=new Set();
  if(schedule.specialPattern!==undefined && !['NONE','MONTH_FINAL','FACTION_ROTATION','EVENT_ROTATION'].includes(schedule.specialPattern)) errors.push('Choose a valid special pattern.');
  if(schedule.specialPattern==='EVENT_ROTATION' && ((schedule.mode||'EVENT')!=='EVENT'||(schedule.recurrence||'NONE')==='NONE'))errors.push('Rotating events require a recurring EVENT schedule.');
  if((schedule.rotationEvents!==undefined && activities.length>0) || schedule.specialPattern==='EVENT_ROTATION') {
    const table=schedule.rotationEvents;
    if(!object(table)||Array.isArray(table)||Object.keys(table).some((key,i)=>key!==String(i+1)||!isLuaNumericKey(table,key)))errors.push('Rotating events must be a Lua sequence table.');
    if(activities.length<1||activities.length>50)errors.push('Choose between one and 50 rotating events.');
    for(const activity of activities){
      if(!object(activity)||typeof activity.id!=='string'||!activity.id.trim()||activity.id==='ALL'||ids.has(activity.id))errors.push('Rotating events need unique stable IDs other than ALL.');
      ids.add(activity?.id);
      if(typeof activity?.name!=='string'||!activity.name.trim()||[...activity.name].length>80)errors.push('Rotating event names must contain 1 to 80 characters.');
    }
  }
  if(schedule.rotationEvery!==undefined&&(!Number.isInteger(schedule.rotationEvery)||schedule.rotationEvery<1||schedule.rotationEvery>1000))errors.push('Rotate every must be a whole number from 1 to 1000.');
  if(schedule.specialPattern==='EVENT_ROTATION')for(const variant of values(schedule.messageVariants))if(variant!=='ALL'&&!ids.has(variant))errors.push('Message variant must reference a rotating event or ALL.');
  if(schedule.occurrenceExceptions!==undefined){
    if(!object(schedule.occurrenceExceptions)||Array.isArray(schedule.occurrenceExceptions))errors.push('Occurrence exceptions must be a date map.');
    else for(const [key,exception] of Object.entries(schedule.occurrenceExceptions))if(!date(key)||!object(exception)||Array.isArray(exception)||Object.keys(exception).some(k=>k!=='action')||!['KEEP','POSTPONE'].includes(exception.action))errors.push('Occurrence exceptions need actual dates and KEEP or POSTPONE actions.');
  }
  return [...new Set(errors)];
}
export function validateTimelineForAddon(schedule) {
  const errors = validateEventRotation(schedule);
  if (!schedule?.timelineVersion) return errors;
  const integer = (x, min, max) =>
    typeof x === "number" && Number.isInteger(x) && x >= min && x <= max;
  const sequence = (table, label) => {
    if (!object(table) || Array.isArray(table)) {
      errors.push(`${label} must be a Lua sequence table.`);
      return [];
    }
    const keys = Object.keys(table);
    if (keys.some((k, i) => String(i + 1) !== k || !isLuaNumericKey(table, k)))
      errors.push(`${label} must use consecutive numeric keys starting at 1.`);
    return values(table);
  };
  if (schedule.timelineVersion !== 1 || schedule.mode !== "EVENT")
    errors.push("Use event timeline version 1.");
  if (
    ![
      "NONE",
      "DAILY",
      "WEEKLY",
      "BIWEEKLY",
      "MONTHLY_DATE",
      "MONTHLY_WEEKDAY",
    ].includes(schedule.recurrence || "NONE") ||
    !integer(schedule.recurrenceInterval ?? 1, 1, 1000000)
  )
    errors.push("Choose a valid recurrence and positive whole interval.");
  if (!["ET", "CT", "MT", "PT"].includes(schedule.timeZone || "ET"))
    errors.push("Choose ET, CT, MT, or PT for the addon timezone.");
  if(schedule.eventDurationMinutes!==undefined && !integer(schedule.eventDurationMinutes,0,5256000))errors.push("Event duration must be zero or more whole minutes, or blank.");
  for(const flag of ["enabled","paused"])if(schedule[flag]!==undefined&&typeof schedule[flag]!=="boolean")errors.push("Event state flags must be boolean values.");
  const eventDate = date(schedule.eventDate);
  if (
    !eventDate ||
    eventDate[0] < 2007 ||
    eventDate[0] > 2099 ||
    !/^\d{1,2}:\d{2}\s+[AP]M$/i.test(schedule.eventTime || "")
  )
    errors.push(
      "Use an actual event date from 2007 to 2099 and an AM/PM clock.",
    );
  let event;
  try {
    event = scheduleEventUtc(schedule);
    if (event === null || !Number.isFinite(event))
      errors.push(
        "Choose a valid actual event date and time; daylight-saving gaps are unavailable.",
      );
  } catch {
    errors.push("Choose a supported timezone and actual event time.");
  }
  if(Number.isFinite(event) && schedule.recurrence==='MONTHLY_WEEKDAY') {
    // Validate real reminder clocks, including a cancelled first occurrence, rather than a phantom anchor date.
    const first=nextScheduleOccurrence(schedule,event,{includeCancelled:true});
    if(first!==null)event=first;
  }
  if (schedule.importantTimes !== undefined && !object(schedule.importantTimes))
    errors.push("Important times must be a table.");
  for (const [key, mark] of Object.entries(schedule.importantTimes || {}))
    if (
      !/^[a-z][a-z0-9_]*$/.test(key) ||
      !object(mark) ||
      !integer(mark.offsetMinutes, -5256000, 5256000)
    )
      errors.push(
        `Important time ${key}: use a lowercase name and whole offset minutes.`,
      );
  const rows = sequence(schedule.reminders, "Reminders"),
    ids = new Set();
  if (rows.length < 1 || rows.length > 100)
    errors.push("Choose between one and 100 reminders.");
  const anchor = (a, label) => {
    if (!object(a)) {
      errors.push(`${label}: choose an anchor.`);
      return;
    }
    if (a.kind === "OFFSET" && integer(a.minutes, -5256000, 5256000)) return;
    if (
      a.kind === "DAY" &&
      integer(a.days, -3650, 3650) &&
      /^\d{1,2}:\d{2} [AP]M$/.test(a.time) &&
      clock(a.time)
    )
      return;
    if (
      a.kind === "MARK" &&
      typeof a.name === "string" &&
      schedule.importantTimes?.[a.name]
    )
      return;
    errors.push(`${label}: invalid offset, day clock, or named time.`);
  };
  for (const [index, row] of rows.entries()) {
    const label = `Reminder ${index + 1}`;
    if (!object(row)) {
      errors.push(`${label}: invalid row.`);
      continue;
    }
    if (typeof row.id !== "string" || !row.id || ids.has(row.id))
      errors.push(`${label}: use a unique stable ID.`);
    ids.add(row.id);
    try{normalizeReminderAvailability(row.availability);}catch(error){errors.push(`${label}: ${error.message}`);}
    for(const flag of ["enabled","paused","allowAfterEventEnd"])if(row[flag]!==undefined&&typeof row[flag]!=="boolean")errors.push(`${label}: state flags must be boolean values.`);
    if (!integer(row.intervalMinutes ?? 60, 1, 5256000))
      errors.push(`${label}: interval must be a positive whole number.`);
    if (!integer(row.lateMinutes ?? 5, 1, 1440))
      errors.push(`${label}: lateness must be 1–1440 whole minutes.`);
    anchor(row.start, `${label} start`);
    if (!row.once || row.onceUntilFinish) anchor(row.finish, `${label} finish`);
    const messages = sequence(row.messageIds || {}, `${label} messages`);
    if (
      messages.some((x) => typeof x !== "string") ||
      new Set(messages).size !== messages.length
    )
      errors.push(`${label}: message IDs must be unique strings.`);
    if (Number.isFinite(event)) {
      try {
        const window = reminderWindows(
          { ...schedule, reminders: { 1: row } },
          event,
          {uncapped:true,includeCancelled:true},
        )[0];
        if (!window || window.end <= window.start)
          errors.push(
            `${label}: end must follow start and all server clocks must exist.`,
          );
      } catch {
        errors.push(`${label}: reminder time cannot be resolved.`);
      }
    }
  }
  return [...new Set(errors)];
}
export function mapLegacyTimelineUsage(source, target, settings = {}) {
  target.timelineUsage = target.timelineUsage || {};
  const offset = Number(target.legacyEventOffsetMinutes || 0) * 60,
    rows = values(target.reminders),
    mappedEvent = (t) => {
      const expected = t - offset;
      try {
        return (
          projectedOccurrences(
            target,
            expected - 2 * 86400,
            expected + 2 * 86400,
          ).sort(
            (a, b) => Math.abs(a - expected) - Math.abs(b - expected),
          )[0] ?? expected
        );
      } catch {
        return expected;
      }
    };
  const mergeUsage = (key, usage) => {
    const existing = target.timelineUsage[key] || {},
      next = { ...existing, ...usage };
    for (const field of ["lastSentAt", "nextDueAt", "peerAt"])
      if (Number.isFinite(existing[field]) || Number.isFinite(usage[field]))
        next[field] = Math.max(existing[field] || 0, usage[field] || 0);
    if (existing.completed || usage.completed) next.completed = true;
    target.timelineUsage[key] = next;
  };
  for (const [key, usage] of Object.entries(source.timelineUsage || {})) {
    const m = /^(\d+):(.*)$/.exec(key);
    if (m && rows.some((r) => r.id === m[2]))
      mergeUsage(`${mappedEvent(+m[1])}:${m[2]}`, cloneSavedData(usage));
  }
  for (const [key, completed] of Object.entries(
    source.completedOccurrences || {},
  )) {
    if (!completed) continue;
    const m = /^(\d+):(.*)$/.exec(key);
    if (!m) continue;
    for (const row of rows)
      if (
        row.once &&
        (row.legacyPhase === m[2] ||
          (source.mode === "REMINDER" && row.legacyPhase === "ANY"))
      )
        mergeUsage(`${mappedEvent(+m[1])}:${row.id}`, { completed: true });
  }
  const last = settings.lastUsedAt;
  if (source.timelineVersion !== 1 && Number.isFinite(last)) {
    let occurrences = [];
    try {
      occurrences = projectedOccurrences(
        target,
        last - 200 * 86400,
        last + 200 * 86400,
      );
    } catch {}
    for (const at of occurrences) {
      for (const window of reminderWindows(target, at)) {
        const row = window.row;
        if (last < window.start || last >= window.end) continue;
        const usage = {
          lastSentAt: last,
          nextDueAt: last + (row.intervalMinutes || 60) * 60,
        };
        if (row.once) usage.completed = true;
        if (
          Number.isFinite(source.nextDueAt) &&
          (!row.legacyPhase || source.nextDuePhase === row.legacyPhase)
        )
          usage.nextDueAt = Math.max(usage.nextDueAt, source.nextDueAt);
        for (const observed of values(settings.observedChatCooldowns)) {
          if (observed.at === last) {
            usage.peerAt = last;
            usage.nextDueAt = Math.max(
              usage.nextDueAt,
              last +
                (row.intervalMinutes || 60) * 60 +
                (observed.delaySeconds || 0),
            );
          }
        }
        mergeUsage(`${at}:${row.id}`, usage);
      }
    }
  }
  return target;
}
function refreshMigratedRuntime(data, base, latest, conflicts) {
  const child = (table, key, value) =>
    table?.[key] ??
    (value?.id ? values(table).find((x) => x?.id === value.id) : undefined);
  function visit(
    node,
    prior,
    current,
    path = [],
    latestAccount,
    currentSettings,
  ) {
    if (!object(node)) return;
    if (
      object(node.commandGuildSettings) &&
      object(current?.commandGuildSettings)
    )
      latestAccount = current;
    if (node.timelineVersion === 1 && object(node.legacyTimelineBackup)) {
      const apply = (source, settings, rows, offset = 0) => {
        if (!object(source) || !rows.length) return;
        const target = cloneSavedData(node);
        target.reminders = {};
        rows.forEach((row, index) =>
          setLuaValue(target.reminders, index + 1, cloneSavedData(row)),
        );
        target.legacyEventOffsetMinutes = offset;
        mapLegacyTimelineUsage(source, target, settings);
        node.timelineUsage = target.timelineUsage;
      };
      if (prior?.timelineVersion !== 1 && object(current))
        apply(
          current,
          currentSettings || {},
          values(node.reminders).filter((r) => !r.legacySourceCommandId),
          ["WINDOW", "REMINDER"].includes(node.legacyTimelineBackup.mode)
            ? (legacyTechnicalEventUtc(node.legacyTimelineBackup) - scheduleEventUtc(node)) / 60
            : 0,
        );
      const guild = path.at(-2);
      for (const [sourceId, backup] of Object.entries(
        node.legacyTimelineBackup.merged || {},
      )) {
        const settings =
            latestAccount?.commandGuildSettings?.[sourceId]?.[guild],
          source = settings?.schedule;
        const rows = values(node.reminders).filter(
          (r) => r.legacySourceCommandId === sourceId,
        );
        if (!source) {
          conflicts.push({
            path: [...path, "legacyTimelineBackup", "merged", sourceId].join(
              ".",
            ),
            base: backup.settings?.schedule,
            edited: "Migrated helper",
            latest: "Latest helper settings unavailable",
          });
          continue;
        }
        if (!rows.length) {
          if (
            !equal(
              source.timelineUsage,
              backup.settings?.schedule?.timelineUsage,
            ) ||
            !equal(
              source.completedOccurrences,
              backup.settings?.schedule?.completedOccurrences,
            ) ||
            settings.lastUsedAt !== backup.settings?.lastUsedAt
          )
            conflicts.push({
              path: [...path, "timelineUsage", sourceId].join("."),
              base: backup.settings,
              edited: "Missing helper row identity",
              latest: settings,
            });
          continue;
        }
        const mapped = cloneSavedData(source);
        if (source.timelineVersion === 1) {
          mapped.timelineUsage = {};
          for (const [key, usage] of Object.entries(
            source.timelineUsage || {},
          )) {
            const split = key.indexOf(":"),
              id = key.slice(split + 1),
              row = rows.find((r) => r.legacySourceRowId === id);
            if (row)
              mapped.timelineUsage[key.slice(0, split + 1) + row.id] =
                cloneSavedData(usage);
          }
        }
        let offset = backup.legacyEventOffsetMinutes;
        if (!Number.isFinite(offset)) {
          try {
            offset = legacyToTimeline(
              backup.settings.schedule,
              {},
              node,
            ).legacyEventOffsetMinutes;
          } catch {
            conflicts.push({
              path: [...path, "timelineUsage", sourceId].join("."),
              base: backup.settings?.schedule,
              edited: "Helper occurrence alignment",
              latest: source,
            });
            continue;
          }
        }
        apply(mapped, settings, rows, offset);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "legacyTimelineBackup" || key === "timelineUsage") continue;
      if (object(value)) {
        visit(
          value,
          child(prior, key, value),
          child(current, key, value),
          [...path, key],
          latestAccount,
          key === "schedule" ? current : undefined,
        );
      }
    }
  }
  visit(data, base, latest);
}
// These formats intentionally mirror the addon's event-token formatter.
export function formatEventCountdown(seconds) {
 if(seconds<0)return 'passed';if(seconds===0)return 'now';
 return formatDurationMinutes(Math.ceil(seconds/60));
}
function formatDurationMinutes(total){
 total=Math.max(0,total);if(total<5)return 'soon';
 const unit=total<30?1:total<60?5:total<120?10:total<720?15:total<1440?30:total<4320?60:total<10080?180:360;
 const rounded=Math.floor((total+unit/2)/unit)*unit;
 const days=Math.floor(rounded/1440),hours=Math.floor(rounded%1440/60),minutes=rounded%60;
 const parts=[];if(days)parts.push(days+'d');if(hours)parts.push(hours+'h');if(minutes)parts.push(minutes+'m');
 return (rounded!==total?'~':'')+(days?parts.slice(0,2):parts).join(' ');
}
export function previewMessage(text,schedule,eventAtUtc,nowUtc,context={}){
 const zone=schedule.timeZone||'ET',localHour=context.localHour??new Date(nowUtc*1000).getHours();
 const tod=localHour<12?'morning':localHour<18?'afternoon':'evening';
 const normal={time:tod,timeofday:tod,greeting:tod,guild:context.guild||'',zone:context.zone||''};
 const explicit=/%eventcountdown(?::[a-z][a-z0-9_]*|[+-]\d+[mhd])?%/i.test(text);let decorated=false;
 return String(text).replace(/%([a-z][a-z0-9_:+-]*)%/gi,(whole,raw)=>{
  const token=raw.toLowerCase();if(Object.hasOwn(normal,token)&&normal[token])return normal[token];
  const m=/^(eventwhen|eventtime|eventdate|eventcountdown|eventfaction|eventactivity)(?::([a-z][a-z0-9_]*)|([+-])(\d+)([mhd]))?$/.exec(token);
  if(!m)return whole;const kind=m[1];let offset=0;
  if(m[2]){const mark=schedule.importantTimes?.[m[2]];if(!mark||!Number.isFinite(mark.offsetMinutes)||(kind==='eventfaction'||kind==='eventactivity'))return whole;offset=mark.offsetMinutes*60;}
  if(m[3]){offset=Number(m[4])*{m:60,h:3600,d:86400}[m[5]]*(m[3]==='-'?-1:1);if((kind==='eventfaction'||kind==='eventactivity')||Math.abs(offset)>36500*86400)return whole;}
  if(kind==='eventactivity')return rotationActivityName(schedule,eventAtUtc)||whole;
  if(kind==='eventfaction')return {EP:'Ebonheart Pact',AD:'Aldmeri Dominion',DC:'Daggerfall Covenant'}[eventVariant(schedule,eventAtUtc)]||whole;
  const target=eventAtUtc+offset,part=civil(target,zone);if(kind==='eventcountdown')return formatEventCountdown(target-nowUtc);
  const dateText=String(part[1]).padStart(2,'0')+'/'+String(part[2]).padStart(2,'0')+'/'+part[0];
  if(kind==='eventdate')return dateText;
  if(kind==='eventwhen'){
   const current=civil(nowUtc,zone);const diff=(stamp(part.slice(0,3))-stamp(current.slice(0,3)))/86400;
   if(diff===0)return 'today';if(diff===1)return 'tomorrow';
   return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(stamp(part.slice(0,3))*1000).getUTCDay()]+' '+dateText;
  }
  const label=new Intl.DateTimeFormat('en-US',{timeZone:zones[zone]||zone,timeZoneName:'short'}).formatToParts(new Date(target*1000)).find(p=>p.type==='timeZoneName')?.value||zone;
  let result=String(part[3]%12||12).padStart(2,'0')+':'+String(part[4]).padStart(2,'0')+' '+(part[3]>=12?'PM':'AM')+' '+label;
  if(!explicit&&!decorated){result+=' ('+formatDurationMinutes(Math.floor((target-nowUtc)/60))+')';decorated=true;}
  return result;
 });
}

// Human-readable repeat intervals for schedule overview labels.
export function formatRepeatInterval(minutes) {
  const total = Number(minutes);
  if (!Number.isInteger(total) || total < 1) return "";
  const parts = [];
  let remaining = total;
  for (const [size, unit] of [[1440, "day"], [60, "hour"], [1, "minute"]]) {
    const count = Math.floor(remaining / size);
    remaining %= size;
    if (count) parts.push(`${count} ${unit}${count === 1 ? "" : "s"}`);
  }
  return parts.join(" ");
}
// Ordinary command previews mirror ApplyMessageSubstitutions/AnalyzeEmbeddedTime:
// keep literal date/time wording and decorate only the highest-ranked time core.
// Relative dates use UTC today, as the addon passes os.date("!*t") to its parser.
export function previewCommandMessage(text, nowUtc, context = {}) {
  const localHour=context.localHour??new Date(nowUtc*1000).getHours(),greeting=localHour<12?'morning':localHour<18?'afternoon':'evening';
  const basic={time:greeting,timeofday:greeting,greeting,morning:greeting,guild:String(context.guild??'').trim(),zone:context.zone||''};
  let source=String(text??'').replace(/%([a-z]+)%/gi,(whole,key)=>basic[key.toLowerCase()]||whole);
  if(!Number.isFinite(nowUtc)||/%eventcountdown(?::[a-z][a-z0-9_]*|[+-]\d+[mhd])?%/i.test(source))return source;
  const links=[];
  source=source.replace(/\|H[^]*?\|h[^]*?\|h/g,link=>{const key=`SCMPROTECTEDLINK${String.fromCharCode(65+links.length)}`;links.push({key,link});return key;});
  const result=decorateCommandTime(source,nowUtc);
  return links.reduce((text,{key,link})=>text.replace(key,link),result);
}
function decorateCommandTime(source,nowUtc){
  const digit=ch=>!!ch&&/[0-9]/.test(ch);
  const separator=ch=>!!ch&&(/[\s]/.test(ch)||(ch.charCodeAt(0)<128&&!/[a-z0-9]/i.test(ch)));
  const advance=(pos,max=Infinity)=>{let n=0;while(pos<source.length&&n<max&&separator(source[pos])){pos++;n++;}return pos;};
  const suffix=end=>{
    let pos=advance(end,8),ampm=null,ampmEnd=end;
    const dotted=/^(A\.M\.|P\.M\.)/i.exec(source.slice(pos)),plain=/^(AM|PM)/i.exec(source.slice(pos));
    if(dotted||plain){const m=dotted||plain;ampm=m[0][0].toUpperCase()+'M';ampmEnd=pos+m[0].length;}
    pos=advance(ampmEnd,12);const tz=/^[a-z]{1,4}/i.exec(source.slice(pos));
    return {ampm,ampmEnd,timezone:tz?.[0].toUpperCase(),end:tz?pos+tz[0].length:ampmEnd};
  };
  const families={ET:'ET',EST:'ET',EDT:'ET',CT:'CT',CST:'CT',CDT:'CT',MT:'MT',MST:'MT',MDT:'MT',PT:'PT',PST:'PT',PDT:'PT'},supported=tz=>tz==='UTC'||tz==='GMT'||Object.hasOwn(families,tz||'');
  const candidates=[];
  const add=(start,end,hour,minute,kind)=>{
    if(digit(source[start-1])||digit(source[end])||minute>59)return;
    const before=source[start-1]||'',after=source[end]||'';
    if(/[/-]/.test(before)||/[/-]/.test(after)||before==='.'&&digit(source[start-2])||after==='.'&&digit(source[end+1]))return;
    const tail=suffix(end);
    if(kind!=='colon'&&!tail.ampm&&!supported(tail.timezone))return;
    candidates.push({start,end,hour,minute,kind,tail});
  };
  for(let i=0;i<source.length;i++){
    if(!digit(source[i]))continue;
    let hourEnd=i+1;if(digit(source[hourEnd]))hourEnd++;
    let pos=hourEnd;
    while(pos<source.length&&separator(source[pos])&&source[pos]!==':')pos++;
    if(source[pos]===':'){
      pos=advance(pos+1);if(digit(source[pos])&&digit(source[pos+1]))add(i,pos+2,+source.slice(i,hourEnd),+source.slice(pos,pos+2),'colon');
    }
    for(const count of [4,3])if(source.slice(i,i+count).length===count&&/^\d+$/.test(source.slice(i,i+count)))add(i,i+count,+source.slice(i,i+count-2),+source.slice(i+count-2,i+count),count===4?'compact4':'compact3');
    add(i,hourEnd,+source.slice(i,hourEnd),0,'hour');
  }
  const score={colon:100,compact4:60,compact3:40,hour:10};
  candidates.sort((a,b)=>score[b.kind]-score[a.kind]||(b.end-b.start)-(a.end-a.start)||a.start-b.start);
  const core=candidates[0];if(!core||core.hour<(core.tail.ampm?1:0)||core.hour>(core.tail.ampm?12:23)||!supported(core.tail.timezone))return source;
  const now=civil(nowUtc,'UTC'),today=stamp(now.slice(0,3));
  let explicitDate=null;
  for(const m of source.matchAll(/(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{4}|\d{2}))?/g)){
    const month=+m[1],day=+m[2],hasYear=m[3]!==undefined;
    let year=hasYear?(m[3].length===2?(+m[3]<=69?2000:1900)+ +m[3]:+m[3]):now[0];
    if(!date(`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`))continue;
    const past=stamp([year,month,day])<today;
    if(!hasYear&&past)year++;
    explicitDate={year,month,day,hasYear,past:hasYear&&past};break;
  }
  const weekdays=[['sunday','sun'],['monday','mon'],['tuesday','tues','tue'],['wednesday','wed'],['thursday','thurs','thur','thu'],['friday','fri'],['saturday','sat']];
  let weekday=null;
  for(const [index,names]of weekdays.entries())for(const name of names){const pattern=new RegExp(`(^|[^a-z])(${name})(?=$|[^a-z])`,'gi');for(const match of source.matchAll(pattern)){const start=match.index+match[1].length;if(!weekday||start<weekday.start||start===weekday.start&&name.length>weekday.length)weekday={index,start,length:name.length};}}
  const tomorrowMatch=/\btomorrow\b/i.exec(source),tomorrow=!!tomorrowMatch;
  const zone=families[core.tail.timezone];
  const build=(d,hour)=>{
    const provisional=stamp([...d,hour,core.minute,0]);
    // Native resolves the family offset at the provisional UTC time, then
    // applies fixed 24h/7d rollover. Keep that behavior at DST boundaries.
    const offset=zone?stamp(civil(provisional,zone))-provisional:0;
    return provisional-offset;
  };
  const timing=hour=>{
    if(explicitDate&&!explicitDate.past)return build([explicitDate.year,explicitDate.month,explicitDate.day],hour);
    if(tomorrow)return build(civil(today+86400,'UTC').slice(0,3),hour);
    if(weekday){const offset=(weekday.index-new Date(today*1000).getUTCDay()+7)%7;let at=build(civil(today+offset*86400,'UTC').slice(0,3),hour);if(offset===0&&at<=nowUtc)at+=7*86400;return at;}
    let at=build(now.slice(0,3),hour);if(at<nowUtc)at+=86400;return at;
  };
  const ampm=core.tail.ampm,ambiguous=!ampm&&core.hour<=12;
  const hour12=(hour,meridiem)=>hour%12+(meridiem==='PM'?12:0);
  const hours=ampm?[hour12(core.hour,ampm)]:ambiguous?[hour12(core.hour,'AM'),hour12(core.hour,'PM')]:[core.hour];
  const choose=()=>hours.map((hour,index)=>({hour,index,at:timing(hour)})).sort((a,b)=>Math.floor((a.at-nowUtc)/60)-Math.floor((b.at-nowUtc)/60)||a.index-b.index)[0];
  let resolved=choose();
  if(explicitDate&&!explicitDate.hasYear&&!explicitDate.past&&stamp([explicitDate.year,explicitDate.month,explicitDate.day])===today&&resolved.at<nowUtc){explicitDate.year++;resolved=choose();}
  if(explicitDate?.past||explicitDate?.hasYear&&resolved.at<nowUtc)return source;
  let end=core.tail.end;
  // InsertCountdownPreservingTemplate optionally consumes one additional
  // literal AM/PM or supported timezone immediately following the parser span.
  const extraMeridiem=/^\s*[AP]\.?\s*M\.?/i.exec(source.slice(end));if(extraMeridiem)end+=extraMeridiem[0].length;
  const extraZone=/^\s*(UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|ET|CT|MT|PT)(?![a-z])/i.exec(source.slice(end));if(extraZone)end+=extraZone[0].length;
  const literal=source.slice(core.start,end),assumed=ambiguous&&!/[AP]\.?\s*M\.?/i.test(literal)?' '+(resolved.hour>=12?'PM':'AM'):'';
  // The native preserving-template helper detects an already-displayed zone
  // case-sensitively and requires whitespace before it. Preserve that detail.
  const displayed=/\s+(UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|ET|CT|MT|PT)\s*$/.exec(literal);
  const canonical=zone?new Intl.DateTimeFormat('en-US',{timeZone:zones[zone],timeZoneName:'short'}).formatToParts(new Date(resolved.at*1000)).find(p=>p.type==='timeZoneName').value:core.tail.timezone;
  const zoneSuffix=displayed?.[1]||extraZone?.[0].trim()||canonical;
  let remainder=source.slice(end);
  const duplicate=new RegExp(`^(\\s*)${zoneSuffix}(?![a-z])`,'i').exec(remainder);if(duplicate)remainder=duplicate[1]+remainder.slice(duplicate[0].length);
  return source.slice(0,core.start)+literal+assumed+(!displayed&&!extraZone?' '+canonical:'')+' ('+formatDurationMinutes(Math.floor((resolved.at-nowUtc)/60))+')'+remainder;
}
