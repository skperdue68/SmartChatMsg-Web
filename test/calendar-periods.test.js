import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../src/model.js';
const s={timeZone:'ET',eventDate:'2026-11-03',eventTime:'08:00 PM'};
const at=m.scheduleEventUtc(s);
test('calendar fields resolve legacy elapsed, day and important-time anchors',()=>{
 for(const a of [{kind:'OFFSET',minutes:-60},{kind:'DAY',days:-1,time:'08:00 PM'},{kind:'MARK',name:'tickets'}]){
 const schedule={...s,importantTimes:{tickets:{offsetMinutes:-60}}},v=m.reminderCalendarFields(schedule,at,a);
 assert.deepEqual(m.reminderCalendarAnchor(schedule,at,v.date,v.time,a),a);
 }
});
test('edited dates become server-day anchors and follow future occurrences',()=>{
 const a=m.reminderCalendarAnchor(s,at,'2026-11-02','07:00 PM',{kind:'OFFSET',minutes:0});
 assert.equal(a.kind,'DAY');assert.equal(a.days,-1);
 assert.equal(m.reminderCalendarFields(s,at+7*86400,a).date,'2026-11-09');
});
test('calendar conversion rejects missing and DST gap clocks',()=>{
 assert.throws(()=>m.reminderCalendarAnchor(s,at,'','08:00 PM',{}));
 assert.throws(()=>m.reminderCalendarAnchor(s,at,'2027-03-14','02:30 AM',{}));
});
test('calendar day clock stays constant across spring DST',()=>{
 const e={...s,eventDate:'2027-03-14',eventTime:'08:00 PM'},event=m.scheduleEventUtc(e);
 const a=m.reminderCalendarAnchor(e,event,'2027-03-13','08:00 PM',{kind:'OFFSET',minutes:0});
 assert.equal((event-m.resolveReminderAnchor(e,event,a))/3600,23);
});

test('unchanged repeated-hour anchors preserve their second-fold selection',()=>{
 const e={...s,eventDate:'2026-11-01',eventTime:'08:00 PM'},event=m.scheduleEventUtc(e),a={kind:'DAY',days:0,time:'01:30 AM',fold:'SECOND'};
 const v=m.reminderCalendarFields(e,event,a);assert.deepEqual(m.reminderCalendarAnchor(e,event,v.date,v.time,a),a);
});
