import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
const sourceFile=await fs.readFile('assets/sns/maamaa-complete-logo.png');
const {data:source,info}=await sharp(sourceFile).ensureAlpha().raw().toBuffer({resolveWithObject:true});
test('official source unchanged; both variants preserve alpha, complete seal and lettering geometry',async()=>{
 assert.equal(crypto.createHash('sha256').update(sourceFile).digest('hex'),'37e1c62ffc4b190e1c7121e36c1165580db0e05b2f8c264f1e18c291f3b86eeb');
 for(const color of ['black','white']) {
  const {data,info:out}=await sharp(`assets/sns/maamaa-complete-logo-${color}.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.deepEqual([out.width,out.height,out.channels],[390,130,4]);let letterCount=0,transparentCount=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++) {
   const p=(y*info.width+x)*4;assert.equal(data[p+3],source[p+3],`${color} alpha (${x},${y})`);
   if(x<151)assert.deepEqual(data.subarray(p,p+4),source.subarray(p,p+4),`${color} seal/gap (${x},${y})`);
   if(!data[p+3])transparentCount++;
   if(x>=151&&source[p+3]){letterCount++;assert.deepEqual([...data.subarray(p,p+3)],color==='white'?[255,255,255]:[0,0,0]);}
  }
  assert.ok(letterCount>3000);assert.ok(transparentCount>20000);
 }
});
