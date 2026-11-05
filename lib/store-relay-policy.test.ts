import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAndScaleLine, usableScaleReading } from './store-relay-policy.ts';
test('A&D grams/kg and ST/US/OL are distinguished; malformed frames are rejected',()=>{
 assert.deepEqual(parseAndScaleLine('ST,+000300.0  g\r\n'),{grams:300,stable:true,overload:false});
 assert.deepEqual(parseAndScaleLine('US,+0000.300 kg'),{grams:300,stable:false,overload:false});
 assert.equal(parseAndScaleLine('OL,+9999.999 kg')?.overload,true);
 for(const line of ['300','ST,NaN g','ST,+123 PC','ST,+123g;ST,+999g','ST,+123 mg'])assert.equal(parseAndScaleLine(line),null);
});
test('official SH-AWP 17-byte ASCII frames preserve units/sign and never treat control replies as weight',()=>{
 const samples=[
  ['ST,+0012.345 kg\r\n',{grams:12345,stable:true,overload:false}],
  ['ST,-00001234  g\r\n',{grams:-1234,stable:true,overload:false}],
  ['US,+0007.890 kg\r\n',{grams:7890,stable:false,overload:false}],
  ['OL,+9999.999 kg\r\n',{grams:9999999,stable:false,overload:true}]
 ] as const;
 for(const [frame,expected] of samples){assert.equal(Buffer.byteLength(frame,'ascii'),17);assert.deepEqual(parseAndScaleLine(frame),expected);}
 for(const frame of ['ST,+00000003 PC\r\n','Q\r\n','Z\r\n','T\r\n','CT\r\n','OK\r\n','ST, +0012.345 kg\r\n'])assert.equal(parseAndScaleLine(frame),null);
});
test('only fresh stable positive in-range scale readings can be adopted',()=>{
 const now=10000,good={grams:300,stable:true,overload:false};
 assert.equal(usableScaleReading(good,now,now),true);
 for(const r of [{...good,stable:false},{...good,overload:true},{...good,grams:0},{...good,grams:-1},{...good,grams:3000.5}])assert.equal(usableScaleReading(r,now,now),false);
 assert.equal(usableScaleReading(good,now-5001,now),false);
 assert.equal(usableScaleReading(good,now+1,now),false);
 assert.equal(usableScaleReading(null,now,now),false);
});
