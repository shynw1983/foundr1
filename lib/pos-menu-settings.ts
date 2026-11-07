import { sql } from './db';
import { counterMenuStateSql, posCounterMenuPolicyRevision } from './pos-counter-menu-data';
import { applyPosItems, applyPosOptions, posSetting, type PosMenuSetting } from './pos-menu-policy';
export type PosMenuConfig = {ready: boolean; revision: string; settings: PosMenuSetting[]};
export async function readPosMenuConfig(storeId: string): Promise<PosMenuConfig> {
  try {
    const rows = await sql`select
      coalesce(jsonb_agg(jsonb_build_object('kind',case when item_id is not null then 'item' when group_id is not null then 'group' else 'option' end,
        'targetId',coalesce(item_id,group_id,option_id)::text,'visible',visible,'price',price_override) order by id),'[]'::jsonb) as settings,
      md5(coalesce(string_agg(id::text||':'||revision::text,',' order by id),'')) as revision
      from menu_pos_settings where store_id::text=${storeId}`;
    return {ready:true,revision:String(rows[0].revision),settings:rows[0].settings as PosMenuSetting[]};
  } catch(e) {
    if ((e as {code?:string}).code === '42P01') return {ready:false,revision:'',settings:[]};
    throw e;
  }
}
/** Same version as readPosMenuConfig, without aggregating settings JSON. */
export async function readPosMenuRevision(storeId: string): Promise<Pick<PosMenuConfig, 'ready' | 'revision'> & { counterMenuPolicyRevision: string }> {
  try {
    const rows = await sql.query(`select
      (select md5(coalesce(string_agg(id::text||':'||revision::text,',' order by id),'')) from menu_pos_settings where store_id::text=$1) as revision,
      (select ${counterMenuStateSql} from pos_store_settings p where p.store_id::text=$1) as "counterMenuState"`, [storeId]);
    return { ready: true, revision: String(rows[0].revision), counterMenuPolicyRevision: posCounterMenuPolicyRevision(rows[0].counterMenuState) };
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return { ready: false, revision: '', counterMenuPolicyRevision: '' };
    throw error;
  }
}
export function posMenuLock(storeId: string) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${`pos-menu:${storeId}`},0))`;
}
export function posMenuGuard(storeId: string, revision: string) {
  return sql`select 1 / case when md5(coalesce((select string_agg(id::text||':'||revision::text,',' order by id)
    from menu_pos_settings where store_id::text=${storeId}),''))=${revision} then 1 else 0 end as pos_menu_current`;
}
export function applyPosMenu<T extends {id:string;basePrice?:number|null;priceOverride?:number|null;price?:number}, G extends {id:string;options:Array<{id:string;priceDelta:number|null}>}>(items:T[],groups:G[],config:PosMenuConfig){
  return {items:applyPosItems(items,config.settings),optionGroups:groups.filter(g=>posSetting(config.settings,'group',g.id)?.visible!==false).map(g=>({...g,
    posEnabled:posSetting(config.settings,'group',g.id)?.visible===true,
    options:applyPosOptions(g.options.map(o=>({...o,groupId:g.id})),config.settings)})),posMenuRevision:config.revision};
}
