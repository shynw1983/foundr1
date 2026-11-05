import { requireOsSession } from '../../../../../lib/api-auth';
import { roleHasPermission } from '../../../../../lib/role-permissions';
import { getStoreOrderAccess } from '../../../../../lib/store-order-access';
import { sql } from '../../../../../lib/db';
import { readPosMenuConfig, posMenuGuard, posMenuLock } from '../../../../../lib/pos-menu-settings';
import { parsePosMenuChange, posSetting } from '../../../../../lib/pos-menu-policy';
export const dynamic = 'force-dynamic';
function fail(message:string,status=409):never {throw Object.assign(new Error(message),{status});}
function responseError(e:unknown){
  const error=e as {status?:number;code?:string;message?:string};
  if(error.code==='22012')return Response.json({error:'設定が変更されました。再読込して確認してください。'},{status:409});
  if(error.code==='42P01')return Response.json({error:'店内メニューのデータベース更新が必要です。'},{status:503});
  if(!error.status)console.error('POS menu settings',e);
  return Response.json({error:error.status?error.message:'店内メニューの処理に失敗しました。'},{status:error.status||500});
}
async function access(storeId:string,brandId:string){
  const session=await requireOsSession();if(!session)fail('ログインしてください。',401);
  if(!await roleHasPermission(session.role,'menus.edit'))fail('権限がありません。',403);
  const scope=await getStoreOrderAccess(session);
  if(!scope.stores.some(s=>s.id===storeId))fail('権限がありません。',403);
  const brand=await sql`select 1 from store_brands sb join brands b on b.id=sb.brand_id where sb.store_id::text=${storeId} and sb.brand_id::text=${brandId} and b.status='active'`;
  if(!brand.length)fail('この店舗のブランドを選択してください。',403);
  return session;
}
export async function GET(request:Request){
  try{
    const p=new URL(request.url).searchParams,storeId=p.get('storeId')||'',brandId=p.get('brandId')||'';
    await access(storeId,brandId);
    const config=await readPosMenuConfig(storeId);if(!config.ready)fail('店内メニューのデータベース更新が必要です。',503);
    const targets=await sql`
      select 'item' as kind,i.id::text as id,i.name,coalesce(i.category,'未分類') as category,'' as "parentId",
        i.base_price::float as "brandPrice",coalesce(s.pos_enabled,true) as "legacyVisible",0 as minimum
      from menu_catalog_items i left join menu_store_settings s on s.menu_catalog_item_id=i.id and s.store_id::text=${storeId}
      where i.brand_id::text=${brandId} and i.store_id is null and i.is_active
      union all
      select 'group',g.id::text,g.name,'選択肢グループ','',null,true,coalesce((g.rule_json->>'minSelections')::int,0)
      from menu_option_groups g where g.brand_id::text=${brandId} and g.is_active
      union all
      select 'option',o.id::text,o.name,g.name,g.id::text,o.price_delta::float,true,0
      from menu_options o join menu_option_groups g on g.id=o.option_group_id
      where g.brand_id::text=${brandId} and g.is_active and o.is_active
      order by kind,category,name`;
    return Response.json({revision:config.revision,targets:targets.map(t=>({...t,setting:posSetting(config.settings,t.kind as 'item'|'group'|'option',String(t.id))||null}))},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return responseError(e);}
}
export async function POST(request:Request){
  try{
    if(request.headers.get('origin')!==new URL(request.url).origin)fail('アクセス元を確認できません。',403);
    const b=await request.json(),storeId=String(b.storeId||''),brandId=String(b.brandId||'');
    const session=await access(storeId,brandId);
    let change;try{change=parsePosMenuChange(b);}catch(e){fail((e as Error).message,400);}
    if(!/^[0-9a-f]{32}$/.test(String(b.revision)))fail('再読込して設定を確認してください。');
    const config=await readPosMenuConfig(storeId);if(!config.ready)fail('店内メニューのデータベース更新が必要です。',503);
    const {kind,targetId,visible,price}=change;
    // Parent and child targets remain stable IDs from the brand master; never copy menu text or alter availability.
    const target=kind==='item'
      ? await sql`select id from menu_catalog_items where id::text=${targetId} and brand_id::text=${brandId} and store_id is null and is_active`
      : kind==='group' ? await sql`select id from menu_option_groups where id::text=${targetId} and brand_id::text=${brandId} and is_active`
      : await sql`select o.id from menu_options o join menu_option_groups g on g.id=o.option_group_id where o.id::text=${targetId} and g.brand_id::text=${brandId} and o.is_active and g.is_active`;
    if(!target.length)fail('対象のメニューが見つかりません。',404);
    if(kind!=='item'){
      const affected=kind==='group'?targetId:String((await sql`select option_group_id::text as id from menu_options where id::text=${targetId}`)[0].id);
      const required=await sql`select coalesce((rule_json->>'minSelections')::int,0) as minimum from menu_option_groups where id::text=${affected}`;
      const nextSettings=[...config.settings.filter(s=>!(s.kind===kind&&s.targetId===targetId)),change];
      if(Number(required[0]?.minimum)>0&&posSetting(nextSettings,'group',affected)?.visible!==false){
        const children=await sql`select id::text from menu_options where option_group_id::text=${affected} and is_active`;
        if(!children.some(o=>posSetting(nextSettings,'option',String(o.id))?.visible!==false))fail('必須グループの選択肢をすべて非公開にはできません。グループ全体を非公開にするか、選択肢を残してください。');
      }
    }
    const itemId=kind==='item'?targetId:null,groupId=kind==='group'?targetId:null,optionId=kind==='option'?targetId:null;
    // One store lock also serializes configuration against POS order persistence.
    const update=sql`insert into menu_pos_settings(store_id,brand_id,item_id,group_id,option_id,visible,price_override,updated_by)
      values(${storeId}::uuid,${brandId}::uuid,${itemId}::uuid,${groupId}::uuid,${optionId}::uuid,${visible},${price},${session.id}::uuid)`;
    const existing=await sql`select id from menu_pos_settings where store_id::text=${storeId}
      and (item_id::text=${itemId||''} or group_id::text=${groupId||''} or option_id::text=${optionId||''})`;
    const write=existing.length ? sql`update menu_pos_settings set visible=${visible},price_override=${price},revision=revision+1,updated_by=${session.id}::uuid,updated_at=now()
      where store_id::text=${storeId} and id=${existing[0].id}::uuid` : update;
    await sql.transaction([posMenuLock(storeId),posMenuGuard(storeId,String(b.revision)),write]);
    return Response.json({ok:true,revision:(await readPosMenuConfig(storeId)).revision});
  }catch(e){return responseError(e);}
}
