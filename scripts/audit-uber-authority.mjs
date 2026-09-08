import { neon } from '@neondatabase/serverless';
import { loadLocalEnv } from './db-env.mjs';
loadLocalEnv();
const sql = neon(process.env.DATABASE_URL);
console.log(JSON.stringify(await sql`
 select p.brand_id::text, b.name, p.platform_key, p.management_url,
   (select count(*)::int from menu_platform_object_mappings m where m.external_platform_id=p.id) as mappings,
   (select count(*)::int from menu_catalog_items i where i.brand_id=p.brand_id and i.is_active) as items,
   (select jsonb_agg(jsonb_build_object('kind',q.target_type,'count',q.n)) from
    (select target_type,count(*)::int n from menu_platform_object_mappings m where m.external_platform_id=p.id group by target_type) q) as mapping_types
 from menu_external_platforms p join brands b on b.id=p.brand_id
 where p.store_id is null and p.is_active and p.platform_key in ('uber_eats','rocket_now','demae_can')
`,null,2));
