import test from 'node:test';
import assert from 'node:assert/strict';
import { recurrenceDescription } from '../src/model.js';
test('sidebar frequency uses actual recurrence interval',()=>{
 for(const [recurrence,recurrenceInterval,expected] of [['NONE',1,'One-time event'],['DAILY',1,'Every day'],['DAILY',3,'Every 3 days'],['WEEKLY',1,'Every week'],['WEEKLY',2,'Every 2 weeks'],['BIWEEKLY',1,'Every 2 weeks'],['BIWEEKLY',2,'Every 4 weeks'],['MONTHLY_DATE',1,'Every month'],['MONTHLY_WEEKDAY',3,'Every 3 months']])assert.equal(recurrenceDescription({recurrence,recurrenceInterval}),expected);
 assert.equal(recurrenceDescription({recurrence:'WEEKLY',interval:3}),'Every 3 weeks');
});
