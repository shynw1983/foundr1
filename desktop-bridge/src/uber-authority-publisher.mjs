import {connectMerchantMenuClient} from './merchant-menu-client.mjs';
import {AuthorityNativeDriver} from './uber-authority-native-driver.mjs';
import {runUberAuthorityPublication,validateAuthorityCommand} from './uber-authority-runner.mjs';
import {createMenuProgress} from './menu-progress.mjs';

export async function publishNativeAuthority(session,platform,payload,reportProgress,merchantId) {
  validateAuthorityCommand(payload,platform,merchantId??payload.merchantId);
  if(payload.storeId!==session.config?.storeId)throw Error('uber_authority_store_scope_mismatch');
  const rocket=platform==='rocket_now';
  const progress=createMenuProgress(reportProgress);
  const transport=await connectMerchantMenuClient(session,rocket?'https://store.rocketnow.co.jp':'https://partner.demae-can.com',rocket?'SUCCESS':'MSA0000',progress.request);
  try{return await runUberAuthorityPublication(payload,new AuthorityNativeDriver(transport,payload),progress.stage);}
  finally{transport.close();}
}
