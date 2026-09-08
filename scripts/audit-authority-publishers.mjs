import {loadConfig} from '../desktop-bridge/src/config.mjs';
import {BrowserSession} from '../desktop-bridge/src/browser-session.mjs';
import {connectMerchantMenuClient} from '../desktop-bridge/src/merchant-menu-client.mjs';
import {RocketMenuClient} from '../desktop-bridge/src/rocket-menu-client.mjs';
import {DemaeMenuClient} from '../desktop-bridge/src/demae-menu-client.mjs';

const config=await loadConfig();
const chainId=process.argv[2],pattern=process.argv[3];
if(!chainId||!pattern)throw Error('Usage: node scripts/audit-authority-publishers.mjs <Demae chain ID> <menu pattern>');
const rocketTransport=await connectMerchantMenuClient(new BrowserSession(config,'rocket_now'),'https://store.rocketnow.co.jp','SUCCESS');
try {
 const client=new RocketMenuClient(rocketTransport,config.platforms.rocket_now.storeId);
 const catalog=await client.catalog();
 if(process.argv.includes('--fields')) {
  const first=catalog.menus.flatMap(menu=>menu.dishes??[])[0];
  const detail=first?await client.detail(first.dishId):{};
  console.log(JSON.stringify({platform:'rocket_now',dishFields:Object.keys(detail),imageFields:Object.keys(detail.allDishImages?.[0]??{}),approvedImageFields:Object.keys(detail.allDishImages?.[0]?.dishImage??{}),groupFields:Object.keys(catalog.groups[0]??{}),dishGroupFields:Object.keys(detail.options?.[0]??{}),dishOptionFields:Object.keys(detail.options?.[0]?.optionItems?.[0]??{})}));
 }
 console.log(JSON.stringify({platform:'rocket_now',readOnly:true,categories:catalog.menus.length,items:new Set(catalog.menus.flatMap(menu=>menu.dishes??[]).map(item=>item.dishId)).size,groups:catalog.groups.length,options:catalog.groups.reduce((sum,group)=>sum+(group.optionItems?.length??0),0)}));
} finally {rocketTransport.close();}
const demaeTransport=await connectMerchantMenuClient(new BrowserSession(config,'demae_can'),'https://partner.demae-can.com','MSA0000');
try {
 const client=new DemaeMenuClient(demaeTransport,chainId,pattern);
 const {items,groups}=await client.catalog();
 const options=await client.options();
 if(process.argv.includes('--all-items'))console.log(JSON.stringify({allItems:await client.allItems()}));
 const stock=await client.stockCatalog();
 if(process.argv.includes('--markers'))console.log(JSON.stringify({markers:stock.optionList.filter(row=>/^FS[0-9a-f]{14}$/.test(row.optionName??''))}));
 console.log(JSON.stringify({platform:'demae_can',readOnly:true,stockItems:stock.itemList.length,stockOptions:stock.optionList.length,stockOptionFields:Object.keys(stock.optionList[0]??{})}));
 if(process.argv.includes('--fields')) {
  const first=items.categoryList.flatMap(category=>category.itemList??[])[0];
  const detail=first?await client.item(first.itemCode):{};
  const groupItems=groups[0]?await demaeTransport.request(`${client.base}/option-group/${encodeURIComponent(groups[0].optionGroupCode)}/option-item-list`):[];
  console.log(JSON.stringify({platform:'demae_can',categoryFields:Object.keys(items.categoryList[0]??{}),itemListFields:Object.keys(first??{}),itemFields:Object.keys(detail),sizeFields:Object.keys(detail.sizeInfoList?.[0]??{}),groupFields:Object.keys(groups[0]??{}),groupItemsArray:Array.isArray(groupItems),groupItemsFields:Object.keys(groupItems[0]??groupItems),groupItemSample:groupItems[0]}));
 }
 console.log(JSON.stringify({platform:'demae_can',readOnly:true,categories:items.categoryList.length,items:new Set(items.categoryList.flatMap(category=>category.itemList??[]).map(item=>item.itemCode)).size,groups:groups.length,options:options.length,optionFields:Object.keys(options[0]??{})}));
} finally {demaeTransport.close();}
