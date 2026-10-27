import test from 'node:test';import assert from 'node:assert/strict';
import {isReservedCommandName,validateCommandNamesForAddon,mergeSavedVariables} from '../src/model.js';
import {parseSavedVariables} from '../src/lua-data.js';
test('native built-in action names are reserved in all editor contexts',()=>{
 for(const name of ['on','OFF','schedule','status','retry','resetcooldowns','send','scm','scmdebug','/On','o-n'])assert.equal(isReservedCommandName(name),true,name);
 assert.equal(isReservedCommandName('recruit'),false);
 assert.throws(()=>validateCommandNamesForAddon({Default:{'@fixture':{$AccountWide:{commands:{1:{id:'a',name:'off'}}}}}}),/reserved/);
});
test('latest ESO scheduled sending switch survives web edits',()=>{
 const base=parseSavedVariables('SmartChatMsgSavedVars = { ["Default"] = { ["@fixture"] = { ["$AccountWide"] = { ["scheduledSendingEnabled"] = true, ["revertChatSeconds"] = 60 } } } }');
 const edited=structuredClone(base),latest=structuredClone(base);edited.Default['@fixture'].$AccountWide.revertChatSeconds=90;latest.Default['@fixture'].$AccountWide.scheduledSendingEnabled=false;
 const result=mergeSavedVariables(base,edited,latest);assert.deepEqual(result.conflicts,[]);assert.equal(result.data.Default['@fixture'].$AccountWide.scheduledSendingEnabled,false);assert.equal(result.data.Default['@fixture'].$AccountWide.revertChatSeconds,90);
});
