import { positiveId, yen, sameMenuValue } from './merchant-menu-client.mjs';

export function rocketPhysicalId(value) {
  const text = String(value ?? '');
  return positiveId(text.match(/^sub_checkbox_\d+_(\d+)$/u)?.[1] ?? text);
}

function optionMappings(groups = []) {
  return groups.map(group => ({
    optionId: Number(group.optionId), exposeOrder: group.exposeOrder,
    // Item ordering belongs to the separate group ordering endpoint. This
    // dish association contains only identity and stock, so compare by ID.
    optionItemSaveDtos: (group.optionItems ?? []).map(item => ({optionItemId:Number(item.optionItemId),displayStatus:item.displayStatus})).sort((a,b)=>a.optionItemId-b.optionItemId)
  }));
}

export function rocketGroupUpdate(group,patch={}) {
  const min=patch.min??group.minSelect,max=patch.max??group.maxSelect;
  const prior=group.optionItems??[];
  const emptyZero=prior.length===0&&min===0&&max===0;
  if(!Number.isSafeInteger(min)||min<0||!Number.isSafeInteger(max)||(!emptyZero&&max!==-1&&max<Math.max(1,min)))throw Error(`rocket_menu_group_quantity_invalid:${JSON.stringify({groupId:group.optionId,name:group.optionName,min,max,choices:prior.length})}`);
  const ids=patch.memberIds??prior.map(row=>String(row.optionItemId));
  if(!Array.isArray(ids)||new Set(ids.map(String)).size!==ids.length||ids.length!==prior.length
    ||ids.some(id=>!prior.some(row=>String(row.optionItemId)===String(id))))throw Error('rocket_menu_group_members_require_migration');
  return {
    // The read API emits zero for an empty group, but its edit endpoint
    // requires a positive maximum. With no choices this is still 0 choices.
    optionName:patch.name??group.optionName,minSelect:min,maxSelect:emptyZero?1:max,
    isMandatory:min>0,isMultiSelect:patch.isMultiSelect??group.isMultiSelect,
    optionItems:ids.map(id=>{
      const item=prior.find(row=>String(row.optionItemId)===String(id));
      const displayStatus=item.forceNotExpose?'NOT_EXPOSE':item.displayStatus;
      if(!['ON_SALE','NOT_EXPOSE','SOLD_OUT_TODAY'].includes(displayStatus))throw Error('rocket_menu_unknown_availability');
      return {optionItemId:Number(positiveId(id)),name:item.optionItemName,salePrice:yen(Number(item.salePrice)),displayStatus};
    })
  };
}

export function rocketDishUpdate(detail, patch, storeId) {
  const displayStatus = patch.retire || detail.forceNotExpose ? 'NOT_EXPOSE' : detail.displayStatus;
  if (!['ON_SALE','NOT_EXPOSE','SOLD_OUT_TODAY'].includes(displayStatus)) throw new Error('rocket_menu_unknown_availability');
  const fromMenuId = Number(detail.mappingMenus?.[0]?.menuId ?? 0);
  if (!fromMenuId) throw new Error('rocket_menu_category_missing');
  if(detail.mappingMenus.length!==1 && patch.menuId)throw new Error('rocket_menu_multiple_categories_requires_plan');
  // The merchant's edit serializer (FNe) omits image fields entirely. Image
  // approvals/deletions have separate endpoints; even an empty image array
  // is inappropriate here. Pending reviews must not block content edits.
  const groups=patch.groups?.map((group,index)=>({...group,exposeOrder:index}))??detail.options??[];
  const priorStatuses=new Map((detail.options??[]).flatMap(group=>(group.optionItems??[]).map(item=>[String(item.optionItemId),item.displayStatus])));
  const mappingDtos=optionMappings(groups).map(group=>({...group,optionItemSaveDtos:group.optionItemSaveDtos.map(item=>({...item,displayStatus:priorStatuses.get(String(item.optionItemId))??item.displayStatus}))}));
  return {
    storeId:Number(positiveId(storeId)),dishId:Number(positiveId(detail.dishId)),
    dishName:patch.name ?? detail.dishName,description:patch.description ?? detail.description ?? '',
    salePrice:yen(patch.price ?? Number(detail.salePrice)),
    fromMenuId,toMenuId:patch.menuId ? Number(positiveId(patch.menuId)) : fromMenuId,
    displayStatus,soldOutHour:displayStatus==='SOLD_OUT_TODAY'?detail.soldOutHour:null,
    optionMappingDtos:mappingDtos,
    moaExemption:detail.moaExemption ?? null,dishDiscountPercentage:detail.dishDiscountPercentage ?? null,
    dishDiscountCouponId:detail.dishDiscountCouponId ?? null,dishDiscountPrice:detail.dishDiscountPrice ?? null,
    dishDiscountType:detail.dishDiscountType ?? null,itemCategoryId:detail.itemCategoryId ?? null,
    koshiAttributes:detail.koshiAttributes ?? null,mappingMenus:detail.mappingMenus ?? [],
    dishType:detail.dishType ?? null,unitPriceBasis:detail.unitPriceBasis ?? null,
    baseUnit:detail.baseUnit ?? null,weightValue:detail.weightValue ?? null
  };
}

export class RocketMenuClient {
  constructor(transport, storeId) {
    this.transport=transport;this.storeId=positiveId(storeId);
    this.readBase=`/api/v1/merchant/web/stores/${this.storeId}`;
    this.writeBase=`/api/v1/merchant/web/catalog/stores/${this.storeId}`;
  }
  async catalog() {
    const [menus,groups]=await Promise.all([
      this.transport.request(`${this.readBase}/all-menu-dishes`),
      this.transport.request(`${this.readBase}/all-options?fetchDish=true`)
    ]);
    if (!Array.isArray(menus?.menus) || !Array.isArray(groups)) throw new Error('rocket_menu_incomplete_catalog');
    return {menus:menus.menus,groups};
  }
  async detail(id) {
    const detail=await this.transport.request(`${this.readBase}/dishes/${rocketPhysicalId(id)}/detail`);
    // The API array retains creation order; exposeOrder is the actual
    // customer-facing order (also used by the merchant frontend).
    if(Array.isArray(detail.options))detail.options=[...detail.options].sort((a,b)=>(Number.isFinite(a.exposeOrder)?a.exposeOrder:Infinity)-(Number.isFinite(b.exposeOrder)?b.exposeOrder:Infinity));
    return detail;
  }
  async updateDish(id, patch) {
    // Fetch immediately before the write so a prior sold-out state is retained.
    const detail=await this.detail(id);
    if (String(detail.dishId)!==rocketPhysicalId(id)) throw new Error('rocket_menu_identity_mismatch');
    const body=rocketDishUpdate(detail,patch,this.storeId);
    await this.transport.request(`${this.writeBase}/dishes/${rocketPhysicalId(id)}/update`,'POST',body);
    const actual=await this.detail(id);
    if ((patch.name!==undefined && actual.dishName!==patch.name)
      || (patch.price!==undefined && Number(actual.salePrice)!==patch.price)
      || (patch.description!==undefined && actual.description!==patch.description)
      || actual.displayStatus!==body.displayStatus
      || (body.displayStatus==='SOLD_OUT_TODAY' && actual.targetAvailableTime!==detail.targetAvailableTime)
      || !sameMenuValue(optionMappings(actual.options),body.optionMappingDtos)
      || !sameMenuValue(actual.allDishImages,detail.allDishImages)
      || !sameMenuValue(actual.allDetailImages,detail.allDetailImages)
      || (patch.menuId ? actual.mappingMenus?.length!==1 || String(actual.mappingMenus[0].menuId)!==String(patch.menuId) : !sameMenuValue(actual.mappingMenus,detail.mappingMenus))) throw new Error(`rocket_menu_dish_verification_failed:${rocketPhysicalId(id)}:${JSON.stringify({name:actual.dishName!==body.dishName,price:Number(actual.salePrice)!==body.salePrice,description:actual.description!==body.description,stock:actual.displayStatus!==body.displayStatus,groups:optionMappings(actual.options),expectedGroups:body.optionMappingDtos,category:actual.mappingMenus?.map(row=>row.menuId),expectedCategory:body.toMenuId,images:!sameMenuValue(actual.allDishImages,detail.allDishImages)||!sameMenuValue(actual.allDetailImages,detail.allDetailImages)})}`);
    return actual;
  }
  async createHiddenDish({marker,price,description='',menuId,groups=[]}) {
    if (!/^FS[0-9a-f]{14}$/.test(marker)) throw new Error('rocket_menu_marker_required');
    return this.transport.request(`${this.writeBase}/dishes/create`,'POST',{
      storeId:Number(this.storeId),dishName:marker,salePrice:yen(price),description,
      toMenuId:Number(positiveId(menuId)),displayStatus:'NOT_EXPOSE',soldOutHour:null,
      optionMappingDtos:optionMappings(groups),
      moaExemption:null,dishDiscountPercentage:null,dishDiscountCouponId:null,dishDiscountPrice:null,
      dishDiscountType:null,itemCategoryId:null,koshiAttributes:null,dishType:null,
      unitPriceBasis:null,baseUnit:null,weightValue:null
    },{receiptKey:`rocket:${this.storeId}:item:${marker}`});
  }
  async updateOption(id,{name,price,retire=false}) {
    const physicalId=rocketPhysicalId(id);
    const before=await this.catalog();
    const matches=before.groups.flatMap(group=>(group.optionItems??[]).filter(item=>String(item.optionItemId)===physicalId).map(item=>({group,item})));
    if(matches.length!==1)throw new Error('rocket_menu_option_identity_ambiguous');
    const {group,item}=matches[0];
    const displayStatus=retire?'NOT_EXPOSE':item.displayStatus;
    if(!['ON_SALE','NOT_EXPOSE','SOLD_OUT_TODAY'].includes(displayStatus))throw new Error('rocket_menu_unknown_availability');
    const salePrice=yen(price??Number(item.salePrice));
    await this.transport.request(`${this.writeBase}/option-items/${physicalId}/update`,'POST',{
      optionId:Number(group.optionId),optionItemName:name??item.optionItemName,displayStatus,
      salePrice,salePriceMoney:{currencyCode:'JPY',units:salePrice,nanos:0}
    });
    const after=await this.catalog();
    const actual=after.groups.find(row=>row.optionId===group.optionId)?.optionItems?.find(row=>String(row.optionItemId)===physicalId);
    if(!actual || actual.optionItemName!==(name??item.optionItemName) || Number(actual.salePrice)!==salePrice || actual.displayStatus!==displayStatus)throw new Error('rocket_menu_option_verification_failed');
    return actual;
  }
  createHiddenOption({marker,price,groupId}) {
    if(!/^FS[0-9a-f]{14}$/.test(marker))throw new Error('rocket_menu_marker_required');
    return this.transport.request(`${this.writeBase}/option-items/create`,'POST',{
      storeId:Number(this.storeId),optionId:Number(positiveId(groupId)),optionItemName:marker,
      salePrice:yen(price),displayStatus:'NOT_EXPOSE'
    },{receiptKey:`rocket:${this.storeId}:option:${marker}`});
  }
  async setMigratedOptionStatus(id,{name,price,displayStatus,groupId}) {
    if(!['ON_SALE','NOT_EXPOSE'].includes(displayStatus))throw Error('rocket_migration_status_invalid');
    const physicalId=rocketPhysicalId(id),before=await this.catalog();
    const matches=before.groups.flatMap(group=>(group.optionItems??[]).filter(item=>String(item.optionItemId)===physicalId).map(item=>({group,item})));
    if(matches.length!==1)throw Error('rocket_migration_identity_ambiguous');
    const {group,item}=matches[0];
    if(String(group.optionId)!==String(groupId)||item.optionItemName!==name||Number(item.salePrice)!==price||item.forceNotExpose||!['ON_SALE','NOT_EXPOSE'].includes(item.displayStatus))throw Error('rocket_migration_content_drift');
    await this.transport.request(`${this.writeBase}/option-items/${physicalId}/update`,'POST',{
      optionId:Number(group.optionId),optionItemName:name,salePrice:yen(price),displayStatus,
      salePriceMoney:{currencyCode:'JPY',units:yen(price),nanos:0}
    });
    const after=await this.catalog(),actual=after.groups.find(row=>row.optionId===group.optionId)?.optionItems?.find(row=>String(row.optionItemId)===physicalId);
    if(!actual||actual.optionItemName!==name||Number(actual.salePrice)!==price||actual.displayStatus!==displayStatus)throw Error('rocket_migration_status_unverified');
  }
  createCategory(marker) {
    if(!/^FS[0-9a-f]{14}$/.test(marker))throw new Error('rocket_menu_marker_required');
    return this.transport.request(`${this.writeBase}/menus/create`,'POST',{menuName:marker,description:'',menuType:null},{receiptKey:`rocket:${this.storeId}:category:${marker}`});
  }
  createGroup(marker) {
    if(!/^FS[0-9a-f]{14}$/.test(marker))throw Error('rocket_menu_marker_required');
    return this.transport.request(`${this.writeBase}/options/create`,'POST',{
      optionName:marker,minSelect:0,maxSelect:1,isMandatory:false,isMultiSelect:false,optionItems:[]
    },{receiptKey:`rocket:${this.storeId}:group:${marker}`});
  }
  async moveOption(id,groupId) {
    const optionId=positiveId(groupId),physicalId=rocketPhysicalId(id),before=await this.catalog();
    if(!before.groups.some(group=>String(group.optionId)===optionId))throw Error('rocket_menu_destination_group_missing');
    const owners=before.groups.filter(group=>group.optionItems?.some(item=>String(item.optionItemId)===physicalId));
    if(owners.length!==1)throw Error('rocket_menu_option_identity_ambiguous');
    if(String(owners[0].optionId)===optionId)return;
    const item=owners[0].optionItems.find(item=>String(item.optionItemId)===physicalId);
    if(!['ON_SALE','NOT_EXPOSE'].includes(item.displayStatus))throw Error('rocket_menu_move_requires_stable_availability');
    // Both official edit endpoints reject foreign-group option IDs. Use the
    // journaled replacement migration instead of pretending this is a move.
    throw Error('rocket_menu_option_move_requires_recreation');
  }
  async updateGroup(id,patch) {
    const physicalId=positiveId(id);
    const before=(await this.catalog()).groups.find(row=>String(row.optionId)===physicalId);
    if(!before)throw Error('rocket_menu_group_missing');
    if(before.optionRestrictionType&&before.optionRestrictionType!=='NONE')throw Error('rocket_menu_restricted_group');
    const body=rocketGroupUpdate(before,patch);
    const priorBody=rocketGroupUpdate(before);
    const byId=value=>({...value,optionItems:[...value.optionItems].sort((a,b)=>a.optionItemId-b.optionItemId)});
    // Native group editing does not persist display order. Use its dedicated
    // ordering endpoint; sorting must never require rewriting stock or limits.
    if(!sameMenuValue(byId(priorBody),byId(body))) {
      await this.transport.request(`${this.writeBase}/options/${physicalId}/update`,'POST',body);
      const saved=(await this.catalog()).groups.find(row=>String(row.optionId)===physicalId);
      if(!saved||!sameMenuValue(byId(rocketGroupUpdate(saved)),byId(body)))throw Error(`rocket_menu_group_content_verification_failed:${physicalId}`);
    }
    if(!sameMenuValue(priorBody.optionItems.map(row=>row.optionItemId),body.optionItems.map(row=>row.optionItemId))) {
      await this.transport.request(`${this.writeBase}/option-items/update-expose-order`,'POST',[
        {optionId:Number(physicalId),optionItemExposeOrderDtos:body.optionItems.map((row,index)=>({optionItemId:row.optionItemId,exposeOrder:index}))}
      ]);
    }
    const actual=(await this.catalog()).groups.find(row=>String(row.optionId)===physicalId);
    if(!actual||!sameMenuValue(rocketGroupUpdate(actual),body)
      ||actual.exposeStatus!==before.exposeStatus||!sameMenuValue(actual.mappingDishes,before.mappingDishes)
      ||actual.mappingDishCount!==before.mappingDishCount) {
      const readback=actual?rocketGroupUpdate(actual):{};
      const fields=Object.keys(body).filter(key=>!sameMenuValue(readback[key],body[key]));
      throw Error(`rocket_menu_group_verification_failed:${physicalId}:${JSON.stringify({fields,expectedLimits:{min:body.minSelect,max:body.maxSelect,multi:body.isMultiSelect},actualLimits:{min:actual?.minSelect,max:actual?.maxSelect,multi:actual?.isMultiSelect},consumerChanged:!sameMenuValue(actual?.mappingDishes,before.mappingDishes)||actual?.mappingDishCount!==before.mappingDishCount,exposureChanged:actual?.exposeStatus!==before.exposeStatus})}`);
    }
    return actual;
  }
  async retireUnlinkedGroup(id) {
    const physicalId=positiveId(id);
    const before=await this.catalog(),group=before.groups.find(row=>String(row.optionId)===physicalId);
    if(!group)return;
    // Do not infer that an omitted relationship list means no consumers.
    if(group.mappingDishCount!==0||!Array.isArray(group.mappingDishes)||group.mappingDishes.length)throw Error('rocket_menu_group_still_linked');
    const ids=new Set((group.optionItems??[]).map(row=>String(row.optionItemId)));
    if(before.groups.some(other=>String(other.optionId)!==physicalId&&other.optionItems?.some(row=>ids.has(String(row.optionItemId)))))throw Error('rocket_menu_group_shared_members');
    await this.transport.request(`${this.writeBase}/options/${physicalId}/delete`,'POST');
    const after=await this.catalog();
    if(after.groups.some(row=>String(row.optionId)===physicalId)
      ||!sameMenuValue(before.groups.filter(row=>String(row.optionId)!==physicalId),after.groups)
      ||!sameMenuValue(before.menus,after.menus))throw Error('rocket_menu_group_retirement_failed');
  }
  async retireOption(id) {
    const physicalId=rocketPhysicalId(id),before=await this.catalog();
    const matches=before.groups.flatMap(group=>(group.optionItems??[]).filter(row=>String(row.optionItemId)===physicalId));
    if(!matches.length)return;
    if(matches.length!==1)throw Error('rocket_menu_option_identity_ambiguous');
    await this.transport.request(`${this.writeBase}/option-items/${physicalId}/delete`,'POST');
    const after=await this.catalog();
    if(after.groups.some(group=>group.optionItems?.some(row=>String(row.optionItemId)===physicalId)))throw Error('rocket_menu_option_still_exists');
    // A removal may update native counts, but must not alter any other option's
    // content, parent, price or stock state, nor any group definition.
    const retained=rows=>rows.map(group=>({id:group.optionId,name:group.optionName,
      options:(group.optionItems??[]).filter(row=>String(row.optionItemId)!==physicalId)}));
    if(!sameMenuValue(retained(before.groups),retained(after.groups)))throw Error('rocket_menu_option_retirement_changed_other_records');
    for(const group of before.groups) {
      const actual=after.groups.find(row=>row.optionId===group.optionId),count=actual.optionItems?.length??0;
      for(const key of ['minSelect','maxSelect'])if(actual[key]!==group[key]
        &&!(group.optionItems?.some(item=>String(item.optionItemId)===physicalId)&&actual[key]===Math.min(group[key],count)))throw Error('rocket_menu_option_retirement_changed_group_limits');
    }
  }
  async updateCategory(id,patch) {
    const before=(await this.catalog()).menus.find(row=>String(row.menuId)===positiveId(id));
    if(!before)throw new Error('rocket_menu_category_missing');
    const body={menuName:patch.name??before.menuName,description:patch.description??before.description??'',menuType:before.menuType??null};
    await this.transport.request(`${this.writeBase}/menus/${positiveId(id)}/update`,'POST',body);
    const actual=(await this.catalog()).menus.find(row=>String(row.menuId)===String(id));
    if(!actual || actual.menuName!==body.menuName || (actual.description??'')!==body.description || actual.exposeStatus!==before.exposeStatus
      || !sameMenuValue((actual.dishes??[]).map(row=>row.dishId),(before.dishes??[]).map(row=>row.dishId)))throw new Error('rocket_menu_category_verification_failed');
    return actual;
  }
  async retireEmptyCategory(id) {
    const {menus}=await this.catalog();
    const menu=menus.find(row=>String(row.menuId)===positiveId(id));
    if(!menu)return;
    if(menu.dishes?.length)throw new Error('rocket_menu_category_still_has_items');
    await this.transport.request(`${this.writeBase}/menus/${positiveId(id)}/delete`,'POST');
    if((await this.catalog()).menus.some(row=>String(row.menuId)===String(id)))throw new Error('rocket_menu_category_retirement_failed');
  }
}
