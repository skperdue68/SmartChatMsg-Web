import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setLuaValue,writeSavedVariables,parseSavedVariables,isLuaNumericKey} from '../src/lua-data.js';
const portableSource=fs.readFileSync(new URL('../public/portable.js',import.meta.url),'utf8').replaceAll('"./model.js"',JSON.stringify(new URL('../src/model.js',import.meta.url).href)).replaceAll('"./lua-data.js"',JSON.stringify(new URL('../src/lua-data.js',import.meta.url).href));
const {exportEventBundle,readEventBundle,reviewEventImport,importEventBundle}=await import('data:text/javascript;base64,'+Buffer.from(portableSource+'\n//# sourceURL=command-settings-sharing-test.js').toString('base64'));
const seq=items=>{const table={};items.forEach((item,i)=>setLuaValue(table,i+1,item));return table;};
const plain=value=>JSON.parse(JSON.stringify(value));
const commandOptions={runAt:'STARTUP',reminderMinutes:90,reminderRetryMinutes:15,autoPopulateCooldownMinutes:120,autoPopulateOnZone:false,openStatusPanelOnRun:true,populateSound:'CHAMPION_POINT_GAINED'};
function account(id,slot,settings={}){
 return {
  commands:seq([{id,name:'Announcements'}]),messages:seq([{id:id+'-m',commandId:id,guildName:'Shared Guild',guildIndex:slot,text:'Welcome %guild%',useCount:7,lastUsedAt:99}]),
  guildRoster:seq([{guildName:'Shared Guild',guildIndex:slot}]),guildRosterUpdatedAt:123,
  defaultGuildIndex:slot,revertChatSeconds:slot===1?45:90,schedulingTimeZone:slot===1?'ET':'PT',selectedCommand:id,statusPanelState:{visible:true,offsetX:-40,offsetY:180},
  commandGuildSettings:{[id]:{'shared guild':{runAt:'ON_DEMAND',reminderMinutes:10,reminderRetryMinutes:5,autoPopulateCooldownMinutes:60,autoPopulateOnZone:false,openStatusPanelOnRun:false,populateSound:'DUEL_START',lastUsedAt:123,lastUsedGuildIndex:slot,lastUsedParamText:'local params',lastAutoPopulateSentAtByZone:{stonefalls:456},observedChatCooldowns:{peer:{at:789}},...settings}}},
  chatChannels:{[id]:{'shared guild':'Officer'}},
 };
}
test('portable command settings preserve every option by guild name across different recipient guild slots',()=>{
 const source=account('source',1,commandOptions),recipient=account('recipient',4),document=exportEventBundle(source,'shared guild',['source']);
 assert.deepEqual(document.items[0].settings,commandOptions);assert.equal(document.items[0].schedule,null);assert.equal(reviewEventImport(document,recipient)[0].action,'Update');
 const result=importEventBundle(recipient,JSON.parse(JSON.stringify(document)),[0]).account,settings=result.commandGuildSettings.recipient['shared guild'];
 for(const [key,value]of Object.entries(commandOptions))assert.equal(settings[key],value,key);
 assert.equal(result.messages[1].commandId,'recipient');assert.equal(result.messages[1].guildIndex,4);assert.equal(result.messages[1].useCount,7);assert.equal(result.chatChannels.recipient['shared guild'],'Officer');
 assert.equal(settings.lastUsedGuildIndex,4);assert.equal(settings.lastUsedAt,123);assert.equal(settings.lastUsedParamText,'local params');assert.equal(settings.lastAutoPopulateSentAtByZone.stonefalls,456);assert.equal(settings.observedChatCooldowns.peer.at,789);
 assert.equal(result.defaultGuildIndex,4);assert.equal(result.revertChatSeconds,90);assert.equal(result.schedulingTimeZone,'PT');assert.equal(result.guildRoster[1].guildIndex,4);
 const repeated=importEventBundle(result,document,[0]).account;assert.equal(Object.keys(repeated.commands).length,1);assert.equal(Object.keys(repeated.messages).length,1);assert.deepEqual(plain(repeated.commandGuildSettings),plain(result.commandGuildSettings));
});
test('shared settings exclude account preferences, recipient slots, runtime and private entries',()=>{
 const source=account('source',1,commandOptions);setLuaValue(source.messages,2,{id:'private',commandId:'source',guildName:'Shared Guild',guildIndex:1,text:'PRIVATE MESSAGE',locked:true});
 const document=exportEventBundle(source,'shared guild',['source']),serialized=JSON.stringify(document);
 assert.doesNotMatch(serialized,/defaultGuildIndex|revertChatSeconds|schedulingTimeZone|guildRoster|guildIndex|lastUsed|lastAutoPopulate|observedChatCooldowns|useCount|statusPanelState|selectedCommand|PRIVATE MESSAGE/);
 assert.deepEqual(readEventBundle(document).items[0].settings,commandOptions);
});
test('full SavedVariables Lua roundtrip retains account-global preferences, runtime and numeric guild roster keys',()=>{
 const a=account('source',1,commandOptions),data={Default:{'@Source':{$AccountWide:a}}},roundtrip=parseSavedVariables(writeSavedVariables(data)).Default['@Source'].$AccountWide;
 assert.equal(roundtrip.defaultGuildIndex,1);assert.equal(roundtrip.revertChatSeconds,45);assert.equal(roundtrip.schedulingTimeZone,'ET');assert.equal(roundtrip.statusPanelState.offsetX,-40);assert.equal(roundtrip.commandGuildSettings.source['shared guild'].lastAutoPopulateSentAtByZone.stonefalls,456);assert.equal(roundtrip.messages[1].useCount,7);assert.ok(isLuaNumericKey(roundtrip.guildRoster,'1'));
 for(const [key,value]of Object.entries(commandOptions))assert.equal(roundtrip.commandGuildSettings.source['shared guild'][key],value,key);
});
test('explicit false, zero retry, and NONE sound roundtrip without replacement by defaults',()=>{
 const options={...commandOptions,runAt:'ON_DEMAND',reminderRetryMinutes:0,autoPopulateOnZone:false,openStatusPanelOnRun:false,populateSound:'NONE'},source=account('source',1,options),recipient=account('recipient',4),result=importEventBundle(recipient,exportEventBundle(source,'shared guild',['source']),[0]).account.commandGuildSettings.recipient['shared guild'];
 for(const [key,value]of Object.entries(options))assert.equal(result[key],value,key);
});
test('sharing a disabled repeat clears the recipient repeat before applying zone behavior',()=>{
 const source=account('source',1,{...commandOptions,runAt:'ON_DEMAND',autoPopulateOnZone:true,reminderRetryMinutes:0});delete source.commandGuildSettings.source['shared guild'].reminderMinutes;
 const recipient=account('recipient',4),document=exportEventBundle(source,'shared guild',['source']),settings=importEventBundle(recipient,document,[0]).account.commandGuildSettings.recipient['shared guild'];
 assert.equal(settings.autoPopulateOnZone,true);assert.ok(settings.reminderMinutes===undefined||settings.reminderMinutes===0,'recipient repeat must be off when the shared source has no repeat');
});

test('omitted shared configuration resets only known command options and preserves extra settings, runtime and locked messages',()=>{
 const source=account('source',1),incoming=source.commandGuildSettings.source['shared guild'];for(const key of ['reminderMinutes','reminderRetryMinutes','autoPopulateCooldownMinutes','autoPopulateOnZone','openStatusPanelOnRun','populateSound'])delete incoming[key];
 const recipient=account('recipient',4,commandOptions),settings=recipient.commandGuildSettings.recipient['shared guild'];settings.futureOption={keep:true};settings.schedule={availabilityUsage:{'r:2026-10-27':{count:2,lastAt:123}},timelineUsage:{'123:r':{completed:true}}};
 setLuaValue(recipient.messages,2,{id:'private',commandId:'recipient',guildName:'Shared Guild',guildIndex:4,text:'PRIVATE',locked:true,useCount:12});
 const out=importEventBundle(recipient,exportEventBundle(source,'shared guild',['source']),[0]).account,result=out.commandGuildSettings.recipient['shared guild'];
 assert.equal(result.runAt,'ON_DEMAND');for(const key of ['reminderMinutes','reminderRetryMinutes','autoPopulateCooldownMinutes','autoPopulateOnZone','openStatusPanelOnRun','populateSound'])assert.equal(result[key],undefined,key);
 assert.equal(result.futureOption.keep,true);assert.equal(result.lastUsedAt,123);assert.equal(result.schedule.availabilityUsage['r:2026-10-27'].count,2);assert.equal(result.schedule.timelineUsage['123:r'].completed,true);assert.equal(out.messages[2].text,'PRIVATE');assert.equal(out.messages[2].useCount,12);assert.equal(out.messages[2].locked,true);
});

 test('condensed date/time command setting survives bundles and validates boolean type',()=>{
 for(const condensedDateTime of [true,false]){
 const source=account('source',1,{...commandOptions,condensedDateTime}),bundle=exportEventBundle(source,'shared guild',['source']);
 assert.equal(readEventBundle(bundle).items[0].settings.condensedDateTime,condensedDateTime);
 const native=parseSavedVariables(writeSavedVariables({Default:{'@Source':{$AccountWide:source}}}));
 assert.equal(native.Default['@Source'].$AccountWide.commandGuildSettings.source['shared guild'].condensedDateTime,condensedDateTime);
 const imported=importEventBundle(account('recipient',4),bundle,[0]).account;
 assert.equal(imported.commandGuildSettings.recipient['shared guild'].condensedDateTime,condensedDateTime);
 }
 const bundle=exportEventBundle(account('source',1,commandOptions),'shared guild',['source']);bundle.items[0].settings.condensedDateTime='true';
 assert.throws(()=>readEventBundle(bundle),/Invalid command option/);
 });
