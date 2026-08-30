import { neon } from "@neondatabase/serverless";

import { loadLocalEnv } from "./db-env.mjs";

function record(value) {
  return value && typeof value === "object" ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function optionTitle(label) {
  return String(label).replace(/（(?:\+¥[\d,]+|無料)）$/, "").normalize("NFKC").trim().toLocaleLowerCase("ja-JP");
}

function summary(details) {
  const parts = [
    details.added.length ? `選択肢追加：${details.added.join("、")}` : "",
    details.returned.length ? `選択肢が再表示：${details.returned.join("、")}` : "",
    details.hidden.length ? `選択肢がメニューから非表示：${details.hidden.join("、")}` : "",
    details.availabilityChanged.length ? `選択肢の販売状態変更：${details.availabilityChanged.join("、")}` : "",
    details.priceChanged.length ? `選択価格変更：${details.priceChanged.join("、")}` : "",
    details.ruleChanged.length ? `選択ルール変更：${details.ruleChanged.join("、")}` : ""
  ].filter(Boolean);
  const affected = list(details.affectedProducts);
  return `${parts.join("。")}。${affected.length > 1 ? ` ${affected.length}商品で共通する1件の変更として記録しました。` : ""}`;
}

loadLocalEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  select id::text, source_id::text as "sourceId", title, summary,
    current_value as "currentValue", detected_at::text as "detectedAt"
  from competitor_menu_changes
  where change_type = 'options_changed'
  order by source_id, detected_at, id
`;

const seenBySourceAndProduct = new Map();
let repaired = 0;
for (const row of rows) {
  const currentValue = record(row.currentValue);
  const details = record(currentValue.optionChangeDetails);
  if (!Object.keys(details).length) continue;
  const products = list(details.affectedProducts).length ? list(details.affectedProducts) : [String(row.title)];
  const productSets = products.map((product) => {
    const key = `${row.sourceId}:${product.normalize("NFKC").trim().toLocaleLowerCase("ja-JP")}`;
    const known = seenBySourceAndProduct.get(key) ?? new Set();
    seenBySourceAndProduct.set(key, known);
    return known;
  });
  const added = list(details.added);
  const returned = list(details.returned);
  const stillAdded = [];
  for (const label of added) {
    const title = optionTitle(label);
    if (productSets.some((known) => known.has(title))) returned.push(label);
    else stillAdded.push(label);
  }
  const nextDetails = {
    ...details,
    kind: returned.length && !stillAdded.length && !list(details.hidden).length
      && !list(details.availabilityChanged).length && !list(details.priceChanged).length && !list(details.ruleChanged).length
      ? "returned"
      : details.kind,
    priority: returned.length && !stillAdded.length && !list(details.hidden).length
      && !list(details.availabilityChanged).length && !list(details.priceChanged).length && !list(details.ruleChanged).length
      ? "low"
      : details.priority,
    added: stillAdded,
    returned,
    hidden: list(details.hidden),
    availabilityChanged: list(details.availabilityChanged),
    priceChanged: list(details.priceChanged),
    ruleChanged: list(details.ruleChanged)
  };
  if (returned.length !== list(details.returned).length) {
    await sql`
      update competitor_menu_changes
      set summary = ${summary(nextDetails)},
        current_value = jsonb_set(current_value, '{optionChangeDetails}', ${JSON.stringify(nextDetails)}::jsonb, true)
      where id::text = ${String(row.id)}
    `;
    repaired += 1;
  }
  for (const label of [...nextDetails.added, ...nextDetails.returned, ...nextDetails.hidden]) {
    const title = optionTitle(label);
    for (const known of productSets) known.add(title);
  }
}

console.log(JSON.stringify({ repaired }));
