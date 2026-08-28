import { writeFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = neon(databaseUrl);
const sourceNames = [
  "にゃんこ麻辣湯 品味居 中華料理",
  "楊国福マーラータン 福岡天神店 Yangguofumalatang"
];

const sources = await sql`
  select id::text, competitor_name as "competitorName"
  from competitor_menu_sources
  where competitor_name = any(${sourceNames})
  order by competitor_name
`;

const repairs = [];
for (const source of sources) {
  const runs = await sql`
    select id::text, started_at as "startedAt", completed_at as "completedAt",
      item_count as "itemCount", new_item_count as "newItemCount", change_count as "changeCount"
    from competitor_menu_scan_runs
    where source_id = ${source.id} and status = 'succeeded' and item_count > 0
      and new_item_count = item_count and change_count >= item_count * 2
    order by started_at
  `;
  const duplicates = await sql`
    select legacy.id::text as "legacyId", current.id::text as "currentId",
      legacy.external_key as "legacyKey", current.external_key as "currentKey", current.name
    from competitor_menu_items legacy
    join competitor_menu_items current on current.source_id = legacy.source_id
      and current.external_key = concat('id:', legacy.external_key)
    where legacy.source_id = ${source.id} and legacy.external_key not like 'id:%'
    order by current.name
  `;
  repairs.push({ source, runs, duplicates });
}

const summary = repairs.map(({ source, runs, duplicates }) => ({
  source: source.competitorName,
  badRuns: runs.length,
  duplicateProducts: duplicates.length,
  runIds: runs.map((run) => run.id)
}));

if (!apply) {
  console.log(JSON.stringify({ mode: "dry-run", summary }, null, 2));
  process.exit(0);
}

if (repairs.some(({ runs, duplicates }) => runs.length !== 1 || duplicates.length === 0)) {
  throw new Error(`Repair scope is not the expected one: ${JSON.stringify(summary)}`);
}

const backup = { createdAt: new Date().toISOString(), repairs: [] };
for (const repair of repairs) {
  const run = repair.runs[0];
  const [changes, notifications, legacyItems] = await Promise.all([
    sql`
      select * from competitor_menu_changes
      where source_id = ${repair.source.id} and detected_at >= ${run.startedAt}
        and detected_at <= ${run.completedAt} and change_type in ('new_product', 'removed')
      order by detected_at
    `,
    sql`
      select * from os_notifications
      where notification_type = 'competitor_new_product'
        and source_key like ${`competitor-new-product:${repair.source.id}:%`}
        and created_at >= ${run.startedAt} and created_at <= (${run.completedAt}::timestamptz + interval '1 minute')
    `,
    sql`
      select * from competitor_menu_items
      where id = any(${repair.duplicates.map((row) => row.legacyId)}::uuid[])
      order by name
    `
  ]);
  backup.repairs.push({ source: repair.source, run, changes, notifications, legacyItems });
}

const backupPath = `/private/tmp/foundr1-competitor-prefix-repair-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await writeFile(backupPath, JSON.stringify(backup, null, 2));

const results = [];
for (const repair of repairs) {
  const run = repair.runs[0];
  const [deletedChanges, deletedNotifications, deletedItems, updatedRun] = await sql.transaction([
    sql`
      delete from competitor_menu_changes
      where source_id = ${repair.source.id} and detected_at >= ${run.startedAt}
        and detected_at <= ${run.completedAt} and change_type in ('new_product', 'removed')
      returning id::text
    `,
    sql`
      delete from os_notifications
      where notification_type = 'competitor_new_product'
        and source_key like ${`competitor-new-product:${repair.source.id}:%`}
        and created_at >= ${run.startedAt} and created_at <= (${run.completedAt}::timestamptz + interval '1 minute')
      returning id::text
    `,
    sql`
      delete from competitor_menu_items
      where id = any(${repair.duplicates.map((row) => row.legacyId)}::uuid[])
      returning id::text
    `,
    sql`
      update competitor_menu_scan_runs
      set new_item_count = 0,
        change_count = (
          select count(*)::int from competitor_menu_changes
          where source_id = ${repair.source.id} and detected_at >= ${run.startedAt} and detected_at <= ${run.completedAt}
        )
      where id = ${run.id}
      returning id::text, new_item_count as "newItemCount", change_count as "changeCount"
    `
  ]);
  results.push({
    source: repair.source.competitorName,
    deletedChanges: deletedChanges.length,
    deletedNotifications: deletedNotifications.length,
    deletedDuplicateProducts: deletedItems.length,
    correctedRun: updatedRun[0]
  });
}

console.log(JSON.stringify({ mode: "applied", backupPath, results }, null, 2));
