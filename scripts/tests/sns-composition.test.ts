import { test } from "node:test";
import assert from "node:assert/strict";
import { cropGeometry, snsPresets } from "../../lib/sns-composition.ts";
import { decodeWidth, photoDimensions } from "../../lib/sns-image.ts";
test("two complete-logo presets keep fixed output positions",()=>{assert.deepEqual(snsPresets.map(p=>[p.x,p.y,p.width,p.height]),[[345,1658,390,130],[403,1651,274,91]]);});
test("portrait, landscape and zoom always cover the output without blank edges",()=>{for(const [w,h] of [[1080,1920],[4000,3000],[3000,4000],[8000,1000]])for(const zoom of [1,2,4])for(const x of [-1e6,0,1e6]){const g=cropGeometry(w,h,{zoom,x,y:-x});assert.ok(g.x<=0&&g.y<=0&&g.x+g.width>=1080&&g.y+g.height>=1920);}});
test("large and extreme-ratio photos rejected before decoding; retained image bounded",()=>{assert.throws(()=>decodeWidth(20000,20000));assert.throws(()=>decodeWidth(100,10000));for(const [w,h] of [[8000,6000],[6000,8000]]){const width=decodeWidth(w,h);assert.ok(width<=2160);assert.ok(width*h/w<=2160);assert.ok(width*w/h<=2160);}});
test("dimensions read from PNG bytes rather than MIME",()=>{const b=new Uint8Array(24);b[0]=137;b[1]=80;const d=new DataView(b.buffer);d.setUint32(16,1080);d.setUint32(20,1920);assert.deepEqual(photoDimensions(b),{width:1080,height:1920});assert.throws(()=>photoDimensions(new Uint8Array(24)));});
