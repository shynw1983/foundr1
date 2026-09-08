import {sameMenuValue,yen} from './merchant-menu-client.mjs';

const nativeCode=value=>{
 const text=String(value??'');
 if(!/^[A-Za-z0-9_-]+$/.test(text))throw Error('demae_stage_code_invalid');
 return text;
};

// Each held option owns a carrier group linked only to the unassigned draft
// pattern. It is never linked to a selling item and never expires at midnight.
export class DemaeStagedOption {
 constructor(client){this.client=client;}
 async read(identity) {return (await this.readAll([identity]))[0];}
 async readAll(identities) {
  if(!identities.length)return [];
  const c=this.client;
  for(const row of identities){nativeCode(row.optionCode);nativeCode(row.groupCode);if(!/^FS[0-9a-f]{14}$/.test(row.marker))throw Error('demae_stage_marker_invalid');}
  await c.assertScope();
  const readGroups=async()=>{
   const rows=[];
   for(let i=0;i<identities.length;i+=4)rows.push(...await Promise.all(identities.slice(i,i+4).map(row=>c.group(row.groupCode))));
   return rows;
  };
  const carrierItems=groups=>[...new Map(groups.flatMap(group=>group.items).map(item=>[String(item.itemCode),item])).values()];
  const before=await readGroups();
  before.forEach((group,index)=>{
   const identity=identities[index];
   if(group.detail.optionGroupName!==identity.marker||group.options.length!==1||String(group.options[0].optionCode)!==String(identity.optionCode))throw Error('demae_stage_group_not_isolated');
   if(String(group.options[0].chainId)!==c.chainId)throw Error('demae_stage_identity_mismatch');
  });
  await c.hiddenGroupItems(carrierItems(before));
  const stock=await c.stockCatalog(),live=await c.options();
  for(const row of identities)if(stock.optionList.some(option=>String(option.chainId)===c.chainId&&String(option.optionCode)===String(row.optionCode))||live.some(option=>String(option.optionCode)===String(row.optionCode)))throw Error('demae_stage_option_is_published');
  const after=await readGroups();
  await c.hiddenGroupItems(carrierItems(after));
  return after.map((group,index)=>{
   if(!sameMenuValue(group.items,before[index].items)||!sameMenuValue(group.options,before[index].options)||group.detail.optionGroupName!==identities[index].marker)throw Error('demae_stage_changed_during_read');
   return {option:group.options[0],groupCode:String(identities[index].groupCode),hidden:true};
  });
 }
 async ensure({marker,price,itemType,receipt,allowCreate=false},saveReceipt) {
  const c=this.client;yen(price);
  if(!/^FS[0-9a-f]{14}$/.test(marker)||itemType!=='REDUCED_RATE_NORMAL_ITEM'
   ||typeof saveReceipt!=='function')throw Error('demae_stage_metadata_required');
  await c.assertScope();
  let optionCode=receipt?.optionCode,groupCode=receipt?.groupCode;
  const groupPending=groupCode==='__creating__';
  if(groupPending)groupCode='';
  if(!optionCode) {
   const local=await c.transport.creationReceipt(`demae:${c.chainId}:option:${marker}`);
   let created;
   if(local?.status==='received')created=local.data;
   else {
    if(!allowCreate||local&&local.status!=='rejected')throw Error('demae_stage_creation_uncertain');
    created=await c.createUnlinkedOption({marker,price,itemType});
   }
   if(String(created?.chainId)!==c.chainId||!created?.optionCode
    ||created.optionName!==marker||Number(created.price)!==price)throw Error('demae_stage_receipt_invalid');
   optionCode=nativeCode(created.optionCode);
   // Save the option ID before attempting any carrier-group creation.
   await saveReceipt({optionCode,groupCode:''});
  }
  nativeCode(optionCode);
  if(!groupCode) {
   const local=await c.transport.creationReceipt(`demae:${c.chainId}:group:${marker}`);
   if(local?.status==='received') {
    if(String(local.data?.chainId)!==c.chainId||!local.data?.optionGroupCode)throw Error('demae_stage_group_receipt_invalid');
    groupCode=nativeCode(local.data.optionGroupCode);
    await saveReceipt({optionCode,groupCode});
   } else {
    if(groupPending&&local?.status!=='rejected'||local&&local.status!=='rejected')throw Error('demae_stage_group_creation_uncertain');
    await saveReceipt({optionCode,groupCode:'__creating__'});
    await c.createStagedGroup({marker,optionCodes:[optionCode],buttonType:'CHECKBOX'},async id=>{
     groupCode=nativeCode(id);await saveReceipt({optionCode,groupCode});
    });
   }
  }
  const actual=await this.read({optionCode,groupCode,marker});
  if(actual.option.optionName!==marker||Number(actual.option.price)!==price)throw Error('demae_stage_content_mismatch');
  return actual;
 }
 async update(identity,{name,price}) {
  const c=this.client,before=await this.read(identity),option=before.option;
  if(typeof name!=='string'||!name.trim())throw Error('demae_stage_name_invalid');yen(price);
  const body={};
  for(const key of ['chainId','optionCode','applyStartDate','applyEndDate','optionName','price','linkageItemCode','linkageItemName','itemType'])body[key]=option[key];
  const date=value=>{const text=String(value??'').replaceAll('/','-');if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw Error('demae_stage_date_invalid');return text;};
  body.optionName=name;body.price=price;
  await c.transport.request(`${c.base}/option-item/${nativeCode(option.optionCode)}/${date(option.applyStartDate)}/${date(option.applyEndDate)}`,'PUT',body);
  const after=await this.read(identity);
  if(after.option.optionName!==name||Number(after.option.price)!==price
   ||!sameMenuValue({...after.option,optionName:option.optionName,price:option.price},option))throw Error('demae_stage_update_unverified');
  return after;
 }
}
