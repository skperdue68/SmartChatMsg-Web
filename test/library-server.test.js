import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, readConfig } from '../src/server.js';
const lua = 'SmartChatMsgSavedVars = { Default = { ["@example"] = { ["$AccountWide"] = {} } } }';
async function start(directory) {
  const server = createServer({ libraryDir:directory });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const root = `http://127.0.0.1:${server.address().port}`;
  return {root, stop:() => new Promise(r => server.close(r)), post:(name, text = lua, headers = {}) => fetch(root + '/api/library', {method:'POST', headers:{origin:root, 'content-type':'application/json', ...headers}, body:JSON.stringify({name, lua:text})})};
}
test('shared library persists full Lua and publishes unique names atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scm-library-'));
  let app = await start(directory);
  try {
    assert.equal(readConfig({LIBRARY_DIR:directory}).libraryDir, directory);
    const saved = await app.post('  Café / schedule  ');
    assert.equal(saved.status, 201);
    const {file} = await saved.json();
    assert.equal(file.name, 'Café / schedule');
    assert.equal(file.bytes, Buffer.byteLength(lua));
    assert.match(file.id, /^[a-f0-9]{64}$/);
    const duplicate = await app.post('CAFE\u0301 / SCHEDULE');
    assert.equal(duplicate.status, 409);
    assert.match((await duplicate.json()).error, /choose a unique name/);
    const race = await Promise.all([app.post('race'), app.post('RACE')]);
    assert.deepEqual(race.map(r => r.status).sort(), [201,409]);
    await app.stop(); app = await start(directory);
    const files = (await (await fetch(app.root + '/api/library')).json()).files;
    assert.equal(files.length, 2);
    assert.ok(files[0].createdAt >= files[1].createdAt);
    assert.equal(await (await fetch(app.root + '/api/library/' + file.id)).text(), lua);
    const head = await fetch(app.root + '/api/library/' + file.id, {method:'HEAD'});
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal((await readdir(directory)).filter(x => x.endsWith('.tmp')).length, 0);
  } finally { await app.stop(); await rm(directory, {recursive:true, force:true}); }
});
test('library validates data, origin, media type, paths, and methods', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scm-library-'));
  const app = await start(directory);
  try {
    for (const value of ['oops', 'SmartChatMsgSavedVars = {}', 'SmartChatMsgSavedVars = os.execute("oops")', lua + '; print("oops")']) assert.equal((await app.post('bad', value)).status, 400);
    for (const name of ['', 'x\nname', 'a'.repeat(121)]) assert.equal((await app.post(name)).status, 400);
    assert.equal((await app.post('too large', 'é'.repeat(10 * 1024 * 1024 + 1))).status, 413);
    for (const origin of [undefined, 'https://evil.example']) {
      const headers = {'content-type':'application/json'}; if (origin) headers.origin = origin;
      const response = await fetch(app.root + '/api/library', {method:'POST',headers,body:JSON.stringify({name:'blocked',lua})});
      assert.equal(response.status, 403); assert.equal(typeof (await response.json()).error, 'string');
    }
    assert.equal((await app.post('bad', lua, {'content-type':'text/plain'})).status, 415);
    assert.equal((await fetch(app.root + '/api/library', {method:'POST',headers:{origin:app.root,'content-type':'application/json'},body:'{'})).status, 400);
    for (const path of ['/api/library/missing','/api/library/' + 'a'.repeat(64), '/api/library/%2e%2e%2fsecret', '/data/shared-library']) assert.equal((await fetch(app.root + path)).status, 404);
    for (const method of ['PUT','PATCH','DELETE']) {
      const response = await fetch(app.root + '/api/library', {method});
      assert.equal(response.status, 405); assert.equal(typeof (await response.json()).error, 'string');
    }
    assert.deepEqual((await (await fetch(app.root + '/api/library')).json()).files, []);
  } finally { await app.stop(); await rm(directory, {recursive:true, force:true}); }
});

test('confirmed overwrite replaces the named file while preserving its identity and other files',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'scm-overwrite-'));let app=await start(directory);
 try{
  const file=(await(await app.post('My events')).json()).file;
  const other=(await(await app.post('Other events')).json()).file;
  const replacement=lua.replace('@example','@updated');
  const post=(overwrite,text=replacement)=>fetch(app.root+'/api/library',{method:'POST',headers:{origin:app.root,'content-type':'application/json'},body:JSON.stringify({name:'MY EVENTS',lua:text,overwrite})});
  assert.equal((await post('true')).status,400);
  assert.equal((await post(false)).status,409);
  assert.equal((await post(true,'not lua')).status,400);
  assert.equal(await(await fetch(app.root+'/api/library/'+file.id)).text(),lua);
  const response=await post(true);assert.equal(response.status,201);const updated=(await response.json()).file;
  assert.equal(updated.id,file.id);assert.equal(updated.createdAt,file.createdAt);assert.ok(updated.updatedAt);
  await app.stop();app=await start(directory);
  assert.equal(await(await fetch(app.root+'/api/library/'+file.id)).text(),replacement);
  assert.equal(await(await fetch(app.root+'/api/library/'+other.id)).text(),lua);
  assert.equal((await(await fetch(app.root+'/api/library')).json()).files.length,2);
  assert.equal((await readdir(directory)).filter(name=>name.endsWith('.tmp')).length,0);
 }finally{await app.stop();await rm(directory,{recursive:true,force:true});}
});
