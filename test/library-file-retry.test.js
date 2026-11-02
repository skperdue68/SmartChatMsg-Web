import test from 'node:test';
import assert from 'node:assert/strict';
import {retryLibraryFileOperation} from '../src/library-store.js';
test('transient Windows file replacement retries are bounded and preserve the operation result',async()=>{
 let attempts=0;const delays=[];
 assert.equal(await retryLibraryFileOperation(async()=>{if(++attempts<3)throw Object.assign(new Error('busy'),{code:'EPERM'});return 'saved';},{platform:'win32',delay:async ms=>delays.push(ms)}),'saved');
 assert.deepEqual(delays,[50,100]);assert.equal(attempts,3);
 for(const [platform,code,count] of [['linux','EPERM',1],['win32','ENOENT',1],['win32','EPERM',6]]){
  attempts=0;await assert.rejects(retryLibraryFileOperation(async()=>{attempts++;throw Object.assign(new Error('blocked'),{code});},{platform,delay:async()=>{}}),{code});assert.equal(attempts,count);
 }
});
