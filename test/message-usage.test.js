import test from 'node:test';
import assert from 'node:assert/strict';
import { messageSelectionStats } from '../src/model.js';
test('usage weighting mirrors ESO: unused first, oldest then count and stable ID',()=>{
 const messages=[{id:'new',useCount:0},{id:'old',lastUsedAt:100,useCount:9},{id:'b',lastUsedAt:200,useCount:1},{id:'a',lastUsedAt:200,useCount:1}];
 assert.deepEqual(messageSelectionStats(messages[0],messages),{lastUsedAt:null,useCount:0,rank:1,weight:4,totalWeight:10,chance:40});
 assert.equal(messageSelectionStats(messages[1],messages).weight,3);
 assert.equal(messageSelectionStats(messages[3],messages).rank,3);
 assert.equal(messageSelectionStats(messages[2],messages).weight,1);
});
test('disabled messages have history but no selection weight; invalid history is normalized',()=>{
 const message={id:'off',lastUsedAt:123.9,useCount:8.8};
 assert.deepEqual(messageSelectionStats(message,[]),{lastUsedAt:123,useCount:8,rank:null,weight:0,totalWeight:0,chance:0});
 assert.equal(messageSelectionStats({id:'x',useCount:-1,lastUsedAt:'bad'},[]).lastUsedAt,null);
 assert.equal(messageSelectionStats({id:'x',useCount:Infinity},[]).useCount,0);
});
