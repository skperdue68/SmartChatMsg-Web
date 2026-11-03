import test from 'node:test';
import assert from 'node:assert/strict';
import { occurrenceTypeLabel, nextScheduleOccurrence, scheduleEventUtc, validateEventRotation } from '../src/model.js';
const schedule=()=>({mode:'EVENT',timelineVersion:1,eventDate:'2026-10-10',eventTime:'08:00 PM',timeZone:'ET',recurrence:'BIWEEKLY',specialPattern:'MONTH_FINAL',regularEventLabel:'Bi-weekly raffle',monthFinalEventLabel:'Bi-weekly + 50/50'});
test('labels follow actual last scheduled occurrence, not last calendar week',()=>{
 const s=schedule();for(const [date,label]of [['2026-10-10','Bi-weekly raffle'],['2026-10-24','Bi-weekly + 50/50'],['2027-01-16','Bi-weekly raffle'],['2027-01-30','Bi-weekly + 50/50']])assert.equal(occurrenceTypeLabel(s,scheduleEventUtc({...s,eventDate:date})),label);
 delete s.regularEventLabel;delete s.monthFinalEventLabel;assert.equal(occurrenceTypeLabel(s,scheduleEventUtc(s)),'Regular event');assert.equal(occurrenceTypeLabel(s,scheduleEventUtc({...s,eventDate:'2026-10-24'})),'Last event of month');
});
test('next summary selection advances across DST and identifies factions and rotating activities',()=>{
 const s=schedule(),next=nextScheduleOccurrence(s,scheduleEventUtc({...s,eventDate:'2026-10-25'}));assert.equal(next,scheduleEventUtc({...s,eventDate:'2026-11-07'}));assert.equal(occurrenceTypeLabel(s,next),'Bi-weekly raffle');
 assert.equal(occurrenceTypeLabel({...s,specialPattern:'FACTION_ROTATION',rotationFactions:{1:'EP',2:'AD'},rotationWeeks:4},scheduleEventUtc(s)),'Ebonheart Pact');
 assert.equal(occurrenceTypeLabel({...s,specialPattern:'EVENT_ROTATION',rotationEvents:{1:{id:'a',name:'Dragon trial'}},rotationEvery:1},scheduleEventUtc(s)),'Dragon trial');
 assert.equal(occurrenceTypeLabel({...s,specialPattern:'NONE'},next),'');
});
test('month-final labels are optional strings up to 80 characters',()=>{
 assert.deepEqual(validateEventRotation(schedule()),[]);assert.ok(validateEventRotation({...schedule(),regularEventLabel:7}).length);assert.ok(validateEventRotation({...schedule(),monthFinalEventLabel:'x'.repeat(81)}).length);
});
