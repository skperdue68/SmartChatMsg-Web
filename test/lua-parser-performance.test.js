import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedVariables, writeSavedVariables } from '../src/lua-data.js';

const wrap = body => `SmartChatMsgSavedVars = { Default = { ["@x"] = { ["$AccountWide"] = { value = ${body} } } } }`;
const parse = body => parseSavedVariables(wrap(body));
const read = body => parse(body).Default['@x'].$AccountWide.value;

// Security regression: the parser is synchronous and runs on the server's single thread
// for every upload. A 20 MiB string used to block it for roughly 30 seconds.
test('a maximum-size string is parsed without blocking the thread for seconds', () => {
  const length = 20 * 1024 * 1024 - 200;
  const text = wrap('"' + 'a'.repeat(length) + '"');
  const started = performance.now();
  const value = parseSavedVariables(text).Default['@x'].$AccountWide.value;
  const elapsed = performance.now() - started;
  assert.equal(value.length, length);
  assert.ok(elapsed < 3000, `parsing took ${Math.round(elapsed)} ms`);
});

test('string decoding keeps its previous behaviour', () => {
  assert.equal(read('"plain"'), 'plain');
  assert.equal(read("'single \"quoted\"'"), 'single "quoted"');
  assert.equal(read('"tab\\tnew\\nquote\\"back\\\\slash"'), 'tab\tnew\nquote"back\\slash');
  assert.equal(read('"café ✓ 😀"'), 'café ✓ 😀');
  assert.equal(read('"\\104\\105"'), 'hi');
  assert.equal(read('"a\\\nb"'), 'a\nb');
  assert.equal(read('"\\239\\187\\191x"'), '﻿x', 'a byte-order mark inside a string is data, not stripped');
});

test('invalid UTF-8 bytes still round-trip losslessly', () => {
  const data = parse('"ok \\200 \\255 end"');
  const written = writeSavedVariables(data);
  assert.ok(written.includes('\\200') && written.includes('\\255'));
  assert.equal(parseSavedVariables(written).Default['@x'].$AccountWide.value, data.Default['@x'].$AccountWide.value);
});

test('malformed strings are still rejected', () => {
  assert.throws(() => read('"unterminated'), /Unterminated string/);
  assert.throws(() => read('"bad \\q escape"'), /Unsupported escape/);
  assert.throws(() => read('"\\256"'), /Invalid byte escape/);
  assert.throws(() => parse('"lone \ud800 surrogate"'), /isolated Unicode surrogate/);
  assert.throws(() => parse('"lone \udc00 surrogate"'), /isolated Unicode surrogate/);
});
