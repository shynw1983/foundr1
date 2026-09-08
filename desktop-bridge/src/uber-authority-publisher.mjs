import {connectMerchantMenuClient} from './merchant-menu-client.mjs';
import {AuthorityNativeDriver} from './uber-authority-native-driver.mjs';
import {runUberAuthorityPublication,validateAuthorityCommand} from './uber-authority-runner.mjs';

export async function publishNativeAuthority(session,platform,payload,reportProgress,merchantId) {
  validateAuthorityCommand(payload,platform,merchantId??payload.merchantId);
  if(payload.storeId!==session.config?.storeId)throw Error('uber_authority_store_scope_mismatch');
  const rocket=platform==='rocket_now';
  const transport=await connectMerchantMenuClient(session,rocket?'https://store.rocketnow.co.jp':'https://partner.demae-can.com',rocket?'SUCCESS':'MSA0000');
  try{return await runUberAuthorityPublication(payload,new AuthorityNativeDriver(transport,payload),reportProgress);}
  finally{transport.close();}
}
