import test from 'node:test';import assert from 'node:assert/strict';
import {previewMessage} from '../src/model.js';
const schedule={timeZone:'ET',eventDate:'2026-11-07',eventTime:'08:00 PM',importantTimes:{tickets:{offsetMinutes:-60}},specialPattern:'FACTION_ROTATION',rotationWeeks:4,rotationFactions:{1:'EP',2:'AD'}};
const at=Date.parse('2026-11-08T01:00:00Z')/1000;
test('event previews expand standard named and offset tokens at simulated phase time',()=>{
 const text='Raffle %eventwhen% at %eventtime% (%eventcountdown%). Sales close %eventwhen:tickets% at %eventtime:tickets% (%eventcountdown:tickets%).';
 assert.equal(previewMessage(text,schedule,at,at-86400),'Raffle tomorrow at 08:00 PM EST (1d). Sales close tomorrow at 07:00 PM EST (23h).');
 assert.equal(previewMessage('%eventwhen% %eventdate% %eventtime-1h% (%eventcountdown-1h%)',schedule,at,at-3600),'today 11/07/2026 07:00 PM EST (now)');
 assert.equal(previewMessage('%eventfaction% - %guild% - %zone%',schedule,at,at,{guild:'Example',zone:'Guild Hall'}),'Ebonheart Pact - Example - Guild Hall');
});
test('preview countdown formatting and automatic event-time countdown match addon conventions',()=>{
 assert.equal(previewMessage('%eventtime%',schedule,at,at-3600),'08:00 PM EST (1h)');
 assert.equal(previewMessage('%eventcountdown%',schedule,at,at-17*60),'17m');
 assert.equal(previewMessage('%eventcountdown%',schedule,at,at-31*60),'31m');
 assert.equal(previewMessage('%eventcountdown%',schedule,at,at+60),'passed');
 assert.equal(previewMessage('%eventcountdown%',schedule,at,at),'now');
});

test('unsupported greeting-like tokens stay literal as in ESO',()=>{assert.equal(previewMessage('%morning% %time%',schedule,at,at,{localHour:9}),'%morning% morning');});

test('explicit deadline countdowns preserve offsets even many days ahead',()=>{
 const text='%eventcountdown% / %eventcountdown-60m% / %eventcountdown-1h% / %eventcountdown-4h% / %eventcountdown:tickets%';
 assert.equal(previewMessage(text,schedule,at,at-(10*86400+6*3600+17*60)), '10d 6h 17m / 10d 5h 17m / 10d 5h 17m / 10d 2h 17m / 10d 5h 17m');
 assert.equal(previewMessage('%eventcountdown-1d% / %eventcountdown+30m%',schedule,at,at-2*86400),'1d / 2d 30m');
 assert.equal(previewMessage('%eventcountdown%',schedule,at,at-1),'1m');
 assert.equal(previewMessage('%eventcountdown-1%h',schedule,at,at-3600),'%eventcountdown-1%h');
});
