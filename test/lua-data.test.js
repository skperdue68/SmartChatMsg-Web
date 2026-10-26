import test from "node:test";
import assert from "node:assert/strict";
import { parseSavedVariables, writeSavedVariables } from "../src/lua-data.js";
test("roundtrip retains sparse keys, accounts, escaped content and cooldowns", () => {
  const source =
    'SmartChatMsgSavedVars = { ["Default"] = { ["@evainefaye"] = { ["$AccountWide"] = { ["lastUsedAt"] = 1791449829, ["messages"] = { [2] = { ["text"] = "Mafia \\"family\\"\\nhello", ["id"] = "x", }, }, }, }, }, }';
  const a = parseSavedVariables(source);
  assert.equal(a.Default["@evainefaye"].$AccountWide.lastUsedAt, 1791449829);
  assert.deepEqual(parseSavedVariables(writeSavedVariables(a)), a);
});
test("rejects executable code and duplicate keys without executing Lua", () => {
  for (const source of [
    'SmartChatMsgSavedVars = os.execute("oops")',
    'SmartChatMsgSavedVars = {}; print("oops")',
    'SmartChatMsgSavedVars = { ["x"]=1,["x"]=2 }',
  ])
    assert.throws(() => parseSavedVariables(source));
});
test("rejects oversized, deeply nested and prototype keys", () => {
  assert.throws(() =>
    parseSavedVariables(
      "SmartChatMsgSavedVars = " + "{".repeat(150) + "}".repeat(150),
    ),
  );
  const a = parseSavedVariables(
    'SmartChatMsgSavedVars = { ["__proto__"]={ ["ok"]=true } }',
  );
  assert.equal(Object.getPrototypeOf(a), null);
  assert.equal(a.__proto__.ok, true);
  assert.equal({}.ok, undefined);
});

test("preserves numeric table keys separately from quoted numeric strings", () => {
  const a = parseSavedVariables(
    'SmartChatMsgSavedVars = { [1] = { ["1"] = "text" } }',
  );
  const result = writeSavedVariables(a);
  assert.match(result, /\[1\]/);
  assert.match(result, /\["1"\]/);
});
// Independent byte reader for the writer's quoted Lua output. It does not use
// the production parser and compares Lua string bytes, not JS display strings.
function literalBytes(literal) {
  const bytes=[];
  for(let index=1;index<literal.length-1;){
    if(literal[index]==='\\'){
      index++;
      const digits=/^\d{1,3}/.exec(literal.slice(index));
      if(digits){bytes.push(Number(digits[0]));index+=digits[0].length;}
      else {bytes.push(literal.charCodeAt(index++));}
    } else {
      const point=literal.codePointAt(index),character=String.fromCodePoint(point);
      bytes.push(...Buffer.from(character,'utf8'));index+=character.length;
    }
  }
  return Buffer.from(bytes);
}
function writtenValueBytes(data){const output=writeSavedVariables(data),literal=/\["value"\] = ("(?:\\.|[^"\\])*"),/.exec(output)?.[1];assert.ok(literal);return literalBytes(literal);}
test('escaped UTF-8 bytes display like literal Unicode in values and guild keys',()=>{
  const escaped=parseSavedVariables(String.raw`SmartChatMsgSavedVars={value="\195\169",["Caf\195\169"]="guild"}`),literal=parseSavedVariables('SmartChatMsgSavedVars={value="é",["Café"]="guild"}');
  assert.deepEqual(escaped,literal);assert.equal(escaped.value,'é');assert.equal(escaped['Café'],'guild');assert.deepEqual(writtenValueBytes(escaped),Buffer.from([195,169]));
});
test('mixed escaped invalid byte, Unicode emoji and controls retain exact Lua bytes',()=>{
  const parsed=parseSavedVariables(String.raw`SmartChatMsgSavedVars={value="é\255😀\000\n\127\195\169\240\159\152\128"}`);
  assert.equal(parsed.value,'é\udcff😀\0\n\x7fé😀');
  const expected=Buffer.concat([Buffer.from('é','utf8'),Buffer.from([255]),Buffer.from('😀','utf8'),Buffer.from([0,10,127]),Buffer.from('é😀','utf8')]);
  assert.deepEqual(writtenValueBytes(parsed),expected);assert.deepEqual(parseSavedVariables(writeSavedVariables(parsed)),parsed);assert.match(writeSavedVariables(parsed),/\\255/);assert.match(writeSavedVariables(parsed),/😀/);
});
test('all byte values and malformed UTF-8 remain byte-identical after export',()=>{
  for(const bytes of [Array.from({length:256},(_,index)=>index),[224,128,128,237,160,128,244,144,128,128,192,175,128,194],[244,143,191,191,240,159,152,128]]){
    const source='SmartChatMsgSavedVars={value="'+bytes.map(x=>'\\'+String(x).padStart(3,'0')).join('')+'"}',data=parseSavedVariables(source);
    assert.deepEqual(writtenValueBytes(data),Buffer.from(bytes));assert.deepEqual(parseSavedVariables(writeSavedVariables(data)),data);
  }
});
