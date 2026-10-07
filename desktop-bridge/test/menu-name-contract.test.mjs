import test from 'node:test';
import assert from 'node:assert/strict';
import {MENU_NAME_CONTRACT_VERSION,inspectMenuNameContract} from '../src/menu-name-contract.mjs';

test('confirmed Demae option prohibition detects embedded English without mistaking it for a length limit',()=>{
  const name='ひとくち台湾豚ソーセージ｜一口台湾猪肉肠｜한입 대만식 돼지고기 소시지｜Bite-Sized Taiwanese Pork Sausage';
  assert.equal(name.length,70);
  const expected=[{code:'native_name_prohibited_substring',rule:'demae-option-size-substring',fragment:'size'}];
  assert.deepEqual(inspectMenuNameContract('demae_can','option',name),expected);
  assert.deepEqual(inspectMenuNameContract('demae_can','option','Large SIZE'),expected);
  assert.deepEqual(inspectMenuNameContract('demae_can','option','Oversized Portion'),expected);
  assert.equal(MENU_NAME_CONTRACT_VERSION,'native-name-contract-v1');
});

test('name inspection is scoped to Demae options and never rewrites names',()=>{
  const name='Bite-Sized Taiwanese Pork Sausage';
  for(const platform of ['rocket_now','uber_eats','unknown'])assert.deepEqual(inspectMenuNameContract(platform,'option',name),[]);
  for(const kind of ['item','category','option_group'])assert.deepEqual(inspectMenuNameContract('demae_can',kind,name),[]);
  assert.deepEqual(inspectMenuNameContract('demae_can','option','Taiwanese Pork Sausage Bites'),[]);
  // Other frontend restrictions are not promoted without a verified native
  // operation. Neither typography nor a generic backend code expands this rule.
  assert.deepEqual(inspectMenuNameContract('demae_can','option','Import Face ！！'),[]);
  assert.equal(name,'Bite-Sized Taiwanese Pork Sausage');
});
