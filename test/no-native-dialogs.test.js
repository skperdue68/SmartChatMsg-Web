import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
const nativeCall=/\b(?:alert|confirm|prompt)\s*\(/;
test('application actions use styled modals instead of browser-native dialogs',async()=>{
 for(const directory of ['public','src'])for(const name of await readdir(new URL('../'+directory+'/',import.meta.url)))if(name.endsWith('.js')){
  const source=await readFile(new URL('../'+directory+'/'+name,import.meta.url),'utf8');assert.doesNotMatch(source,nativeCall,directory+'/'+name+' must use an in-site dialog');
 }
});
