import test from 'node:test';
import assert from 'node:assert/strict';
import { schedulingSlider, schedulingValue, schedulingLabel } from '../public/scheduling-sliders.js';

test('compact scheduling sliders define the requested bounds and sentinels', () => {
  for (const [key,min,max] of [['eventDurationMinutes',0,240],['recurrenceInterval',1,10],['intervalMinutes',1,1440],['maxPerDay',0,20]]) {
    const html=schedulingSlider(key,undefined);
    assert.match(html,new RegExp(`min="${min}" max="${max}" step="1"`));
    assert.match(html,/type="range"/);
    assert.match(html,/<output/);
  }
  assert.equal(schedulingValue({value:'0',dataset:{schedulingSlider:'eventDurationMinutes'}}),null);
  assert.equal(schedulingValue({value:'0',dataset:{schedulingSlider:'maxPerDay'}}),undefined);
  assert.equal(schedulingValue({value:'120',dataset:{schedulingSlider:'eventDurationMinutes'}}),120);
});

test('existing values outside the slider bounds survive until deliberate slider input', () => {
  for (const [key,value] of [['eventDurationMinutes',480],['recurrenceInterval',12],['intervalMinutes',2880],['maxPerDay',50]]) {
    assert.match(schedulingSlider(key,value),new RegExp(`data-slider-original="${value}"`));
    assert.equal(schedulingValue({value:'10',dataset:{schedulingSlider:key,sliderOriginal:String(value)}}),value);
  }
});

test('readable labels distinguish unset duration, unlimited daily cap, and recurrence units', () => {
  assert.equal(schedulingLabel('eventDurationMinutes',0),'Not set');
  assert.equal(schedulingLabel('maxPerDay',0),'Unlimited');
  assert.equal(schedulingLabel('eventDurationMinutes',125),'2 hours 5 min');
  assert.equal(schedulingLabel('intervalMinutes',1440),'24 hours');
  assert.equal(schedulingLabel('recurrenceInterval',2,'WEEKLY'),'Every 2 weeks');
  assert.equal(schedulingLabel('recurrenceInterval',1,'MONTHLY_DATE'),'Every 1 month');
  assert.equal(schedulingLabel('recurrenceInterval',2,'BIWEEKLY'),'Every 2 two-week periods');
});
