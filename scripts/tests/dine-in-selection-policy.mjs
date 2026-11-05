import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { getPosOptionSelectionRules as rules } from '../../lib/dine-in-option-selection.ts';
const checks=[];
function check(name, fn) {fn(); checks.push({name,passed:true});}
const legacy={groupKey:'option',selectionType:'multiple',ruleJson:{maxSelections:3}};
check('Shared brand option retains identified single-choice behavior',()=>assert.equal(rules(legacy).type,'single'));
check('Store group respects explicit multiple even for legacy option key',()=>assert.deepEqual(rules({...legacy,sourceGroupId:'canonical'}),{type:'multiple',min:0,max:3,perOptionMax:1}));
check('Store quantity respects both total bounds and per-choice cap',()=>assert.deepEqual(rules({groupKey:'noodle',selectionType:'quantity',sourceGroupId:'canonical',ruleJson:{limit:5,maxSelections:3,minSelections:1,perOptionMax:2}}),{type:'quantity',min:1,max:3,perOptionMax:2}));
check('No-repeat quantity mode caps each choice at one',()=>assert.equal(rules({groupKey:'noodle',selectionType:'quantity',sourceGroupId:'canonical',ruleJson:{maxSelections:4,allowRepeat:false,perOptionMax:3}}).perOptionMax,1));
check('Store single selection cannot exceed one even if upstream maximum is larger',()=>assert.equal(rules({...legacy,sourceGroupId:'',selectionType:'single',ruleJson:{maxSelections:99}}).max,1));
check('Unconfigured shared legacy limit preserves numeric-string compatibility',()=>assert.equal(rules({...legacy,groupKey:'topping',ruleJson:{limit:'2'}}).max,2));
const files=['lib/dine-in-option-selection.ts','scripts/tests/dine-in-selection-policy.mjs'];
const report={passed:true,checks,sourceHashes:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')])),productionWrites:0};
if(process.env.TEST_OUTPUT_DIR){fs.mkdirSync(process.env.TEST_OUTPUT_DIR,{recursive:true});fs.writeFileSync(process.env.TEST_OUTPUT_DIR+'/report.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report));
