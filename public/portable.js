import {validateTimelineForAddon} from '/model.js';
import { setLuaValue } from '/lua-data.js';
const values = x => Object.values(x || {});
const scheduleKeys = ['timelineVersion', 'mode', 'eventDate', 'eventTime', 'timeZone', 'recurrence', 'recurrenceInterval', 'specialPattern', 'rotationWeeks', 'rotationFactions', 'eventFold', 'importantTimes', 'reminders', 'messageVariants', 'weekdays', 'enabled', 'paused'];
function array(items) {
  const o = {};
  items.forEach((v, i) => setLuaValue(o, i + 1, v));
  return o;
}
function object(x, label) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error(`${label} must be an object.`);
  return x;
}
function exact(x, keys, label) {
  object(x, label);
  for (const key of Object.keys(x)) if (!keys.includes(key)) throw Error(`Unknown ${label} field: ${key}`);
}
function text(x, label, max = 500) {
  if (typeof x !== 'string' || !x.trim() || x.length > max) throw Error(`Invalid ${label}.`);
  return x;
}
function num(x, label, min, max) {
  if (!Number.isFinite(x) || !Number.isInteger(x) || x < min || x > max) throw Error(`Invalid ${label}.`);
  return x;
}
function anchor(x, marks) {
  exact(x, ['kind', 'minutes', 'days', 'time', 'name', 'fold'], 'anchor');
  if (x.kind === 'OFFSET') return {
    kind: 'OFFSET',
    minutes: num(x.minutes, 'anchor minutes', -5256000, 5256000)
  };
  if (x.kind === 'DAY') {
    if (!/^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(x.time) || !validClock(x.time)) throw Error('Invalid day anchor clock.');
    return {
      kind: 'DAY',
      days: num(x.days, 'anchor days', -3650, 3650),
      time: x.time,
      ...(x.fold ? {
        fold: x.fold
      } : {})
    };
  }
  if (x.kind === 'MARK' && Object.hasOwn(marks, x.name)) return {
    kind: 'MARK',
    name: x.name
  };
  throw Error('Invalid reminder anchor or missing important time.');
}
function validClock(x) {
  const m = /^(\d{1,2}):(\d{2})\s?(AM|PM)$/i.exec(x);
  return m && +m[1] >= 1 && +m[1] <= 12 && +m[2] < 60;
}
export function portableEvent(event, messages) {
  const schedule = {};
  for (const key of scheduleKeys) if (event.schedule[key] !== undefined) schedule[key] = event.schedule[key];
  const unlocked = messages.filter(m => m.locked !== true),
    ids = new Set(unlocked.map(m => m.id));
  schedule.reminders = array(values(schedule.reminders).map(row => ({
    id: row.id,
    label: row.label,
    start: row.start,
    finish: row.finish || row.start,
    once: !!row.once,
    ...(row.onceUntilFinish ? {
      onceUntilFinish: true
    } : {}),
    lateMinutes: row.lateMinutes ?? 5,
    intervalMinutes: row.intervalMinutes ?? 60,
    timeSensitive: !!row.timeSensitive,
    messageIds: array(values(row.messageIds).filter(id => ids.has(id)))
  })));
  schedule.messageVariants = Object.fromEntries(Object.entries(schedule.messageVariants || {}).filter(([id]) => ids.has(id)));
  return {
    format: 'SmartChatMsgTimeline',
    version: 1,
    eventName: event.command.name,
    guild: event.guild,
    schedule,
    messages: unlocked.map(m => ({
      id: m.id,
      text: m.text,
      variant: schedule.messageVariants[m.id] || 'ALL'
    }))
  };
}
export function validatePortable(p) {
  exact(p, ['format', 'version', 'eventName', 'guild', 'schedule', 'messages'], 'portable document');
  if (p.format !== 'SmartChatMsgTimeline' || p.version !== 1) throw Error('Unsupported portable timeline.');
  text(p.eventName, 'event name');
  text(p.guild, 'guild');
  exact(p.schedule, scheduleKeys, 'schedule');
  const s = p.schedule;
  if (s.timelineVersion !== 1 || s.mode !== 'EVENT') throw Error('Only timeline events can be imported.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.eventDate) || !Number.isFinite(Date.parse(s.eventDate)) || new Date(s.eventDate).toISOString().slice(0, 10) !== s.eventDate || !validClock(s.eventTime)) throw Error('Invalid actual event date or clock.');
  if (!['ET', 'CT', 'MT', 'PT'].includes(s.timeZone)) throw Error('Unsupported timezone.');
  if (!['NONE', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY_DATE', 'MONTHLY_WEEKDAY'].includes(s.recurrence)) throw Error('Unsupported recurrence.');
  if (!['NONE', 'MONTH_FINAL', 'FACTION_ROTATION'].includes(s.specialPattern || 'NONE')) throw Error('Unsupported special pattern.');
  if (s.recurrenceInterval !== undefined) num(s.recurrenceInterval, 'recurrence interval', 1, 999);
  if (s.rotationWeeks !== undefined) num(s.rotationWeeks, 'rotation weeks', 1, 999);
  if (s.rotationFactions && values(s.rotationFactions).some(f => !['AD', 'EP', 'DC'].includes(f))) throw Error('Invalid faction order.');
  if (!Array.isArray(p.messages) || p.messages.length > 10000) throw Error('Invalid message collection.');
  const ids = new Set();
  for (const m of p.messages) {
    exact(m, ['id', 'text', 'variant'], 'message');
    text(m.id, 'message ID');
    text(m.text, 'message text', 100000);
    if (ids.has(m.id)) throw Error('Duplicate message ID.');
    ids.add(m.id);
    if (!['ALL', 'REGULAR', 'FINAL', 'AD', 'EP', 'DC'].includes(m.variant)) throw Error('Invalid message variant.');
  }
  const marks = Object.create(null);
  for (const [id, m] of Object.entries(s.importantTimes || {})) {
    text(id, 'important time ID');
    exact(m, ['label', 'offsetMinutes'], 'important time');
    marks[id] = {
      label: text(m.label, 'important time label'),
      offsetMinutes: num(m.offsetMinutes, 'important time offset', -5256000, 5256000)
    };
  }
  if (s.enabled !== undefined && typeof s.enabled !== 'boolean' || s.paused !== undefined && typeof s.paused !== 'boolean') throw Error('Invalid schedule flags.');
  if (s.eventFold && !['FIRST', 'SECOND', 'EDT', 'EST', 'CDT', 'CST', 'MDT', 'MST', 'PDT', 'PST'].includes(s.eventFold)) throw Error('Invalid DST fold.');
  for (const [k, v] of Object.entries(s.weekdays || {})) if (!/^[1-7]$/.test(k) || typeof v !== 'boolean') throw Error('Invalid weekdays.');
  const rowIds = new Set(),
    rows = [];
  for (const r of values(s.reminders)) {
    exact(r, ['id', 'label', 'start', 'finish', 'once', 'onceUntilFinish', 'lateMinutes', 'intervalMinutes', 'timeSensitive', 'messageIds'], 'reminder');
    text(r.id, 'reminder ID');
    if (rowIds.has(r.id)) throw Error('Duplicate reminder ID.');
    rowIds.add(r.id);
    if (typeof r.once !== 'boolean' || typeof r.timeSensitive !== 'boolean' || r.onceUntilFinish !== undefined && typeof r.onceUntilFinish !== 'boolean') throw Error('Invalid reminder delivery flags.');
    const pool = values(r.messageIds);
    if (pool.some(id => !ids.has(id))) throw Error('Reminder references a missing or private message.');
    rows.push({
      id: r.id,
      label: text(r.label, 'reminder label'),
      start: anchor(r.start, marks),
      finish: anchor(r.finish || r.start, marks),
      once: r.once,
      ...(r.onceUntilFinish ? {
        onceUntilFinish: true
      } : {}),
      lateMinutes: num(r.lateMinutes, 'late allowance', 1, 1440),
      intervalMinutes: num(r.intervalMinutes, 'reminder interval', 1, 525600),
      timeSensitive: r.timeSensitive,
      messageIds: array(pool)
    });
  }
  const result = {};
  for (const key of scheduleKeys) if (s[key] !== undefined) result[key] = s[key];
  result.weekdays = {};
  for (const [key,value] of Object.entries(s.weekdays || {})) setLuaValue(result.weekdays,Number(key),value);
  if(s.rotationFactions) result.rotationFactions = array(values(s.rotationFactions));
  result.importantTimes = marks;
  result.reminders = array(rows);
  const errors=validateTimelineForAddon(result);if(errors.length)throw Error(errors.join(' '));
  return {
    ...p,
    schedule: result
  };
}
export function stageImport(p, event, existingMessages, guild) {
  p = validatePortable(p);
  const ids = new Map(),
    newMessages = [],
    guildIndex = values(existingMessages).find(m => m.guildName?.trim().toLowerCase() === guild && Number.isInteger(m.guildIndex))?.guildIndex;
  for (const m of p.messages) {
    const id = crypto.randomUUID();
    ids.set(m.id, id);
    newMessages.push({
      id,
      commandId: event.commandId,
      guildName: guild,
      ...(guildIndex ? {
        guildIndex
      } : {}),
      text: m.text,
      useCount: 0
    });
  }
  const s = p.schedule;
  for (const r of values(s.reminders)) {
    r.id = crypto.randomUUID();
    r.messageIds = array(values(r.messageIds).map(id => ids.get(id)));
  }
  s.messageVariants = Object.fromEntries(p.messages.map(m => [ids.get(m.id), m.variant]));
  return {
    schedule: s,
    messages: newMessages
  };
}
