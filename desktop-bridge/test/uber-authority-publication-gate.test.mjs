import test from 'node:test';
import assert from 'node:assert/strict';
import {RocketNowAdapter} from '../src/adapters/rocket-now.mjs';
import {DemaeCanAdapter} from '../src/adapters/demae-can.mjs';

test('invalid catalog commands fail before touching the browser or acknowledging success',async()=>{
 const session={goto(){throw new Error('Browser must not be touched before capability validation');}};
 for(const [adapter,platform] of [[new RocketNowAdapter(session),'rocket_now'],[new DemaeCanAdapter(session),'demae_can']]) {
  await assert.rejects(()=>adapter.publishMenuChanges({authoritativePublication:true,targets:[{kind:'item',name:'new'}]}),/uber_authority_command_invalid/);
 }
});
