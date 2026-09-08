import { requireMasterOsSession } from '../../../../lib/api-auth';
import { sql } from '../../../../lib/db';
import { scheduleUberSourceScans } from '../../../../lib/uber-menu-source-sync';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!await requireMasterOsSession()) return Response.json({error:'権限がありません。'},{status:403});
  const brandId = new URL(request.url).searchParams.get('brandId') ?? '';
  const sources = await sql`select id::text,brand_id::text,store_id::text,uber_store_uuid,enabled,auto_publish,revision,last_checked_at,last_error from menu_uber_sources where brand_id::text=${brandId}`;
  const runs = sources.length ? await sql`select revision,summary,created_at from menu_uber_sync_runs where source_id=${sources[0].id} order by created_at desc limit 20` : [];
  const jobs = sources.length ? await sql`select distinct on(platform) platform,status,updated_at,last_error,payload->>'revision' as revision from local_bridge_commands where store_id=${sources[0].store_id} and payload->>'sourceId'=${sources[0].id}::text and payload->>'authoritativePublication'='true' order by platform,created_at desc` : [];
  const prices = sources.length ? await sql`select o.target_id::text as id,o.kind,o.price_mode as mode,o.last_uber_price::float as "uberPrice",coalesce(i.name,p.name) as name,case when o.kind='item' then i.base_price else p.price_delta end::float as price from menu_uber_objects o left join menu_catalog_items i on o.kind='item' and i.id=o.target_id left join menu_options p on o.kind='option' and p.id=o.target_id where o.source_id=${sources[0].id} and o.kind in ('item','option') and not o.archived order by o.kind,name` : [];
  return Response.json({source:sources[0]??null,runs,jobs,prices},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request: Request) {
  if (!await requireMasterOsSession()) return Response.json({error:'権限がありません。'},{status:403});
  const body = await request.json().catch(()=>({}));
  const sources = await sql`select id::text,store_id::text,revision from menu_uber_sources where brand_id::text=${String(body.brandId??'')} and enabled=true`;
  if (!sources.length) return Response.json({error:'Uber メニュー連携はまだ有効になっていません。'},{status:409});
  if(body.action==='scan') return Response.json(await scheduleUberSourceScans(sources[0].store_id));
  if(body.action==='price') {
    const price=Number(body.price);
    if(!['manual','automatic'].includes(body.mode) || (body.mode==='manual' && (body.price===null||body.price===undefined||String(body.price).trim()===''||!Number.isSafeInteger(price)||price<0))) return Response.json({error:'価格を確認してください。'},{status:400});
    const rows=await sql`select kind,target_id::text,last_uber_price::float from menu_uber_objects where source_id=${sources[0].id} and target_id::text=${String(body.targetId)} and kind in ('item','option') and not archived`;
    if(rows.length!==1) return Response.json({error:'商品が見つかりません。'},{status:404});
    const value=body.mode==='manual'?price:Math.round(Number(rows[0].last_uber_price)*0.8/10)*10;
    if(rows[0].last_uber_price===null || !Number.isSafeInteger(value) || value<0) return Response.json({error:'Uber の確定価格がありません。'},{status:409});
    await sql.transaction([
      sql`select lock_menu_uber_revision(${sources[0].id},${sources[0].revision})`,
      sql`update menu_uber_objects set price_mode=${body.mode},updated_at=now() where source_id=${sources[0].id} and target_id::text=${String(body.targetId)}`,
      rows[0].kind==='item' ? sql`update menu_catalog_items set base_price=${value},updated_at=now() where id=${rows[0].target_id}` : sql`update menu_options set price_delta=${value},updated_at=now() where id=${rows[0].target_id}`,
      sql`update menu_uber_sources set revision=revision+1,updated_at=now() where id=${sources[0].id}`
    ]);
    await scheduleUberSourceScans(sources[0].store_id);
    return Response.json({ok:true,price:value,mode:body.mode});
  }
  return Response.json({error:'操作が不正です。'},{status:400});
}
