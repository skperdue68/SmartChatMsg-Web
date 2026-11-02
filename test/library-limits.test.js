import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibraryStore } from '../src/library-store.js';
import { createServer, readConfig } from '../src/server.js';

const lua = 'SmartChatMsgSavedVars = { Default = { ["@example"] = { ["$AccountWide"] = {} } } }';
const withDirectory = async body => {
  const directory = await mkdtemp(join(tmpdir(), 'scm-limits-'));
  try { await body(directory); } finally { await rm(directory, { recursive: true, force: true }); }
};
const status = async promise => { try { await promise; return 201; } catch (error) { return error.status; } };

test('the library refuses new files once its file quota is reached, but still allows replacing one', () => withDirectory(async directory => {
  const store = createLibraryStore(directory, { maxFiles: 2 });
  await store.save('one', lua);
  await store.save('two', lua);
  assert.equal(await status(store.save('three', lua)), 507);
  assert.equal(await status(store.save('two', lua, { overwrite: true })), 201);
}));

test('the library refuses uploads that exceed its byte quota', () => withDirectory(async directory => {
  const store = createLibraryStore(directory, { maxBytes: lua.length * 2 + 10 });
  await store.save('one', lua);
  await store.save('two', lua);
  assert.equal(await status(store.save('three', lua)), 507);
}));

test('overwrite password guessing is throttled per entry and resets after a correct password', () => withDirectory(async directory => {
  let clock = 1_000_000;
  const store = createLibraryStore(directory, { now: () => clock });
  await store.save('guarded', lua, { password: 'correct horse' });
  const attempt = password => status(store.save('guarded', lua, { overwrite: true, password }));
  for (let i = 0; i < 5; i++) assert.equal(await attempt('wrong' + i), 403);
  assert.equal(await attempt('correct horse'), 429, 'even the right password is refused during the lockout');
  assert.equal(await attempt('wrong again'), 429);
  clock += 31_000;
  assert.equal(await attempt('correct horse'), 201, 'the lockout expires');
  for (let i = 0; i < 4; i++) assert.equal(await attempt('wrong' + i), 403);
  assert.equal(await attempt('correct horse'), 201, 'a success clears the failure count');
  assert.equal(await attempt('wrong'), 403);
}));

test('a corrupt record does not break listing the rest of the library', () => withDirectory(async directory => {
  const store = createLibraryStore(directory);
  await store.save('good', lua);
  await writeFile(join(directory, 'a'.repeat(64) + '.scm'), 'not a record');
  assert.deepEqual((await store.list()).map(file => file.name), ['good']);
}));

test('only a few uploads are accepted at once', async () => {
  await withDirectory(async directory => {
    const server = createServer({ libraryDir: directory, maxConcurrentUploads: 1 });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address(), root = `http://127.0.0.1:${port}`;
    const headers = { origin: root, 'content-type': 'application/json' };
    // Start an upload that announces a body but never finishes sending it.
    const stalled = http.request({ port, host: '127.0.0.1', method: 'POST', path: '/api/library', headers: { ...headers, 'content-length': '1000' } });
    stalled.on('error', () => {});
    stalled.write('{"name":"slow",');
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      const busy = await fetch(root + '/api/library', { method: 'POST', headers, body: JSON.stringify({ name: 'next', lua }) });
      assert.equal(busy.status, 503);
      assert.equal(busy.headers.get('retry-after'), '5');
      stalled.destroy();
      await new Promise(resolve => setTimeout(resolve, 100));
      const ok = await fetch(root + '/api/library', { method: 'POST', headers, body: JSON.stringify({ name: 'next', lua }) });
      assert.equal(ok.status, 201, 'capacity is released when the stalled upload ends');
    } finally { stalled.destroy(); await new Promise(resolve => server.close(resolve)); }
  });
});

test('quota settings are read from the environment and validated', () => {
  assert.equal(readConfig({}).libraryMaxFiles, 500);
  assert.equal(readConfig({}).maxConcurrentUploads, 4);
  assert.equal(readConfig({ LIBRARY_MAX_FILES: '10', LIBRARY_MAX_BYTES: '2048', MAX_CONCURRENT_UPLOADS: '2' }).libraryMaxBytes, 2048);
  for (const value of ['0', '-1', '1.5', 'many']) assert.throws(() => readConfig({ LIBRARY_MAX_FILES: value }), /LIBRARY_MAX_FILES/);
});

test('deletion shares password throttling with overwrite and frees the entry quota',()=>withDirectory(async directory=>{
 let clock=1000000;const store=createLibraryStore(directory,{maxFiles:1,now:()=>clock});
 const file=await store.save('protected',lua,{password:'correct'});
 for(let i=0;i<5;i++)assert.equal(await status(store.remove(file.id,'wrong')),403);
 assert.equal(await status(store.save('protected',lua,{overwrite:true,password:'correct'})),429);
 clock+=31000;assert.equal((await store.remove(file.id,'correct')).id,file.id);
 assert.equal(await status(store.save('replacement',lua)),201);
}));
