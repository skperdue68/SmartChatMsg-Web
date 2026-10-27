import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {setLuaValue,writeSavedVariables,parseSavedVariables} from '../src/lua-data.js';
const source=fs.readFileSync(new URL('../public/portable.js',import.meta.url),'utf8').replaceAll('"/model.js"',JSON.stringify(new URL('../src/model.js',import.meta.url).href)).replaceAll('"/lua-data.js"',JSON.stringify(new URL('../src/lua-data.js',import.meta.url).href));
const {exportEventBundle,readEventBundle,importEventBundle}=await import('data:text/javascript;base64,'+Buffer.from(source+'\n//# sourceURL=ordinary-pool-portable-test.js').toString('base64'));
const seq=items=>{const out={};items.forEach((v,i)=>setLuaValue(out,i+1,v));return out;};
function fixture(prefix,slot=1,mode='ON_DEMAND'){
 return {commands:seq([{id:prefix,name:'Pool'}]),messages:seq([{id:prefix+'-a',commandId:prefix,guildName:'Guild',guildIndex:slot,text:'First',useCount:7},{id:prefix+'-b',commandId:prefix,guildName:'Guild',guildIndex:slot,text:'Second',useCount:8}]),guildRoster:seq([{guildName:'Guild',guildIndex:slot}]),guildRosterUpdatedAt:123,schedulingTimeZone:'ET',commandGuildSettings:{[prefix]:{Guild:{runAt:mode,lastUsedAt:456,customOption:'keep'}}}};
}
const settings=(a,id)=>a.commandGuildSettings[id].Guild;
test('ordinary disabled message selection remaps source IDs to matched recipient IDs and survives repeated import',()=>{
 for(const mode of ['ON_DEMAND','STARTUP']){
  const remote=fixture('remote',1,mode),local=fixture('local',4);settings(remote,'remote').disabledMessageIds={'remote-b':true};
  const document=exportEventBundle(remote,'Guild',['remote']);assert.deepEqual(document.items[0].settings.disabledMessageIds,{'remote-b':true});
  const first=importEventBundle(local,document,[0]).account;assert.equal(settings(first,'local').disabledMessageIds['local-b'],true);assert.equal(settings(first,'local').disabledMessageIds['remote-b'],undefined);assert.equal(first.messages[2].useCount,8);assert.equal(first.messages[2].guildIndex,4);assert.equal(settings(first,'local').customOption,'keep');
  const second=importEventBundle(first,document,[0]).account;assert.equal(Object.keys(second.messages).length,2);assert.equal(settings(second,'local').disabledMessageIds['local-b'],true);
 }
});
test('absent map enables all public entries while locked personal state is excluded from exports and preserved on import',()=>{
 const remote=fixture('remote'),local=fixture('local');setLuaValue(remote.messages,3,{id:'source-private',commandId:'remote',guildName:'Guild',guildIndex:1,text:'SOURCE PRIVATE',locked:true});settings(remote,'remote').disabledMessageIds={'source-private':true,'deleted-source':true,'remote-a':false};
 setLuaValue(local.messages,3,{id:'private-disabled',commandId:'local',guildName:'Guild',guildIndex:1,text:'PRIVATE DISABLED',locked:true});setLuaValue(local.messages,4,{id:'private-enabled',commandId:'local',guildName:'Guild',guildIndex:1,text:'PRIVATE ENABLED',locked:true});settings(local,'local').disabledMessageIds={'local-a':true,'private-disabled':true,'private-enabled':false,'deleted-local':true};
 const document=exportEventBundle(remote,'Guild',['remote']);assert.doesNotMatch(JSON.stringify(document),/source-private|deleted-source|SOURCE PRIVATE/);assert.equal(document.items[0].settings.disabledMessageIds,undefined);
 const result=importEventBundle(local,document,[0]).account,map=settings(result,'local').disabledMessageIds;assert.equal(map['local-a'],undefined);assert.equal(map['private-disabled'],true);assert.equal(map['private-enabled'],undefined);assert.equal(map['deleted-local'],undefined);assert.equal(settings(result,'local').lastUsedAt,456);
});
test('strict pool map validation rejects unknown payload IDs and nonboolean flags; false means enabled',()=>{
 const document=exportEventBundle(fixture('remote'),'Guild',['remote']);
 for(const map of [{'missing':true},{'missing':false},{'remote-a':'true'},{'remote-a':1},[]]){document.items[0].settings.disabledMessageIds=map;assert.throws(()=>readEventBundle(document),/disabled|message|pool/i);}
 document.items[0].settings.disabledMessageIds={'remote-a':false};const normalized=readEventBundle(document);assert.equal(normalized.items[0].settings.disabledMessageIds,undefined);
});
test('scheduled roundtrips retain inactive ordinary selections without changing timeline reminder pools',()=>{
 const remote=fixture('remote',1,'SCHEDULED'),local=fixture('local',4),schedule={timelineVersion:1,mode:'EVENT',eventDate:'2026-10-28',eventTime:'08:00 PM',timeZone:'ET',recurrence:'WEEKLY',reminders:seq([{id:'row',label:'Notice',start:{kind:'OFFSET',minutes:-60},finish:{kind:'OFFSET',minutes:0},once:false,timeSensitive:false,intervalMinutes:15,lateMinutes:5,messageIds:seq(['remote-a','remote-b'])}])};
 settings(remote,'remote').schedule=schedule;settings(remote,'remote').disabledMessageIds={'remote-b':true};
 const document=exportEventBundle(remote,'Guild',['remote']);assert.deepEqual(Object.values(document.items[0].schedule.reminders[1].messageIds),['remote-a','remote-b']);assert.equal(document.items[0].settings.disabledMessageIds['remote-b'],true);
 const out=importEventBundle(local,document,[0]).account,config=settings(out,'local');assert.equal(config.disabledMessageIds['local-b'],true);assert.deepEqual(Object.values(config.schedule.reminders[1].messageIds),['local-a','local-b']);assert.equal(config.runAt,'SCHEDULED');
 const native=parseSavedVariables(writeSavedVariables(out));assert.equal(settings(native,'local').disabledMessageIds['local-b'],true);
});
test('locked recipient matches retain enabled state even when incoming matching text is disabled',()=>{
 const remote=fixture('remote'),local=fixture('local');remote.messages[1].name='Shared label';local.messages[1].locked=true;settings(remote,'remote').disabledMessageIds={'remote-a':true};
 const out=importEventBundle(local,exportEventBundle(remote,'Guild',['remote']),[0]).account;assert.equal(settings(out,'local').disabledMessageIds,undefined);assert.equal(out.messages[1].locked,true);assert.equal(out.messages[1].useCount,7);
});
test('new-message UUID collisions remap disabled IDs while other guilds and commands remain untouched',()=>{
 const remote=fixture('remote'),local=fixture('local',4);remote.messages[1].text='Entirely new text';settings(remote,'remote').disabledMessageIds={'remote-a':true};
 setLuaValue(local.commands,2,{id:'other',name:'Other'});setLuaValue(local.messages,3,{id:'remote-a',commandId:'other',guildName:'Other Guild',guildIndex:2,text:'Other entry'});local.commandGuildSettings.other={'Other Guild':{runAt:'STARTUP',disabledMessageIds:{'remote-a':true}}};
 const out=importEventBundle(local,exportEventBundle(remote,'Guild',['remote']),[0]).account,added=Object.values(out.messages).find(message=>message.text==='Entirely new text');assert.ok(added);assert.notEqual(added.id,'remote-a');assert.equal(added.guildIndex,4);assert.equal(settings(out,'local').disabledMessageIds[added.id],true);assert.equal(out.commandGuildSettings.other['Other Guild'].disabledMessageIds['remote-a'],true);assert.equal(out.messages[3].text,'Other entry');
});
test('identical-text ordinary entries retain distinct enabled/disabled membership after sharing',()=>{
 const remote=fixture('remote'),local=fixture('local');remote.messages[2].text='First';local.messages[2].text='First';settings(remote,'remote').disabledMessageIds={'remote-b':true};
 const out=importEventBundle(local,exportEventBundle(remote,'Guild',['remote']),[0]).account,map=settings(out,'local').disabledMessageIds;assert.equal(Object.keys(out.messages).length,2);assert.equal(map['local-a'],undefined);assert.equal(map['local-b'],true);
});
test('ordinary text fallback cannot claim another incoming entry’s exact stable recipient ID',()=>{
 const remote=fixture('remote'),local=fixture('local');remote.messages[1].text='Second';remote.messages[2].id='local-b';remote.messages[2].text='Changed exact entry';settings(remote,'remote').disabledMessageIds={'remote-a':true};
 const out=importEventBundle(local,exportEventBundle(remote,'Guild',['remote']),[0]).account,exact=Object.values(out.messages).find(message=>message.id==='local-b'),copy=Object.values(out.messages).find(message=>message.text==='Second'&&message.id!=='local-b');assert.equal(exact.text,'Changed exact entry');assert.ok(copy);assert.equal(settings(out,'local').disabledMessageIds[copy.id],true);assert.equal(settings(out,'local').disabledMessageIds['local-b'],undefined);
});
test('ordinary text matching ignores dormant faction and activity variants so unchecked imports leave no enabled duplicate',()=>{
 for(const variant of ['AD','activity-stable-id']){
  const remote=fixture('remote'),local=fixture('local');settings(remote,'remote').disabledMessageIds={'remote-a':true,'remote-b':true};settings(local,'local').schedule={specialPattern:variant==='AD'?'FACTION_ROTATION':'EVENT_ROTATION',messageVariants:{'local-a':variant,'local-b':variant}};
  const out=importEventBundle(local,exportEventBundle(remote,'Guild',['remote']),[0]).account,map=settings(out,'local').disabledMessageIds;assert.equal(Object.keys(out.messages).length,2);assert.equal(map['local-a'],true);assert.equal(map['local-b'],true);assert.equal(settings(out,'local').schedule.messageVariants['local-a'],variant);
 }
});
