import test from 'node:test';import assert from 'node:assert/strict';import * as model from '../src/model.js';
const now=Date.parse('2026-10-26T18:00:00Z')/1000;
test('command previews expand native BASIC tokens and preserve unresolved event tokens',()=>{
 assert.equal(model.previewCommandMessage('%time% %timeofday% %greeting% %morning% %guild% %zone% %eventtime% %eventactivity%',now,{guild:' Guild ',zone:'Stonefalls',localHour:13}),'afternoon afternoon afternoon afternoon Guild Stonefalls %eventtime% %eventactivity%');
});
test('ordinary explicit timezone countdowns preserve original template wording',()=>{
 assert.equal(model.previewCommandMessage('Meet today at 8 PM ET!',now),'Meet today at 8 PM ET (6h)!');
 assert.equal(model.previewCommandMessage('Meet at 8 PM',now,{timeZone:'ET'}),'Meet at 8 PM');
});

// Expected strings below were captured from the real addon's
// ApplyMessageSubstitutions using tests/eso_fixture.lua and the stated UTC now.
const nativeCases=[
 ['2026-01-15T18:00:00Z','Meet 8 PM MT','Meet 8 PM MT (9h)'],
 ['2026-07-15T18:00:00Z','Meet 8 PM MT','Meet 8 PM MT (8h)'],
 ['2026-10-26T18:00:00Z','Meet 8 PM EDT','Meet 8 PM EDT (6h)'],
 ['2026-10-26T18:00:00Z','Meet 8 PM GMT','Meet 8 PM GMT (2h)'],
 ['2026-10-26T18:00:00Z','Meet Thursday 8 PM ET','Meet Thursday 8 PM ET (3d 6h)'],
 ['2026-10-26T18:00:00Z','Meet 10-27-2026 at 8 PM ET','Meet 10-27-2026 at 8 PM ET (1d 6h)'],
 ['2026-10-26T18:00:00Z','Meet 830 PM ET','Meet 830 PM ET (6h 30m)'],
 ['2026-10-26T18:00:30Z','Meet 6:01 PM UTC','Meet 6:01 PM UTC (soon)'],
 ['2026-10-26T18:00:00Z','Meet at 99:00 UTC','Meet at 99:00 UTC'],
 ['2026-10-27T02:00:00Z','Tomorrow 8 PM PT','Tomorrow 8 PM PT (2d 1h)'],
 ['2026-10-26T18:00:00Z','Meet tomorrow at 8 PM ET!','Meet tomorrow at 8 PM ET (1d 6h)!'],
 ['2026-10-26T18:00:00Z','Meet Monday at 8 PM ET','Meet Monday at 8 PM ET (6h)'],
 ['2026-10-26T18:00:00Z','Meet Tuesday at 8 PM UTC','Meet Tuesday at 8 PM UTC (1d 2h)'],
 ['2026-10-26T18:00:00Z','Meet 10/27 at 8 PM ET','Meet 10/27 at 8 PM ET (1d 6h)'],
 ['2026-10-26T18:00:00Z','Meet 10/25 at 8 PM ET','Meet 10/25 at 8 PM ET (364d 6h)'],
 ['2026-10-26T18:00:00Z','Meet 10/26 at 8 AM ET','Meet 10/26 at 8 AM ET (364d 18h)'],
 ['2026-10-26T18:00:00Z','Meet 10/25/2026 at 8 PM ET','Meet 10/25/2026 at 8 PM ET'],
 ['2026-10-26T18:00:00Z','Meet 10/27/26 at 8 PM ET','Meet 10/27/26 at 8 PM ET (1d 6h)'],
 ['2026-10-26T18:00:00Z','Meet at 8 ET','Meet at 8 ET PM (6h)'],
 ['2026-10-26T18:00:00Z','Meet at 0800 ET','Meet at 0800 ET PM (6h)'],
 ['2026-10-26T18:00:00Z','Meet at 8:00 ET','Meet at 8:00 ET PM (6h)'],
 ['2026-10-26T18:00:00Z','Meet at 20:00 UTC','Meet at 20:00 UTC (2h)'],
 ['2026-10-26T18:00:00Z','Meet at 8 PM CET','Meet at 8 PM CET'],
 ['2026-10-26T18:00:00Z','Doors 7 PM ET; start 8:30 PM ET','Doors 7 PM ET; start 8:30 PM ET (6h 30m)'],
 ['2026-10-26T18:00:00Z','Today at 12 PM CT','Today at 12 PM CT (23h)'],
 ['2026-10-26T18:00:00Z','Meet 7:30 p.m. PT','Meet 7:30 p.m. PT (8h 30m)'],
 ['2026-10-26T18:00:00Z','At 8 PM ET ET','At 8 PM ET ET (6h)'],
 ['2026-10-26T18:00:00Z','At 8PMET','At 8PMET EDT (6h)'],
 ['2026-10-26T18:00:00Z','At 8pm et','At 8pm et EDT (6h)'],
 ['2026-10-26T18:00:00Z','At 8 PM ET and %eventcountdown%','At 8 PM ET and %eventcountdown%'],
 ['2026-03-08T06:00:00Z','Today at 3:30 AM ET','Today at 3:30 AM ET (2h 30m)'],
 ['2026-03-08T06:00:00Z','Tomorrow at 3:30 AM ET','Tomorrow at 3:30 AM ET (~1d 2h)'],
 ['2026-11-01T04:00:00Z','Today at 1:30 AM ET','Today at 1:30 AM ET (1h 30m)'],
 ['2026-11-01T04:00:00Z','Tomorrow at 1:30 AM ET','Tomorrow at 1:30 AM ET (~1d 3h)'],
 ['2026-12-31T23:00:00Z','1/1 at 8 PM PT','1/1 at 8 PM PT (1d 5h)'],
];
for(const [now,text,expected]of nativeCases)test('native command parity: '+now+' '+text,()=>assert.equal(model.previewCommandMessage(text,Date.parse(now)/1000),expected));
test('unsupported tokens, links and messages without explicit timezone retain their literal contents',()=>{
 const link='|H1:item:20:00:23|h[Meet 8 PM ET]|h';assert.equal(model.previewCommandMessage(link,now),link);
 assert.equal(model.previewCommandMessage(link+' Outside 8 PM ET',now),link+' Outside 8 PM ET (6h)');
 assert.equal(model.previewCommandMessage('%eventwhen% %eventtime:doors% %eventdate% %eventcountdown+2h% %eventfaction% %eventactivity%',now),'%eventwhen% %eventtime:doors% %eventdate% %eventcountdown+2h% %eventfaction% %eventactivity%');
 assert.equal(model.previewCommandMessage('No clock %zone% %guild% %unknown%',now),'No clock %zone% %guild% %unknown%');
});

test('native greeting uses provided local-hour boundaries and matching token case',()=>{
 for(const [localHour,expected]of [[0,'morning'],[11,'morning'],[12,'afternoon'],[17,'afternoon'],[18,'evening'],[23,'evening']])assert.equal(model.previewCommandMessage('%MoRnInG%',now,{localHour}),expected);
});
