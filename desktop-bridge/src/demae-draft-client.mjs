import {positiveId,yen} from './merchant-menu-client.mjs';

const code=value=>{
 const text=String(value??'');
 if(!/^[A-Za-z0-9_-]+$/.test(text))throw Error('demae_draft_code_invalid');
 return encodeURIComponent(text);
};
const marker=value=>{
 if(!/^FS[0-9a-f]{14}$/.test(value))throw Error('demae_draft_marker_invalid');
 return value;
};

// A draft is isolated by an UNASSIGNED menu pattern, never by a clock/date.
// There is deliberately no shop-menu-pattern mutation in this client.
export class DemaeDraftClient {
 constructor(transport,chainId,livePattern,{today}={}) {
  this.transport=transport;this.chainId=positiveId(chainId);this.livePattern=String(livePattern);
  this.base=`/merchant-admin/api/v1/product/chain/${this.chainId}`;
  this.today=today??new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
 }
 async patterns() {
  const result=await this.transport.request('/merchant-admin/api/v1/product/search/menu-pattern','POST',{
   chainId:Number(this.chainId),keyword:'',offset:0,limit:100
  });
  if(!Array.isArray(result?.menuPatternList)||result.isContinueNextPage!==false||result.totalCount!==result.menuPatternList.length)throw Error('demae_draft_patterns_incomplete');
  if(result.menuPatternList.some(row=>String(row.chainId)!==this.chainId))throw Error('demae_draft_scope_mismatch');
  return result.menuPatternList;
 }
 async assertHiddenPattern(patternId) {
  if(String(patternId)===this.livePattern)throw Error('demae_draft_is_live_pattern');
  const rows=await this.patterns();
  const selected=rows.filter(row=>String(row.menuPatternCode)===String(patternId));
  if(selected.length!==1)throw Error('demae_draft_pattern_missing');
  const pattern=selected[0];
  if(pattern.shopCountPerMenuPattern!==0||pattern.displayShopCount!==0||!Array.isArray(pattern.linkedShopList)||pattern.linkedShopList.length)throw Error('demae_draft_pattern_is_assigned');
  return pattern;
 }
 async ensurePattern(areaMarker,saveReceipt) {
  marker(areaMarker);
  if(typeof saveReceipt!=='function')throw Error('demae_draft_receipt_callback_required');
  const before=await this.patterns();
  if(!before.some(row=>row.menuPatternCode===this.livePattern))throw Error('demae_draft_live_scope_missing');
  const name=`Foundr1 下書き ${areaMarker}`;
  const matches=before.filter(row=>row.menuPatternName===name);
  if(matches.length>1)throw Error('demae_draft_pattern_ambiguous');
  let id=matches[0]?.menuPatternCode;
  if(!id) {
   const receipt=await this.transport.request(`${this.base}/menu-pattern`,'POST',{
    menuPatternName:name,menuPatternCategoryLinkList:[]
   },{receiptKey:`demae:${this.chainId}:draft:${areaMarker}`});
   if(String(receipt?.chainId)!==this.chainId||!receipt?.menuPatternCode)throw Error('demae_draft_receipt_invalid');
   id=receipt.menuPatternCode;
   await saveReceipt({kind:'menu_pattern',externalId:id});
  }
  const actual=await this.assertHiddenPattern(id);
  if(actual.menuPatternName!==name)throw Error('demae_draft_pattern_identity_mismatch');
  await this.ensureTopImage(id);
  // Existing live assignments must remain exactly unchanged.
  const after=await this.patterns();
  for(const prior of before.filter(row=>row.menuPatternCode!==id)) {
   const current=after.find(row=>row.menuPatternCode===prior.menuPatternCode);
   if(JSON.stringify(current)!==JSON.stringify(prior))throw Error('demae_draft_live_assignment_changed');
  }
  return String(id);
 }
 async ensureTopImage(patternId) {
  await this.assertHiddenPattern(patternId);
  const path=`${this.base}/menu-pattern/${code(patternId)}`;
  const links=await this.transport.request(`${path}/linked-category-list`);
  if(!Array.isArray(links?.categoryList))throw Error('demae_draft_catalog_incomplete');
  if(links.recommendCategory)return;
  // Image configuration belongs to the merchant. Do not even copy a live
  // image reference into another pattern as part of menu synchronization.
  throw Error('demae_draft_top_image_requires_merchant_setup');
 }
 async ensureCategory(patternId,areaMarker,saveReceipt) {
  marker(areaMarker);
  if(typeof saveReceipt!=='function')throw Error('demae_draft_receipt_callback_required');
  await this.assertHiddenPattern(patternId);
  const list=await this.transport.request(`${this.base}/menu-pattern/${code(patternId)}/item-list`);
  if(!Array.isArray(list?.categoryList))throw Error('demae_draft_catalog_incomplete');
  const name=`未公開 ${areaMarker}`;
  const matches=list.categoryList.filter(row=>row.categoryName===name);
  if(matches.length>1)throw Error('demae_draft_category_ambiguous');
  let category=matches[0];
  if(!category) {
   category=await this.transport.request(`${this.base}/category`,'POST',{
    chainId:1,categoryCode:'',applyStartDate:this.today.replaceAll('-','/'),applyEndDate:'9999/12/31',
    categoryName:name,adminCategoryName:name,type:'NORMAL_CATEGORY',categoryType:'NORMAL_CATEGORY',
    businessType:'NORMAL',isSideOrderCategory:false,categoryDescription:'',
    menuPatternCategoryLinkList:[{menuPatternCode:String(patternId)}],categoryItemLinkList:[]
   },{receiptKey:`demae:${this.chainId}:draft-category:${areaMarker}`});
   if(!category?.categoryCode)throw Error('demae_draft_category_receipt_missing');
   await saveReceipt({kind:'category',externalId:category.categoryCode,receipt:category});
  }
  const actual=await this.category(category);
  this.assertCategoryLinks(actual,patternId);
  if(actual.categoryName!==name)throw Error('demae_draft_category_identity_mismatch');
  return actual;
 }
 async category(row) {
  const date=value=>code(String(value??'').replaceAll('/','-'));
  const actual=await this.transport.request(`${this.base}/category/${code(row.categoryCode)}/${date(row.applyStartDate)}/${date(row.applyEndDate)}`);
  const links=await this.transport.request(`${this.base}/category/${code(row.categoryCode)}/menu-pattern-list`);
  if(!Array.isArray(links)||links.some(link=>String(link.chainId)!==this.chainId))throw Error('demae_draft_category_links_incomplete');
  return {...actual,menuPatternCategoryLinkList:links};
 }
 assertCategoryLinks(category,patternId) {
  const links=category.menuPatternCategoryLinkList;
  if(String(category.chainId)!==this.chainId||!Array.isArray(links)||links.length!==1||String(links[0].menuPatternCode)!==String(patternId))throw Error('demae_draft_category_is_shared');
 }
 async createItem({patternId,category,marker:itemMarker,price,description='',itemType},saveReceipt) {
  marker(itemMarker);yen(price);
  if(itemType!=='REDUCED_RATE_NORMAL_ITEM'||typeof saveReceipt!=='function')throw Error('demae_draft_item_metadata_required');
  await this.assertHiddenPattern(patternId);
  this.assertCategoryLinks(await this.category(category),patternId);
  const receipt=await this.transport.request(`${this.base}/item`,'POST',{
   chainId:1,itemCode:'',itemName:itemMarker,itemDescription:description.replaceAll('\n','<br>'),
   comboItemType:'NORMAL_ITEM',itemType,appealIconCode:'0',itemImageEditType:'NOT_EDIT',
   sizeInfoList:[{chainId:1,itemCode:'',applyStartDate:this.today.replaceAll('-','/'),applyEndDate:'9999/12/31',
    dispOrder:1,sizeName:'',price,linkageItemCode:'',linkageItemName:'',sizeOptionGroupLinkList:[]}],
   categoryItemLinkList:[{categoryCode:category.categoryCode}]
  },{receiptKey:`demae:${this.chainId}:item:${itemMarker}`});
  if(String(receipt?.chainId)!==this.chainId||!receipt?.itemCode)throw Error('demae_draft_item_receipt_missing');
  await saveReceipt({kind:'item',externalId:receipt.itemCode,receipt});
  const actual=await this.assertHiddenItem(patternId,receipt.itemCode);
  if(actual.itemName!==itemMarker||actual.sizeInfoList?.length!==1||Number(actual.sizeInfoList[0].price)!==price)throw Error('demae_draft_item_content_mismatch');
  return actual;
 }
 async assertHiddenItem(patternId,itemId) {
  await this.assertHiddenPattern(patternId);
  const actual=await this.transport.request(`${this.base}/item/${code(itemId)}`);
  if(String(actual.chainId)!==this.chainId||String(actual.itemCode)!==String(itemId))throw Error('demae_draft_item_identity_mismatch');
  const links=await this.transport.request(`${this.base}/item/${code(itemId)}/linked-category-list`);
  if(!Array.isArray(links)||!links.length)throw Error('demae_draft_item_links_incomplete');
  for(const linked of links)this.assertCategoryLinks(await this.category(linked),patternId);
  // Recheck after the detail reads; a human may have assigned the draft menu.
  await this.assertHiddenPattern(patternId);
  return {...actual,categoryItemLinkList:links};
 }
}
