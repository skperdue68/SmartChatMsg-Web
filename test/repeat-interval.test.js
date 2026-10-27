import test from 'node:test';
import assert from 'node:assert/strict';
import {formatRepeatInterval} from '../src/model.js';

test('overview repeat intervals scale through days without dropping minutes', () => {
  for (const [minutes, expected] of [[1,'1 minute'],[59,'59 minutes'],[60,'1 hour'],[120,'2 hours'],[125,'2 hours 5 minutes'],[1440,'1 day'],[1500,'1 day 1 hour'],[2945,'2 days 1 hour 5 minutes']]) {
    assert.equal(formatRepeatInterval(minutes), expected);
  }
});
