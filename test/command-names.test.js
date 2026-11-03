import test from 'node:test';import assert from 'node:assert/strict';
import {sanitizeCommandName,commandDisplayName,validateCommandIdentity} from '../src/model.js';
test('display names and slash names have separate identity rules',()=>{
 assert.equal(sanitizeCommandName('/ Sunday-Fishing_!? '),'SundayFishing');assert.equal(commandDisplayName({name:'fftg',displayName:'Sunday Fishing'}),'Sunday Fishing');assert.equal(commandDisplayName({name:'old'}),'old');
 assert.equal(validateCommandIdentity({displayName:'Sunday Fishing',name:' /ff-tg! '},[]).name,'fftg');
 assert.throws(()=>validateCommandIdentity({displayName:'Anything',name:'o f f'},[]),/reserved/);
 assert.throws(()=>validateCommandIdentity({displayName:'Anything',name:'!!!'},[]),/letters/);
 assert.throws(()=>validateCommandIdentity({displayName:'Anything',name:'a'.repeat(26)},[]),/25/);
 assert.throws(()=>validateCommandIdentity({displayName:'Other title',name:'FFTG'},[{id:'a',name:'fftg'}]),/already exists/);
 assert.equal(validateCommandIdentity({displayName:'Same title',name:'fftg'},[{id:'a',name:'fftg'}],'a').name,'fftg');
});
