import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';
import { loadLocalEnv } from './db-env.mjs';
import { resolveLinkedTargetKeys } from '../lib/menu-availability-link-graph.ts';

// Reviewed active catalog IDs. Never infer identity by stripping noodle names.
const families = [
  ['火锅粉极宽', '2f12df61-b47a-41a1-b8c4-7bc9cbb8549e', '59aab522-9a04-46e4-9ed9-f365f7f687b3'],
  ['火锅粉细', 'e05303bc-e483-442b-8298-286c4bad3ecd', '3dcaae25-2210-4198-a3c9-5e7dbc2584b8'],
  ['粉丝', '4ca0c580-c770-4952-a3d9-fceaea579b43', '45e9618e-d408-45b8-8348-3feccf77ada5', '26f59d05-3b21-43e1-b8f8-5d0107b61a6b'],
  ['米粉', '62133fe3-1830-4585-966f-80abc938bb5d', '99f21a1e-67b6-4178-8491-fbf23a205169', 'ddd12292-af82-43ad-9122-96be699f6607'],
  ['玉米面', 'b9ba6fdd-59a5-44dc-970d-aa4e83106344', 'b5c50160-cb7c-499a-bd1d-d818adf12d3f', '4f781248-44c3-4ebc-b322-a30a642b520c'],
  ['虾子蛋面', 'a4434c1f-0026-45c7-b2eb-ca80aced7580', 'deaad547-2728-416e-9979-e328b1f6499d'],
  ['红薯粉', '43447412-5f8b-4cc4-909e-4adbd4236990', 'a88f6d62-4bd6-4199-a1d8-d11a13cb2012', '430962e2-26dc-41ec-b687-d244b7560d00'],
  ['宽粉', 'ff276e57-8b2c-4282-b6c6-819c2bbee914', 'e0b18160-cdb3-4246-9492-559b4cb8d0e4', '6ebc3a3b-31de-4b30-a4a9-805daeaac6d1'],
  ['牛筋面', '372b6c2e-37dd-43d2-b1c3-311826e17f6a', 'a468a3e0-4466-45f6-871b-8db3cfe5cb59', '7c0178af-5884-45f8-97f2-d8e09a9c8f6e'],
  ['韩式年糕', '67c214b6-7c50-4c3c-93f0-693d076ba80f', '85c12090-8992-4f9f-bc6b-c7ca783ab1a5'],
  ['黄豆芽', '51295bd3-b7f0-4090-bb31-c320b525786c', '0792cca1-e59b-40bb-a912-f948837f1be7'],
  ['圆形山药粉皮', 'beac600b-72f1-4e90-98ba-5ca74855efe1', '9cc27018-3f94-4cdf-af25-97c5b5727a88'],
  ['山药粉', 'ef81765c-d5a7-495b-8b80-1e5fc42d0b9d', '8a1e1ffe-945f-4b2e-b073-bced8183149c', '62e18c4b-058c-406b-a68c-15fa48c5cd41'],
  ['宽乌冬', '1410c7c7-62bc-451b-997f-0146bdd1e3f4', '8b033b2c-0222-43ad-b34e-f4c010bc7fda', 'eb5cf3d1-c4e0-49ed-8ce2-f1a5fa4e4696'],
  ['刀削面', '043966e9-5ae6-44a3-bf7e-b2712c61bc88', '6af801e9-e947-4c5d-8837-75280fff40ac', 'dd7e1806-3933-4ee5-93b5-cbcc499d9a88'],
  ['红薯宽粉', '8adad25d-6c5d-4866-ab59-57d25ee7b9a1', '2c580681-466a-45f0-a0e0-b094e5e154eb', '00e331db-1f16-48db-81bd-e53a4af29be8'],
  ['肥羊粉', '819a0053-a587-4e0c-aaa8-29db3da392a5', '4fee1a47-647a-43f1-a6d8-dd5eeab3d09e']
];
loadLocalEnv();
const sql = neon(process.env.DATABASE_URL);
const brand = '30d5d8b7-a65d-4190-8016-f796bb54219e';
const groups = ['noodles', 'noodle-replacement', 'cold-noodles'];
const ids = families.flatMap(([, ...members]) => members);
assert.equal(new Set(ids).size, 44);
const rows = await sql`select o.id::text, o.name, g.group_key from menu_options o
 join menu_option_groups g on g.id=o.option_group_id
 where g.brand_id=${brand}::uuid and g.group_key=any(${groups}) and o.is_active and g.is_active`;
assert.deepEqual(rows.map(r=>r.id).sort(), [...ids].sort(), 'Catalog changed; review before applying');
for (const [label, ...members] of families) {
  members.forEach((id,i)=>assert.equal(rows.find(r=>r.id===id)?.group_key, groups[i]));
  console.log(label, members.map(id=>rows.find(r=>r.id===id).name).join(' ↔ '));
}
const planned = families.flatMap(([, sourceId, ...members])=>members.map(dependentId=>({
  sourceKind:'option',sourceId,dependentKind:'option',dependentId,isBidirectional:true
})));
const readLinks = ()=>sql`select source_kind as "sourceKind",source_id::text as "sourceId",
 dependent_kind as "dependentKind",dependent_id::text as "dependentId",is_bidirectional as "isBidirectional"
 from menu_availability_links where brand_id=${brand}::uuid`;
function verify(links) {
  for (const [, ...members] of families) for (const id of members) {
    assert.deepEqual(resolveLinkedTargetKeys(links,[`option:${id}`]).sort(),
      members.filter(other=>other!==id).map(other=>`option:${other}`).sort(), 'Unexpected cross-family link');
  }
}
verify([...await readLinks(), ...planned]);
const snapshot = ()=>sql`select
 (select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.store_id,s.menu_option_id)::text,''))
  from menu_option_store_settings s where s.menu_option_id::text=any(${ids})) as settings,
 (select md5(coalesce(jsonb_agg(to_jsonb(b) order by b.store_id,b.target_id,b.inventory_key)::text,''))
  from menu_inventory_availability_blocks b where b.target_kind='option' and b.target_id::text=any(${ids})) as blocks`;
const before = await snapshot();
if (process.argv.includes('--apply')) {
  await sql`insert into menu_availability_links (brand_id,source_kind,source_id,dependent_kind,dependent_id,is_bidirectional)
   select ${brand}::uuid,'option',p."sourceId"::uuid,'option',p."dependentId"::uuid,true
   from jsonb_to_recordset(${JSON.stringify(planned)}::jsonb) as p("sourceId" text,"dependentId" text)
   on conflict (source_kind,source_id,dependent_kind,dependent_id) do update set is_bidirectional=true,updated_at=now()`;
  verify(await readLinks());
  assert.deepEqual(await snapshot(),before,'Sales state changed during configuration; investigate');
  console.log('Saved and verified: 17 families, 44 options, 27 bidirectional links. Sales states unchanged.');
} else console.log('Preview verified. Pass --apply to save links only.');
