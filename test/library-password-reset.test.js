import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, scryptSync } from 'node:crypto';
import { resetLibraryPassword } from '../src/library-password-reset.js';
import { createLibraryStore } from '../src/library-store.js';

test('administrator reset preserves payload and metadata and replaces forgotten password', async () => {
 const dir=await mkdtemp(join(tmpdir(),'scm-reset-'));
 try {
  const id=createHash('sha256').update('example').digest('hex');
  const record={id,name:'Example',createdAt:'2026-01-01',bytes:7,passwordSalt:'old',passwordHash:scryptSync('forgotten','old',64).toString('hex')};
  const payload=Buffer.from('payload');
  const path=join(dir,id+'.scm');
  await writeFile(path,Buffer.concat([Buffer.from(JSON.stringify(record)+'\n'),payload]));
  await assert.rejects(resetLibraryPassword(dir,'Example',''));
  await resetLibraryPassword(dir,' EXAMPLE ','new secret');
  const data=await readFile(path),line=data.indexOf(10),updated=JSON.parse(data.subarray(0,line));
  assert.deepEqual(data.subarray(line+1),payload);
  assert.equal(updated.createdAt,record.createdAt);
  assert.notEqual(updated.passwordHash,record.passwordHash);
  const store=createLibraryStore(dir);
  await assert.rejects(store.load(id,{password:'forgotten'}),/Incorrect/);
  assert.deepEqual(await store.load(id,{password:'new secret'}),payload);
  await assert.rejects(resetLibraryPassword(dir,'missing','new secret'),{code:'ENOENT'});
 } finally { await rm(dir,{recursive:true,force:true}); }
});
