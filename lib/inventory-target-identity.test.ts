import test from 'node:test';
import assert from 'node:assert/strict';
import {selectInventoryIdentity} from './inventory-target-identity.ts';
const rows=[{id:'thin',name:'火鍋春雨（細）50g',displayNames:{zh:'火锅粉（细）'}},{id:'wide',name:'火鍋春雨（極太）50g',displayNames:{zh:'火锅粉（极宽）'}},{id:'replace',name:'火鍋春雨50g（細）に変更',displayNames:null}];
test('IDs take precedence over stale names and invalid IDs never fall back',()=>{
 assert.equal(selectInventoryIdentity(rows,rows[1].name,'thin')?.id,'thin');
 assert.equal(selectInventoryIdentity(rows,rows[0].name,'deleted'),null);
});
test('no-ID input must match exactly one full name',()=>{
 assert.equal(selectInventoryIdentity(rows,'火锅粉（细）')?.id,'thin');
 assert.equal(selectInventoryIdentity(rows,'火鍋春雨'),null);
 assert.equal(selectInventoryIdentity([...rows,{...rows[0],id:'duplicate'}],rows[0].name),null);
});
