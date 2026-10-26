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
  /^(lastUsedAt|useCount|lastUsedParamText|lastUsedGuildIndex|lastAutoPopulateSentAtByZone|observedChatCooldowns|completedOccurrences|timelineDeliveries|timelineHistory|timelineUsage|nextDue.*|completed|last.*At|.*Cooldowns)$/.test(
    k,
  );
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
export function projectedOccurrences(schedule, fromUtc, toUtc) {
  if (!Number.isFinite(fromUtc) || !Number.isFinite(toUtc) || toUtc < fromUtc)
    return [];
  if (toUtc - fromUtc > 400 * 86400)
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
    wanted = Object.entries(schedule.weekdays || {})
      .filter(([, v]) => v === true)
      .map(([k]) => Number(k) - 1);
  const result = [];
  const start = Math.max(anchor, Math.floor((fromUtc - 86400) / 86400) * 86400),
    end = toUtc + 86400;
  for (let day = start; day <= end; day += 86400) {
    const c = civil(day, "UTC").slice(0, 3),
      diff = Math.round((day - anchor) / 86400),
      dow = new Date(day * 1000).getUTCDay(),
      months = (c[0] - d[0]) * 12 + c[1] - d[1];
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
        dow === weekday &&
        (schedule.monthWeek === -1 || schedule.monthWeek === "LAST"
          ? new Date(Date.UTC(c[0], c[1] - 1, c[2] + 7)).getUTCMonth() !==
            c[1] - 1
          : Math.floor((c[2] - 1) / 7) === Math.floor((d[2] - 1) / 7));
    if (yes) {
      const occurrence = utc([...c, ...t], z, schedule.eventFold);
      if (occurrence !== null && occurrence >= fromUtc && occurrence <= toUtc)
        result.push(occurrence);
    }
  }
  return result;
}
export function reminderWindows(schedule, eventAtUtc, options = {}) {
  const z = schedule.timeZone || "ET";
  function resolve(a) {
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
  return values(schedule.reminders).flatMap((row) => {
    const start = resolve(row.start);
    let end =
        row.once && !row.onceUntilFinish
          ? start + Number(row.lateMinutes ?? 5) * 60
          : resolve(row.finish);
    if(!options.uncapped && schedule.eventDurationMinutes!==undefined && !row.allowAfterEventEnd){
      const ending=eventAtUtc+schedule.eventDurationMinutes*60;
      if(!(row.once && start===ending))end=Math.min(end,ending);
    }
    return start === null || end === null || end <= start
      ? []
      : [{ row, start, end, eventAtUtc }];
  });
}
export function eventVariant(schedule, eventAtUtc) {
  const zone = schedule.timeZone || "ET";
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
            Math.floor(Math.max(0, days) / 7) /
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
  return { ...window, status, usage };
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
  const target = scheduleEventUtc(parentSchedule),
    original = legacyTechnicalEventUtc(schedule),
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
      sd &&
      pd &&
      (Math.floor((sd[2] - 1) / 7) !== Math.floor((pd[2] - 1) / 7) ||
        new Date(stamp(sd) * 1000).getUTCDay() !==
          new Date(stamp(pd) * 1000).getUTCDay())
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
  if (schedule !== parentSchedule) {
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
  result.eventAtUtc = target;
  const actual = civil(target, zone);
  result.eventDate = `${actual[0]}-${String(actual[1]).padStart(2, "0")}-${String(actual[2]).padStart(2, "0")}`;
  result.eventTime = `${String(actual[3] % 12 || 12).padStart(2, "0")}:${String(actual[4]).padStart(2, "0")} ${actual[3] >= 12 ? "PM" : "AM"}`;
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
export function validateTimelineForAddon(schedule) {
  const errors = [];
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
          {uncapped:true},
        )[0];
        if (!window || window.end <= window.start)
          errors.push(
            `${label}: end must follow start and all local clocks must exist.`,
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
 const normal={time:tod,timeofday:tod,greeting:tod,morning:tod,guild:context.guild||'',zone:context.zone||''};
 const explicit=/%eventcountdown(?::[a-z][a-z0-9_]*|[+-]\d+[mhd])?%/i.test(text);let decorated=false;
 return String(text).replace(/%([a-z][a-z0-9_:+-]*)%/gi,(whole,raw)=>{
  const token=raw.toLowerCase();if(Object.hasOwn(normal,token)&&normal[token])return normal[token];
  const m=/^(eventwhen|eventtime|eventdate|eventcountdown|eventfaction)(?::([a-z][a-z0-9_]*)|([+-])(\d+)([mhd]))?$/.exec(token);
  if(!m)return whole;const kind=m[1];let offset=0;
  if(m[2]){const mark=schedule.importantTimes?.[m[2]];if(!mark||!Number.isFinite(mark.offsetMinutes)||kind==='eventfaction')return whole;offset=mark.offsetMinutes*60;}
  if(m[3]){offset=Number(m[4])*{m:60,h:3600,d:86400}[m[5]]*(m[3]==='-'?-1:1);if(kind==='eventfaction'||Math.abs(offset)>36500*86400)return whole;}
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
