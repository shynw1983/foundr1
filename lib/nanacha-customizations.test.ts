import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStructuredCustomizations } from './nanacha-customizations.ts';
const group={id:'food-spice',externalId:'',groupKey:'food-spice',label:'辛さ',selectionType:'single' as const,minSelections:1,maxSelections:1,allowRepeat:false,perOptionMax:1,options:[{id:'mild',externalId:'',optionKey:'mild',label:'控えめ',price:0}]};
test('plain food accepts an empty customization list without drink options',()=>{assert.deepEqual(validateStructuredCustomizations([],[]),[])});
test('food rejects inherited drink controls and unavailable required options',()=>{assert.equal(validateStructuredCustomizations([{groupId:'sweetness',optionIds:['normal']}],[]),null);assert.equal(validateStructuredCustomizations([],[group]),null);assert.equal(validateStructuredCustomizations([{groupId:group.id,optionIds:['mild']}],[{...group,options:[]}]),null)});
test('validated food options retain structured identities and master pricing',()=>{const result=validateStructuredCustomizations([{groupId:group.id,optionIds:['mild'],price:-999}],[group]);assert.equal(result?.[0].groupKey,'food-spice');assert.deepEqual(result?.[0].optionKeys,['mild']);assert.equal(result?.[0].price,0);assert.equal(validateStructuredCustomizations([{groupId:group.id,optionIds:['mild','mild']}],[group]),null)});
