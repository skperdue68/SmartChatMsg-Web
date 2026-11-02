import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function stepOverviewDate('),source.indexOf('function renderCalendar()'));
const {stepOverviewDate:step,overviewPeriodLabel:label}=vm.runInNewContext(helpers+';({stepOverviewDate,overviewPeriodLabel})');
test('overview weeks advance civil dates across DST and year boundaries',()=>{
 for(const [from,to] of [['2026-03-07','2026-03-14'],['2026-10-31','2026-11-07'],['2026-12-28','2027-01-04']]){
 assert.equal(step(from,'week',1),to);assert.equal(step(to,'week',-1),from);
 }
});
test('overview month navigation starts at first day without overflow from month end',()=>{
 assert.equal(step('2026-01-31','month',1),'2026-02-01');
 assert.equal(step('2026-03-31','month',-1),'2026-02-01');
 assert.equal(step('2026-12-31','month',1),'2027-01-01');
 assert.equal(step('2027-01-31','month',-1),'2026-12-01');
 assert.equal(label('2026-12-31','week'),'Dec 31, 2026 – Jan 6, 2027');
 assert.equal(label('2026-02-28','month'),'February 2026');
});
