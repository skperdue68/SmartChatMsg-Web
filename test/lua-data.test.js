import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSavedVariables,writeSavedVariables} from '../src/lua-data.js';
test('roundtrip retains sparse keys, accounts, escaped content and cooldowns',()=>{
 const source='SmartChatMsgSavedVars = { ["Default"] = { ["@evainefaye"] = { ["$AccountWide"] = { ["lastUsedAt"] = 1791449829, ["messages"] = { [2] = { ["text"] = "Mafia \\"family\\"\\nhello", ["id"] = "x", }, }, }, }, }, }';
 const a=parseSavedVariables(source); assert.equal(a.Default['@evainefaye'].$AccountWide.lastUsedAt,1791449829);
 assert.deepEqual(parseSavedVariables(writeSavedVariables(a)),a);
});
test('rejects executable code and duplicate keys without executing Lua',()=>{
 for(const source of ['SmartChatMsgSavedVars = os.execute("oops")','SmartChatMsgSavedVars = {}; print("oops")','SmartChatMsgSavedVars = { ["x"]=1,["x"]=2 }'])assert.throws(()=>parseSavedVariables(source));
});
test('rejects oversized, deeply nested and prototype keys',()=>{
 assert.throws(()=>parseSavedVariables('SmartChatMsgSavedVars = '+ '{'.repeat(150)+'}'.repeat(150)));
 const a=parseSavedVariables('SmartChatMsgSavedVars = { ["__proto__"]={ ["ok"]=true } }');
 assert.equal(Object.getPrototypeOf(a),null); assert.equal(a.__proto__.ok,true); assert.equal({}.ok,undefined);
});

test('preserves numeric table keys separately from quoted numeric strings',()=>{
 const a=parseSavedVariables('SmartChatMsgSavedVars = { [1] = { ["1"] = "text" } }');
 const result=writeSavedVariables(a);assert.match(result,/\[1\]/);assert.match(result,/\["1"\]/);
});
