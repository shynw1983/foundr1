import { positiveId, yen, sameMenuValue } from './merchant-menu-client.mjs';
import {DemaeDraftClient} from './demae-draft-client.mjs';

const code = value => {
  const text=String(value??'');
  if(!/^[A-Za-z0-9_-]+$/.test(text))throw new Error('demae_menu_code_invalid');
  return encodeURIComponent(text);
};
const date = value => {
  const text=String(value??'').replaceAll('/','-');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw new Error('demae_menu_date_invalid');
  return text;
};

export function demaeItemUpdate(detail,patch,today) {
  const sizes=detail.sizeInfoList??[];
  const active=sizes.filter(size=>date(size.applyStartDate)<=today && date(size.applyEndDate)>=today);
  if((patch.price!==undefined||patch.groupLinks!==undefined) && active.length!==1)throw new Error('demae_menu_ambiguous_active_size');
  const output={};
  for(const key of ['chainId','itemCode','itemName','itemDescription','imageTrimmingRange','comboItemType','itemType','appealIconCode','sizeInfoList','categoryItemLinkList','itemImageFileName'])output[key]=detail[key];
  output.itemName=patch.name??detail.itemName;
  output.itemDescription=patch.description!==undefined?patch.description.replaceAll('\n','<br>'):detail.itemDescription;
  output.sizeInfoList=sizes.map(size=>({...size,
    // The edit form's key identifies an existing period. GET returns these
    // fields as null; echoing null makes the server treat it as a new period.
    originalApplyStartDate:size.applyStartDate,originalApplyEndDate:size.applyEndDate,
    price:patch.price!==undefined && size===active[0]?yen(patch.price):size.price,
    ...(patch.groupLinks!==undefined&&size===active[0]?{sizeOptionGroupLinkList:patch.groupLinks}:{})}));
  output.categoryItemLinkList=patch.categoryLinks??detail.categoryItemLinkList;
  output.itemImageEditType='NOT_EDIT';output.itemImage=null;
  return output;
}

function storedSizes(sizes) {
  return sizes.map(({originalApplyStartDate,originalApplyEndDate,...size})=>size);
}

export class DemaeMenuClient {
  constructor(transport,chainId,menuPatternCode,{today,draftPatternCode,draftCarrierItemCode}={}) {
    this.transport=transport;this.chainId=positiveId(chainId);this.pattern=String(menuPatternCode);
    this.base=`/merchant-admin/api/v1/product/chain/${this.chainId}`;
    this.patternPath=code(this.pattern);
    this.today=today??new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
    this.draftPatternCode=draftPatternCode?String(draftPatternCode):'';
    this.draftCarrierItemCode=draftCarrierItemCode?String(draftCarrierItemCode):'';
  }
  async assertScope() {
    const chains=await this.transport.request('/merchant-admin/api/v1/product/search/chain-menu-pattern');
    const chain=chains?.find(row=>String(row.chain?.chainId)===this.chainId);
    if(!chain?.menuPatternList?.some(row=>row.menuPatternCode===this.pattern))throw new Error('demae_menu_scope_mismatch');
    // Editing a shared definition could modify another menu/store. A dedicated
    // shared-chain strategy is required before relaxing this constraint.
    const other=chain.menuPatternList.filter(row=>row.menuPatternCode!==this.pattern);
    if(other.length) {
      if(other.length!==1||!this.draftPatternCode||other[0].menuPatternCode!==this.draftPatternCode)throw new Error('demae_menu_shared_chain_requires_mapping');
      await new DemaeDraftClient(this.transport,this.chainId,this.pattern).assertHiddenPattern(this.draftPatternCode);
    }
  }
  async catalog() {
    await this.assertScope();
    const [items,groups]=await Promise.all([
      this.transport.request(`${this.base}/menu-pattern/${this.patternPath}/item-list`),
      this.transport.request(`/merchant-admin/api/v1/product/suggest/chain/${this.chainId}/menu-pattern/${this.patternPath}/linked-option-group-list`)
    ]);
    if(!Array.isArray(items?.categoryList)||!Array.isArray(groups))throw new Error('demae_menu_incomplete_catalog');
    return {items,groups};
  }
  item(id) {return this.transport.request(`${this.base}/item/${code(id)}`);}
  async allItems() {
    await this.assertScope();
    const rows=await this.transport.request(`/merchant-admin/api/v2/product/suggest/chain/${this.chainId}/menu-pattern/${this.patternPath}/item-list-with-unlinked`);
    if(!Array.isArray(rows))throw Error('demae_menu_all_items_incomplete');
    return rows;
  }
  async stockCatalog() {
    const scope=await this.transport.request('/merchant-admin/api/v1/stock/stockout/shop-list');
    if(!Array.isArray(scope?.shopList))throw new Error('demae_menu_stock_scope_missing');
    const shops=scope.shopList.filter(shop=>String(shop.chainId)===this.chainId);
    if(!shops.length || new Set(shops.map(shop=>String(shop.shopId))).size!==1)throw new Error('demae_menu_stock_scope_ambiguous');
    // This POST is the merchant's read-only query, not its stockout mutation.
    const snapshot=await this.transport.request('/merchant-admin/api/v1/stock/stockout/target-list','POST',{
      shopList:shops.map(shop=>({chainId:shop.chainId,shopId:shop.shopId,orderType:shop.orderType}))
    });
    if(!Array.isArray(snapshot?.itemList)||!Array.isArray(snapshot?.optionList)||snapshot.hasOverOptionLimitChain!==false)throw new Error('demae_menu_stock_snapshot_incomplete');
    return snapshot;
  }
  async stockState(kind,id) {
    const snapshot=await this.stockCatalog();
    const key=kind==='item'?'itemCode':'optionCode';
    const matches=(kind==='item'?snapshot.itemList:snapshot.optionList).filter(row=>String(row.chainId)===this.chainId&&String(row[key])===String(id));
    if(matches.length>1)throw new Error('demae_menu_stock_identity_ambiguous');
    if(!matches.length)return {listed:false};
    const row=matches[0];
    const records=kind==='item'?row.stockoutItemList:row.stockoutOptionList;
    if(!Array.isArray(row.linkedShopList)||!Array.isArray(records))throw new Error('demae_menu_stock_snapshot_incomplete');
    return {listed:true,linkedShops:row.linkedShopList,records,
      sizes:kind==='item'?(row.itemSizeList??[]).map(size=>({sizeCode:size.sizeCode,linkedShops:size.linkedShopList,records:size.stockoutItemSizeList})):[]};
  }
  async itemOccurrences(id) {
    const {items}=await this.catalog();
    return items.categoryList.flatMap(category=>(category.itemList??[])
      .filter(item=>String(item.itemCode)===String(id))
      .map(item=>({categoryCode:category.categoryCode,stockoutType:item.stockoutType,
        sizes:(item.sizeInfoList??[]).map(size=>({sizeCode:size.sizeCode,stockoutType:size.stockoutType}))})))
      .sort((a,b)=>String(a.categoryCode).localeCompare(String(b.categoryCode)));
  }
  async updateItem(id,patch) {
    // Reject before any write: attaching a draft could expose it. The future
    // publication planner must verify a permanent hold before linking.
    if(patch.categoryLinks!==undefined && (!Array.isArray(patch.categoryLinks)||patch.categoryLinks.length>1||patch.categoryLinks.length&&patch.allowCategoryMove!==true))throw new Error('demae_menu_category_link_publication_not_supported');
    await this.assertScope();
    const occurrences=await this.itemOccurrences(id);
    const stock=await this.stockState('item',id);
    const before=await this.item(id);
    if(String(before.itemCode)!==String(id)||String(before.chainId)!==this.chainId)throw new Error('demae_menu_identity_mismatch');
    if(patch.categoryLinks?.length) {
      const {items}=await this.catalog();
      if(!occurrences.length||!items.categoryList.some(row=>String(row.categoryCode)===String(patch.categoryLinks[0].categoryCode)))throw Error('demae_menu_draft_requires_release');
    }
    if(patch.groupLinks!==undefined) {
      if(!Array.isArray(patch.groupLinks)||new Set(patch.groupLinks.map(row=>row.optionGroupCode)).size!==patch.groupLinks.length)throw Error('demae_menu_group_links_invalid');
      for(const link of patch.groupLinks) {
        const group=await this.group(link.optionGroupCode);
        // Unlinked draft groups cannot be accidentally exposed through a
        // content update. They need the separate permanent-hold release flow.
        if(!group.items.length)throw Error('demae_menu_draft_group_requires_release');
        const prior=(before.sizeInfoList??[]).flatMap(row=>row.sizeOptionGroupLinkList??[]).some(row=>row.optionGroupCode===link.optionGroupCode);
        if(occurrences.length&&!prior) {
          const snapshot=await this.stockCatalog();
          if(!group.options.length||group.options.some(option=>!snapshot.optionList.some(row=>String(row.chainId)===this.chainId&&row.optionCode===option.optionCode&&row.linkedShopList?.length)))throw Error('demae_menu_new_group_requires_release');
        }
      }
    }
    const body=demaeItemUpdate(before,patch,this.today);
    await this.transport.request(`${this.base}/item/${code(id)}`,'PUT',body);
    const actual=await this.item(id);
    const active=(actual.sizeInfoList??[]).filter(size=>date(size.applyStartDate)<=this.today&&date(size.applyEndDate)>=this.today);
    if(String(actual.itemCode)!==String(id) || String(actual.chainId)!==this.chainId
      || actual.itemName!==body.itemName || String(actual.itemDescription??'')!==String(body.itemDescription??'')
      || (patch.price!==undefined && (active.length!==1||Number(active[0].price)!==patch.price))
      || !sameMenuValue(actual.categoryItemLinkList,body.categoryItemLinkList)
      || !sameMenuValue(storedSizes(actual.sizeInfoList),storedSizes(body.sizeInfoList))
      || actual.itemImageUri!==before.itemImageUri)throw new Error('demae_menu_item_verification_failed');
    const afterOccurrences=await this.itemOccurrences(id);
    if(patch.categoryLinks?.length===0) {
      if(afterOccurrences.length)throw new Error('demae_menu_item_still_linked');
    } else if(patch.categoryLinks?.length) {
      if(afterOccurrences.length!==1||String(afterOccurrences[0].categoryCode)!==String(patch.categoryLinks[0].categoryCode))throw Error('demae_menu_category_move_unverified');
      if(!sameMenuValue(stock,await this.stockState('item',id)))throw Error('demae_menu_availability_changed');
    } else if(!sameMenuValue(occurrences,afterOccurrences))throw new Error('demae_menu_availability_changed');
    if(patch.categoryLinks===undefined && !sameMenuValue(stock,await this.stockState('item',id)))throw new Error('demae_menu_availability_changed');
    return actual;
  }
  async createUnlinkedItem() {
    // Live validation and the merchant UI both require a category. Do not
    // silently replace this with a sellable create followed by stockout.
    throw new Error('demae_menu_item_requires_safe_staging_category');
  }
  async createHiddenDraftItem({marker,price,description},saveReceipt) {
    if(!this.draftPatternCode)throw Error('demae_menu_hidden_item_scope_missing');
    const draft=new DemaeDraftClient(this.transport,this.chainId,this.pattern);
    await this.assertScope();await draft.assertHiddenPattern(this.draftPatternCode);
    const catalog=await this.transport.request(`${this.base}/menu-pattern/${code(this.draftPatternCode)}/item-list`);
    if(!Array.isArray(catalog?.categoryList))throw Error('demae_menu_draft_catalog_incomplete');
    const categories=catalog.categoryList.filter(row=>/^未公開 FS[0-9a-f]{14}$/.test(row.categoryName));
    if(categories.length!==1)throw Error('demae_menu_draft_category_ambiguous');
    return draft.createItem({patternId:this.draftPatternCode,category:categories[0],marker,price,description,itemType:'REDUCED_RATE_NORMAL_ITEM'},saveReceipt);
  }
  async createEmptyCategory(marker) {
    if(!/^FS[0-9a-f]{14}$/.test(marker))throw Error('demae_menu_marker_required');
    await this.assertScope();
    return this.transport.request(`${this.base}/category`,'POST',{
      chainId:1,categoryCode:'',applyStartDate:this.today.replaceAll('-','/'),applyEndDate:'9999/12/31',
      categoryName:marker,adminCategoryName:marker,type:'NORMAL_CATEGORY',categoryType:'NORMAL_CATEGORY',
      businessType:'NORMAL',isSideOrderCategory:false,categoryDescription:'',
      menuPatternCategoryLinkList:[{menuPatternCode:this.pattern}],categoryItemLinkList:[]
    },{receiptKey:`demae:${this.chainId}:category:${marker}`});
  }
  async updateCategory(id,patch) {
    const before=await this.catalog();
    const row=before.items.categoryList.find(row=>String(row.categoryCode)===String(id));
    if(!row)throw Error('demae_menu_category_missing');
    const path=`${this.base}/category/${code(id)}/${date(row.applyStartDate)}/${date(row.applyEndDate)}`;
    const detail=await this.transport.request(path);
    const links=await this.transport.request(`${this.base}/category/${code(id)}/menu-pattern-list`);
    if(String(detail.chainId)!==this.chainId||!Array.isArray(links)||links.length!==1||links[0].menuPatternCode!==this.pattern)throw Error('demae_menu_category_scope_mismatch');
    const ids=patch.itemCodes??row.itemList.map(item=>item.itemCode);
    if(ids.length!==row.itemList.length||new Set(ids.map(String)).size!==ids.length||ids.some(id=>!row.itemList.some(item=>String(item.itemCode)===String(id))))throw Error('demae_menu_category_members_require_migration');
    const body={};
    for(const key of ['chainId','categoryCode','applyStartDate','applyEndDate','categoryName','adminCategoryName','type','categoryType','businessType','isSideOrderCategory','categoryDescription'])body[key]=detail[key];
    body.categoryName=patch.name??detail.categoryName;
    body.menuPatternCategoryLinkList=links.map(row=>({menuPatternCode:row.menuPatternCode}));
    body.categoryItemLinkList=ids.map((id,index)=>({itemCode:id,dispOrder:index+1}));
    await this.transport.request(path,'PUT',body);
    const actual=(await this.catalog()).items.categoryList.find(row=>String(row.categoryCode)===String(id));
    if(!actual||actual.categoryName!==body.categoryName||!sameMenuValue(actual.itemList.map(item=>item.itemCode),ids)
      ||!sameMenuValue(await this.transport.request(`${this.base}/category/${code(id)}/menu-pattern-list`),links))throw Error('demae_menu_category_verification_failed');
    return actual;
  }
  async retireItem(id) {
    const actual=await this.updateItem(id,{categoryLinks:[]});
    if(actual.categoryItemLinkList?.length)throw new Error('demae_menu_item_retirement_failed');
    const {items}=await this.catalog();
    if(items.categoryList.some(category=>category.itemList?.some(item=>String(item.itemCode)===String(id))))throw new Error('demae_menu_item_still_linked');
    return actual;
  }
  async options() {
    await this.assertScope();
    const rows=await this.transport.request(`/merchant-admin/api/v1/product/suggest/chain/${this.chainId}/menu-pattern/${this.patternPath}/option-item-list`);
    if(!Array.isArray(rows))throw new Error('demae_menu_options_incomplete');
    return rows;
  }
  async optionOccurrences(id) {
    const {groups}=await this.catalog(),found=[];
    for(const group of groups) {
      const rows=await this.transport.request(`${this.base}/option-group/${code(group.optionGroupCode)}/option-item-list`);
      if(!Array.isArray(rows))throw Error('demae_menu_group_members_incomplete');
      if(rows.some(row=>String(row.optionCode)===String(id)))found.push(group.optionGroupCode);
    }
    return found;
  }
  async updateOption(id,{name,price}) {
    const rows=await this.options();
    const active=rows.filter(row=>String(row.optionCode)===String(id)&&date(row.applyStartDate)<=this.today&&date(row.applyEndDate)>=this.today);
    if(active.length!==1)throw new Error('demae_menu_option_period_ambiguous');
    const before=active[0];
    if(String(before.chainId)!==this.chainId)throw new Error('demae_menu_identity_mismatch');
    const stock=await this.stockState('option',id);
    const payload={};
    for(const key of ['chainId','optionCode','applyStartDate','applyEndDate','optionName','price','linkageItemCode','linkageItemName','itemType'])payload[key]=before[key];
    payload.optionName=name??before.optionName;payload.price=yen(price??Number(before.price));
    await this.transport.request(`${this.base}/option-item/${code(id)}/${date(before.applyStartDate)}/${date(before.applyEndDate)}`,'PUT',payload);
    const after=(await this.options()).find(row=>String(row.optionCode)===String(id)&&row.applyStartDate===before.applyStartDate&&row.applyEndDate===before.applyEndDate);
    if(!after||after.optionName!==payload.optionName||Number(after.price)!==payload.price)throw new Error('demae_menu_option_verification_failed');
    if(!sameMenuValue(stock,await this.stockState('option',id)))throw new Error('demae_menu_availability_changed');
    return after;
  }
  async createUnlinkedOption({marker,price,itemType}) {
    await this.assertScope();
    if(!/^FS[0-9a-f]{14}$/.test(marker)||!itemType)throw new Error('demae_menu_create_metadata_required');
    return this.transport.request(`${this.base}/option-item`,'POST',{
      chainId:1,optionCode:'',applyStartDate:this.today.replaceAll('-','/'),applyEndDate:'9999/12/31',
      optionName:marker,price:yen(price),itemType,linkageItemCode:'',linkageItemName:''
    },{receiptKey:`demae:${this.chainId}:option:${marker}`});
  }
  async group(id) {
    const path=`${this.base}/option-group/${code(id)}`;
    const [detail,items,options]=await Promise.all([
      this.transport.request(path),this.transport.request(`${path}/linked-item-list`),this.transport.request(`${path}/option-item-list`)
    ]);
    if(String(detail.chainId)!==this.chainId||String(detail.optionGroupCode)!==String(id)
      ||!Array.isArray(items)||!Array.isArray(options)
      ||[...items,...options].some(row=>String(row.chainId)!==this.chainId))throw Error('demae_menu_group_identity_mismatch');
    if(items.some(row=>!row.itemCode||!Array.isArray(row.sizeList)||!row.sizeList.length||row.sizeList.some(size=>!size.sizeCode)))throw Error('demae_menu_group_size_links_missing');
    return {detail,items,options};
  }
  async updateGroup(id,patch) {
    await this.assertScope();
    const before=await this.group(id),stock=await this.stockCatalog();
    const currentIds=[...new Set(before.options.map(row=>String(row.optionCode)))];
    const ids=patch.optionCodes??currentIds;
    if(!Array.isArray(ids)||ids.length!==new Set(ids.map(String)).size)throw Error('demae_menu_group_members_invalid');
    // Adding an unlisted option to a live group would make it orderable before
    // stockout could be applied. Stage new membership on unlinked groups only.
    if(before.items.length&&ids.some(id=>!currentIds.includes(String(id))&&!stock.optionList.some(row=>String(row.chainId)===this.chainId&&String(row.optionCode)===String(id)&&Array.isArray(row.linkedShopList)&&row.linkedShopList.length)))throw Error('demae_menu_new_group_member_requires_staging');
    const body={
      chainId:Number(this.chainId),optionGroupCode:String(id),
      optionGroupName:patch.name??before.detail.optionGroupName,
      adminOptionGroupName:before.detail.adminOptionGroupName,
      optionGroupDescription:patch.description!==undefined?patch.description.replaceAll('\n','<br>'):before.detail.optionGroupDescription,
      optionButtonType:before.detail.optionButtonType,
      // Detail endpoint returns empty arrays even for linked groups; always
      // reconstruct the actual associations from independent relationship reads.
      sizeOptionGroupLinkList:before.items.flatMap(item=>item.sizeList.map(size=>({itemCode:item.itemCode,sizeCode:size.sizeCode}))),
      optionGroupItemLinkList:ids.map((id,index)=>({optionCode:decodeURIComponent(code(id)),dispOrder:index+1}))
    };
    await this.transport.request(`${this.base}/option-group/${code(id)}`,'PUT',body);
    const actual=await this.group(id);
    if(actual.detail.optionGroupName!==body.optionGroupName
      ||String(actual.detail.optionGroupDescription??'')!==String(body.optionGroupDescription??'')
      ||actual.detail.adminOptionGroupName!==body.adminOptionGroupName||actual.detail.optionButtonType!==body.optionButtonType
      ||!sameMenuValue(actual.items,before.items)
      ||!sameMenuValue([...new Set(actual.options.map(row=>String(row.optionCode)))],ids.map(String)))throw Error('demae_menu_group_verification_failed');
    for(const prior of before.options.filter(row=>ids.map(String).includes(String(row.optionCode)))) {
      const after=actual.options.find(row=>String(row.optionCode)===String(prior.optionCode)&&row.applyStartDate===prior.applyStartDate&&row.applyEndDate===prior.applyEndDate);
      if(!after||!sameMenuValue(after,prior))throw Error('demae_menu_group_member_content_changed');
    }
    const afterStock=await this.stockCatalog();
    // Disappearing removed members is safe. Every still-listed original option
    // must retain its stockout records; content updates never restore stock.
    for(const prior of stock.optionList) {
      const after=afterStock.optionList.find(row=>String(row.chainId)===String(prior.chainId)&&row.optionCode===prior.optionCode);
      if(after&&!sameMenuValue(after.stockoutOptionList,prior.stockoutOptionList))throw Error('demae_menu_availability_changed');
    }
    return actual;
  }
  async createUnlinkedGroup({marker,optionCodes,buttonType},saveReceipt) {
    throw Error('demae_menu_group_requires_hidden_item');
  }
  async hiddenGroupItems(items) {
    if(!this.draftPatternCode||!Array.isArray(items))throw Error('demae_menu_hidden_group_scope_missing');
    const draft=new DemaeDraftClient(this.transport,this.chainId,this.pattern);
    await draft.assertHiddenPattern(this.draftPatternCode);
    for(const item of items)await draft.assertHiddenItem(this.draftPatternCode,item.itemCode);
    return true;
  }
  async createStagedGroup({marker,optionCodes,buttonType},saveReceipt) {
    if(!/^FS[0-9a-f]{14}$/.test(marker)||!Array.isArray(optionCodes)
      ||new Set(optionCodes.map(String)).size!==optionCodes.length||!['RADIO','CHECKBOX','LABEL','HIDE'].includes(buttonType)
      ||typeof saveReceipt!=='function')throw Error('demae_menu_create_metadata_required');
    await this.assertScope();
    if(!this.draftPatternCode)throw Error('demae_menu_hidden_group_scope_missing');
    const draft=new DemaeDraftClient(this.transport,this.chainId,this.pattern);
    await draft.assertHiddenPattern(this.draftPatternCode);
    const catalog=await this.transport.request(`${this.base}/menu-pattern/${code(this.draftPatternCode)}/item-list`);
    if(!Array.isArray(catalog?.categoryList))throw Error('demae_menu_draft_catalog_incomplete');
    const ids=[...new Set(catalog.categoryList.flatMap(row=>row.itemList??[]).map(row=>String(row.itemCode)))];
    // Until an explicit carrier identity is configured, only the existing
    // single isolated draft may be used. Never guess among several items.
    const carrier=this.draftCarrierItemCode||(ids.length===1?ids[0]:'');
    if(!carrier||!ids.includes(carrier))throw Error('demae_menu_draft_carrier_ambiguous');
    const item=await draft.assertHiddenItem(this.draftPatternCode,carrier);
    const sizes=(item.sizeInfoList??[]).filter(row=>date(row.applyStartDate)<=this.today&&date(row.applyEndDate)>=this.today);
    if(sizes.length!==1||!sizes[0].sizeCode)throw Error('demae_menu_draft_size_ambiguous');
    const links=[{itemCode:carrier,sizeCode:sizes[0].sizeCode}];
    const receipt=await this.transport.request(`${this.base}/option-group`,'POST',{
      chainId:1,optionGroupCode:'',optionGroupName:marker,adminOptionGroupName:marker,
      optionGroupDescription:'',optionButtonType:buttonType,sizeOptionGroupLinkList:links,
      optionGroupItemLinkList:optionCodes.map((id,index)=>({optionCode:decodeURIComponent(code(id)),dispOrder:index+1}))
    },{receiptKey:`demae:${this.chainId}:group:${marker}`});
    if(!receipt?.optionGroupCode)throw Error('demae_menu_group_receipt_missing');
    await saveReceipt(String(receipt.optionGroupCode));
    const actual=await this.group(receipt.optionGroupCode);
    await this.hiddenGroupItems(actual.items);
    if(actual.detail.optionGroupName!==marker||!sameMenuValue(actual.items.flatMap(row=>row.sizeList.map(size=>({itemCode:row.itemCode,sizeCode:size.sizeCode}))),links)
      ||!sameMenuValue([...new Set(actual.options.map(row=>String(row.optionCode)))],optionCodes.map(String)))throw Error('demae_menu_group_create_unverified');
    return actual;
  }
  async retireOption(id) {
    code(id);
    // Demae has no verified option hard-delete API. Remove every live menu
    // association permanently; retain the native library record and history.
    const occurrences=await this.optionOccurrences(id);
    for(const groupId of occurrences) {
      const group=await this.group(groupId);
      const ids=[...new Set(group.options.map(row=>String(row.optionCode)))].filter(value=>value!==String(id));
      await this.updateGroup(groupId,{optionCodes:ids});
    }
    if((await this.optionOccurrences(id)).length)throw Error('demae_menu_option_still_linked');
    if((await this.options()).some(row=>String(row.optionCode)===String(id)))throw Error('demae_menu_retired_option_still_listed');
  }
}
