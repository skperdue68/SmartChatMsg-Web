import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {guildNames,guildIndexFromRoster,mergeSavedVariables} from '../src/model.js';
import {setLuaValue,parseSavedVariables,writeSavedVariables} from '../src/lua-data.js';
const seq=items=>{const t={};items.forEach((v,i)=>setLuaValue(t,i+1,v));return t;};
const roster=()=>seq([{guildId:761817,guildIndex:4,guildName:'Alphabet Mafia'},{guildId:202,guildIndex:2,guildName:'Second Guild'}]);
test('cached roster supplies guild names and slots without commands or messages',()=>{
 const account={commands:{},messages:{},commandGuildSettings:{},guildRoster:roster()};
 assert.deepEqual([...guildNames(account)],[['alphabet mafia','Alphabet Mafia'],['second guild','Second Guild']]);assert.equal(guildIndexFromRoster(account,'ALPHABET MAFIA'),4);
 account.guildRoster[3]={guildIndex:0,guildName:'Bad slot'};account.guildRoster[4]={guildIndex:5,guildName:''};assert.equal(guildNames(account).size,2);
});
test('older files keep guild discovery and newer roster metadata wins on runtime merge',()=>{
 const old={commands:seq([{id:'c',name:'Test'}]),commandGuildSettings:{c:{alpha:{}}},messages:seq([{guildName:'Beta'}]),guildSchedulingTimeZones:{gamma:'ET'}};
 assert.deepEqual([...guildNames(old).keys()].sort(),['alpha','beta','gamma']);
 const base={guildRoster:roster(),guildRosterUpdatedAt:1,setting:'old'},edited=parseSavedVariables(writeSavedVariables(base)),latest=parseSavedVariables(writeSavedVariables(base));edited.setting='edited';latest.guildRoster[1].guildIndex=1;latest.guildRosterUpdatedAt=99;
 const merged=mergeSavedVariables(base,edited,latest);assert.deepEqual(merged.conflicts,[]);assert.equal(merged.data.guildRoster[1].guildIndex,1);assert.equal(merged.data.guildRosterUpdatedAt,99);assert.equal(merged.data.setting,'edited');
 const older={setting:'old'};assert.equal(mergeSavedVariables(base,edited,older).data.guildRoster[1].guildName,'Alphabet Mafia');
});
test('event imports into an empty account use cached guild identity and destination slot',async()=>{
 const source=fs.readFileSync(new URL('../public/portable.js',import.meta.url),'utf8').replaceAll('"./model.js"',JSON.stringify(new URL('../src/model.js',import.meta.url).href)).replaceAll('"./lua-data.js"',JSON.stringify(new URL('../src/lua-data.js',import.meta.url).href));
 const {exportEventBundle,reviewEventImport,importEventBundle}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const remote={commands:seq([{id:'c',name:'Test'}]),messages:seq([{id:'m',commandId:'c',guildIndex:1,guildName:'Alphabet Mafia',text:'Hello'}]),commandGuildSettings:{c:{'alphabet mafia':{runAt:'ON_DEMAND'}}},schedulingTimeZone:'ET'};
 const local={commands:{},messages:{},commandGuildSettings:{},guildRoster:roster(),guildRosterUpdatedAt:123,schedulingTimeZone:'ET'};
 const bundle=exportEventBundle(remote,'alphabet mafia',['c']);assert.equal(reviewEventImport(bundle,local)[0].reason,null);
 const imported=importEventBundle(local,bundle,[0]).account;assert.equal(imported.messages[1].guildIndex,4);assert.equal(imported.messages[1].guildName.toLowerCase(),'alphabet mafia');assert.equal(writeSavedVariables(imported.guildRoster),writeSavedVariables(local.guildRoster));
 const mixed={...local,commands:seq([{id:'c',name:'Test'}]),commandGuildSettings:{c:{'Alphabet Mafia':{runAt:'ON_DEMAND',custom:'keep'}}}};assert.equal(reviewEventImport(bundle,mixed)[0].action,'Update');const matched=importEventBundle(mixed,bundle,[0]).account;assert.deepEqual(Object.keys(matched.commandGuildSettings.c),['Alphabet Mafia']);assert.equal(matched.commandGuildSettings.c['Alphabet Mafia'].custom,'keep');
 local.guildRoster=seq([{guildId:202,guildIndex:2,guildName:'Second Guild'}]);local.messages=remote.messages;assert.match(reviewEventImport(bundle,local)[0].reason,/No such guild/,'departed guild history is not current membership');
 local.guildRoster={};assert.match(reviewEventImport(bundle,local)[0].reason,/No such guild/,'authoritative empty roster prevents imports into departed guilds');
});
