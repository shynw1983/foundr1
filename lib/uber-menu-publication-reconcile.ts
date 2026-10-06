import {randomUUID} from 'node:crypto';
import {sql} from './db.ts';
import {buildUberPublication,type UberPublicationNode,type UberPublicationMapping,type UberMenuNameAdaptation} from './uber-menu-publication.ts';
import {splitUberName,type UberSourceCatalog} from './uber-menu-authority.ts';
import {menuSyncIssue} from './menu-sync-status.ts';
import {loadVerifiedCreationHoldReleases} from './uber-creation-hold-releases.ts';

type Row=Record<string,any>;
type Platform='rocket_now'|'demae_can';
type Block={platform?:Platform;code:string};
export type UberPublicationReconcileResult={queued:number;blocked:Block[];jobs:Array<{id:string;platform:Platform}>};
export type UberPublicationReconcileInput={sourceId:string;storeId:string;revision:number;mode:'manual'|'scheduled';
  jobId?:string;captureCommandId?:string;nodes?:UberPublicationNode[];catalog?:UberSourceCatalog};
const platforms:Platform[]=['rocket_now','demae_can'];
const record=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)])):value;
const equal=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const pair=(mapping:Row)=>`${mapping.externalId}\u0000${mapping.externalParentId??''}`;
const blocked=(code:string,platform?:Platform):UberPublicationReconcileResult=>({queued:0,blocked:[{code,...(platform?{platform}:{})}],jobs:[]});

// Read a complete preparation manifest. Its exact JSON is checked again inside
// the source-locked transaction: snapshot/mapping writers do not all share the
// source lock, so the lock alone cannot authorize a stale physical identity.
async function readState(input:UberPublicationReconcileInput) {
  const rows=await sql`select s.*,
    coalesce((select jsonb_agg(to_jsonb(o) order by o.source_key) from menu_uber_objects o where o.source_id=s.id),'[]'::jsonb) as objects,
    coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from menu_catalog_items i where i.brand_id=s.brand_id and i.store_id is null),'[]'::jsonb) as items,
    coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from menu_option_groups g where g.brand_id=s.brand_id),'[]'::jsonb) as groups,
    coalesce((select jsonb_agg(to_jsonb(o) order by o.id) from menu_options o join menu_option_groups g on g.id=o.option_group_id where g.brand_id=s.brand_id),'[]'::jsonb) as options,
    coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from menu_categories c where c.brand_id=s.brand_id and c.store_id is null),'[]'::jsonb) as categories,
    coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from menu_external_platforms p where p.brand_id=s.brand_id and p.store_id is null and p.platform_key in ('rocket_now','demae_can')),'[]'::jsonb) as platforms,
    coalesce((select jsonb_agg(jsonb_build_object('platform',p.platform_key,'mapping',to_jsonb(m)) order by p.platform_key,m.id) from menu_platform_object_mappings m join menu_external_platforms p on p.id=m.external_platform_id where p.brand_id=s.brand_id and p.store_id is null and (m.store_id is null or m.store_id=s.store_id) and p.platform_key in ('rocket_now','demae_can')),'[]'::jsonb) as mappings,
    coalesce((select jsonb_agg(to_jsonb(a) order by a.platform,a.source_key) from menu_uber_creation_attempts a where a.source_id=s.id),'[]'::jsonb) as receipts,
    coalesce((select jsonb_agg(to_jsonb(m) order by m.platform,m.migration_key) from menu_uber_option_migrations m where m.source_id=s.id),'[]'::jsonb) as migrations
    from menu_uber_sources s where s.id::text=${input.sourceId} and s.store_id::text=${input.storeId}`;
  return rows[0] as Row|undefined;
}

function hasUnconfirmedRemovals(state:Row) {
  const catalog=record(state.last_catalog) as unknown as UberSourceCatalog;
  if(!Array.isArray(catalog.entities)||!Array.isArray(catalog.groups)||!Array.isArray(catalog.categories))throw Error('uber_publication_reconcile_catalog_missing');
  const objects=state.objects as Row[];
  const present=(object:Row)=>object.kind==='item'?catalog.entities.some(row=>row.id===object.uber_id)
    :object.kind==='option'?catalog.entities.some(row=>row.id===object.uber_id)&&catalog.groups.some(row=>row.id===object.parent_uber_id&&row.optionIds.includes(object.uber_id))
    :object.kind==='option_group'?catalog.groups.some(row=>row.id===object.uber_id)
    :object.kind==='category'?catalog.categories.some(row=>row.id===object.uber_id):false;
  if(objects.some(object=>!object.archived&&!present(object)))return true;
  for(const key of state.missing_keys??[]) {
    if(typeof key!=='string'||!key.includes(':'))return true;
    const type=key.slice(0,key.indexOf(':')),id=key.slice(key.indexOf(':')+1);
    if(!id)return true;
    if(type==='object') {
      const object=objects.find(row=>row.source_key===id);
      if(!object||!object.archived||present(object))return true;
      continue;
    }
    const kinds=type==='entity'?['item','option']:type==='group'?['option_group']:type==='category'?['category']:[];
    if(!kinds.length)return true;
    const current=type==='entity'?catalog.entities:type==='group'?catalog.groups:catalog.categories;
    const matches=objects.filter(row=>kinds.includes(row.kind)&&row.uber_id===id);
    if(current.some(row=>row.id===id)||matches.some(row=>!row.archived))return true;
    // Complete Uber snapshots contain unused entities too: their historical
    // absence has no OS/publication identity to retire. Groups/categories are
    // always imported; an unknown one remains unsafe. Never erase the evidence.
    if(type!=='entity'&&!matches.length)return true;
  }
  return false;
}

/** Rebuild the current projection without importing stock or guessing/adopting
 * objects. Source keys and OS IDs come only from the persisted source graph. */
function persistedNodes(state:Row):UberPublicationNode[] {
  const catalog=record(state.last_catalog) as unknown as UberSourceCatalog;
  if(!Array.isArray(catalog.groups)||!Array.isArray(catalog.categories)||!Array.isArray(catalog.entities)||!Array.isArray(catalog.sections))throw Error('uber_publication_reconcile_catalog_missing');
  const categoryOrder=[...new Set(catalog.sections.flatMap(section=>section.categoryIds))];
  const productOrder=[...new Set(catalog.categories.flatMap(category=>category.itemIds))];
  for(const object of state.objects.filter((row:Row)=>row.kind==='item'&&!row.archived))if(catalog.entities.some(entity=>entity.id===object.uber_id)&&!productOrder.includes(object.uber_id))productOrder.push(object.uber_id);
  const objects=state.objects as Row[];
  return objects.map(object=>{
    if(object.archived)return {sourceKey:object.source_key,kind:object.kind,targetId:object.target_id,parentId:null,name:'',displayNames:{},uberPrice:null,price:null,description:'',imageUrl:'',sortOrder:0,payload:{},archived:true};
    const native=record(object.source_payload);
    const table=object.kind==='item'?state.items:object.kind==='option_group'?state.groups:object.kind==='option'?state.options:state.categories;
    const local=(table as Row[]).find(row=>row.id===object.target_id);
    if(!local||!native.name)throw Error('uber_publication_reconcile_identity_changed');
    const localized=splitUberName(String(native.name));
    const group=catalog.groups.find(row=>row.id===object.parent_uber_id);
    const categoryIndex=categoryOrder.includes(object.uber_id)?categoryOrder.indexOf(object.uber_id):catalog.categories.findIndex(row=>row.id===object.uber_id);
    const index=object.kind==='category'?categoryIndex:object.kind==='option_group'?catalog.groups.findIndex(row=>row.id===object.uber_id)
      :object.kind==='option'?group?.optionIds.indexOf(object.uber_id)??-1:productOrder.indexOf(object.uber_id);
    if(index<0)throw Error('uber_publication_reconcile_identity_changed');
    const category=object.kind==='item'?objects.find(row=>row.kind==='category'&&row.uber_id===native.categoryIds?.[0]):undefined;
    const parent=object.kind==='option'?objects.find(row=>row.kind==='option_group'&&row.uber_id===object.parent_uber_id):category;
    if(object.kind==='option'&&(!parent||local.option_group_id!==parent.target_id))throw Error('uber_publication_reconcile_identity_changed');
    return {sourceKey:object.source_key,kind:object.kind,targetId:object.target_id,parentId:parent?.target_id??null,
      name:localized.name,displayNames:{...record(local.display_names),...localized.displayNames},uberPrice:object.last_uber_price==null?null:Number(object.last_uber_price),
      price:['item','option'].includes(object.kind)?Number(object.kind==='item'?local.base_price:local.price_delta):null,
      description:String(native.description??''),imageUrl:'',sortOrder:index*10,payload:native};
  });
}

async function freshPayload(state:Row,platform:Platform,nodes:UberPublicationNode[]) {
  const config=record(state.publish_config?.[platform]);
  if(!config.merchantId||(platform==='demae_can'&&!config.menuPatternCode))throw Error('uber_publication_reconcile_not_configured');
  const receipts=(state.receipts as Row[]).filter(row=>row.platform===platform);
  const mappings=(state.mappings as Row[]).filter(row=>row.platform===platform).map(({mapping})=>({kind:mapping.target_type,targetId:mapping.target_id,externalId:mapping.external_id,externalParentId:mapping.external_parent_id??''})) as UberPublicationMapping[];
  const creationHoldReleases=await loadVerifiedCreationHoldReleases({sourceId:state.id,storeId:state.store_id,platform,merchantId:String(config.merchantId),
    releases:config.creationHoldReleases,nodes,mappings});
  const payload=buildUberPublication({sourceId:state.id,storeId:state.store_id,brandId:state.brand_id,revision:Number(state.revision),platform,
    merchantId:config.merchantId,menuPatternCode:config.menuPatternCode,draftPatternCode:config.draftPatternCode,draftCarrierItemCode:config.draftCarrierItemCode,
    selectionPolicy:config.selectionPolicy,quarantinedSourceKeys:config.quarantinedSourceKeys,excludedSourceKeys:config.excludedSourceKeys,
    optionMigrationPolicy:config.optionMigrationPolicy,nameAdaptations:config.nameAdaptations as Record<string,UberMenuNameAdaptation>,nodes,
    mappings,creationHoldReleases,
    creationIdentities:receipts.map(row=>({sourceKey:row.source_key,status:row.status,externalId:row.external_id,externalParentId:row.external_parent_id}))});
  return {...payload,pendingRemovals:[],authorityState:Object.fromEntries(receipts.map(row=>[row.source_key,{sourceKey:row.source_key,status:row.status,externalId:row.external_id,externalParentId:row.external_parent_id}])),
    migrationState:Object.fromEntries((state.migrations as Row[]).filter(row=>row.platform===platform).map(row=>[row.migration_key,row.state]))} as Row;
}

function mergePayload(old:Row,fresh:Row):Row {
  for(const key of ['sourceId','storeId','brandId','revision','platformKey','merchantId','menuPatternCode','draftPatternCode','draftCarrierItemCode'])if(String(old[key]??'')!==String(fresh[key]??''))throw Error('uber_publication_reconcile_identity_changed');
  if(old.authoritativePublication!==true||!Array.isArray(old.targets)||old.targets.length!==fresh.targets.length)throw Error('uber_publication_reconcile_identity_changed');
  if(Array.isArray(old.pendingRemovals)&&old.pendingRemovals.length)throw Error('uber_publication_reconcile_pending_removal');
  const oldTargets=new Map<string,Row>(old.targets.map((target:Row)=>[String(target.sourceKey),target]));
  if(oldTargets.size!==old.targets.length)throw Error('uber_publication_reconcile_identity_changed');
  for(const target of fresh.targets as Row[]) {
    const prior=oldTargets.get(target.sourceKey);
    if(!prior||prior.kind!==target.kind||prior.targetId!==target.targetId||prior.parentId!==target.parentId||prior.marker!==target.marker)throw Error('uber_publication_reconcile_identity_changed');
    if(!Array.isArray(prior.mappings)||prior.mappings.some((mapping:Row)=>!target.mappings.some((row:Row)=>pair(row)===pair(mapping))))throw Error('uber_publication_reconcile_identity_changed');
    // Preserve receipt-bearing flags. Dropping created:true would weaken the
    // native verifier's requirement that a newly created entity remain hidden.
    for(const mapping of target.mappings as Row[]) {
      const previous=prior.mappings.find((row:Row)=>pair(row)===pair(mapping));
      if(previous) {
        const release=mapping.creationHoldRelease,created=mapping.created===true||previous.created===true;
        Object.assign(mapping,previous);
        // Only the newly loaded persisted command/native audit proof may
        // release a hold; an old payload must not resurrect revoked/stale proof.
        delete mapping.creationHoldRelease;
        if(release)mapping.creationHoldRelease=release;
        if(created)mapping.created=true;
      }
      else if(!Object.entries(fresh.authorityState as Record<string,Row>).some(([key,receipt])=>receipt.status==='identified'
        &&receipt.externalId===mapping.externalId&&receipt.externalParentId===mapping.externalParentId
        &&(key===target.sourceKey||(target.kind==='option'&&key.startsWith('option:')&&key.split(':').at(-1)===target.sourceKey.split(':').at(-1)))))throw Error('uber_publication_reconcile_identity_changed');
      else mapping.created=true;
    }
    if(prior.nameAdaptation) {
      const candidate=record(prior.nameAdaptation);
      if(candidate.sourceKey!==target.sourceKey||candidate.targetId!==target.targetId||candidate.sourceName!==target.sourceName
        ||candidate.inputName!==target.nameProjection||candidate.name!==prior.name||typeof candidate.name!=='string'||!candidate.name)throw Error('uber_publication_reconcile_candidate_changed');
      target.name=prior.name;target.nameAdaptation=candidate;
    }
  }
  const authority={...record(old.authorityState),...fresh.authorityState};
  for(const [key,prior] of Object.entries(record(old.authorityState))) {
    const current=fresh.authorityState[key];
    if(!current)continue; // An absent DB row is not permission to forget a write.
    if(prior.externalId&&(current.externalId!==prior.externalId||String(current.externalParentId??'')!==String(prior.externalParentId??'')))throw Error('uber_publication_reconcile_identity_changed');
    if(prior.status===current.status)continue;
    // The receipt store deliberately retains status=creating after receiving
    // the ID; the command's received state is the stronger equivalent proof.
    if(prior.status==='received'&&current.status==='creating'&&prior.externalId) {authority[key]={...current,...prior};continue;}
    const identified=current.status==='identified'&&Boolean(current.externalId)&&['creating','received','rejected'].includes(String(prior.status));
    const newUncertainAttempt=prior.status==='rejected'&&current.status==='creating';
    if(!identified&&!newUncertainAttempt)throw Error('uber_publication_reconcile_identity_changed');
  }
  for(const [key,prior] of Object.entries(record(old.migrationState))) {
    const current=fresh.migrationState[key];
    // Both stores persist progress atomically with the command. A contradictory
    // same-revision intent cannot be repaired by guessing which journal wins.
    if(current&&!equal(prior,current))throw Error('uber_publication_reconcile_identity_changed');
  }
  return {...old,...fresh,authorityState:authority,migrationState:{...record(old.migrationState),...fresh.migrationState}};
}

/** Reconcile an unchanged source using the ordinary full native publisher, not
 * desired-state echoes. Same-revision commands keep their ID, results, creation
 * journal and prepared name. A manual scan verifies both platforms; scheduled
 * recovery allows at most two additional network-failure retries per revision. */
export async function reconcileUberPublications(input:UberPublicationReconcileInput):Promise<UberPublicationReconcileResult> {
  try {
    const state=await readState(input);
    if(!state||!state.enabled||!state.auto_publish)return blocked('uber_publication_reconcile_disabled');
    if(Number(state.revision)!==input.revision)return blocked('uber_publication_reconcile_conflict');
    if(input.catalog&&!equal(state.last_catalog,input.catalog))return blocked('uber_publication_reconcile_conflict');
    if(hasUnconfirmedRemovals(state))return blocked('uber_publication_reconcile_pending_removal');
    // History can include tens of megabytes of native observations. Read only
    // active/capture metadata, then the two current publication heads. Loading
    // every historical result exceeded the database HTTP response limit.
    const activeRows=await sql`select jsonb_build_object('id',c.id,'platform',c.platform,'command_type',c.command_type,'status',c.status,
      'payload',jsonb_build_object('sourceId',c.payload->>'sourceId','authoritativeSource',c.payload->'authoritativeSource')) as data
      from local_bridge_commands c where c.store_id::text=${input.storeId} and c.payload->>'sourceId'=${input.sourceId}
      and (c.status in ('pending','processing') or c.id::text=${input.captureCommandId??''})`;
    const activeCommands=activeRows.map(row=>row.data as Row);
    const capture=input.captureCommandId?activeCommands.find(row=>row.id===input.captureCommandId):undefined;
    if(input.captureCommandId&&(!capture||capture.platform!=='uber_eats'||capture.command_type!=='capture_menu_snapshot'||capture.payload.authoritativeSource!==true
      ||!['processing','succeeded'].includes(capture.status)))return blocked('uber_publication_reconcile_conflict');
    if(activeCommands.some(row=>row.id!==input.captureCommandId&&['pending','processing'].includes(row.status)))return blocked('uber_publication_reconcile_active');
    const commandRows=await sql`select to_jsonb(c) as data from local_bridge_commands c where c.store_id::text=${input.storeId} and c.payload->>'sourceId'=${input.sourceId}
      and c.id in(select distinct on(head.platform) head.id from local_bridge_commands head where head.store_id::text=${input.storeId} and head.payload->>'sourceId'=${input.sourceId}
        and head.platform in ('rocket_now','demae_can') and head.command_type='publish_menu_changes' order by head.platform,head.created_at desc,head.id desc)
      order by c.created_at desc,c.id desc`;
    const commands=commandRows.map(row=>row.data as Row);
    const nodes=input.nodes??persistedNodes(state);
    if(nodes.length!==state.objects.length)return blocked('uber_publication_reconcile_identity_changed');
    for(const node of nodes)if(!(state.objects as Row[]).some(row=>row.source_key===node.sourceKey&&row.target_id===node.targetId&&row.kind===node.kind&&Boolean(row.archived)===Boolean(node.archived)))return blocked('uber_publication_reconcile_identity_changed');
    const plans:Array<{platform:Platform;old?:Row;head?:Row;payload:Row;id:string;key?:string}>=[];
    const result:UberPublicationReconcileResult={queued:0,blocked:[],jobs:[]};
    for(const platform of platforms) {
      const latest=commands.find(row=>row.platform===platform&&row.command_type==='publish_menu_changes');
      if(input.jobId&&latest?.id!==input.jobId)continue;
      if(!(state.platforms as Row[]).some(row=>row.platform_key===platform&&row.is_active===true)) {result.blocked.push({platform,code:'uber_publication_reconcile_not_configured'});continue;}
      const current=latest&&Number(latest.payload?.revision)===input.revision?latest:undefined;
      if(input.jobId&&(!current||current.status!=='failed')) {result.blocked.push({platform,code:'uber_publication_reconcile_conflict'});continue;}
      if(current&&!['failed','succeeded'].includes(current.status)) {result.blocked.push({platform,code:'uber_publication_reconcile_conflict'});continue;}
      if(current&&input.captureCommandId&&current.payload.publicationReconciliation?.captureCommandId===input.captureCommandId)continue;
      if(input.mode==='scheduled'&&current?.status==='succeeded')continue;
      const scheduledRetries=Number(current?.payload.publicationReconciliation?.scheduledRetries??0);
      if(input.mode==='scheduled'&&current&&(menuSyncIssue(String(current.last_error??''))?.kind!=='network'||scheduledRetries>=2)) {
        result.blocked.push({platform,code:scheduledRetries>=2?'uber_publication_reconcile_scheduled_limit':'uber_publication_reconcile_manual_required'});continue;
      }
      try {
        const fresh=await freshPayload(state,platform,nodes);
        const payload:Row=current?mergePayload(current.payload,fresh):fresh;
        payload.publicationReconciliation={...record(current?.payload.publicationReconciliation),
          ...(input.captureCommandId?{captureCommandId:input.captureCommandId}:{}),mode:input.mode,
          scheduledRetries:scheduledRetries+(input.mode==='scheduled'&&current?1:0)};
        if(current)payload.manualRetryHistory=[...(Array.isArray(current.payload.manualRetryHistory)?current.payload.manualRetryHistory:[]),
          {at:new Date().toISOString(),error:current.last_error,attempts:current.attempts,status:current.status,reason:input.mode==='manual'?'manual_source_verification':'scheduled_network_recovery'}];
        plans.push({platform,old:current,head:latest,payload,id:current?.id??randomUUID(),...(!current?{key:`uber-publish:${input.sourceId}:${input.revision}:${platform}`}:{})});
      } catch(error) {result.blocked.push({platform,code:error instanceof Error?error.message:'uber_publication_reconcile_conflict'});}
    }
    if(input.jobId&&!plans.length&&!result.blocked.length)return blocked('uber_publication_reconcile_conflict');
    if(!plans.length)return result;
    await sql.transaction([
      sql`select lock_menu_uber_revision(${input.sourceId},${input.revision})`,
      sql`select 1/count(*)::int from (select s.id from menu_uber_sources s where s.id::text=${input.sourceId} and s.store_id::text=${input.storeId}
        and s.brand_id::text=${String(state.brand_id)} and s.revision=${input.revision} and s.enabled=true and s.auto_publish=true
        and s.publish_config=${JSON.stringify(state.publish_config)}::jsonb and s.last_catalog=${JSON.stringify(state.last_catalog)}::jsonb
        and s.last_content_hash is not distinct from ${state.last_content_hash??null} and s.missing_keys=${state.missing_keys??[]}
        and not exists(select 1 from local_bridge_commands c where c.store_id=s.store_id and c.payload->>'sourceId'=s.id::text and c.status in ('pending','processing') and c.id::text<>${input.captureCommandId??''})
        and (${!input.captureCommandId} or exists(select 1 from local_bridge_commands c where c.id::text=${input.captureCommandId??''} and c.store_id=s.store_id
          and c.payload->>'sourceId'=s.id::text and c.platform='uber_eats' and c.command_type='capture_menu_snapshot' and c.payload->>'authoritativeSource'='true' and c.status in ('processing','succeeded')))
        for update of s) guard`,
      sql`select 1/count(*)::int from menu_uber_sources s where s.id::text=${input.sourceId}
        and coalesce((select jsonb_agg(to_jsonb(o) order by o.source_key) from menu_uber_objects o where o.source_id=s.id),'[]'::jsonb)=${JSON.stringify(state.objects)}::jsonb
        and coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from menu_catalog_items i where i.brand_id=s.brand_id and i.store_id is null),'[]'::jsonb)=${JSON.stringify(state.items)}::jsonb
        and coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from menu_option_groups g where g.brand_id=s.brand_id),'[]'::jsonb)=${JSON.stringify(state.groups)}::jsonb
        and coalesce((select jsonb_agg(to_jsonb(o) order by o.id) from menu_options o join menu_option_groups g on g.id=o.option_group_id where g.brand_id=s.brand_id),'[]'::jsonb)=${JSON.stringify(state.options)}::jsonb
        and coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from menu_categories c where c.brand_id=s.brand_id and c.store_id is null),'[]'::jsonb)=${JSON.stringify(state.categories)}::jsonb
        and coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from menu_external_platforms p where p.brand_id=s.brand_id and p.store_id is null and p.platform_key in ('rocket_now','demae_can')),'[]'::jsonb)=${JSON.stringify(state.platforms)}::jsonb
        and coalesce((select jsonb_agg(jsonb_build_object('platform',p.platform_key,'mapping',to_jsonb(m)) order by p.platform_key,m.id) from menu_platform_object_mappings m join menu_external_platforms p on p.id=m.external_platform_id where p.brand_id=s.brand_id and p.store_id is null and (m.store_id is null or m.store_id=s.store_id) and p.platform_key in ('rocket_now','demae_can')),'[]'::jsonb)=${JSON.stringify(state.mappings)}::jsonb
        and coalesce((select jsonb_agg(to_jsonb(a) order by a.platform,a.source_key) from menu_uber_creation_attempts a where a.source_id=s.id),'[]'::jsonb)=${JSON.stringify(state.receipts)}::jsonb
        and coalesce((select jsonb_agg(to_jsonb(m) order by m.platform,m.migration_key) from menu_uber_option_migrations m where m.source_id=s.id),'[]'::jsonb)=${JSON.stringify(state.migrations)}::jsonb`,
      ...plans.map(plan=>plan.old?sql`with updated as (update local_bridge_commands c set status='pending',attempts=0,available_at=now(),completed_at=null,claimed_by_device_id=null,claimed_at=null,claim_expires_at=null,
        payload=${JSON.stringify(plan.payload)}::jsonb,last_error='',updated_at=now()
        where c.id::text=${plan.id} and c.store_id::text=${input.storeId} and c.platform=${plan.platform} and c.command_type='publish_menu_changes'
          and c.status=${plan.old.status} and c.attempts=${plan.old.attempts} and c.last_error=${plan.old.last_error}
          and c.payload=${JSON.stringify(plan.old.payload)}::jsonb and coalesce(c.result,'null'::jsonb)=${JSON.stringify(plan.old.result)}::jsonb
          and not exists(select 1 from local_bridge_commands newer where newer.store_id=c.store_id and newer.payload->>'sourceId'=${input.sourceId}
            and newer.platform=c.platform and newer.command_type='publish_menu_changes' and (newer.created_at>c.created_at or (newer.created_at=c.created_at and newer.id>c.id))) returning id)
        select 1/count(*)::int from updated`:
        sql`with inserted as (insert into local_bridge_commands(id,store_id,platform,command_type,idempotency_key,payload,status)
          select ${plan.id},${input.storeId},${plan.platform},'publish_menu_changes',${plan.key!},${JSON.stringify(plan.payload)}::jsonb,'pending'
          where coalesce((select to_jsonb(head) from local_bridge_commands head where head.store_id::text=${input.storeId} and head.payload->>'sourceId'=${input.sourceId}
            and head.platform=${plan.platform} and head.command_type='publish_menu_changes' order by head.created_at desc,head.id desc limit 1),'null'::jsonb)=${JSON.stringify(plan.head??null)}::jsonb
          on conflict(idempotency_key) do nothing returning id)
          select 1/count(*)::int from inserted`)
    ],{isolationLevel:'Serializable'});
    result.queued=plans.length;result.jobs=plans.map(({id,platform})=>({id,platform}));
    return result;
  } catch(error) {
    const code=error instanceof Error&&error.message.startsWith('uber_publication_reconcile_')?error.message:'uber_publication_reconcile_conflict';
    return blocked(code);
  }
}
