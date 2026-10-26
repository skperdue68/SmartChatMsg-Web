import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedReminderRows,timelineConflicts,scheduleEventUtc} from '../src/model.js';
const row=(id,start,end,once=false)=>({id,label:id,start:{kind:'OFFSET',minutes:start},finish:{kind:'OFFSET',minutes:end},once,lateMinutes:10});
const schedule=rows=>({timeZone:'ET',eventDate:'2026-10-27',eventTime:'08:00 PM',recurrence:'NONE',reminders:Object.fromEntries(rows.map((r,i)=>[i+1,r]))});
test('sorts by resolved start while preserving row identity and stable ties',()=>{
 const a=row('later',-30,0),b=row('early',-2880,-1440),c=row('tie',-30,0),s=schedule([a,b,c]);
 assert.deepEqual(orderedReminderRows(s).map(r=>r.id),['early','later','tie']);assert.equal(orderedReminderRows(s)[0],b);
 a.start.minutes=-3000;assert.equal(orderedReminderRows(s)[0],a);
});
test('overlaps conflict but adjacent periods and one-time late allowances do not',()=>{
 assert.equal(timelineConflicts(schedule([row('a',-2880,0),row('b',-1440,0)])).length,1);
 assert.equal(timelineConflicts(schedule([row('a',-120,-60),row('b',-60,0)])).length,0);
 assert.equal(timelineConflicts(schedule([row('once',0,10,true),row('repeat',1,60)])).length,0);
 assert.equal(timelineConflicts(schedule([row('once',0,10,true),row('repeat',0,60)])).length,1);
 assert.equal(timelineConflicts(schedule([row('a',0,10,true),row('b',0,10,true)])).length,1);
});
test('uses calendar days and important times and detects recurring self-overlap',()=>{
 const s=schedule([row('a',-120,-60),row('b',-90,0)]);s.importantTimes={close:{offsetMinutes:-90}};s.reminders[2].start={kind:'MARK',name:'close'};
 const conflict=timelineConflicts(s)[0];assert.equal(conflict.start,scheduleEventUtc(s)-90*60);
 s.reminders[2].start={kind:'DAY',days:0,time:'07:00 PM'};assert.equal(timelineConflicts(s).length,0);
 const weekly=schedule([row('long',-8*1440,0)]);weekly.recurrence='WEEKLY';assert.ok(timelineConflicts(weekly).length);
});
