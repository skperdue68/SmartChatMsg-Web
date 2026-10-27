import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setLuaValue,writeSavedVariables,parseSavedVariables,isLuaNumericKey} from '../src/lua-data.js';
import {mergeSavedVariables,eventVariant,rotationActivityName,projectedOccurrences,occurrenceCancellation,previewMessage,messagesForReminder,reminderWindows,validateEventRotation,validateTimelineForAddon,scheduleEventUtc} from '../src/model.js';
const seq=(items)=>{const o={};items.forEach((v,i)=>setLuaValue(o,i+1,v));return o;};
const fixture=(extra={})=>({timelineVersion:1,mode:'EVENT',eventDate:'2026-03-01',eventTime:'7:00 PM',timeZone:'ET',recurrence:'WEEKLY',specialPattern:'EVENT_ROTATION',rotationEvents:seq([{id:'a',name:'Activity 🐉'},{id:'b',name:'Second'}]),rotationEvery:1,messageVariants:{a:'a',b:'b',all:'ALL'},reminders:seq([{id:'r',label:'Reminder',start:{kind:'OFFSET',minutes:-60},finish:{kind:'OFFSET',minutes:0},messageIds:seq(['a','b','all'])}]),...extra});
const times=s=>projectedOccurrences(s,scheduleEventUtc(s),scheduleEventUtc(s)+100*86400,{includeCancelled:true});
test('rotation counts actual nominal occurrences across recurrence types and DST',()=>{
 for(const extra of [{},{recurrence:'BIWEEKLY'},{recurrence:'MONTHLY_DATE'},{recurrence:'MONTHLY_WEEKDAY'},{recurrence:'WEEKLY',recurrenceInterval:2,weekdays:{1:true,3:true}}]){
  const s=fixture(extra),at=times(s);assert.ok(at.length>=3);assert.deepEqual(at.slice(0,3).map(t=>eventVariant(s,t)),['a','b','a']);
  s.rotationEvery=2;assert.deepEqual(at.slice(0,3).map(t=>eventVariant(s,t)),['a','a','b']);
 }
});
test('KEEP, POSTPONE, off-cadence dates and undo preserve defined ordinal semantics',()=>{
 const s=fixture(),at=times(s);s.occurrenceExceptions={'2026-03-01':{action:'KEEP'}};
 assert.equal(occurrenceCancellation(s,at[0]),'KEEP');assert.equal(eventVariant(s,at[1]),'b');assert.equal(projectedOccurrences(s,at[0],at[1]).length,1);assert.deepEqual(reminderWindows(s,at[0]),[]);
 s.occurrenceExceptions['2026-03-01'].action='POSTPONE';assert.equal(eventVariant(s,at[1]),'a');assert.equal(eventVariant(s,at[2]),'b');
 s.occurrenceExceptions['2026-03-02']={action:'POSTPONE'};assert.equal(eventVariant(s,at[2]),'b');
 delete s.occurrenceExceptions['2026-03-01'];assert.equal(eventVariant(s,at[1]),'b');assert.deepEqual(validateTimelineForAddon(s),[]);
 s.occurrenceExceptions['2026-03-01']={action:'POSTPONE'};assert.deepEqual(validateTimelineForAddon(s),[]);
});
test('faction postponement subtracts civil cadence span including biweekly gaps',()=>{
 const s=fixture({specialPattern:'FACTION_ROTATION',rotationWeeks:1,recurrence:'BIWEEKLY',rotationFactions:seq(['AD','EP','DC'])}),at=times(s);
 assert.equal(eventVariant(s,at[1]),'DC');s.occurrenceExceptions={'2026-03-01':{action:'POSTPONE'}};assert.equal(eventVariant(s,at[1]),'AD');
});
test('activity tokens, pools and validation use stable IDs and Unicode names',()=>{
 const s=fixture(),at=times(s)[0];assert.equal(rotationActivityName(s,at),'Activity 🐉');
 assert.equal(previewMessage('%eventactivity% %eventactivity+1h% %eventactivity:doors%',s,at,at),'Activity 🐉 %eventactivity+1h% %eventactivity:doors%');
 assert.deepEqual(messagesForReminder(s,s.reminders[1],at,[{id:'a'},{id:'b'},{id:'all'}]).map(m=>m.id),['a','all']);
 assert.deepEqual(validateEventRotation(s),[]);s.rotationEvents[1].name='🐉'.repeat(80);assert.deepEqual(validateEventRotation(s),[]);s.rotationEvents[1].name+='x';assert.ok(validateEventRotation(s).length);
});
test('old anchors count years without public preview limit',()=>{
 const s=fixture({eventDate:'1970-01-04'}),at=Date.UTC(2026,9,25,23)/1000;
 assert.ok(['a','b'].includes(eventVariant(s,at)));assert.throws(()=>projectedOccurrences(s,0,500*86400),/400/);
});
test('portable and native Lua retain activity IDs, numeric keys and exceptions',async()=>{
 const source=fs.readFileSync(new URL('../public/portable.js',import.meta.url),'utf8').replaceAll('"/model.js"',JSON.stringify(new URL('../src/model.js',import.meta.url).href)).replaceAll('"/lua-data.js"',JSON.stringify(new URL('../src/lua-data.js',import.meta.url).href));
 const {portableEvent,validatePortable}=await import('data:text/javascript;base64,'+Buffer.from(source+'\n//# sourceURL=rotation-portable-test.js').toString('base64'));
 const s=fixture({occurrenceExceptions:{'2026-03-01':{action:'POSTPONE'}}});const payload=JSON.parse(JSON.stringify(portableEvent({command:{name:'Rotation'},guild:'Guild',schedule:s},[{id:'a',text:'A'},{id:'b',text:'B'},{id:'all',text:'All'}])));
 const out=validatePortable(payload).schedule;assert.equal(out.rotationEvents[1].id,'a');assert.ok(isLuaNumericKey(out.rotationEvents,'1'));assert.deepEqual(out.occurrenceExceptions,s.occurrenceExceptions);
 const native=parseSavedVariables(writeSavedVariables(out));assert.equal(native.rotationEvents[1].name,'Activity 🐉');assert.ok(isLuaNumericKey(native.rotationEvents,'1'));
 payload.schedule.rotationEvents[2].id='a';assert.throws(()=>validatePortable(payload),/variant|unique/);
});



test('rotation reordering survives merge with latest runtime and retains contiguous Lua sequence',()=>{
 const base={rotationEvents:seq([{id:'a',name:'One'},{id:'b',name:'Two'}]),lastSentAt:1};
 const edited={...base,rotationEvents:seq([{id:'b',name:'Two'},{id:'a',name:'Renamed'}])};
 const latest={...base,lastSentAt:99};
 const {data,conflicts}=mergeSavedVariables(base,edited,latest);assert.deepEqual(conflicts,[]);assert.deepEqual(Object.values(data.rotationEvents).map(a=>a.id),['b','a']);assert.equal(data.rotationEvents[2].name,'Renamed');assert.equal(data.lastSentAt,99);assert.ok(isLuaNumericKey(data.rotationEvents,'1'));
});

test('active rotations require recurring EVENT schedules while inactive empty definitions remain editable',()=>{
 assert.match(validateEventRotation(fixture({mode:'WINDOW'})).join(' '),/recurring EVENT/);
 assert.match(validateEventRotation(fixture({recurrence:'NONE'})).join(' '),/recurring EVENT/);
 assert.deepEqual(validateEventRotation(fixture({mode:undefined})),[]);
 assert.deepEqual(validateEventRotation({specialPattern:'NONE',rotationEvents:{}}),[]);
});
test('sparse faction postponement finds the next nominal date beyond 400 days',()=>{
 const s=fixture({specialPattern:'FACTION_ROTATION',recurrence:'MONTHLY_DATE',recurrenceInterval:24,rotationWeeks:1,rotationFactions:seq(['AD','EP','DC']),occurrenceExceptions:{'2026-03-01':{action:'POSTPONE'}}});
 const next=Date.UTC(2028,2,1,0)/1000;
 const actual=projectedOccurrences(s,next,next+86400,{includeCancelled:true})[0];
 assert.ok(actual);assert.equal(eventVariant(s,actual),'AD');
});
test('explicit cancellations remain effective when the special pattern changes',()=>{
 const s=fixture({specialPattern:'NONE',occurrenceExceptions:{'2026-03-01':{action:'KEEP'}}}),at=scheduleEventUtc(s);
 assert.equal(occurrenceCancellation(s,at),'KEEP');assert.deepEqual(projectedOccurrences(s,at,at),[]);
});

test('portable import reconciles independent activity IDs and preserves locked groups through repeated import',async()=>{
 const source=fs.readFileSync(new URL('../public/portable.js',import.meta.url),'utf8').replaceAll('"/model.js"',JSON.stringify(new URL('../src/model.js',import.meta.url).href)).replaceAll('"/lua-data.js"',JSON.stringify(new URL('../src/lua-data.js',import.meta.url).href));
 const {exportEventBundle,importEventBundle}=await import('data:text/javascript;base64,'+Buffer.from(source+'\n//# sourceURL=rotation-sharing-test.js').toString('base64'));
 const account=(prefix,locked=false)=>{
  const schedule=fixture({rotationEvents:seq([{id:prefix+'-a',name:'Activity A'},{id:prefix+'-b',name:'Activity B'}]),messageVariants:{[prefix+'-message']:prefix+'-a'}});
  schedule.reminders[1].messageIds=seq([prefix+'-message']);
  const messages=[{id:prefix+'-message',commandId:prefix,guildName:'Guild',text:'Same text',useCount:7}];
  if(locked){messages.push({id:'private',commandId:prefix,guildName:'Guild',text:'PRIVATE',locked:true,useCount:20});schedule.messageVariants.private=prefix+'-b';setLuaValue(schedule.reminders[1].messageIds,2,'private');}
  return {commands:seq([{id:prefix,name:'Rotation'}]),messages:seq(messages),schedulingTimeZone:'ET',commandGuildSettings:{[prefix]:{guild:{runAt:'SCHEDULED',schedule}}}};
 };
 const remote=account('remote'),local=account('local',true),bundle=exportEventBundle(remote,'guild',['remote']);
 const first=importEventBundle(local,bundle,[0]).account,schedule=first.commandGuildSettings.local.guild.schedule;
 assert.deepEqual(Object.values(schedule.rotationEvents).map(a=>a.id),['local-a','local-b']);assert.equal(schedule.messageVariants.private,'local-b');assert.equal(schedule.messageVariants['local-message'],'local-a');assert.equal(Object.keys(first.messages).length,2);assert.deepEqual(Object.values(schedule.reminders[1].messageIds),['local-message','private']);
 const second=importEventBundle(first,bundle,[0]).account;assert.equal(Object.keys(second.messages).length,2);assert.equal(second.messages[2].useCount,20);assert.equal(second.commandGuildSettings.local.guild.schedule.messageVariants.private,'local-b');
 const stable=JSON.parse(JSON.stringify(bundle));stable.items[0].schedule.rotationEvents[2]={id:'local-b',name:'Renamed activity'};
 const renamed=importEventBundle(local,stable,[0]).account;assert.equal(renamed.commandGuildSettings.local.guild.schedule.rotationEvents[2].id,'local-b');assert.equal(renamed.commandGuildSettings.local.guild.schedule.rotationEvents[2].name,'Renamed activity');assert.equal(renamed.commandGuildSettings.local.guild.schedule.messageVariants.private,'local-b');
 bundle.items[0].schedule.rotationEvents[2].name='Different activity';assert.throws(()=>importEventBundle(local,bundle,[0]),/locked message.*absent/);assert.equal(local.messages[2].useCount,20);
});

test('single timeline staging preserves locked activity groups and explicitly clears omitted cancellations',async()=>{
 const source=fs.readFileSync(new URL('../public/portable.js',import.meta.url),'utf8').replaceAll('"/model.js"',JSON.stringify(new URL('../src/model.js',import.meta.url).href)).replaceAll('"/lua-data.js"',JSON.stringify(new URL('../src/lua-data.js',import.meta.url).href));
 const {portableEvent,stageImport}=await import('data:text/javascript;base64,'+Buffer.from(source+'\n//# sourceURL=rotation-stage-test.js').toString('base64'));
 const remote=fixture(),messages=[{id:'a',text:'A'},{id:'b',text:'B'},{id:'all',text:'All'}];
 const payload=JSON.parse(JSON.stringify(portableEvent({command:{name:'Rotation'},guild:'guild',schedule:remote},messages)));
 const prior=fixture({rotationEvents:seq([{id:'local-a',name:'Activity 🐉'},{id:'local-b',name:'Second'}]),messageVariants:{private:'local-b'},occurrenceExceptions:{'2026-03-01':{action:'KEEP'}}});prior.reminders[1].messageIds=seq(['private']);
 const privateMessage={id:'private',commandId:'local',guildName:'guild',text:'Private',locked:true,useCount:21};
 const event={commandId:'local',schedule:prior,messages:[privateMessage]};
 const staged=stageImport(payload,event,seq([privateMessage]),'guild');
 assert.deepEqual(Object.values(staged.schedule.rotationEvents).map(a=>a.id),['local-a','local-b']);assert.equal(staged.schedule.messageVariants.private,'local-b');assert.ok(Object.values(staged.schedule.reminders[1].messageIds).includes('private'));assert.deepEqual(staged.schedule.occurrenceExceptions,{});
 assert.equal(staged.messages.length,3);assert.ok(staged.messages.every(m=>m.id!=='a'&&m.id!=='b'&&m.id!=='all'&&m.useCount===0));assert.equal(staged.schedule.messageVariants[staged.messages[0].id],'local-a');assert.equal(payload.messages[0].variant,'a');
 payload.schedule.rotationEvents[2].name='Missing local group';assert.throws(()=>stageImport(payload,event,seq([privateMessage]),'guild'),/locked message.*absent/);
});
