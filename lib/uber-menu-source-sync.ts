import { randomUUID } from 'node:crypto';
import { sql } from './db.ts';
import { resolveUberOptionMove, missingUberSourceObjects } from './uber-menu-identity.ts';
import { buildUberPublication, type UberPublicationMapping, type UberPublicationNode } from './uber-menu-publication.ts';
import { splitUberName, uberContextPrice, resolveUberBasePrice, uberSourceContentHash, validateUberSourceCatalog, confirmedUberRemovals, type UberSourceCatalog } from './uber-menu-authority.ts';

type SourceObject = { sourceKey: string; kind: string; uberId: string; parentUberId: string; targetId: string; priceMode: 'manual' | 'automatic'; archived: boolean; movedFromSourceKey?: string };
type Node = SourceObject & { name: string; displayNames: Record<string, string>; price: number | null; uberPrice: number | null; description: string; imageUrl: string; sortOrder: number; parentId: string | null; groupKey: string; payload: Record<string, unknown>; isNew: boolean };

export async function ingestUberMenuSource(input: { sourceId: string; commandId: string; storeId: string; catalog: unknown; dryRun?: boolean; verifyRollback?: boolean; bootstrap?: boolean }) {
  const sources = await sql`select * from menu_uber_sources where id::text=${input.sourceId} and store_id::text=${input.storeId} and (enabled=true or ${input.dryRun===true||input.verifyRollback===true} or (${input.bootstrap===true} and enabled=false and auto_publish=false and revision=0))`;
  const source = sources[0];
  if (!source) throw new Error('uber_source_not_enabled');
  if(input.bootstrap&&(source.enabled||source.auto_publish||Number(source.revision)!==0||input.verifyRollback))throw Error('uber_bootstrap_requires_disabled_initial_source');
  const previousRun = await sql`select summary from menu_uber_sync_runs where command_id::text=${input.commandId} and source_id=${source.id}`;
  if (previousRun.length) return previousRun[0].summary;
  const catalog = validateUberSourceCatalog(input.catalog, String(source.uber_store_uuid));
  const previous = source.last_catalog as UberSourceCatalog | null;
  if (previous && Date.parse(catalog.capturedAt) <= Date.parse(previous.capturedAt)) throw new Error('uber_source_stale_snapshot');
  const removals = confirmedUberRemovals(previous, catalog, (source.missing_keys as string[]).filter(key=>!key.startsWith('object:')));
  const hash = uberSourceContentHash(catalog);
  const [objects, mappings, items, groups, options, categories, platforms] = await Promise.all([
    sql`select source_key as "sourceKey",kind,uber_id as "uberId",parent_uber_id as "parentUberId",target_id::text as "targetId",price_mode as "priceMode",archived from menu_uber_objects where source_id=${source.id}`,
    sql`select m.target_type as kind,m.target_id::text as "targetId",m.external_id as "uberId" from menu_platform_object_mappings m join menu_external_platforms p on p.id=m.external_platform_id where p.brand_id=${source.brand_id} and p.store_id is null and p.platform_key='uber_eats'`,
    sql`select id::text,display_names as "displayNames",base_price::float as price,variable_schema as payload from menu_catalog_items where brand_id=${source.brand_id} and store_id is null`,
    sql`select id::text,display_names as "displayNames",external_id as "uberId",group_key as "groupKey",rule_json as payload from menu_option_groups where brand_id=${source.brand_id}`,
    sql`select o.id::text,o.display_names as "displayNames",o.option_group_id::text as "parentId",o.external_id as "uberId",o.price_delta::float as price from menu_options o join menu_option_groups g on g.id=o.option_group_id where g.brand_id=${source.brand_id}`,
    sql`select id::text,external_id as "uberId" from menu_categories where brand_id=${source.brand_id} and store_id is null`,
    sql`select id::text,platform_key as key from menu_external_platforms where brand_id=${source.brand_id} and store_id is null and platform_key in ('uber_eats','rocket_now','demae_can') and is_active=true`
  ]);
  const sourceObjects = objects as SourceObject[];
  const nodes: Node[] = [];
  const entityById = new Map(catalog.entities.map(row => [row.id,row]));
  const adopt = (kind: string, uberId: string, parentUberId = '', parentId: string | null = null) => {
    const sourceKey = `${kind}:${parentUberId ? `${parentUberId}:` : ''}${uberId}`;
    const existing = sourceObjects.find(row => row.sourceKey === sourceKey);
    if (existing) {
      if (nodes.some(row => row.kind===kind && row.targetId===existing.targetId)) throw new Error(`uber_source_mapping_reused:${sourceKey}`);
      return {...existing, archived:false, isNew:false};
    }
    let candidates = mappings.filter(row => row.kind === kind && row.uberId === uberId).map(row => String(row.targetId));
    if (kind === 'option') {
      candidates = [...candidates.filter(id => options.some(row => row.id===id && row.parentId===parentId)), ...options.filter(row => row.uberId===uberId && row.parentId===parentId).map(row => String(row.id))];
      if (!candidates.length) {
        const currentParents=catalog.groups.filter(row=>row.optionIds.includes(uberId)).map(row=>row.id);
        const currentParentIds=new Set([
          ...groups.filter(row=>currentParents.includes(String(row.uberId))).map(row=>String(row.id)),
          ...sourceObjects.filter(row=>row.kind==='option_group'&&currentParents.includes(row.uberId)).map(row=>row.targetId),
          ...mappings.filter(row=>row.kind==='option_group'&&currentParents.includes(String(row.uberId))).map(row=>String(row.targetId))
        ]);
        const orphanLegacyIds=options.filter(row=>!currentParentIds.has(String(row.parentId))).map(row=>String(row.id));
        const moved = resolveUberOptionMove({uberId,parentUberId,
          currentParents,
          sourceObjects,claimedTargetIds:nodes.filter(row=>row.kind==='option').map(row=>row.targetId),
          legacyTargetIds:[...options.filter(row=>row.uberId===uberId && orphanLegacyIds.includes(String(row.id))).map(row=>String(row.id)),
            ...mappings.filter(row=>row.kind==='option'&&row.uberId===uberId && orphanLegacyIds.includes(String(row.targetId))).map(row=>String(row.targetId))]
        });
        if (moved) return {kind,uberId,priceMode:'manual' as const,...moved,archived:false,sourceKey,parentUberId,isNew:false};
      }
    }
    if (kind === 'option_group') candidates.push(...groups.filter(row => row.uberId===uberId).map(row => String(row.id)));
    if (kind === 'category') candidates.push(...categories.filter(row => row.uberId===uberId).map(row => String(row.id)));
    candidates = [...new Set(candidates)];
    if (candidates.length > 1) throw new Error(`uber_source_mapping_ambiguous:${sourceKey}`);
    const targetId = candidates[0] ?? randomUUID();
    if (nodes.some(row => row.kind===kind && row.targetId===targetId)) throw new Error(`uber_source_mapping_reused:${sourceKey}`);
    return {sourceKey,kind,uberId,parentUberId,targetId,priceMode:candidates.length ? 'manual' as const : 'automatic' as const,archived:false,isNew:!candidates.length};
  };
  const add = (kind: string, uberId: string, name: string, index: number, extra: Partial<Node> = {}) => {
    const identity = adopt(kind,uberId,extra.parentUberId,extra.parentId);
    const localized = splitUberName(name);
    const old = (kind==='item'?items:kind==='option'?options:groups).find(row=>row.id===identity.targetId);
    localized.displayNames = {...(old?.displayNames as Record<string,string>??{}),...localized.displayNames};
    const node: Node = {...identity,...localized,price:null,uberPrice:null,description:'',imageUrl:'',sortOrder:index*10,parentId:null,groupKey:'',payload:{},...extra};
    nodes.push(node); return node;
  };
  const categoryOrder = [...new Set(catalog.sections.flatMap(row => row.categoryIds))];
  for (const [index,row] of catalog.categories.entries()) add('category',row.id,row.name,categoryOrder.includes(row.id)?categoryOrder.indexOf(row.id):index,{payload:row});
  for (const [index,row] of catalog.groups.entries()) {
    const node = add('option_group',row.id,row.name,index,{payload:row});
    node.groupKey = String(groups.find(group => group.id===node.targetId)?.groupKey ?? `uber-${row.id}`);
    for (const [optionIndex,id] of row.optionIds.entries()) {
      const entity = entityById.get(id)!;
      const option = add('option',id,entity.name,optionIndex,{parentUberId:row.id,parentId:node.targetId,payload:{...entity,groupId:row.id},description:entity.description,imageUrl:entity.imageUrl,uberPrice:uberContextPrice(entity,row.id)});
      option.price = resolveUberBasePrice({uberPrice:option.uberPrice!,currentBasePrice:options.find(old=>old.id===option.targetId)?.price as number|undefined,mode:option.priceMode}).price;
    }
  }
  const productIds = [...new Set(catalog.categories.flatMap(row => row.itemIds))];
  // Keep already imported, now unlinked entities identifiable without exposing them.
  for (const old of sourceObjects.filter(row=>row.kind==='item')) if(entityById.has(old.uberId) && !productIds.includes(old.uberId)) productIds.push(old.uberId);
  for (const old of mappings.filter(row=>row.kind==='item')) if(entityById.has(String(old.uberId)) && !productIds.includes(String(old.uberId))) productIds.push(String(old.uberId));
  for (const [index,id] of productIds.entries()) {
    const entity = entityById.get(id)!;
    const category = catalog.categories.find(row=>row.itemIds.includes(id));
    const node = add('item',id,entity.name,index,{payload:{...entity,categoryIds:catalog.categories.filter(row=>row.itemIds.includes(id)).map(row=>row.id),attached:Boolean(category)},parentId:nodes.find(row=>row.kind==='category'&&row.uberId===category?.id)?.targetId ?? null,description:entity.description,imageUrl:entity.imageUrl,uberPrice:entity.price});
    node.price = resolveUberBasePrice({uberPrice:entity.price,currentBasePrice:items.find(old=>old.id===node.targetId)?.price as number|undefined,mode:node.priceMode}).price;
  }
  // Adopt only stable legacy mappings. Objects deleted before the first source
  // capture must also enter the two-observation removal process.
  const legacyMissing: SourceObject[] = [];
  for (const mapping of mappings) {
    if (nodes.some(node=>node.kind===mapping.kind && node.targetId===mapping.targetId)
      || sourceObjects.some(node=>node.kind===mapping.kind && node.targetId===mapping.targetId)) continue;
    const parent = mapping.kind==='option'
      ? groups.find(group=>group.id===options.find(option=>option.id===mapping.targetId)?.parentId)?.uberId : '';
    if (mapping.kind==='option' && !parent) throw new Error(`uber_source_legacy_parent_missing:${mapping.targetId}`);
    legacyMissing.push({sourceKey:`${mapping.kind}:${parent?`${parent}:`:''}${mapping.uberId}`,kind:String(mapping.kind),uberId:String(mapping.uberId),parentUberId:String(parent??''),targetId:String(mapping.targetId),priceMode:'manual',archived:false});
  }
  const missingObjects = missingUberSourceObjects([...sourceObjects,...legacyMissing],nodes);
  const oldMissing = source.missing_keys as string[];
  const objectMissingKeys = missingObjects.map(row=>`object:${row.sourceKey}`);
  const independent = previous && Date.parse(catalog.capturedAt)-Date.parse(previous.capturedAt)>=60_000;
  const archived = missingObjects.filter(row => independent && oldMissing.includes(`object:${row.sourceKey}`));
  const pendingKeys = [...removals.pending,...objectMissingKeys];
  const summary = {added:nodes.filter(row=>row.isNew).length,moved:nodes.filter(row=>row.kind==='option' && options.some(old=>old.id===row.targetId && old.parentId!==row.parentId)).length,observed:nodes.length,archived:archived.length,pendingRemoval:missingObjects.length,contentChanged:hash!==source.last_content_hash};
  if(input.dryRun) return {...summary, dryRun:true, additions:nodes.filter(row=>row.isNew).map(row=>({kind:row.kind,name:row.name,uberId:row.uberId})), prices:nodes.filter(row=>row.price!==null).map(row=>({kind:row.kind,name:row.name,uberPrice:row.uberPrice,osPrice:row.price,mode:row.priceMode})), nodes};
  const statements = input.bootstrap?[sql`with locked as materialized(select id from menu_uber_sources where id=${source.id} and revision=0 and enabled=false and auto_publish=false for update) select 1/count(*)::int from locked`]:input.verifyRollback ? [sql`update menu_uber_sources set enabled=true where id=${source.id}`,sql`select lock_menu_uber_revision(${source.id},${source.revision})`] : [sql`select lock_menu_uber_revision(${source.id},${source.revision})`];
  for (const node of legacyMissing) statements.push(sql`insert into menu_uber_objects(source_id,source_key,kind,uber_id,parent_uber_id,target_id,price_mode) values(${source.id},${node.sourceKey},${node.kind},${node.uberId},${node.parentUberId},${node.targetId},'manual') on conflict do nothing`);
  // Every write and checkpoint shares one transaction. Failed imports cannot
  // leave half a menu or enqueue a downstream publication of partial data.
  for (const node of nodes) {
    if (node.movedFromSourceKey) statements.push(sql`update menu_uber_objects set source_key=${node.sourceKey},parent_uber_id=${node.parentUberId},updated_at=now() where source_id=${source.id} and source_key=${node.movedFromSourceKey} and target_id=${node.targetId}`);
    const translations = JSON.stringify(node.displayNames);
    if (node.kind==='category') statements.push(sql`insert into menu_categories (id,brand_id,external_id,name,sort_order) values (${node.targetId},${source.brand_id},${node.uberId},${node.name},${node.sortOrder}) on conflict(id) do update set name=excluded.name,sort_order=excluded.sort_order,updated_at=now()`);
    if (node.kind==='option_group') {
      const rules = JSON.stringify({...((groups.find(row=>row.id===node.targetId)?.payload ?? {}) as object),source:'uber_eats',minSelections:node.payload.min,maxSelections:node.payload.max,limit:node.payload.max,uberQuantityInfo:node.payload.quantityInfo});
      statements.push(sql`insert into menu_option_groups(id,brand_id,external_id,group_key,name,display_names,selection_type,rule_json,sort_order) values(${node.targetId},${source.brand_id},${node.uberId},${node.groupKey},${node.name},${translations}::jsonb,${node.payload.max===1?'single':'multiple'},${rules}::jsonb,${node.sortOrder}) on conflict(id) do update set name=excluded.name,display_names=menu_option_groups.display_names||excluded.display_names,rule_json=excluded.rule_json,selection_type=excluded.selection_type,sort_order=excluded.sort_order,is_active=true,updated_at=now()`);
    }
    if (node.kind==='option') statements.push(sql`insert into menu_options(id,option_group_id,external_id,option_key,name,display_names,price_delta,image_url,sort_order) values(${node.targetId},${node.parentId},${node.uberId},${node.uberId},${node.name},${translations}::jsonb,${node.price},${node.imageUrl},${node.sortOrder}) on conflict(id) do update set option_group_id=excluded.option_group_id,external_id=excluded.external_id,option_key=excluded.option_key,name=excluded.name,display_names=menu_options.display_names||excluded.display_names,price_delta=excluded.price_delta,image_url=excluded.image_url,sort_order=excluded.sort_order,is_active=true,updated_at=now()`);
    if (node.kind==='item') {
      const categoryName = nodes.find(row=>row.targetId===node.parentId)?.name ?? '';
      const variables = JSON.stringify({...((items.find(row=>row.id===node.targetId)?.payload ?? {}) as object),source:'uber_eats',sourceProductId:node.uberId,uberPrice:node.uberPrice,customizationGroupKeys:(node.payload.groupIds as string[]).map(id=>nodes.find(row=>row.kind==='option_group'&&row.uberId===id)?.groupKey).filter(Boolean)});
      statements.push(sql`insert into menu_catalog_items(id,brand_id,external_id,name,display_names,description,image_url,base_price,category,variable_schema,sort_order,is_active) values(${node.targetId},${source.brand_id},${node.uberId},${node.name},${translations}::jsonb,${node.description},${node.imageUrl},${node.price},${categoryName},${variables}::jsonb,${node.sortOrder},${node.payload.attached!==false}) on conflict(id) do update set promotion_prefix='',name=excluded.name,display_names=menu_catalog_items.display_names||excluded.display_names,description=excluded.description,image_url=excluded.image_url,base_price=excluded.base_price,category=excluded.category,variable_schema=excluded.variable_schema,sort_order=excluded.sort_order,is_active=excluded.is_active,updated_at=now()`);
      statements.push(sql`update menu_catalog_item_option_groups set is_active=false,updated_at=now() where menu_catalog_item_id=${node.targetId}`);
      for (const [index,groupId] of (node.payload.groupIds as string[]).entries()) {
        const targetGroupId = nodes.find(row=>row.kind==='option_group'&&row.uberId===groupId)!.targetId;
        statements.push(sql`insert into menu_catalog_item_option_groups(menu_catalog_item_id,option_group_id,sort_order) values(${node.targetId},${targetGroupId},${index*10}) on conflict(menu_catalog_item_id,option_group_id) do update set sort_order=excluded.sort_order,is_active=true,updated_at=now()`);
      }
    }
    if (node.isNew && ['item','option'].includes(node.kind)) {
      if(node.kind==='item') statements.push(sql`insert into menu_store_settings(brand_id,store_id,menu_catalog_item_id,is_available,stock_status,website_enabled) values(${source.brand_id},${source.store_id},${node.targetId},false,'unavailable',false) on conflict(store_id,menu_catalog_item_id) do nothing`);
      else statements.push(sql`insert into menu_option_store_settings(brand_id,store_id,menu_option_id,is_available,stock_status) values(${source.brand_id},${source.store_id},${node.targetId},false,'unavailable') on conflict(store_id,menu_option_id) do nothing`);
      for (const platform of ['rocket_now','demae_can']) statements.push(sql`insert into menu_platform_availability_settings(brand_id,store_id,target_kind,target_id,platform,availability) values(${source.brand_id},${source.store_id},${node.kind},${node.targetId},${platform},'unavailable') on conflict(store_id,target_kind,target_id,platform) do nothing`);
    }
    const payload = JSON.stringify(node.payload);
    statements.push(sql`insert into menu_uber_objects(source_id,source_key,kind,uber_id,parent_uber_id,target_id,price_mode,last_uber_price,source_payload) values(${source.id},${node.sourceKey},${node.kind},${node.uberId},${node.parentUberId},${node.targetId},${node.priceMode},${node.uberPrice},${payload}::jsonb) on conflict(source_id,source_key) do update set source_payload=excluded.source_payload,last_uber_price=excluded.last_uber_price,archived=false,updated_at=now()`);
    const uberPlatform = platforms.find(row=>row.key==='uber_eats');
    if (uberPlatform) {
      statements.push(sql`insert into menu_platform_target_settings(brand_id,external_platform_id,target_type,target_id,name_override,price_override,placement_config) values(${source.brand_id},${uberPlatform.id},${node.kind},${node.targetId},${String(node.payload.name??node.name)},${node.uberPrice},'{"authoritativeSource":"uber_eats","useExactNameOverride":true}'::jsonb) on conflict(external_platform_id,target_type,target_id) do update set name_override=excluded.name_override,price_override=excluded.price_override,placement_config=menu_platform_target_settings.placement_config||excluded.placement_config,updated_at=now()`);
      statements.push(sql`insert into menu_platform_object_mappings(brand_id,external_platform_id,target_type,target_id,external_id,external_parent_id,external_name) values(${source.brand_id},${uberPlatform.id},${node.kind},${node.targetId},${node.uberId},${node.parentUberId},${node.name}) on conflict(external_platform_id,target_type,external_id) do update set external_parent_id=excluded.external_parent_id,external_name=excluded.external_name,updated_at=now() where menu_platform_object_mappings.target_id=excluded.target_id`);
    }
  }
  for (const node of archived) {
    if(node.kind==='item') statements.push(sql`update menu_catalog_items set is_active=false,updated_at=now() where id=${node.targetId} and brand_id=${source.brand_id}`);
    if(node.kind==='option') statements.push(sql`update menu_options set is_active=false,updated_at=now() where id=${node.targetId}`);
    if(node.kind==='option_group') statements.push(sql`update menu_option_groups set is_active=false,updated_at=now() where id=${node.targetId} and brand_id=${source.brand_id}`);
    statements.push(sql`update menu_uber_objects set archived=true,updated_at=now() where source_id=${source.id} and source_key=${node.sourceKey}`);
  }
  const revision = Number(source.revision)+1;
  if(source.auto_publish && !input.verifyRollback) {
    const deliveryMappings=await sql`select p.platform_key as platform,m.target_type as kind,m.target_id::text as "targetId",m.external_id as "externalId",m.external_parent_id as "externalParentId" from menu_platform_object_mappings m join menu_external_platforms p on p.id=m.external_platform_id where p.brand_id=${source.brand_id} and p.store_id is null and (m.store_id is null or m.store_id=${source.store_id}) and p.platform_key in ('rocket_now','demae_can')`;
    const config=source.publish_config as Record<string,{merchantId?:string;menuPatternCode?:string;draftPatternCode?:string;draftCarrierItemCode?:string;selectionPolicy?:'strict'|'preserve_native';quarantinedSourceKeys?:string[];excludedSourceKeys?:string[];optionMigrationPolicy?:'preserve_stock'}>;
    const [creationAttempts,migrations]=await Promise.all([
      sql`select platform,source_key as "sourceKey",status,external_id as "externalId",external_parent_id as "externalParentId" from menu_uber_creation_attempts where source_id=${source.id}`,
      sql`select platform,migration_key,state from menu_uber_option_migrations where source_id=${source.id}`
    ]);
    const retired: UberPublicationNode[]=[...archived,...sourceObjects.filter(row=>row.archived && !nodes.some(node=>node.sourceKey===row.sourceKey || (node.kind===row.kind && node.targetId===row.targetId)))].map(row=>({...row,name:'',displayNames:{},price:null,uberPrice:null,description:'',imageUrl:'',sortOrder:0,parentId:null,payload:{},archived:true}));
    for(const platform of ['rocket_now','demae_can'] as const) {
      if(!config?.[platform]?.merchantId || (platform==='demae_can' && !config[platform]?.menuPatternCode)) throw new Error(`uber_publish_store_not_configured:${platform}`);
      const payload=buildUberPublication({sourceId:String(source.id),brandId:String(source.brand_id),storeId:String(source.store_id),revision,platform,merchantId:config[platform].merchantId!,menuPatternCode:config[platform].menuPatternCode,draftPatternCode:config[platform].draftPatternCode,draftCarrierItemCode:config[platform].draftCarrierItemCode,selectionPolicy:config[platform].selectionPolicy,quarantinedSourceKeys:config[platform].quarantinedSourceKeys,excludedSourceKeys:config[platform].excludedSourceKeys,nodes:[...nodes,...retired],mappings:deliveryMappings.filter(row=>row.platform===platform) as UberPublicationMapping[],creationIdentities:creationAttempts.filter(row=>row.platform===platform).map(row=>({sourceKey:String(row.sourceKey),status:String(row.status),externalId:String(row.externalId),externalParentId:String(row.externalParentId)}))});
      Object.assign(payload,{
        ...(platform==='rocket_now'&&config[platform].optionMigrationPolicy?{optionMigrationPolicy:config[platform].optionMigrationPolicy}:{}),
        authorityState:Object.fromEntries(creationAttempts.filter(row=>row.platform===platform).map(row=>[row.sourceKey,row])),
        migrationState:Object.fromEntries(migrations.filter(row=>row.platform===platform).map(row=>[row.migration_key,row.state]))
      });
      statements.push(sql`insert into local_bridge_commands(store_id,platform,command_type,idempotency_key,payload) values(${source.store_id},${platform},'publish_menu_changes',${`uber-publish:${source.id}:${revision}:${platform}`},${JSON.stringify(payload)}::jsonb) on conflict(idempotency_key) do nothing`);
    }
  }
  statements.push(sql`update menu_uber_sources set revision=${revision},last_catalog=${JSON.stringify(catalog)}::jsonb,last_content_hash=${hash},missing_keys=${pendingKeys},last_checked_at=now(),last_error='',updated_at=now() where id=${source.id}`);
  statements.push(sql`insert into menu_uber_sync_runs(source_id,command_id,revision,content_hash,summary) values(${source.id},${input.commandId},${revision},${hash},${JSON.stringify(summary)}::jsonb)`);
  if(input.verifyRollback) {
    // Execute every real constraint/write, then deliberately fail the final
    // statement. PostgreSQL rolls back the entire validation transaction.
    statements.push(sql`select 'uber_authority_validation_rollback'::integer`);
    try {await sql.transaction(statements);} catch(error) {
      if(error instanceof Error && error.message.includes('uber_authority_validation_rollback')) return {...summary,transactionValidated:true,rolledBack:true};
      throw error;
    }
    throw new Error('Validation transaction unexpectedly committed');
  }
  await sql.transaction(statements);
  return summary;
}

export async function scheduleUberSourceScans(storeId?: string) {
  const rows = await sql`select s.* from menu_uber_sources s where enabled=true and (${storeId??null}::text is null or store_id::text=${storeId??''}) and (${Boolean(storeId)} or last_checked_at is null or last_checked_at<now()-interval '10 minutes')`;
  let queued=0;
  for(const source of rows) {
    const key=`uber-authority:${source.id}:${storeId?randomUUID():Math.floor(Date.now()/600000)}`;
    const result=await sql`insert into local_bridge_commands(store_id,platform,command_type,idempotency_key,payload) select ${source.store_id},'uber_eats','capture_menu_snapshot',${key},${JSON.stringify({brandId:source.brand_id,sourceId:source.id,authoritativeSource:true,expectedUberStoreUuid:source.uber_store_uuid,ruleVersion:'uber-authority-v1',targets:[]})}::jsonb where not exists(select 1 from local_bridge_commands where store_id=${source.store_id} and payload->>'sourceId'=${source.id}::text and status in ('pending','processing')) on conflict(idempotency_key) do nothing returning id`;
    queued+=result.length;
  }
  return {queued};
}
