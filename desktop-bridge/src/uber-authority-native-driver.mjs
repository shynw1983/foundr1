import {RocketMenuClient} from './rocket-menu-client.mjs';
import {DemaeMenuClient} from './demae-menu-client.mjs';
import {authorityPhysicalId} from './uber-authority-parents.mjs';
import {sameMenuValue} from './merchant-menu-client.mjs';
import {DemaeStagedOption} from './demae-staged-option.mjs';
import {DemaeDraftClient} from './demae-draft-client.mjs';

const ordered=rows=>[...rows].sort((a,b)=>a.sortOrder-b.sortOrder);
const equalIds=(a,b)=>sameMenuValue(a.map(String),b.map(String));

export class AuthorityNativeDriver {
  constructor(transport,payload) {
    this.platform=payload.platformKey;this.merchantId=String(payload.merchantId);this.payload=payload;
    this.client=this.platform==='rocket_now'?new RocketMenuClient(transport,this.merchantId)
      :new DemaeMenuClient(transport,this.merchantId,payload.menuPatternCode,{draftPatternCode:payload.draftPatternCode,draftCarrierItemCode:payload.draftCarrierItemCode});
  }
  id(kind,value){return authorityPhysicalId(this.platform,kind,value,this.merchantId);}
  ids(target){return target.mappings.map(row=>this.id(target.kind,row.externalId));}
  groupIds(target){
    const ids=(target.source?.groupIds??[]).flatMap(id=>this.ids(this.payload.targets.find(row=>row.sourceKey===`option_group:${id}`)??{kind:'option_group',mappings:[]}));
    const row=(this.relationshipSnapshot??this.contentSnapshot??[]).find(row=>row.kind==='item'&&this.ids(target).includes(row.id));
    const carriers=row?.staged?(row.groupIds??[]).filter(id=>this.payload.targets.some(option=>option.kind==='option'&&option.mappings.some(mapping=>mapping.externalParentId===`stage:${id}`))):[];
    const snapshot=this.relationshipSnapshot??this.contentSnapshot??[];
    return [...new Set([...ids,...carriers])].filter(id=>!(this.platform==='demae_can'&&snapshot.some(row=>row.kind==='option_group'&&row.id===id&&row.staged&&row.childIds.length===0)));
  }
  children(target){return ordered(this.payload.targets.filter(row=>!row.archived&&!row.quarantined&&row.parentId===target.targetId));}
  activeChildIds(target,rows){return this.children(target).flatMap(child=>this.ids(child)).filter(id=>!rows.some(row=>row.kind==='option'&&row.id===id&&row.staged&&row.hidden));}
  managedGroup(id,rows) {
    if(this.platform==='demae_can'&&rows.some(row=>row.kind==='option'&&row.staged&&row.hidden&&row.parentIds.includes(String(id))))return true;
    if(this.payload.targets.some(group=>group.kind==='option_group'&&this.ids(group).includes(String(id))))return true;
    const group=rows.find(row=>row.kind==='option_group'&&row.id===String(id));
    return Boolean(group&&group.childIds.length&&group.childIds.every(id=>this.payload.targets.some(child=>child.kind==='option'&&!child.quarantined&&this.ids(child).includes(String(id)))));
  }
  hiddenOptionParent(target,rows) {
    if(this.platform!=='rocket_now'||target.kind!=='option')return null;
    const parent=this.payload.targets.find(row=>row.targetId===target.parentId&&row.kind==='option_group'&&!row.archived&&!row.quarantined);
    const ids=parent?this.ids(parent):[];
    return ids.length===1&&rows.filter(row=>row.kind==='option_group'&&row.id===ids[0]).length===1?ids[0]:null;
  }
  async findMarker(marker,target) {
    if(this.platform==='demae_can'&&target.kind==='option') {
      // Unlinked creations are recovered from the durable receipt by ID.
      // A live marker is a collision, never permission to create a duplicate.
      if((await this.client.options()).some(row=>row.optionName===marker))throw Error('uber_authority_marker_already_published');
      return [];
    }
    const rows=await this.snapshot();
    return rows.filter(row=>row.kind===target.kind&&row.name===marker).map(row=>this.creationIdentity(row));
  }
  creationIdentity(row) {
    if(this.platform==='demae_can'&&row.kind==='option'&&row.staged)return {externalId:`itemList_${this.merchantId}${row.id}true`,externalParentId:`stage:${row.parentIds[0]}`,marker:row.name,hidden:row.hidden};
    if(this.platform==='demae_can'&&row.kind==='item'&&row.staged)return {externalId:`itemList_${this.merchantId}${row.id}false`,externalParentId:`draft:${this.payload.draftPatternCode}`,marker:row.name,hidden:row.hidden};
    if(this.platform==='demae_can'&&['category','option_group'].includes(row.kind))return {externalId:row.id,externalParentId:'',marker:row.name,hidden:row.hidden};
    if(this.platform!=='rocket_now')throw Error('uber_authority_creation_identity_unsupported');
    const child=['item','option'].includes(row.kind);
    if(child&&row.parentIds?.length!==1)throw Error('uber_authority_creation_parent_ambiguous');
    return {externalId:child?`sub_checkbox_${row.parentIds[0]}_${row.id}`:row.id,externalParentId:child?row.parentIds[0]:'',marker:row.name,hidden:row.hidden};
  }
  async findById(externalId,target,candidate) {
    if(this.platform==='demae_can') {
      if(target.kind==='item') {
        const actual=await new DemaeDraftClient(this.client.transport,this.merchantId,this.payload.menuPatternCode).assertHiddenItem(this.payload.draftPatternCode,this.id('item',externalId));
        return {externalId,externalParentId:`draft:${this.payload.draftPatternCode}`,marker:actual.itemName,hidden:true};
      }
      if(['category','option_group'].includes(target.kind)) {
        const actual=(await this.snapshot()).find(row=>row.kind===target.kind&&row.id===this.id(target.kind,externalId));
        return actual?this.creationIdentity(actual):null;
      }
      const parent=candidate?.externalParentId??target.mappings.find(row=>row.externalId===externalId)?.externalParentId??this.payload.authorityState?.[target.sourceKey]?.externalParentId;
      if(target.kind!=='option'||!parent?.startsWith('stage:')||parent==='stage:__creating__')return null;
      const actual=await new DemaeStagedOption(this.client).read({optionCode:this.id('option',externalId),groupCode:parent.slice(6),marker:target.marker});
      return {externalId,externalParentId:parent,marker:actual.option.optionName,hidden:actual.hidden};
    }
    const rows=(await this.snapshot()).filter(row=>row.kind===target.kind&&row.id===this.id(target.kind,externalId));
    if(rows.length>1)throw Error('uber_authority_receipt_identity_ambiguous');
    return rows[0]?this.creationIdentity(rows[0]):null;
  }
  async stageOption(target,{receipt,saveReceipt,allowCreate}) {
    if(target.quarantined||target.kind!=='option')throw Error('uber_authority_staging_target_invalid');
    const options=await this.client.options();
    if(!options.length||options.some(row=>row.itemType!=='REDUCED_RATE_NORMAL_ITEM'))throw Error('uber_authority_staging_tax_type_unverified');
    const externalId=id=>`itemList_${this.merchantId}${id}true`;
    const actual=await new DemaeStagedOption(this.client).ensure({marker:target.marker,price:target.price,itemType:'REDUCED_RATE_NORMAL_ITEM',allowCreate,
      receipt:receipt?.externalId?{optionCode:this.id('option',receipt.externalId),groupCode:receipt.externalParentId?.startsWith('stage:')?receipt.externalParentId.slice(6):''}:undefined
    },async row=>saveReceipt({externalId:externalId(row.optionCode),externalParentId:row.groupCode?`stage:${row.groupCode}`:''}));
    return {externalId:externalId(actual.option.optionCode),externalParentId:`stage:${actual.groupCode}`};
  }
  async resumeHidden(target,context) {
    if(this.platform!=='demae_can'||target.kind!=='option')return null;
    return this.stageOption(target,{...context,allowCreate:false});
  }
  async createHidden(target,context={}) {
    if(this.platform==='demae_can'&&target.kind==='option')return this.stageOption(target,{...context,allowCreate:true});
    if(this.platform==='demae_can'&&target.kind==='category') {
      const receipt=await this.client.createEmptyCategory(target.marker);
      if(!receipt?.categoryCode)throw Error('uber_authority_category_receipt_missing');
      return {externalId:String(receipt.categoryCode),externalParentId:''};
    }
    if(this.platform==='demae_can'&&target.kind==='item') {
      const actual=await this.client.createHiddenDraftItem(target,async receipt=>context.saveReceipt({externalId:`itemList_${this.merchantId}${receipt.externalId}false`,externalParentId:`draft:${this.payload.draftPatternCode}`}));
      return {externalId:`itemList_${this.merchantId}${actual.itemCode}false`,externalParentId:`draft:${this.payload.draftPatternCode}`};
    }
    if(this.platform==='demae_can'&&target.kind==='option_group') {
      const rows=await this.snapshot();
      const group=await this.client.createStagedGroup({marker:target.marker,optionCodes:this.activeChildIds(target,rows),buttonType:target.source?.max===1?'RADIO':'CHECKBOX'},async id=>context.saveReceipt({externalId:id,externalParentId:''}));
      return {externalId:String(group.detail.optionGroupCode),externalParentId:''};
    }
    const rows=await this.snapshot();
    if(this.platform!=='rocket_now')throw Error('uber_authority_creation_requires_verified_staging');
    if(rows.some(row=>row.kind===target.kind&&[target.name,target.marker].includes(row.name)))throw Error('uber_authority_creation_existing_candidate');
    let receipt,parentId='',id;
    if(target.kind==='category') {receipt=await this.client.createCategory(target.marker);id=receipt?.menuId;}
    else if(target.kind==='option_group') {receipt=await this.client.createGroup(target.marker);id=receipt?.optionId;}
    else {
      const parent=this.payload.targets.find(row=>row.targetId===target.parentId);
      const ids=parent?this.ids(parent):[];
      if(ids.length!==1)throw Error('uber_authority_creation_requires_verified_parent');
      parentId=ids[0];
      if(target.kind==='option') {
        if(!this.hiddenOptionParent(target,rows))throw Error('uber_authority_creation_requires_verified_parent');
        receipt=await this.client.createHiddenOption({marker:target.marker,price:target.price,groupId:parentId});id=receipt?.optionItemId;
      } else if(target.kind==='item') {
        if(!rows.some(row=>row.kind==='category'&&row.id===parentId))throw Error('uber_authority_creation_requires_verified_parent');
        receipt=await this.client.createHiddenDish({marker:target.marker,price:target.price,description:target.description,menuId:parentId});id=receipt?.dishId;
      } else throw Error('uber_authority_creation_kind_invalid');
    }
    // Persist the native ID before the marker is renamed. Missing receipts do
    // not authorize retries; the marker protocol still requires a fresh read.
    if(id)return {externalId:parentId?`sub_checkbox_${parentId}_${id}`:String(id),externalParentId:parentId};
    return undefined;
  }
  quantityMatches(target,row) {
    if(target.kind!=='option_group'||target.source?.min===undefined)return true;
    if(this.platform==='demae_can')return this.payload.selectionPolicy==='preserve_native';
    const max=target.source.max??-1;
    return row.native?.minSelect===target.source.min&&row.native?.maxSelect===max
      &&row.native?.isMultiSelect===(max===-1||max>1);
  }
  matches(target,rows,id) {
    const parent=this.payload.targets.find(row=>row.targetId===target.parentId);
    const physical=rows.filter(row=>row.kind===target.kind&&row.id===id);
    if(target.kind!=='option'||target.archived||!parent)return physical;
    const placed=physical.filter(row=>row.parentIds.some(id=>this.ids(parent).includes(id)));
    // A changed parent is a move, not a missing physical product. Keep the
    // actual record visible to structural validation instead of creating a copy.
    return placed.length?placed:physical;
  }
  async snapshot() {
    const c=this.client,remote=await c.catalog(),rows=[];
    if(this.platform==='rocket_now') {
      const items=[...new Map(remote.menus.flatMap(menu=>menu.dishes??[]).map(item=>[String(item.dishId),item])).values()];
      const details=await Promise.all(items.map(item=>c.detail(item.dishId)));
      for(const item of details)rows.push({kind:'item',id:String(item.dishId),name:item.dishName,price:Number(item.salePrice),description:item.description??'',hidden:item.displayStatus==='NOT_EXPOSE',
        parentIds:(item.mappingMenus??[]).map(row=>String(row.menuId)),groupIds:(item.options??[]).map(row=>String(row.optionId)),native:item});
      for(const group of remote.groups) {
        rows.push({kind:'option_group',id:String(group.optionId),name:group.optionName,price:null,childIds:(group.optionItems??[]).map(row=>String(row.optionItemId)),hidden:!rows.some(row=>row.kind==='item'&&!row.hidden&&row.groupIds.includes(String(group.optionId))),native:group});
        for(const option of group.optionItems??[])rows.push({kind:'option',id:String(option.optionItemId),name:option.optionItemName,price:Number(option.salePrice),hidden:option.displayStatus==='NOT_EXPOSE',parentIds:[String(group.optionId)],native:option});
      }
      for(const menu of remote.menus)rows.push({kind:'category',id:String(menu.menuId),name:menu.menuName,price:null,childIds:(menu.dishes??[]).map(row=>String(row.dishId)),hidden:!(menu.dishes??[]).some(item=>rows.some(row=>row.kind==='item'&&row.id===String(item.dishId)&&!row.hidden)),native:menu});
    } else {
      const stock=await c.stockCatalog();
      const hidden=(kind,id)=>{
        const data=(kind==='item'?stock.itemList:stock.optionList).find(row=>String(row.chainId)===this.merchantId&&String(row[kind==='item'?'itemCode':'optionCode'])===String(id));
        if(!data)return true;
        const records=kind==='item'?data.stockoutItemList:data.stockoutOptionList;
        return Array.isArray(data.linkedShopList)&&data.linkedShopList.every(shop=>records?.some(record=>String(record.shopId)===String(shop.shopId)&&record.orderType===shop.orderType&&record.isEndSale===true&&record.isCurrentApplying===true));
      };
      const itemIds=[...new Set(remote.items.categoryList.flatMap(category=>category.itemList??[]).map(item=>String(item.itemCode)))];
      const draftIds=this.payload.targets.filter(target=>target.kind==='item'&&!target.quarantined).flatMap(target=>[...target.mappings,this.payload.authorityState?.[target.sourceKey]].filter(mapping=>mapping?.externalId).map(mapping=>this.id('item',mapping.externalId))).filter(id=>!itemIds.includes(id));
      const draftClient=new DemaeDraftClient(c.transport,this.merchantId,this.payload.menuPatternCode);
      const items=await Promise.all([...itemIds.map(id=>c.item(id)),...[...new Set(draftIds)].map(id=>draftClient.assertHiddenItem(this.payload.draftPatternCode,id))]);
      for(const item of items) {
        const sizes=(item.sizeInfoList??[]).filter(size=>String(size.applyStartDate).replaceAll('/','-')<=c.today&&String(size.applyEndDate).replaceAll('/','-')>=c.today);
        rows.push({kind:'item',id:String(item.itemCode),name:item.itemName,price:sizes.length===1?Number(sizes[0].price):null,description:String(item.itemDescription??'').replaceAll('<br>','\n'),hidden:hidden('item',item.itemCode),staged:!itemIds.includes(String(item.itemCode)),parentIds:remote.items.categoryList.filter(cat=>cat.itemList?.some(row=>row.itemCode===item.itemCode)).map(cat=>String(cat.categoryCode)),groupIds:sizes.length===1?(sizes[0].sizeOptionGroupLinkList??[]).map(row=>String(row.optionGroupCode)):[],native:item});
      }
      const liveGroupIds=remote.groups.map(row=>String(row.optionGroupCode));
      const knownGroupIds=this.payload.targets.filter(target=>target.kind==='option_group'&&!target.quarantined).flatMap(target=>[...target.mappings,this.payload.authorityState?.[target.sourceKey]].filter(mapping=>mapping?.externalId).map(mapping=>this.id('option_group',mapping.externalId)));
      const groups=await Promise.all([...new Set([...liveGroupIds,...knownGroupIds])].map(id=>c.group(id)));
      for(const group of groups) {
        const id=String(group.detail.optionGroupCode);
        const staged=!liveGroupIds.includes(id);
        if(staged)await c.hiddenGroupItems(group.items);
        const options=group.options.filter(row=>String(row.applyStartDate).replaceAll('/','-')<=c.today&&String(row.applyEndDate).replaceAll('/','-')>=c.today);
        rows.push({kind:'option_group',id,name:group.detail.optionGroupName,price:null,childIds:[...new Set(options.map(row=>String(row.optionCode)))],staged,hidden:group.items.every(item=>hidden('item',item.itemCode)),native:group});
        for(const option of options)rows.push({kind:'option',id:String(option.optionCode),name:option.optionName,price:Number(option.price),hidden:hidden('option',option.optionCode),parentIds:[id],native:option});
      }
      for(const category of remote.items.categoryList)rows.push({kind:'category',id:String(category.categoryCode),name:category.categoryName,price:null,childIds:(category.itemList??[]).map(row=>String(row.itemCode)),hidden:(category.itemList??[]).every(item=>hidden('item',item.itemCode)),native:category});
      const stagedIdentities=[];
      for(const target of this.payload.targets.filter(row=>row.kind==='option'&&!row.quarantined)) {
        const candidates=[...target.mappings,this.payload.authorityState?.[target.sourceKey]].filter(Boolean);
        const seen=new Set();
        for(const mapping of candidates) {
          const parent=mapping.externalParentId;
          if(!parent?.startsWith('stage:')||parent==='stage:__creating__'||seen.has(mapping.externalId))continue;
          seen.add(mapping.externalId);
          stagedIdentities.push({optionCode:this.id('option',mapping.externalId),groupCode:parent.slice(6),marker:target.marker});
        }
      }
      for(const actual of await new DemaeStagedOption(c).readAll(stagedIdentities))rows.push({kind:'option',id:String(actual.option.optionCode),name:actual.option.optionName,price:Number(actual.option.price),hidden:true,staged:true,parentIds:[actual.groupCode],native:actual.option});
    }
    return rows;
  }
  structureIssues(target,rows,{preflight=false}={}) {
    const issues=[];
    const add=code=>issues.push({sourceKey:target.sourceKey,code});
    for(const id of this.ids(target)) {
      const actual=this.matches(target,rows,id);
      if(!actual.length){add('mapped_object_missing');continue;}
      for(const row of actual) {
        if(target.kind==='option_group') {
          const expected=this.children(target).flatMap(child=>this.ids(child).length?this.ids(child).filter(id=>!rows.some(row=>row.kind==='option'&&row.id===id&&row.staged&&row.hidden))
            :preflight?rows.filter(row=>row.kind===child.kind&&row.name===child.marker).map(row=>row.id):[]);
          const reorderAllowed=preflight&&this.platform==='rocket_now';
          const retiredIds=preflight?this.payload.targets.filter(target=>target.kind==='option'&&target.archived&&!target.quarantined).flatMap(target=>this.ids(target)):[];
          const moves=preflight?(this.plannedMoves??[]):[];
          const actualIds=[...row.childIds.filter(id=>!retiredIds.includes(String(id))&&!moves.some(move=>move.id===String(id)&&move.from===row.id)),
            ...moves.filter(move=>move.to===row.id).map(move=>move.id)];
          const knownDemaeMigration=preflight&&this.platform==='demae_can'&&row.childIds.every(id=>this.payload.targets.some(child=>child.kind==='option'&&!child.quarantined&&this.ids(child).includes(String(id))));
          if(!equalIds(reorderAllowed?[...actualIds].sort():actualIds,reorderAllowed?[...expected].sort():expected)&&!knownDemaeMigration)add('group_membership_migration_required');
        }
        if(target.kind==='category') {
          const expected=this.children(target).filter(child=>child.kind==='item').flatMap(child=>this.ids(child)).filter(id=>!rows.some(row=>row.kind==='item'&&row.id===id&&row.staged));
          if(!equalIds([...row.childIds].sort(),[...expected].sort())&&!(preflight&&this.platform==='rocket_now'&&row.childIds.every(id=>this.payload.targets.some(child=>child.kind==='item'&&this.ids(child).includes(String(id))))))add('category_membership_migration_required');
        }
        if(target.kind==='item') {
          const parent=this.payload.targets.find(row=>row.targetId===target.parentId);
          if(parent&&!row.staged&&!equalIds(row.parentIds,this.ids(parent))&&!(preflight&&this.platform==='rocket_now'&&row.parentIds.length===1&&(parent.mappings.length===1||!parent.mappings.length)))add('item_category_migration_required');
          if(!equalIds(row.groupIds,this.groupIds(target))&&!(preflight&&row.groupIds.every(id=>this.managedGroup(id,rows))))add('item_group_migration_required');
        }
        if(target.kind==='option') {
          if(row.staged&&row.hidden)continue;
          const parent=this.payload.targets.find(row=>row.targetId===target.parentId);
          if((!parent||!row.parentIds.some(id=>this.ids(parent).includes(id)))&&!(preflight&&this.plannedMoves?.some(move=>move.sourceKey===target.sourceKey)))add('option_group_migration_required');
        }
      }
    }
    return issues;
  }
  async preflight(payload) {
    this.payload=payload;
    const rows=await this.snapshot(),issues=[];
    this.contentSnapshot=rows;
    this.plannedMoves=[];
    if(this.platform==='rocket_now')for(const target of payload.targets.filter(row=>row.kind==='option'&&!row.archived&&!row.quarantined)) {
      const parent=payload.targets.find(row=>row.targetId===target.parentId&&!row.archived&&!row.quarantined);
      if(!parent)continue;
      const to=this.ids(parent);
      for(const id of this.ids(target)) {
        const actual=rows.filter(row=>row.kind==='option'&&row.id===id);
        if(actual.length===1&&actual[0].parentIds.length===1&&to.length<=1&&actual[0].parentIds[0]!==to[0]) {
          if(!['ON_SALE','NOT_EXPOSE'].includes(actual[0].native?.displayStatus))issues.push({sourceKey:target.sourceKey,code:'move_requires_stable_availability'});
          else this.plannedMoves.push({sourceKey:target.sourceKey,id,from:actual[0].parentIds[0],to:to[0],toTargetId:parent.targetId});
        }
      }
    }
    const owners=new Map();
    for(const target of payload.targets.filter(row=>!row.quarantined)) {
      if(!target.archived&&!target.name.trim())issues.push({sourceKey:target.sourceKey,code:'empty_projected_name'});
      if(!target.archived&&this.platform==='demae_can'&&target.kind==='option_group'&&target.name.length>50)issues.push({sourceKey:target.sourceKey,code:'native_group_name_too_long'});
      if(this.platform==='demae_can'&&target.kind==='option_group'&&!target.archived&&target.source?.min!==undefined&&payload.selectionPolicy!=='preserve_native')issues.push({sourceKey:target.sourceKey,code:'selection_policy_requires_confirmation'});
      for(const id of this.ids(target)) {
        const key=`${target.kind}:${id}`,other=owners.get(key);
        if(other&&(other.name!==target.name||other.price!==target.price||other.archived!==target.archived))issues.push({sourceKey:target.sourceKey,code:'conflicting_physical_object'});
        owners.set(key,target);
      }
      if(target.archived) {
        if(this.platform!=='rocket_now'&&target.kind!=='option'&&target.mappings.length)issues.push({sourceKey:target.sourceKey,code:'permanent_retirement_requires_adapter'});
        continue;
      }
      if(!target.mappings.length){
        const parent=payload.targets.find(row=>row.targetId===target.parentId&&!row.archived&&!row.quarantined);
        const rocketCreate=this.platform==='rocket_now'&&(['category','option_group'].includes(target.kind)||parent&&parent.mappings.length<=1);
        const demaeOptionCreate=this.platform==='demae_can'&&(target.kind==='category'||target.kind==='option'&&parent||['item','option_group'].includes(target.kind)&&payload.draftPatternCode);
        if(!rocketCreate&&!demaeOptionCreate&&!this.hiddenOptionParent(target,rows))issues.push({sourceKey:target.sourceKey,code:'creation_requires_verified_staging'});
        else if(rows.some(row=>row.kind===target.kind&&row.name===target.name))issues.push({sourceKey:target.sourceKey,code:'existing_unmapped_candidate'});
        continue;
      }
      issues.push(...this.structureIssues(target,rows,{preflight:true}));
    }
    return {issues:[...new Map(issues.map(row=>[`${row.sourceKey}:${row.code}`,row])).values()]};
  }
  async updateContent(target) {
    // Newly journaled records did not exist in the preflight snapshot.
    let rows;
    if(this.platform==='demae_can'&&target.kind==='option'&&target.mappings.some(mapping=>mapping.externalParentId?.startsWith('stage:'))) {
      rows=await Promise.all(target.mappings.map(async mapping=>{
        const actual=await new DemaeStagedOption(this.client).read({optionCode:this.id('option',mapping.externalId),groupCode:mapping.externalParentId.slice(6),marker:target.marker});
        return {kind:'option',id:String(actual.option.optionCode),name:actual.option.optionName,price:Number(actual.option.price),staged:true,parentIds:[actual.groupCode]};
      }));
    }else rows=target.mappings.some(mapping=>mapping.created)?await this.snapshot():this.contentSnapshot;
    for(const id of this.ids(target)) {
      const before=rows.find(row=>row.kind===target.kind&&row.id===id);
      if(!before)throw Error('uber_authority_native_object_missing');
      const nameChanged=before.name!==target.name,priceChanged=target.price!==null&&before.price!==target.price;
      const descriptionChanged=target.kind==='item'&&before.description!==target.description;
      const quantityChanged=!this.quantityMatches(target,before);
      if(!nameChanged&&!priceChanged&&!descriptionChanged&&!quantityChanged)continue;
      const patch={name:target.name,...(target.price!==null?{price:target.price}:{}),...(target.kind==='item'?{description:target.description}:{})};
      if(target.kind==='item')await (this.platform==='rocket_now'?this.client.updateDish(id,patch):this.client.updateItem(id,patch));
      else if(target.kind==='option'&&before.staged)await new DemaeStagedOption(this.client).update({optionCode:id,groupCode:before.parentIds[0],marker:target.marker},patch);
      else if(target.kind==='option')await this.client.updateOption(id,patch);
      else if(target.kind==='option_group')await this.client.updateGroup(id,{name:target.name,...(this.platform==='rocket_now'&&target.source?.min!==undefined?{min:target.source.min,max:target.source.max??-1,isMultiSelect:target.source.max==null||target.source.max===-1||target.source.max>1}:{})});
      else await this.client.updateCategory(id,{name:target.name});
    }
  }
  async updateRelationships(target) {
    if(this.platform==='demae_can'&&target.kind==='item') {
      for(const id of this.ids(target)) {
        const before=this.contentSnapshot.find(row=>row.kind==='item'&&row.id===id);
        const current=this.relationshipSnapshot.find(row=>row.kind==='item'&&row.id===id);
        if(!before||!current||!equalIds(before.groupIds,current.groupIds)||!equalIds(before.parentIds,current.parentIds))throw Error('uber_authority_relationship_drift');
        if(equalIds(current.groupIds,this.groupIds(target)))continue;
        if(current.groupIds.some(id=>!this.managedGroup(id,this.contentSnapshot)))throw Error('uber_authority_unowned_item_group');
        const links=[];
        for(const groupId of this.groupIds(target)) {
          const group=await this.client.group(groupId);
          links.push({chainId:Number(this.merchantId),optionGroupCode:groupId,optionGroupName:group.detail.optionGroupName,dispOrder:links.length+1});
        }
        await this.client.updateItem(id,{groupLinks:links});
      }
      return;
    }
    if(this.platform==='demae_can'&&target.kind==='option_group') {
      const expected=this.activeChildIds(target,this.relationshipSnapshot);
      for(const id of this.ids(target)) {
        const actual=await this.client.group(id),current=[...new Set(actual.options.map(row=>String(row.optionCode)))];
        if(current.some(id=>!this.payload.targets.some(row=>row.kind==='option'&&!row.quarantined&&this.ids(row).includes(id))))throw Error('uber_authority_unowned_group_member');
        if(!equalIds(current,expected))await this.client.updateGroup(id,{optionCodes:expected});
      }
      return;
    }
    if(this.platform==='rocket_now'&&target.kind==='option_group') {
      const expected=this.children(target).flatMap(child=>this.ids(child));
      for(const id of this.ids(target)) {
        const rows=await this.snapshot();
        const actual=rows.find(row=>row.kind==='option_group'&&row.id===id);
        if(!actual||!equalIds([...actual.childIds].sort(),[...expected].sort()))throw Error(`uber_authority_relationship_drift:${target.sourceKey}`);
        if(!equalIds(actual.childIds,expected))await this.client.updateGroup(id,{memberIds:expected});
      }
      return;
    }
    if(this.platform==='rocket_now'&&target.kind==='item') {
      for(const id of this.ids(target)) {
        const before=this.contentSnapshot?.find(row=>row.kind==='item'&&row.id===id);
        const current=this.relationshipSnapshot?.find(row=>row.kind==='item'&&row.id===id);
        if(before&&current&&(!equalIds(before.groupIds,current.groupIds)||!equalIds(before.parentIds,current.parentIds)))throw Error(`uber_authority_relationship_drift:${target.sourceKey}`);
      }
      if(!this.structureIssues(target,this.relationshipSnapshot).length)return;
      const parent=this.payload.targets.find(row=>row.targetId===target.parentId);
      if(!parent||this.ids(parent).length!==1)throw Error('uber_authority_item_parent_ambiguous');
      const catalog=await this.client.catalog();
      const groups=this.groupIds(target).map(id=>{
        const group=catalog.groups.find(row=>String(row.optionId)===id);
        if(!group)throw Error('uber_authority_item_group_missing');
        return group;
      });
      for(const id of this.ids(target)) {
        const actual=await this.client.detail(id);
        const prior=(actual.options??[]).map(row=>String(row.optionId));
        if(prior.some(id=>!this.managedGroup(id,this.contentSnapshot)))throw Error('uber_authority_unowned_item_group');
        if(!equalIds(prior,this.groupIds(target))||!equalIds((actual.mappingMenus??[]).map(row=>String(row.menuId)),this.ids(parent))) {
          await this.client.updateDish(id,{menuId:this.ids(parent)[0],groups});
        }
      }
      return;
    }
    if(this.platform==='rocket_now'&&target.kind==='category') {
      if(this.structureIssues(target,await this.snapshot()).length)throw Error(`uber_authority_relationship_drift:${target.sourceKey}`);
      return;
    }
    // Preflight currently admits only verified unchanged relationships. Any
    // drift during execution fails instead of overwriting a concurrent edit.
    if(this.structureIssues(target,this.relationshipSnapshot).length)throw Error(`uber_authority_relationship_drift:${target.sourceKey}`);
  }
  async retire(target) {
    for(const id of this.ids(target)) {
      const row=(await this.snapshot()).find(row=>row.kind===target.kind&&row.id===id);
      if(target.kind==='option') {await this.client.retireOption(id);continue;}
      if(!row||row.hidden)continue;
      if(this.platform!=='rocket_now')throw Error('uber_authority_permanent_retirement_unsupported');
      if(target.kind==='item')await this.client.updateDish(id,{retire:true});
      else if(target.kind==='option')await this.client.updateOption(id,{retire:true});
      else throw Error('uber_authority_parent_still_available');
    }
  }
  async observe(target) {
    const rows=this.observationSnapshot,structureVerified=this.structureIssues(target,rows).length===0;
    if(target.archived&&!target.mappings.length)return [{sourceKey:target.sourceKey,exists:false}];
    return target.mappings.flatMap(mapping=>{
      const matches=this.matches(target,rows,this.id(target.kind,mapping.externalId));
      if(!matches.length)return [{sourceKey:target.sourceKey,externalId:mapping.externalId,exists:false}];
      return matches.map(row=>({sourceKey:target.sourceKey,externalId:mapping.externalId,exists:true,name:row.name,price:row.price,hidden:row.hidden,...(row.staged?{placement:'staged'}:{}),structureVerified:structureVerified&&this.quantityMatches(target,row)}));
    });
  }
  async beginPhase(phase) {
    if(phase==='relationships') {
      if(this.platform==='demae_can') {
        const rows=await this.snapshot();
        // Add existing, independently listed options at their destination
        // BEFORE dropping any old association. This keeps stockout records
        // attached throughout a move. Permanently staged options stay out.
        for(const target of this.payload.targets.filter(row=>row.kind==='option_group'&&!row.archived&&!row.quarantined))for(const id of this.ids(target)) {
          const actual=await this.client.group(id),current=[...new Set(actual.options.map(row=>String(row.optionCode)))];
          const added=this.activeChildIds(target,rows).filter(id=>!current.includes(id));
          if(added.length)await this.client.updateGroup(id,{optionCodes:[...current,...added]});
        }
      }
      for(const move of this.plannedMoves??[]) {
        const parent=this.payload.targets.find(row=>row.targetId===move.toTargetId);
        if(!parent||this.ids(parent).length!==1)throw Error('uber_authority_move_parent_ambiguous');
        move.to=this.ids(parent)[0];
        const current=(await this.snapshot()).filter(row=>row.kind==='option'&&row.id===move.id);
        if(current.length!==1||current[0].parentIds.length!==1||![move.from,move.to].includes(current[0].parentIds[0]))throw Error('uber_authority_move_drift');
        await this.client.moveOption(move.id,move.to);
      }
      this.relationshipSnapshot=await this.snapshot();
    }
    if(phase==='verifying')this.observationSnapshot=await this.snapshot();
  }
}
