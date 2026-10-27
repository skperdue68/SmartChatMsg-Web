import { isReservedCommandName, validateTimelineForAddon, cloneSavedData, events, timelineConflicts, orderedReminderRows, orderedMessageEntries, guildNames, guildIndexFromRoster, guildKey, monthlyWeekdayRule, normalizeReminderAvailability } from "/model.js";
import { setLuaValue } from "/lua-data.js";
const values = (x) => Object.values(x || {});
const scheduleKeys = [
  "timelineVersion",
  "mode",
  "eventDate",
  "eventTime",
  "timeZone",
  "recurrence",
  "recurrenceInterval",
  "monthlyWeek",
  "monthlyWeekday",
  "specialPattern",
  "rotationWeeks",
  "rotationEvents",
  "rotationEvery",
  "occurrenceExceptions",
  "rotationFactions",
  "eventFold",
  "eventDurationMinutes",
  "dailyLimitShared",
  "sharedDailyLimit",
  "importantTimes",
  "reminders",
  "messageVariants",
  "weekdays",
  "enabled",
  "paused",
];
function array(items) {
  const o = {};
  items.forEach((v, i) => setLuaValue(o, i + 1, v));
  return o;
}
function object(x, label) {
  if (!x || typeof x !== "object" || Array.isArray(x))
    throw Error(`${label} must be an object.`);
  return x;
}
function exact(x, keys, label) {
  object(x, label);
  for (const key of Object.keys(x))
    if (!keys.includes(key)) throw Error(`Unknown ${label} field: ${key}`);
}
function text(x, label, max = 500) {
  if (typeof x !== "string" || !x.trim() || x.length > max)
    throw Error(`Invalid ${label}.`);
  return x;
}
function num(x, label, min, max) {
  if (!Number.isFinite(x) || !Number.isInteger(x) || x < min || x > max)
    throw Error(`Invalid ${label}.`);
  return x;
}
function anchor(x, marks) {
  exact(x, ["kind", "minutes", "days", "time", "name", "fold"], "anchor");
  if (x.kind === "OFFSET")
    return {
      kind: "OFFSET",
      minutes: num(x.minutes, "anchor minutes", -5256000, 5256000),
    };
  if (x.kind === "DAY") {
    if (!/^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(x.time) || !validClock(x.time))
      throw Error("Invalid day anchor clock.");
    return {
      kind: "DAY",
      days: num(x.days, "anchor days", -3650, 3650),
      time: x.time,
      ...(x.fold
        ? {
            fold: x.fold,
          }
        : {}),
    };
  }
  if (x.kind === "MARK" && Object.hasOwn(marks, x.name))
    return {
      kind: "MARK",
      name: x.name,
    };
  throw Error("Invalid reminder anchor or missing important time.");
}
function validClock(x) {
  const m = /^(\d{1,2}):(\d{2})\s?(AM|PM)$/i.exec(x);
  return m && +m[1] >= 1 && +m[1] <= 12 && +m[2] < 60;
}
function messageMetadata(message,index){
  const result={};
  if(message.name!==undefined){if(typeof message.name!=='string'||message.name.length>60)throw Error('Message name must be at most 60 characters.');if(message.name.trim())result.name=message.name.trim();}
  if(message.displayOrder!==undefined)result.displayOrder=num(message.displayOrder,'message display order',1,1000000);
  else if(index!==undefined)result.displayOrder=index+1;
  return result;
}
export function portableEvent(event, messages) {
  if(isReservedCommandName(event.command.name))throw Error('That command name is reserved for SmartChatMsg.');
  const schedule = {};
  for (const key of scheduleKeys)
    if (event.schedule[key] !== undefined) schedule[key] = event.schedule[key];
  const unlocked = orderedMessageEntries(messages.filter((m) => m.locked !== true)),
    ids = new Set(unlocked.map((m) => m.id));
  schedule.reminders = array(
    values(schedule.reminders).map((row) => ({
      id: row.id,
      label: row.label,
      start: row.start,
      finish: row.finish || row.start,
      once: !!row.once,
      ...(row.onceUntilFinish
        ? {
            onceUntilFinish: true,
          }
        : {}),
      lateMinutes: row.lateMinutes ?? 5,
      intervalMinutes: row.intervalMinutes ?? 60,
      timeSensitive: !!row.timeSensitive,
      enabled:row.enabled!==false,paused:row.paused===true,allowAfterEventEnd:row.allowAfterEventEnd===true,
      ...(row.availability!==undefined?{availability:normalizeReminderAvailability(row.availability)}:{}),
      messageIds: array(values(row.messageIds).filter((id) => ids.has(id))),
    })),
  );
  schedule.messageVariants = Object.fromEntries(
    Object.entries(schedule.messageVariants || {}).filter(([id]) =>
      ids.has(id),
    ),
  );
  return {
    format: "SmartChatMsgTimeline",
    version: 1,
    eventName: event.command.name,
    guild: event.guild,
    schedule,
    messages: unlocked.map((m,index) => ({
      ...messageMetadata(m,index),
      id: m.id,
      text: m.text,
      variant: schedule.messageVariants[m.id] || "ALL",
    })),
  };
}
export function validatePortable(p) {
  exact(
    p,
    ["format", "version", "eventName", "guild", "schedule", "messages"],
    "portable document",
  );
  if (p.format !== "SmartChatMsgTimeline" || p.version !== 1)
    throw Error("Unsupported portable timeline.");
  text(p.eventName, "event name");
  if(isReservedCommandName(p.eventName))throw Error('That command name is reserved for SmartChatMsg.');
  text(p.guild, "guild");
  exact(p.schedule, scheduleKeys, "schedule");
  const s = p.schedule;
  if (s.timelineVersion !== 1 || s.mode !== "EVENT")
    throw Error("Only timeline events can be imported.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s.eventDate) ||
    !Number.isFinite(Date.parse(s.eventDate)) ||
    new Date(s.eventDate).toISOString().slice(0, 10) !== s.eventDate ||
    !validClock(s.eventTime)
  )
    throw Error("Invalid actual event date or clock.");
  if (!["ET", "CT", "MT", "PT"].includes(s.timeZone))
    throw Error("Unsupported timezone.");
  if (
    ![
      "NONE",
      "DAILY",
      "WEEKLY",
      "BIWEEKLY",
      "MONTHLY_DATE",
      "MONTHLY_WEEKDAY",
    ].includes(s.recurrence)
  )
    throw Error("Unsupported recurrence.");
  if (
    !["NONE", "MONTH_FINAL", "FACTION_ROTATION", "EVENT_ROTATION"].includes(
      s.specialPattern || "NONE",
    )
  )
    throw Error("Unsupported special pattern.");
  if (s.recurrenceInterval !== undefined)
    num(s.recurrenceInterval, "recurrence interval", 1, 999);
  if(s.rotationEvents!==undefined){
    object(s.rotationEvents,'rotating events');
    if(Object.keys(s.rotationEvents).some((key,i)=>key!==String(i+1)))throw Error('Rotating events must use consecutive keys.');
    for(const activity of values(s.rotationEvents))exact(activity,['id','name'],'rotating event');
  }
  if (s.rotationWeeks !== undefined)
    num(s.rotationWeeks, "rotation weeks", 1, 999);
  if (
    s.rotationFactions &&
    values(s.rotationFactions).some((f) => !["AD", "EP", "DC"].includes(f))
  )
    throw Error("Invalid faction order.");
  if (!Array.isArray(p.messages) || p.messages.length > 10000)
    throw Error("Invalid message collection.");
  const ids = new Set();
  for (const m of p.messages) {
    exact(m, ["id", "text", "variant", "name", "displayOrder"], "message");
    messageMetadata(m);
    text(m.id, "message ID");
    text(m.text, "message text", 100000);
    if (ids.has(m.id)) throw Error("Duplicate message ID.");
    ids.add(m.id);
    if (!(s.specialPattern === "EVENT_ROTATION" ? ["ALL",...values(s.rotationEvents).map(a=>a.id)] : ["ALL", "REGULAR", "FINAL", "AD", "EP", "DC"]).includes(m.variant))
      throw Error("Invalid message variant.");
  }
  const marks = Object.create(null);
  for (const [id, m] of Object.entries(s.importantTimes || {})) {
    text(id, "important time ID");
    exact(m, ["label", "offsetMinutes"], "important time");
    marks[id] = {
      label: text(m.label, "important time label"),
      offsetMinutes: num(
        m.offsetMinutes,
        "important time offset",
        -5256000,
        5256000,
      ),
    };
  }
  if (
    (s.enabled !== undefined && typeof s.enabled !== "boolean") ||
    (s.paused !== undefined && typeof s.paused !== "boolean")
  )
    throw Error("Invalid schedule flags.");
  if (
    s.eventFold &&
    ![
      "FIRST",
      "SECOND",
      "EDT",
      "EST",
      "CDT",
      "CST",
      "MDT",
      "MST",
      "PDT",
      "PST",
    ].includes(s.eventFold)
  )
    throw Error("Invalid DST fold.");
  for (const [k, v] of Object.entries(s.weekdays || {}))
    if (!/^[1-7]$/.test(k) || typeof v !== "boolean")
      throw Error("Invalid weekdays.");
  const rowIds = new Set(),
    rows = [];
  for (const r of values(s.reminders)) {
    exact(
      r,
      [
        "id",
        "label",
        "start",
        "finish",
        "once",
        "onceUntilFinish",
        "lateMinutes",
        "intervalMinutes",
        "timeSensitive", "enabled", "paused", "allowAfterEventEnd",
        "messageIds", "availability",
      ],
      "reminder",
    );
    text(r.id, "reminder ID");
    if (rowIds.has(r.id)) throw Error("Duplicate reminder ID.");
    rowIds.add(r.id);
    if (
      ["enabled","paused","allowAfterEventEnd"].some(key=>r[key]!==undefined&&typeof r[key]!=="boolean") ||
      typeof r.once !== "boolean" ||
      typeof r.timeSensitive !== "boolean" ||
      (r.onceUntilFinish !== undefined &&
        typeof r.onceUntilFinish !== "boolean")
    )
      throw Error("Invalid reminder delivery flags.");
    const pool = values(r.messageIds);
    if (pool.some((id) => !ids.has(id)))
      throw Error("Reminder references a missing or private message.");
    rows.push({
      id: r.id,
      label: text(r.label, "reminder label"),
      start: anchor(r.start, marks),
      finish: anchor(r.finish || r.start, marks),
      once: r.once,
      ...(r.onceUntilFinish
        ? {
            onceUntilFinish: true,
          }
        : {}),
      lateMinutes: num(r.lateMinutes, "late allowance", 1, 1440),
      intervalMinutes: num(r.intervalMinutes, "reminder interval", 1, 525600),
      timeSensitive: r.timeSensitive,
      enabled:r.enabled!==false,paused:r.paused===true,allowAfterEventEnd:r.allowAfterEventEnd===true,
      ...(r.availability!==undefined?{availability:normalizeReminderAvailability(r.availability)}:{}),
      messageIds: array(pool),
    });
  }
  const result = {};
  for (const key of scheduleKeys)
    if (s[key] !== undefined) result[key] = s[key];
  result.weekdays = {};
  for (const [key, value] of Object.entries(s.weekdays || {}))
    setLuaValue(result.weekdays, Number(key), value);
  if (s.rotationFactions)
    result.rotationFactions = array(values(s.rotationFactions));
  if(s.rotationEvents)result.rotationEvents=array(values(s.rotationEvents));
  result.importantTimes = marks;
  result.reminders = array(rows);
  const errors = validateTimelineForAddon(result);
  if (errors.length) throw Error(errors.join(" "));
  return {
    ...p,
    schedule: result,
  };
}
function matchingReminderRows(rows,incoming){
  const exact=rows.filter(row=>row.id===incoming.id);
  return exact.length?exact:rows.filter(row=>row.label===incoming.label&&JSON.stringify(row.start)===JSON.stringify(incoming.start)&&JSON.stringify(row.finish)===JSON.stringify(incoming.finish)&&row.once===incoming.once);
}
export function stageImport(p, event, existingMessages, guild) {
  p = validatePortable(p);
  p={...p,schedule:cloneSavedData(p.schedule),messages:p.messages.map(m=>({...m}))};
  const prior=event.schedule||{},localMessages=event.messages||values(existingMessages).filter(m=>m.commandId===event.commandId&&normalized(m.guildName)===normalized(guild));
  reconcileRotationActivities(p,prior,localMessages);
  const locked=localMessages.filter(m=>m.locked),lockedIds=new Set(locked.map(m=>m.id));
  const ids = new Map(),
    newMessages = [],
    guildIndex = event.deliveryGuildIndex??values(existingMessages).find(
      (m) =>
        m.guildName?.trim().toLowerCase() === guild &&
        Number.isInteger(m.guildIndex),
    )?.guildIndex??event.guildIndex;
  for (const [index,m] of p.messages.entries()) {
    const id = crypto.randomUUID();
    ids.set(m.id, id);
    newMessages.push({
      id,
      commandId: event.commandId,
      guildName: guild,
      ...(guildIndex
        ? {
            guildIndex,
          }
        : {}),
      text: m.text,
      ...messageMetadata(m,index),
      useCount: 0,
    });
  }
  const s = p.schedule;
  if(s.recurrence==='MONTHLY_WEEKDAY')Object.assign(s,monthlyWeekdayRule(s));
  const rowIds=new Set();
  for (const r of values(s.reminders)) {
    const matches=matchingReminderRows(values(prior.reminders),r);
    const privateIds=matches.length===1?values(matches[0].messageIds).filter(id=>lockedIds.has(id)):[];
    r.id = matches.length===1&&!rowIds.has(matches[0].id)?matches[0].id:crypto.randomUUID();
    rowIds.add(r.id);
    r.messageIds = array([...new Set([...values(r.messageIds).map((id) => ids.get(id)),...privateIds])]);
  }
  s.messageVariants = Object.fromEntries([
    ...locked.map(m=>[m.id,prior.messageVariants?.[m.id]||'ALL']),
    ...p.messages.map((m) => [ids.get(m.id), m.variant]),
  ]);
  if(prior.occurrenceExceptions && s.occurrenceExceptions===undefined)s.occurrenceExceptions={};
  return {
    schedule: s,
    messages: newMessages,
  };
}

const commandKeys=['runAt','reminderMinutes','reminderRetryMinutes','autoPopulateCooldownMinutes','autoPopulateOnZone','openStatusPanelOnRun','populateSound','disabledMessageIds'];
const normalized=value=>String(value||'').trim().toLowerCase();
function commandConfig(source={}){
  const result={};
  for(const key of commandKeys)if(source[key]!==undefined){
    const v=source[key];
    if(key==='disabledMessageIds'){
      object(v,'disabled message pool');
      const disabled={};for(const [id,flag]of Object.entries(v)){text(id,'disabled message ID');if(typeof flag!=='boolean')throw Error('Disabled message pool flags must be boolean.');if(flag)disabled[id]=true;}
      if(Object.keys(disabled).length)result[key]=disabled;
      continue;
    }
    if(key==='runAt'&&!['SCHEDULED','ON_DEMAND','STARTUP'].includes(v))throw Error('Invalid Run at setting.');
    if(key==='populateSound'&&(typeof v!=='string'||v.length>200))throw Error('Invalid notification sound.');
    if(['autoPopulateOnZone','openStatusPanelOnRun'].includes(key)&&typeof v!=='boolean')throw Error('Invalid command option.');
    if(key.endsWith('Minutes'))num(v,key,0,5256000);
    result[key]=v;
  }
  return result;
}
export function exportEventBundle(account,guild,selectedIds){
  const chosen=new Set(selectedIds),items=[];
  for(const event of events(account).filter(e=>(guild===null||normalized(e.guild)===normalized(guild))&&(chosen.has(e.commandId)||chosen.has(e.commandId+'|'+normalized(e.guild)))&&!e.schedule.mergedInto)){
    if(event.command.locked)continue;
    if(isReservedCommandName(event.command.name))throw Error('That command name is reserved for SmartChatMsg.');
    const messages=event.messages.filter(m=>!m.locked);
    const settings=commandConfig(event.settings),scheduled=settings.runAt==='SCHEDULED';
    if(settings.disabledMessageIds){const sharedIds=new Set(messages.map(message=>message.id));settings.disabledMessageIds=Object.fromEntries(Object.entries(settings.disabledMessageIds).filter(([id])=>sharedIds.has(id)));if(!Object.keys(settings.disabledMessageIds).length)delete settings.disabledMessageIds;}
    if(scheduled&&event.schedule.timelineVersion!==1)throw Error('Unsupported schedule format: '+event.command.name);
    const portable=scheduled?portableEvent(event,messages):null;
    items.push({eventName:event.command.name,guild:event.guild,settings,outputChannel:account.chatChannels?.[event.commandId]?.[event.guild]||'Guild',schedule:portable?.schedule||null,messages:portable?.messages||orderedMessageEntries(messages).map((m,index)=>({id:m.id,text:m.text,variant:'ALL',...messageMetadata(m,index)}))});
  }
  if(!items.length)throw Error('Select at least one exportable event.');
  return {format:'SmartChatMsgEvents',version:1,items};
}
export function readEventBundle(document){
  if(document?.format==='SmartChatMsgTimeline'){
    const p=validatePortable(document);
    document={format:'SmartChatMsgEvents',version:1,items:[{eventName:p.eventName,guild:p.guild,settings:{runAt:'SCHEDULED'},schedule:p.schedule,messages:p.messages}]};
  }
  exact(document,['format','version','items'],'event bundle');
  if(document.format!=='SmartChatMsgEvents'||document.version!==1||!Array.isArray(document.items)||document.items.length<1||document.items.length>1000)throw Error('Choose a SmartChatMsg event export.');
  const seen=new Set();
  return {format:document.format,version:1,items:document.items.map(item=>{
    exact(item,['eventName','guild','settings','outputChannel','schedule','messages'],'event');
    text(item.eventName,'event name',200);text(item.guild,'guild name',200);if(isReservedCommandName(item.eventName))throw Error('That command name is reserved for SmartChatMsg.');
    const key=normalized(item.guild)+'|'+normalized(item.eventName);if(seen.has(key))throw Error('Duplicate guild/event name in import: '+item.eventName);seen.add(key);
    exact(item.settings,commandKeys,'command settings');const settings=commandConfig(item.settings);
    if(item.outputChannel!==undefined&&!['Guild','Officer','Zone','Group'].includes(item.outputChannel))throw Error('Invalid output channel.');
    let schedule=null,messages=item.messages;
    if(settings.runAt==='SCHEDULED'){
      const p=validatePortable({format:'SmartChatMsgTimeline',version:1,eventName:item.eventName,guild:item.guild,schedule:item.schedule,messages:item.messages});schedule=p.schedule;
    }else{
      if(!['ON_DEMAND','STARTUP'].includes(settings.runAt)||item.schedule!==null)throw Error('Invalid command/event schedule.');
      if(!Array.isArray(messages)||messages.length>10000)throw Error('Invalid messages.');
      const ids=new Set();messages=messages.map(m=>{exact(m,['id','text','variant','name','displayOrder'],'message');text(m.id,'message ID');text(m.text,'message text',100000);if(ids.has(m.id))throw Error('Duplicate message ID.');ids.add(m.id);return {id:m.id,text:m.text,variant:'ALL',...messageMetadata(m)};});
    }
    const sharedIds=new Set(messages.map(message=>message.id));
    for(const id of Object.keys(item.settings.disabledMessageIds||{}))if(!sharedIds.has(id))throw Error('Disabled message pool references an unknown message ID.');
    return {...item,settings,schedule,messages};
  })};
}
function knownGuilds(account){
  if(account.guildRoster&&typeof account.guildRoster==='object'&&Number.isFinite(account.guildRosterUpdatedAt))return new Map([...guildNames(account,{currentOnly:true}).keys()].filter(key=>!/^\d+$/.test(key)).map(key=>[key,key]));
  const result=new Map();
  const add=name=>{if(name&&!/^\d+$/.test(name)&&!result.has(normalized(name)))result.set(normalized(name),name);};
  events(account).forEach(e=>add(e.guild));values(account.messages).forEach(m=>add(m.guildName));
  Object.keys(account.guildSchedulingTimeZones||{}).forEach(add);guildNames(account).forEach((_,key)=>add(key));
  return result;
}
export function reviewEventImport(document,account){
  const bundle=readEventBundle(document),guilds=knownGuilds(account);
  return bundle.items.map((entry,index)=>{
    const guild=guilds.get(normalized(entry.guild));
    const matches=values(account.commands).filter(c=>normalized(c.name)===normalized(entry.eventName));
    let reason=!guild?'No such guild: '+entry.guild:matches.length>1?'Ambiguous command name':matches[0]?.locked?'Local command is locked':null;
    const zone=account.guildSchedulingTimeZones?.[guildKey(account.guildSchedulingTimeZones,guild)]||account.schedulingTimeZone||'ET';
    if(!reason&&entry.schedule?.timeZone!==undefined&&entry.schedule.timeZone!==zone)reason='Timezone differs: import '+entry.schedule.timeZone+', destination '+zone;
    if(!reason&&entry.schedule&&timelineConflicts(entry.schedule).length)reason='Announcement periods overlap; correct the source event first.';
    return {index,entry,guild,commandId:matches[0]?.id,action:reason?'Skip':matches[0]&&account.commandGuildSettings?.[matches[0].id]?.[guildKey(account.commandGuildSettings?.[matches[0].id],guild)]?'Update':'Create',reason};
  });
}
function reconcileRotationActivities(entry, prior, oldMessages) {
  const incoming=values(entry.schedule?.rotationEvents),local=values(prior.rotationEvents),mapping=new Map(),used=new Set();
  if(entry.schedule?.specialPattern==='EVENT_ROTATION'){
    for(const activity of incoming)if(local.some(a=>a.id===activity.id)){mapping.set(activity.id,activity.id);used.add(activity.id);}
    for(const activity of incoming){
      if(mapping.has(activity.id))continue;
      const matches=local.filter(a=>a.name===activity.name);
      const match=matches.length===1&&incoming.filter(a=>a.name===activity.name).length===1&&!used.has(matches[0].id)?matches[0]:null;
      const id=match?.id||activity.id;mapping.set(activity.id,id);used.add(id);
    }
    entry.schedule.rotationEvents=array(incoming.map(a=>({...a,id:mapping.get(a.id)})));
    for(const message of entry.messages)if(mapping.has(message.variant))message.variant=mapping.get(message.variant);
    entry.schedule.messageVariants=Object.fromEntries(Object.entries(entry.schedule.messageVariants||{}).map(([id,variant])=>[id,mapping.get(variant)||variant]));
  }
  const available=new Set(entry.schedule?.specialPattern==='EVENT_ROTATION'?values(entry.schedule.rotationEvents).map(a=>a.id):[]);
  if(prior.specialPattern==='EVENT_ROTATION')for(const message of oldMessages){
    const variant=prior.messageVariants?.[message.id]||'ALL';
    if(message.locked&&variant!=='ALL'&&!available.has(variant))throw Error(`Cannot import: locked message "${message.name||message.id}" belongs to a rotating activity absent from the imported event.`);
  }
}
export function importEventBundle(account,document,selectedIndices){
  const result=cloneSavedData(account),selection=new Set(selectedIndices),review=reviewEventImport(document,result),applied=[],skipped=[];
  if([...selection].some(i=>!Number.isInteger(i)||i<0||i>=review.length))throw Error('Invalid import selection.');
  const append=(table,value)=>setLuaValue(table,Math.max(0,...Object.keys(table).map(Number).filter(Number.isFinite))+1,value);
  result.commands??={};result.messages??={};result.commandGuildSettings??={};result.chatChannels??={};
  for(const record of review){
    if(!selection.has(record.index))continue;
    if(record.reason){skipped.push(record.entry.eventName+': '+record.reason);continue;}
    const {guild}=record,entry={...record.entry,schedule:record.entry.schedule?cloneSavedData(record.entry.schedule):null,messages:record.entry.messages.map(m=>({...m}))};let commandId=record.commandId||values(result.commands).find(c=>normalized(c.name)===normalized(entry.eventName))?.id;
    if(!commandId){commandId=crypto.randomUUID();append(result.commands,{id:commandId,name:entry.eventName});}
    result.commandGuildSettings[commandId]??={};
    const settings=result.commandGuildSettings[commandId][guildKey(result.commandGuildSettings[commandId],guild)]??={},prior=settings.schedule||{},destination=events(result).find(e=>e.commandId===commandId&&normalized(e.guild)===normalized(guild)),oldMessages=destination?.messages||[];
    reconcileRotationActivities(entry,prior,oldMessages);
    const guildSlots=new Set(values(result.messages).filter(m=>normalized(m.guildName)===normalized(guild)&&Number.isInteger(m.guildIndex)).map(m=>m.guildIndex));
    const guildIndex=guildIndexFromRoster(result,guild)??destination?.guildIndex??(guildSlots.size===1?[...guildSlots][0]:undefined);
    const messageIds=new Map(),variantsByMessage=new Map(oldMessages.map(m=>[m.id,prior.messageVariants?.[m.id]||'ALL']));
    const ordinary=entry.settings.runAt!=='SCHEDULED',claimedMessages=new Set(),reservedMessageIds=new Set(entry.messages.filter(incoming=>oldMessages.some(local=>local.id===incoming.id&&!local.locked)).map(incoming=>incoming.id));
    for(const [importIndex,incoming] of entry.messages.entries()){
      let message=oldMessages.find(m=>m.id===incoming.id&&!m.locked&&(!ordinary||!claimedMessages.has(m.id)))||oldMessages.find(m=>m.text===incoming.text&&(ordinary||variantsByMessage.get(m.id)===incoming.variant)&&(!ordinary||!claimedMessages.has(m.id)&&!reservedMessageIds.has(m.id)));
      if(!message){const id=values(result.messages).some(m=>m.id===incoming.id)?crypto.randomUUID():incoming.id;message={id,commandId,guildName:guild,useCount:0,...messageMetadata(incoming,importIndex),...(guildIndex!==undefined?{guildIndex}:{})};append(result.messages,message);oldMessages.push(message);}
      if(!message.locked){message.text=incoming.text;Object.assign(message,messageMetadata(incoming));}
      claimedMessages.add(message.id);
      messageIds.set(incoming.id,message.id);variantsByMessage.set(message.id,incoming.variant);
    }
    const lockedMessages=new Map(oldMessages.filter(message=>message.locked).map(message=>[message.id,message]));
    const disabledMessageIds=Object.fromEntries([...lockedMessages.keys()].filter(id=>settings.disabledMessageIds?.[id]===true).map(id=>[id,true]));
    for(const [sourceId,flag]of Object.entries(entry.settings.disabledMessageIds||{})){
      const id=messageIds.get(sourceId);if(flag===true&&id&&!lockedMessages.has(id))disabledMessageIds[id]=true;
    }
    // A shared command configuration replaces these options completely:
    // omitted keys mean native defaults/off, while recipient runtime and extra settings remain local.
    for(const key of commandKeys)delete settings[key];
    Object.assign(settings,entry.settings);
    if(Object.keys(disabledMessageIds).length)settings.disabledMessageIds=disabledMessageIds;else delete settings.disabledMessageIds;
    if(entry.schedule){
      const schedule=cloneSavedData(entry.schedule),oldRows=values(prior.reminders);
      const rowIds=new Set();
      for(const row of values(schedule.reminders)){
        const matches=matchingReminderRows(oldRows,row);
        if(matches.length===1&&!rowIds.has(matches[0].id))row.id=matches[0].id;if(rowIds.has(row.id))row.id=crypto.randomUUID();rowIds.add(row.id);
        const privateIds=matches.length===1?values(matches[0].messageIds).filter(id=>oldMessages.some(m=>m.id===id&&m.locked)):[];
        row.messageIds=array([...new Set([...values(row.messageIds).map(id=>messageIds.get(id)),...privateIds])]);
      }
      const priorVariants=Object.fromEntries(Object.entries(prior.messageVariants||{}).map(([id,variant])=>[id,schedule.specialPattern==='EVENT_ROTATION'&&variant!=='ALL'&&!values(schedule.rotationEvents).some(a=>a.id===variant)?'ALL':variant]));
      schedule.messageVariants={...priorVariants,...Object.fromEntries(entry.messages.filter(m=>!oldMessages.find(local=>local.id===messageIds.get(m.id))?.locked).map(m=>[messageIds.get(m.id),m.variant]))};
      schedule.reminders=array(orderedReminderRows(schedule));
      settings.schedule={...prior,...schedule};
      delete settings.schedule.mergedInto;
      for(const key of ['rotationEvents','rotationEvery','occurrenceExceptions','monthlyWeek','monthlyWeekday','dailyLimitShared','sharedDailyLimit'])if(schedule[key]===undefined)delete settings.schedule[key];
      // An imported duration can explicitly clear the old optional cap.
      if(schedule.eventDurationMinutes===undefined)delete settings.schedule.eventDurationMinutes;
      const errors=validateTimelineForAddon(settings.schedule);if(errors.length)throw Error(errors.join(' '));
    }
    if(entry.outputChannel){result.chatChannels[commandId]??={};result.chatChannels[commandId][guildKey(result.chatChannels[commandId],guild)]=entry.outputChannel;}
    applied.push(entry.eventName+' / '+guild);
  }
  return {account:result,applied,skipped};
}
