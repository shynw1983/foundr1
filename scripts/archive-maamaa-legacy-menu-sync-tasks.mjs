import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const sql = neon(process.env.DATABASE_URL);
const apply = process.argv.includes("--apply");
const archiveNote = "Bridge 新流程導入により旧手動反映待ちを履歴へ移行";

const legacyTasks = await sql`
  select
    tasks.id::text,
    platforms.platform_key as "platformKey",
    tasks.target_label as "targetLabel",
    tasks.created_at::text as "createdAt"
  from menu_change_sync_tasks tasks
  join brands on brands.id = tasks.brand_id
  join menu_external_platforms platforms on platforms.id = tasks.external_platform_id
  where brands.name = 'まぁ麻'
    and tasks.store_id is null
    and tasks.status = 'pending'
    and tasks.command_id is null
    and tasks.publish_batch_id is null
    and tasks.created_at < '2026-08-01T00:00:00+09:00'::timestamptz
  order by platforms.platform_key, tasks.created_at, tasks.target_label
`;

const counts = new Map();
for (const task of legacyTasks) {
  const platformKey = String(task.platformKey);
  counts.set(platformKey, (counts.get(platformKey) ?? 0) + 1);
}

console.log(`${apply ? "Archiving" : "Would archive"} ${legacyTasks.length} legacy menu sync tasks.`);
for (const [platformKey, count] of [...counts.entries()].sort()) {
  console.log(`- ${platformKey}: ${count}`);
}

if (apply && legacyTasks.length) {
  const ids = legacyTasks.map((task) => String(task.id));
  const archived = await sql`
    update menu_change_sync_tasks
    set
      status = 'completed',
      phase = 'archived',
      completion_note = ${archiveNote},
      completed_at = now(),
      updated_at = now()
    where id = any(${ids}::uuid[])
      and status = 'pending'
      and command_id is null
      and publish_batch_id is null
    returning id::text
  `;
  console.log(`Archived ${archived.length} legacy menu sync tasks.`);
}
