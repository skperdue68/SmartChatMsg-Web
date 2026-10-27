import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';
import * as model from '../src/model.js';import {setLuaValue} from '../src/lua-data.js';
const seq=items=>{const out={};items.forEach((item,i)=>setLuaValue(out,i+1,item));return out;};
const seconds=s=>Date.parse(s)/1000;
const fixture=extra=>({timelineVersion:1,mode:'EVENT',eventDate:'2026-10-28',eventTime:'08:00 PM',timeZone:'ET',recurrence:'NONE',reminders:seq([{id:'r',label:'Reminder',start:{kind:'OFFSET',minutes:-3*1440},finish:{kind:'OFFSET',minutes:0},intervalMinutes:60,lateMinutes:5,once:false,messageIds:{},availability:{enabled:true,startMinute:7*60,endMinute:22*60}}]),...extra});
test('availability expands real server days, intersects promotion bounds and retains un-clipped query slices',()=>{
 const s=fixture(),at=model.scheduleEventUtc(s),from=seconds('2026-10-27T13:00Z'),to=from+3600;
 const slices=model.effectiveReminderWindows(s,at,from,to);assert.equal(slices.length,1);assert.equal(slices[0].start,seconds('2026-10-27T11:00Z'));assert.equal(slices[0].end,seconds('2026-10-28T02:00Z'));assert.equal(slices[0].availabilityDate,'2026-10-27');assert.equal(slices[0].availabilitySource,'USUAL');
 assert.equal(model.reminderWindows(s,at).length,1);
});
test('date beats weekday beats usual, explicit empty weekdays gates all overrides',()=>{
 const s=fixture(),row=s.reminders[1];row.availability.weekdayOverrides={3:{startMinute:8*60,endMinute:21*60}};row.availability.dateOverrides={'2026-10-27':{startMinute:9*60,endMinute:20*60}};
 const result=model.availabilityForDate(s,row,'2026-10-27');assert.equal(result.source,'DATE');assert.equal(result.startMinute,540);
 delete row.availability.dateOverrides['2026-10-27'];assert.equal(model.availabilityForDate(s,row,'2026-10-27').source,'WEEKDAY');row.availability.weekdays={};assert.equal(model.availabilityForDate(s,row,'2026-10-27').allowed,false);
});
test('overnight slices keep opening date while daily caps use send day',()=>{
 const s=fixture(),row=s.reminders[1],at=model.scheduleEventUtc(s);row.availability.startMinute=22*60;row.availability.endMinute=7*60;row.availability.maxPerDay=1;row.availability.weekdays=seq([false,false,true,false,false,false,false]);
 const now=seconds('2026-10-28T06:00Z'),slice=model.effectiveReminderWindows(s,at,now,now+1)[0];assert.equal(slice.availabilityDate,'2026-10-27');
 s.availabilityUsage={'r:2026-10-28':{count:1,lastAt:now-60}};assert.equal(model.availabilityStatus(s,row,at,now).status,'DAILY_LIMIT');assert.equal(model.simulateReminder(s,row,at,now).status,'DAILY_LIMIT');
});
test('all-day DST slices last 23 or 25 hours; missing boundaries skip; folds cover both instances',()=>{
 for(const [date,next,hours]of [['2026-03-08','2026-03-09',23],['2026-11-01','2026-11-02',25]]){
  const s=fixture({eventDate:next,eventTime:'08:00 PM'}),row=s.reminders[1],at=model.scheduleEventUtc(s);row.availability={enabled:true,startMinute:0,endMinute:1440};
  const start=seconds(date+'T00:00Z'),slices=model.effectiveReminderWindows(s,at,start,start+2*86400),slice=slices.find(w=>w.availabilityDate===date);assert.equal(slice.end-slice.start,hours*3600);
  if(date==='2026-03-08'){row.availability.startMinute=150;assert.equal(model.effectiveReminderWindows(s,at,start,start+2*86400).some(w=>w.availabilityDate===date),false);}
 }
 const fall=fixture({eventDate:'2026-11-02'}),row=fall.reminders[1],at=model.scheduleEventUtc(fall);row.availability={enabled:true,startMinute:60,endMinute:120};const slice=model.effectiveReminderWindows(fall,at,seconds('2026-11-01T00:00Z'),seconds('2026-11-02T12:00Z')).find(w=>w.availabilityDate==='2026-11-01');assert.equal(slice.end-slice.start,2*3600);
});
test('disabled availability preserves geometry; validation rejects malformed active and inactive config',()=>{
 const s=fixture(),at=model.scheduleEventUtc(s),row=s.reminders[1];row.availability.enabled=false;
 assert.deepEqual(model.effectiveReminderWindows(s,at,at-86400,at),model.reminderWindows(s,at));
 for(const availability of [{enabled:'yes'},{enabled:false,startMinute:60,endMinute:60},{enabled:true,maxPerDay:0},{enabled:true,startMinute:1440},{enabled:true,endMinute:0},{enabled:false,dateOverrides:{'2026-02-30':{startMinute:0,endMinute:1440}}},{enabled:true,weekdays:{8:true}},{enabled:true,weekdayOverrides:{3:{startMinute:90,endMinute:90}}}]){
  row.availability=availability;assert.ok(model.validateTimelineForAddon(s).length,JSON.stringify(availability));
 }
 row.availability={enabled:true,startMinute:0,endMinute:1440};row.start={kind:'OFFSET',minutes:1};assert.match(model.validateTimelineForAddon(s).join(' '),/end must follow start/);
 assert.throws(()=>model.effectiveReminderWindows(s,at,at,at+401*86400),/400/);
});
test('effective non-overlapping hours allow overlapping promotion geometry and late date conflicts are checked',()=>{
 const s=fixture(),a=s.reminders[1];a.availability={enabled:true,startMinute:420,endMinute:600};setLuaValue(s.reminders,2,{...a,id:'b',availability:{enabled:true,startMinute:600,endMinute:720}});assert.deepEqual(model.timelineConflicts(s),[]);
 s.recurrence='WEEKLY';s.reminders[2].availability.dateOverrides={'2028-10-24':{startMinute:480,endMinute:660}};assert.ok(model.timelineConflicts(s).length);
});
test('date/weekday/all edits and resets preserve overrides, IDs, counts and promotion geometry',()=>{
 const s=fixture(),at=model.scheduleEventUtc(s),row=s.reminders[1];row.availability.maxPerDay=2;s.availabilityUsage={'r:2026-10-27':{count:1,lastAt:at-86400}};s.timelineUsage={keep:{lastSentAt:1}};
 const dated=model.editReminderAvailability(s,at,'r','2026-10-27','DATE','move',60).schedule;assert.equal(dated.reminders[1].availability.dateOverrides['2026-10-27'].startMinute,480);assert.deepEqual(JSON.parse(JSON.stringify(dated.availabilityUsage)),s.availabilityUsage);assert.deepEqual(JSON.parse(JSON.stringify(dated.reminders[1].start)),row.start);
 const weekly=model.editReminderAvailability(dated,at,'r','2026-10-26','WEEKDAY','finish',60).schedule;assert.equal(weekly.reminders[1].availability.weekdayOverrides[2].endMinute,1380);
 const usual=model.editReminderAvailability(weekly,at,'r','2026-10-28','ALL','start',30).schedule;assert.equal(usual.reminders[1].availability.startMinute,450);assert.deepEqual(usual.reminders[1].availability.dateOverrides,dated.reminders[1].availability.dateOverrides);
 const reset=model.resetReminderAvailability(usual,'r','2026-10-27','DATE').schedule;assert.equal(model.availabilityForDate(reset,reset.reminders[1],'2026-10-27').source,'USUAL');assert.deepEqual(JSON.parse(JSON.stringify(reset.availabilityUsage)),s.availabilityUsage);
 const resetWeekly=model.resetReminderAvailability(weekly,'r','2026-10-26','WEEKDAY').schedule;assert.equal(model.availabilityForDate(resetWeekly,resetWeekly.reminders[1],'2026-10-26').source,'USUAL');
 assert.throws(()=>model.editReminderAvailability(s,at,'r','2026-10-27','DATE','move',-480),/same date/);
});
test('selected date beyond default horizon cannot introduce an overlap, including reset inheritance',()=>{
 const s=fixture({recurrence:'WEEKLY'}),a=s.reminders[1],at=model.scheduleEventUtc(s);a.availability={enabled:true,startMinute:420,endMinute:600};setLuaValue(s.reminders,2,{...a,id:'b',availability:{enabled:true,startMinute:600,endMinute:720}});
 assert.throws(()=>model.editReminderAvailability(s,at,'r','2028-10-24','DATE','move',60),/overlap/);
 s.reminders[1].availability.startMinute=480;s.reminders[1].availability.endMinute=660;s.reminders[1].availability.dateOverrides={'2028-10-24':{startMinute:420,endMinute:600}};
 assert.throws(()=>model.resetReminderAvailability(s,'r','2028-10-24','DATE'),/overlap/);
});
test('status bootstraps peer/sent counts, uses civil midnight, and once completion remains per occurrence',()=>{
 const s=fixture(),row=s.reminders[1],at=model.scheduleEventUtc(s),now=seconds('2026-10-27T13:00Z');row.availability.maxPerDay=1;s.timelineUsage={[at+':r']:{peerAt:now-60}};
 const status=model.availabilityStatus(s,row,at,now);assert.equal(status.count,1);assert.equal(status.status,'DAILY_LIMIT');assert.equal(status.nextEligibleAt,seconds('2026-10-28T11:00Z'));assert.equal(model.availabilityStatus(s,row,at,now+86400).count,0);
 row.once=true;row.onceUntilFinish=true;s.timelineUsage[at+':r'].completed=true;assert.equal(model.simulateReminder(s,row,at,now).status,'COMPLETE');
 s.paused=true;assert.equal(model.simulateReminder(s,row,at,now).status,'PAUSED');assert.equal(model.availabilityStatus(s,row,at,now).count,1);
});
test('latest availability counters survive hours edits and Lua full roundtrip',()=>{
 const s=fixture(),base={schedule:s},edited=model.cloneSavedData(base),latest=model.cloneSavedData(base);edited.schedule.reminders[1].availability.startMinute=480;edited.schedule.availabilityUsage={'r:2026-10-27':{count:0,lastAt:0}};latest.schedule.availabilityUsage={'r:2026-10-27':{count:2,lastAt:123}};
 const result=model.mergeSavedVariables(base,edited,latest);assert.deepEqual(result.conflicts,[]);assert.equal(result.data.schedule.availabilityUsage['r:2026-10-27'].count,2);assert.equal(result.data.schedule.reminders[1].availability.startMinute,480);
});

test('portable availability normalizes numeric keys, strips counters and preserves matching recipient row counters',async()=>{
 const source=fs.readFileSync(new URL('../public/portable.js',import.meta.url),'utf8').replaceAll('"/model.js"',JSON.stringify(new URL('../src/model.js',import.meta.url).href)).replaceAll('"/lua-data.js"',JSON.stringify(new URL('../src/lua-data.js',import.meta.url).href));
 const {portableEvent,validatePortable,stageImport,exportEventBundle,importEventBundle}=await import('data:text/javascript;base64,'+Buffer.from(source+'\n//# sourceURL=availability-portable-test.js').toString('base64'));
 const s=fixture(),messages=[{id:'m',commandId:'c',guildName:'guild',text:'Message'}];s.reminders[1].messageIds=seq(['m']);s.reminders[1].availability.weekdays={};setLuaValue(s.reminders[1].availability.weekdays,3,true);s.reminders[1].availability.weekdayOverrides={};setLuaValue(s.reminders[1].availability.weekdayOverrides,3,{startMinute:480,endMinute:1200});s.availabilityUsage={'r:2026-10-27':{count:5,lastAt:123}};
 const event={commandId:'c',command:{name:'Available'},guild:'guild',schedule:s},payload=JSON.parse(JSON.stringify(portableEvent(event,messages)));assert.doesNotMatch(JSON.stringify(payload),/availabilityUsage|lastAt/);
 const validated=validatePortable(payload);assert.equal(validated.schedule.reminders[1].availability.weekdays[3],true);assert.equal(model.validateTimelineForAddon(validated.schedule).length,0);
 const staged=stageImport(payload,event,seq(messages),'guild');assert.equal(staged.schedule.reminders[1].id,'r');assert.equal(staged.schedule.availabilityUsage,undefined);
 const account={commands:seq([{id:'c',name:'Available'}]),messages:seq(messages),schedulingTimeZone:'ET',commandGuildSettings:{c:{guild:{runAt:'SCHEDULED',schedule:s}}}};
 const bundle=exportEventBundle(account,'guild',['c']);bundle.items[0].schedule.reminders[1].availability.startMinute=500;
 const imported=importEventBundle(account,bundle,[0]).account.commandGuildSettings.c.guild.schedule;assert.equal(imported.availabilityUsage['r:2026-10-27'].count,5);assert.equal(imported.reminders[1].id,'r');assert.equal(imported.reminders[1].availability.startMinute,500);
 payload.schedule.reminders[1].availability.dateOverrides={'2026-10-27':{startMinute:50,endMinute:50}};assert.throws(()=>validatePortable(payload),/nonempty/);
});
test('overnight availability resolves DST in the opening day timezone',()=>{
 for(const [opening,next,hours]of [['2026-03-07','2026-03-09',8],['2026-10-31','2026-11-02',10]]){
  const s=fixture({eventDate:next}),row=s.reminders[1],at=model.scheduleEventUtc(s);row.availability={enabled:true,startMinute:1320,endMinute:420};
  const from=seconds(opening+'T00:00Z'),slice=model.effectiveReminderWindows(s,at,from,from+3*86400).find(w=>w.availabilityDate===opening);assert.equal(slice.end-slice.start,hours*3600);
 }
});
test('long promotion windows expand only the visible range and recurring overlaps return promptly',()=>{
 const s=fixture({eventDate:'2026-10-28',recurrence:'WEEKLY'}),row=s.reminders[1],at=model.scheduleEventUtc(s);row.start.minutes=-5256000;row.availability={enabled:true,startMinute:420,endMinute:1320};
 const from=seconds('2026-10-20T12:00Z'),slices=model.effectiveReminderWindows(s,at,from,from+2*86400);assert.equal(slices.length,3);assert.ok(model.timelineConflicts(s).length);
});

test('exact recipient row IDs win over identical base geometry on single and bundle imports',async()=>{
 const source=fs.readFileSync(new URL('../public/portable.js',import.meta.url),'utf8').replaceAll('"/model.js"',JSON.stringify(new URL('../src/model.js',import.meta.url).href)).replaceAll('"/lua-data.js"',JSON.stringify(new URL('../src/lua-data.js',import.meta.url).href));
 const {portableEvent,stageImport,exportEventBundle,importEventBundle}=await import('data:text/javascript;base64,'+Buffer.from(source+'\n//# sourceURL=availability-id-test.js').toString('base64'));
 const s=fixture(),messages=[{id:'m',commandId:'c',guildName:'guild',text:'Message'}];s.reminders[1].messageIds=seq(['m']);s.reminders[1].availability={enabled:true,startMinute:420,endMinute:600,maxPerDay:1};setLuaValue(s.reminders,2,{...s.reminders[1],id:'r2',availability:{enabled:true,startMinute:600,endMinute:720,maxPerDay:1}});
 s.availabilityUsage={'r:2026-10-27':{count:1,lastAt:123},'r2:2026-10-27':{count:1,lastAt:124}};
 const event={commandId:'c',command:{name:'Same geometry'},guild:'guild',schedule:s},payload=JSON.parse(JSON.stringify(portableEvent(event,messages))),staged=stageImport(payload,event,seq(messages),'guild');
 assert.deepEqual(Object.values(staged.schedule.reminders).map(row=>row.id),['r','r2']);
 const account={commands:seq([{id:'c',name:'Same geometry'}]),messages:seq(messages),schedulingTimeZone:'ET',commandGuildSettings:{c:{guild:{runAt:'SCHEDULED',schedule:s}}}},bundle=exportEventBundle(account,'guild',['c']),imported=importEventBundle(account,bundle,[0]).account.commandGuildSettings.c.guild.schedule;
 assert.deepEqual(Object.values(imported.reminders).map(row=>row.id),['r','r2']);assert.equal(imported.availabilityUsage['r:2026-10-27'].count,1);assert.equal(imported.availabilityUsage['r2:2026-10-27'].count,1);
 const stagedResult={...s,...staged.schedule};assert.equal(model.availabilityStatus(stagedResult,stagedResult.reminders[1],model.scheduleEventUtc(s),seconds('2026-10-27T12:00Z')).status,'DAILY_LIMIT');
});
