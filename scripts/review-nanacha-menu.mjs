import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const draft = JSON.parse(fs.readFileSync(path.join(root, 'scripts/data/nanacha-menu-review-20260912.json'), 'utf8'));
const schemaChanges = [
  "alter table menu_categories add column if not exists display_names jsonb not null default '{}'::jsonb",
  "alter table menu_categories add column if not exists note_display_names jsonb not null default '{}'::jsonb",
  "alter table menu_categories add column if not exists product_type text not null default 'other' check (product_type in ('drink', 'food', 'other'))"
];
const tables = { categories: 'menu_categories', items: 'menu_catalog_items', groups: 'menu_option_groups', options: 'menu_options' };
const allowedFields = new Set(['name', 'external_id', 'product_type', 'display_names', 'note_display_names', 'category', 'variable_schema', 'description', 'description_display_names', 'promotion_prefix_display_names']);
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const printable = value => typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);

if (!process.argv.includes('--apply')) {
  const output = path.resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || '/private/tmp/nanacha-menu-review.html');
  const rows = draft.changes.flatMap(change => Object.entries(change.after).flatMap(([field, after]) => {
    const before = change.before[field];
    if (field.endsWith('_names')) return Object.entries(after).filter(([language, value]) => value !== before?.[language]).map(([language, value]) => ({ label: change.label, field: `${field} / ${language}`, before: before?.[language] || '', after: value }));
    return [{ label: change.label, field, before: printable(before), after: printable(after) }];
  }));
  fs.writeFileSync(output, `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>nanacha 菜单修正预览</title><style>body{font:15px/1.65 system-ui;margin:32px;color:#192b23}h1{font-size:26px}input{padding:12px;width:min(600px,90%);margin:12px 0}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #dde4df;padding:10px;text-align:left;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#edf4ef}td:first-child{width:23%}small{display:block;color:#65776b}@media(max-width:700px){body{margin:12px}td,th{font-size:12px;padding:6px}}</style><h1>nanacha 菜单修正预览</h1><p>待确认草稿：${draft.changes.length} 条主数据记录。食品使用通用 food 分类。未设置价格的 5 款食品保持原价为空，网站显示准备中。价格、营业状态与选项规则不变。</p><input id="search" placeholder="搜索商品、字段、语言或内容"><table><thead><tr><th>商品 / 字段</th><th>修改前</th><th>修改后</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escape(r.label)}<small>${escape(r.field)}</small></td><td>${escape(r.before)}</td><td>${escape(r.after)}</td></tr>`).join('')}</tbody></table><script>document.querySelector('#search').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q))})</script></html>`);
  console.log(`Preview: ${output}; ${rows.length} changed fields. No database writes.`);
  process.exit(0);
}

// --apply is only for a manually reviewed and explicitly approved draft.
const expectedHost = process.argv.find(arg => arg.startsWith('--database-host='))?.slice(16);
if (!process.env.DATABASE_URL && fs.existsSync(path.join(root, '.env.local'))) process.loadEnvFile(path.join(root, '.env.local'));
if (!process.env.DATABASE_URL || !expectedHost || new URL(process.env.DATABASE_URL).hostname !== expectedHost) throw new Error('Provide --database-host=<verified host> for the approved database.');
const sql = neon(process.env.DATABASE_URL);
const brand = await sql`select id::text from brands where id = ${draft.brandId} and lower(name) = 'nanacha'`;
if (brand.length !== 1) throw new Error('nanacha brand does not match the draft.');
const queries = schemaChanges.map(query => sql.query(query, []));
for (const change of draft.changes) {
  const table = tables[change.type];
  const fields = Object.keys(change.after);
  if (!table || !fields.length || fields.some(field => !allowedFields.has(field))) throw new Error('Unexpected draft field.');
  const params = [change.id, draft.brandId];
  const bound = value => { params.push(typeof value === 'object' ? JSON.stringify(value) : value); return `$${params.length}${typeof value === 'object' ? '::jsonb' : ''}`; };
  const updates = fields.map(field => `${field} = ${bound(change.after[field])}`);
  const checks = fields.map(field => `${field} is not distinct from ${bound(change.before[field])}`);
  const brandScope = change.type === 'options' ? 'option_group_id in (select id from menu_option_groups where brand_id = $2::uuid)' : 'brand_id = $2::uuid';
  queries.push(sql.query(`with changed as (update ${table} set ${updates.join(', ')}, updated_at = now() where id = $1::uuid and ${brandScope} and ${checks.join(' and ')} returning id) select 1 / count(*)::int as applied from changed`, params));
}
// An outdated source row causes division by zero and rolls back the entire transaction.
await sql.transaction(queries);
console.log(`Applied ${draft.changes.length} reviewed nanacha records atomically.`);
