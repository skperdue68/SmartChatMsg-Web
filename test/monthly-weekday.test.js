import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setLuaValue,writeSavedVariables,parseSavedVariables} from '../src/lua-data.js';
import {reminderWindows,nextScheduleOccurrence,timelineConflicts,projectedOccurrences,monthlyWeekdayRule,validateMonthlyWeekdayRule,validateTimelineForAddon,validateEventRotation,scheduleEventUtc,eventVariant,occurrenceCancellation,editDayTimeline,legacyToTimeline} from '../src/model.js';
const seq=items=>{const result={};items.forEach((v,i)=>setLuaValue(result,i+1,v));return result;};
const fixture=extra=>({timelineVersion:1,mode:'EVENT',eventDate:'2026-01-01',eventTime:'7:00 PM',timeZone:'ET',recurrence:'MONTHLY_WEEKDAY',monthlyWeek:'LAST',monthlyWeekday:1,reminders:seq([{id:'r',label:'Reminder',start:{kind:'OFFSET',minutes:-60},finish:{kind:'OFFSET',minutes:0},once:false,intervalMinutes:15,lateMinutes:5,messageIds:seq(['m'])}]),...extra});
const project=(s,from='2026-01-01',to='2026-12-31')=>projectedOccurrences(s,Date.parse(from)/1000,Date.parse(to)/1000);
const civilDates=(s,at)=>at.map(t=>new Intl.DateTimeFormat('en-CA',{timeZone:{ET:'America/New_York',CT:'America/Chicago',MT:'America/Denver',PT:'America/Los_Angeles'}[s.timeZone],year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t*1000)));
test('Last Sunday includes months with four and five Sundays and crosses years in each timezone',()=>{
 for(const timeZone of ['ET','CT','MT','PT']){
  const s=fixture({timeZone}),at=project(s,'2026-01-01','2026-05-01');
  assert.deepEqual(civilDates(s,at),['2026-01-25','2026-02-22','2026-03-29','2026-04-26']);assert.equal(at[2]-at[1],35*86400-3600);
  assert.ok(at.every(t=>new Intl.DateTimeFormat('en-US',{timeZone:{ET:'America/New_York',CT:'America/Chicago',MT:'America/Denver',PT:'America/Los_Angeles'}[timeZone],hour:'numeric',minute:'2-digit'}).format(new Date(t*1000))==='7:00 PM'));
  assert.deepEqual(civilDates(s,project(s,'2026-11-01','2027-02-02')),['2026-11-29','2026-12-27','2027-01-31']);
 }
});
test('fifth weekdays skip missing months and legacy inferred ordinal keeps existing semantics',()=>{
 const explicit=fixture({eventDate:'2026-03-29',monthlyWeek:5}),legacy={...explicit};delete legacy.monthlyWeek;delete legacy.monthlyWeekday;
 assert.deepEqual(monthlyWeekdayRule(legacy),{monthlyWeek:5,monthlyWeekday:1});
 assert.deepEqual(civilDates(explicit,project(explicit)),['2026-03-29','2026-05-31','2026-08-30','2026-11-29']);assert.deepEqual(project(explicit),project(legacy));
});
test('monthly interval retains the anchor month and suppresses dates before the anchor bound',()=>{
 const s=fixture({eventDate:'2026-01-27',recurrenceInterval:2});
 assert.deepEqual(civilDates(s,project(s)),['2026-03-29','2026-05-31','2026-07-26','2026-09-27','2026-11-29']);
 assert.deepEqual(monthlyWeekdayRule(fixture({monthlyWeek:undefined,monthlyWeekday:undefined})),{monthlyWeek:1,monthlyWeekday:5});
});
test('rotation, cancellations and cache edits follow the explicit monthly nominal dates',()=>{
 const s=fixture({specialPattern:'EVENT_ROTATION',rotationEvents:seq([{id:'a',name:'A'},{id:'b',name:'B'}]),occurrenceExceptions:{'2026-02-22':{action:'POSTPONE'}}}),at=project({...s,occurrenceExceptions:{}});
 assert.deepEqual(at.slice(0,4).map(t=>eventVariant(s,t)),['a','b','b','a']);assert.equal(occurrenceCancellation(s,at[1]),'POSTPONE');assert.ok(!project(s).includes(at[1]));
 s.monthlyWeek=1;s.monthlyWeekday=2;const changed=project(s);assert.deepEqual(civilDates(s,changed.slice(0,3)),['2026-01-05','2026-02-02','2026-03-02']);assert.deepEqual(changed.slice(0,3).map(t=>eventVariant(s,t)),['a','b','a']);
});
test('invalid monthly fields fail validation even on inactive recurrence',()=>{
 for(const monthlyWeek of [0,6,'last','5',1.5,null])assert.ok(validateMonthlyWeekdayRule(fixture({recurrence:'WEEKLY',monthlyWeek})).length);
 for(const monthlyWeekday of [0,8,'1',1.5,null])assert.ok(validateEventRotation(fixture({recurrence:'WEEKLY',monthlyWeekday})).length);
 assert.deepEqual(validateTimelineForAddon(fixture()),[]);
});
test('monthly dragging retains explicit rule and rejects an off-rule target',()=>{
 const s=fixture(),at=project(s)[0];const moved=editDayTimeline(s,at,null,'move',60).schedule;assert.equal(moved.monthlyWeek,'LAST');assert.equal(moved.monthlyWeekday,1);assert.equal(moved.eventTime,'08:00 PM');assert.throws(()=>editDayTimeline(s,at,null,'move',1440),/selected occurrence/);
 const partial=fixture();delete partial.monthlyWeekday;assert.throws(()=>editDayTimeline(partial,project(partial)[0],null,'move',1440),/selected occurrence/);
});
test('monthly helper conversion compares effective LAST rules rather than anchor ordinal',()=>{
 const source={mode:'REMINDER',startDate:'2026-03-29',startTime:'07:00 PM',timeZone:'ET',recurrence:'MONTHLY_WEEKDAY',monthlyWeek:'LAST',monthlyWeekday:1};
 const parent=fixture({eventDate:'2026-04-26'});assert.doesNotThrow(()=>legacyToTimeline(source,{},parent));
 assert.throws(()=>legacyToTimeline({...source,monthlyWeek:5},{},parent),/same ordinal weekday/);
});
test('portable and Lua roundtrip monthly rules and imports clear omitted prior explicit rules',async()=>{
 const source=fs.readFileSync(new URL('../public/portable.js',import.meta.url),'utf8').replaceAll('"./model.js"',JSON.stringify(new URL('../src/model.js',import.meta.url).href)).replaceAll('"./lua-data.js"',JSON.stringify(new URL('../src/lua-data.js',import.meta.url).href));
 const {portableEvent,validatePortable,stageImport,exportEventBundle,importEventBundle}=await import('data:text/javascript;base64,'+Buffer.from(source+'\n//# sourceURL=monthly-portable-test.js').toString('base64'));
 const schedule=fixture(),event={command:{name:'Monthly'},commandId:'c',guild:'guild',schedule},messages=[{id:'m',commandId:'c',guildName:'guild',text:'Monthly'}];const payload=JSON.parse(JSON.stringify(portableEvent(event,messages)));
 const result=validatePortable(payload);assert.equal(result.schedule.monthlyWeek,'LAST');assert.equal(result.schedule.monthlyWeekday,1);assert.equal(parseSavedVariables(writeSavedVariables(result.schedule)).monthlyWeek,'LAST');
 payload.schedule.monthlyWeekday=8;assert.throws(()=>validatePortable(payload),/Monthly weekday/);payload.schedule.monthlyWeekday=1;
 payload.schedule.recurrence='WEEKLY';payload.schedule.monthlyWeek=0;assert.throws(()=>validatePortable(payload),/Monthly week/);payload.schedule.recurrence='MONTHLY_WEEKDAY';payload.schedule.monthlyWeek='LAST';
 delete payload.schedule.monthlyWeek;delete payload.schedule.monthlyWeekday;const staged=stageImport(payload,event,seq(messages),'guild');assert.deepEqual(monthlyWeekdayRule(staged.schedule),{monthlyWeek:1,monthlyWeekday:5});
 const account={commands:seq([{id:'c',name:'Monthly'}]),messages:seq(messages),schedulingTimeZone:'ET',commandGuildSettings:{c:{guild:{runAt:'SCHEDULED',schedule}}}};
 const bundle=exportEventBundle(account,'guild',['c']);delete bundle.items[0].schedule.monthlyWeek;delete bundle.items[0].schedule.monthlyWeekday;const imported=importEventBundle(account,bundle,[0]).account.commandGuildSettings.c.guild.schedule;assert.equal(imported.monthlyWeek,undefined);assert.equal(imported.monthlyWeekday,undefined);assert.deepEqual(monthlyWeekdayRule(imported),{monthlyWeek:1,monthlyWeekday:5});
});

test('monthly date bounds do not create phantom reminder overlaps or phantom DST gaps',()=>{
 const s=fixture({monthlyWeek:1,monthlyWeekday:2});s.reminders[1].start={kind:'OFFSET',minutes:-7*1440};
 assert.deepEqual(civilDates(s,project(s).slice(0,2)),['2026-01-05','2026-02-02']);assert.deepEqual(timelineConflicts(s),[]);
 const dst=fixture({eventDate:'2026-03-08'});dst.reminders[1].start={kind:'DAY',days:0,time:'02:30 AM'};assert.deepEqual(validateTimelineForAddon(dst),[]);
 dst.occurrenceExceptions={'2026-03-29':{action:'KEEP'}};assert.deepEqual(validateTimelineForAddon(dst),[]);
 dst.reminders[1].start={kind:'OFFSET',minutes:1};assert.match(validateTimelineForAddon(dst).join(' '),/end must follow start/);
});
test('monthly reminder validation finds sparse first occurrences beyond the preview limit',()=>{
 const s=fixture({eventDate:'2026-02-01',recurrenceInterval:12,monthlyWeek:5,monthlyWeekday:1});
 assert.deepEqual(project(s),[]);assert.deepEqual(validateTimelineForAddon(s),[]);
 s.reminders[1].start={kind:'OFFSET',minutes:1};assert.match(validateTimelineForAddon(s).join(' '),/end must follow start/);
});

test('next occurrence finds sparse fifth Sundays years ahead and skips cancellations',()=>{
 const s=fixture({eventDate:'2026-02-01',recurrenceInterval:12,monthlyWeek:5,monthlyWeekday:1}),from=Date.UTC(2026,1,1)/1000;
 const first=nextScheduleOccurrence(s,from);assert.deepEqual(civilDates(s,[first]),['2032-02-29']);
 s.occurrenceExceptions={'2032-02-29':{action:'KEEP'}};const next=nextScheduleOccurrence(s,from);assert.deepEqual(civilDates(s,[next]),['2060-02-29']);assert.equal(nextScheduleOccurrence(s,from,{includeCancelled:true}),first);assert.equal(nextScheduleOccurrence(s,Date.UTC(2101,0,2)/1000),null);
 const once=fixture({recurrence:'NONE'}),past=Date.UTC(2027,0,1)/1000;assert.equal(nextScheduleOccurrence(once,past),null);assert.ok(nextScheduleOccurrence(once,Date.UTC(2026,0,1)/1000));
});
test('sparse monthly occurrences cannot bypass overlap checking',()=>{
 const s=fixture({eventDate:'2026-02-01',recurrenceInterval:12,monthlyWeek:5,monthlyWeekday:1});setLuaValue(s.reminders,2,{...s.reminders[1],id:'overlap'});
 assert.equal(timelineConflicts(s).length,1);
});
test('monthly helper alignment uses shared actual dates instead of different date bounds',()=>{
 const source={mode:'REMINDER',startDate:'2026-01-01',startTime:'07:00 PM',timeZone:'ET',recurrence:'MONTHLY_WEEKDAY',monthlyWeek:'LAST',monthlyWeekday:1},parent=fixture({eventDate:'2026-01-15'});
 const actual=nextScheduleOccurrence(parent,Date.UTC(2026,0,1)/1000),converted=legacyToTimeline(source,{},parent);
 assert.equal(reminderWindows(converted,actual)[0].start,actual);
 const existing=fixture({eventDate:'2026-01-01'}),combined=legacyToTimeline(existing,{},parent);assert.equal(combined.reminders[1].start.minutes,-60);assert.equal(reminderWindows(combined,actual)[0].start,actual-3600);
 const laterSource={...source,startDate:'2026-02-01'},aligned=legacyToTimeline(laterSource,{},parent),laterActual=nextScheduleOccurrence(parent,Date.UTC(2026,1,1)/1000);assert.equal(reminderWindows(aligned,laterActual)[0].start,laterActual);
 assert.throws(()=>legacyToTimeline({...source,recurrenceInterval:2},{},fixture({eventDate:'2026-02-15',recurrenceInterval:2})),/monthly recurrence phases/);
});

test('recurrence civil dates stop at 2099 while PT late clocks may spill into UTC 2100',()=>{
 const s=fixture({eventDate:'2099-12-31',eventTime:'11:30 PM',timeZone:'PT',recurrence:'DAILY'}),from=Date.UTC(2099,11,31)/1000,to=Date.UTC(2100,0,3)/1000;
 const at=nextScheduleOccurrence(s,from);assert.equal(new Date(at*1000).toISOString(),'2100-01-01T07:30:00.000Z');assert.equal(nextScheduleOccurrence(s,at+1),null);assert.deepEqual(projectedOccurrences(s,from,to),[at]);
});

test('monthly conversion retains parent date bounds and faction or activity rotation phase',()=>{
 for(const pattern of ['FACTION_ROTATION','EVENT_ROTATION']){
  const parent=fixture({eventDate:'2026-01-05',specialPattern:pattern,rotationWeeks:1,rotationFactions:seq(['AD','EP','DC']),rotationEvents:seq([{id:'a',name:'A'},{id:'b',name:'B'}]),rotationEvery:2,eventFold:'FIRST'});
  const actual=nextScheduleOccurrence(parent,Date.UTC(2026,0,1)/1000),before=eventVariant(parent,actual),self=legacyToTimeline(parent,{},parent);
  assert.equal(self.eventDate,parent.eventDate);assert.equal(self.eventTime,parent.eventTime);assert.equal(self.eventFold,parent.eventFold);assert.equal(self.eventAtUtc,scheduleEventUtc(parent));assert.equal(eventVariant(self,actual),before);
  assert.deepEqual(project(self),project(parent));
  const helper={mode:'REMINDER',startDate:'2026-01-01',startTime:'07:00 PM',timeZone:'ET',recurrence:'MONTHLY_WEEKDAY',monthlyWeek:'LAST',monthlyWeekday:1},combined=legacyToTimeline(helper,{},parent);
  assert.equal(combined.eventDate,parent.eventDate);assert.equal(combined.eventAtUtc,scheduleEventUtc(parent));assert.equal(combined.specialPattern,pattern);assert.equal(eventVariant(combined,actual),before);assert.equal(reminderWindows(combined,actual)[0].start,actual);
 }
});
