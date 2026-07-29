import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const shouldApply = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);

const itemPrices = new Map([
  ["きなこチーズタピオカフラッペ", 1390],
  ["エスプレッソバナナスムージー", 850],
  ["コーヒーチーズタピオカフラッペ", 1450],
  ["ザクロ酢チーズタピオカフラッペ", 1520],
  ["ホワイトいちごタピオカフラッペ", 720],
  ["マンゴーココナッツオレ🥥🥭", 850],
  ["ルイボスラテ", 460],
  ["抹茶チーズタピオカフラッペ", 2190],
  ["濃厚マンゴーチーズタピオカフラッペ", 1720],
  ["濃厚マンゴー抹茶タピオカフラッペ", 1320],
  ["濃厚黒ごまバナナスムージー", 850],
  ["瀬戸内レモンチーズタピオカフラッペ", 1450],
  ["烏龍タピオカミルクティー", 850],
  ["生チョコバナナフラッペ🫕🍌", 1650],
  ["苺チーズタピオカフラッペ", 1650],
  ["黒糖タピオカクリーミー杏仁", 720],
  ["黒糖タピオカザクロ酢ミルク💕", 790],
  ["🍉スイカ🍉タピオカフラッペ🎐", 1330],
  ["🍍パイナップルチーズタピオカフラッペ", 790],
  ["🍠焼き芋チーズタピオカフラッペ", 760],
  ["🍯蜂蜜柚子チーズタピオカフラッペ", 1450],
  ["🎃キャラメルパンプキン&ホワイトチョコタピオカフラッペ", 650],
  ["🫘あずきチーズタピオカフラッペ", 1520],
  ["🫘あずき抹茶タピオカフラッペ", 1390]
]);

const optionPrices = new Map([
  ["2d9761ed-5516-4abf-a4c5-5a68fba5e92d", ["ホイップ抜き", 0]],
  ["cd55b67a-64e7-484b-a9ae-0b5a86a3bd0b", ["タピオカ抜き", -50]],
  ["15d99c3b-6e46-4d25-9f3c-466ac1ff4e17", ["タピオカ追加", 150]],
  ["f9f67415-97a5-4c4c-974e-3f3a7cd120aa", ["濃厚国産練乳2倍", 200]],
  ["9ccf5184-d44d-44bb-acc7-415d130d13d8", ["濃厚国産練乳3倍", 300]],
  ["9860d4c0-bd04-4724-8780-8faaa1248b25", ["【鬼練乳】濃厚国産練乳5倍", 670]],
  ["da69748c-4871-4a10-ab39-455bef3046ea", ["オレオ大盛(2倍)", 270]],
  ["2d553488-7e56-4d65-9c0f-43038a106a4b", ["オレオ特盛(3倍)", 430]],
  ["1345edde-a17c-49e8-b967-c8f7cc7c155a", ["【たっぷり】オレオメガ盛(5倍)", 690]],
  ["6d05277f-a708-41b3-b185-1e16868f2e2c", ["プレミアム（濃厚さ・甘さ２倍）", 300]],
  ["0f1b6152-90ac-4f8e-831b-27c5b5144413", ["ライト（低カロリー）", 100]],
  ["726011d1-e779-4177-851e-928db686ddb2", ["ザクザクオレオ+", 270]],
  ["57fd708b-22e9-4e46-81b0-597118e8430f", ["たっぷりナタデココ", 270]],
  ["1e24bd44-c5a9-405f-88d1-bfad9e04a103", ["グラスフェッドWPIホエイプロテイン20gを追加する", 330]],
  ["edad2b26-609b-40de-af29-03ca44042b38", ["Large（700ml）", 250]],
  ["9b965bf5-ffa5-4fef-8448-1af0d82a3d9b", ["Regular（500ml）", 0]],
  ["c90802eb-4115-44a2-913a-4f86a0e5b1ec", ["クリームフォーム追加", 170]],
  ["080ae719-ce99-496a-86e6-e7ac2857edf4", ["豆乳変更", 50]],
  ["80d6784f-3ca0-4d6d-9cd1-7c3d64c8a33c", ["ココナッツミルク変更", 270]],
  ["34c014b8-d734-452e-877e-3676d9a4a8d2", ["アーモンドミルク変更", 270]],
  ["79b70228-a184-4225-ad90-f1fbe85276f3", ["ピーチ追加", 170]],
  ["faf59040-2682-490e-bd19-2f3cacfc4797", ["ゆず茶追加", 170]],
  ["f2eda5e0-c565-4001-baa9-cc42c5c3acd8", ["氷少なめ", 0]],
  ["430590df-dd33-4764-aa33-18d69c7d89b1", ["氷抜き", 0]],
  ["3dcc8446-1964-455b-8c32-cc756075f18e", ["氷標準", 0]],
  ["caeb943c-3434-4c0d-a171-6a8675d3c517", ["温かい", 210]],
  ["f39ef8dd-c716-4fd3-9f60-8d3c0f991256", ["シロップ100％（デフォルト） 100%", 0]],
  ["9adbbeec-cb79-404b-9754-8c849955e8e3", ["シロップ150% 150%", 0]],
  ["c720440b-d70a-4792-87cd-d0b60765acf6", ["シロップ50％ 50%", 0]],
  ["ca752526-9012-4f1c-8f4d-fdf6a03ec539", ["シロップ0％ 0%", 0]],
  ["f37362b9-3215-43cc-ac2d-9a965a67a537", ["粒々みかんジュレ🍊", 270]],
  ["19eda651-ec1e-47d7-8018-2a32a7fdb3df", ["極み濃厚マンゴープリン🥭", 270]],
  ["5b859e65-625e-47c4-a4b2-410cda6c0055", ["フレッシュな生苺🍓", 450]],
  ["a54f6c10-1ed4-4d1c-9ba4-ca182d3a9875", ["フレッシュな生パイナップル🍍", 330]],
  ["2d54f120-6396-4731-a289-c40f01b21cf4", ["フレッシュな生キウイ🥝", 330]],
  ["81651544-1138-4100-8237-db907e6f5e91", ["フレッシュな八朔（はっさく）", 330]],
  ["195adfa6-6e03-4845-8309-8e0aa2da457f", ["クーベルチュールホワイトチョコ", 200]],
  ["e98dbb6e-15a5-4699-bf3c-9411f4b37f2b", ["Small（360ml）", -50]],
  ["0f5c197c-ba51-4e41-8d08-57d65d68e376", ["【特選品質】特製チーズフォーム追加", 300]],
  ["280ed76f-f8ef-4d4b-8390-92c9a8233918", ["自家製珈琲ジェリー", 270]],
  ["e6a5e321-b569-48b6-a2d1-8d4c73519ce1", ["自家製珈琲ジェリー（ハーフ）", 130]],
  ["eac3b3d0-7893-4a0a-9bee-a127ff845eab", ["濃厚マンゴーシロップ", 170]],
  ["30414c50-6a47-4123-ac4a-f8f0b1fa2698", ["シロップ0％（デフォルト） 0%", 0]],
  ["eb135e38-1f09-4698-9c3a-2790cc9592c0", ["シロップ100％ 100%", 0]],
  ["f9eadb3d-b948-4b54-93c3-606532279496", ["とろ〜り濃厚国産練乳っ", 170]],
  ["b55a683e-095a-4258-a863-8fbb9191ae8a", ["苺果肉2倍", 340]],
  ["5736cbcd-22cd-4920-827f-6527be827c83", ["濃い抹茶", 460]],
  ["e8c8b7bc-6172-495f-8e2f-2842e0f2aa19", ["きな粉+", 170]],
  ["e676e1d9-cff4-4d86-baa7-6459b03299be", ["特製黒蜜追加", 170]],
  ["0e5037ca-2a8f-473c-9259-016ab671f90a", ["【約1リットル】オメガギガント", 500]]
]);

const [brand] = await sql`
  select id::text
  from brands
  where lower(name) = lower('nanacha')
    and status = 'active'
  limit 1
`;
if (!brand?.id) throw new Error("nanacha brand not found.");

const items = await sql`
  select name, base_price::float as "basePrice", is_active as "isActive"
  from menu_catalog_items
  where brand_id = ${brand.id}
    and name = any(${Array.from(itemPrices.keys())})
    and variable_schema ? 'uberEatsImport'
  order by name
`;
const itemByName = new Map(items.map((item) => [item.name, item]));
const missingItems = Array.from(itemPrices.keys()).filter((name) => !itemByName.has(name));
if (missingItems.length) throw new Error(`Missing imported items: ${missingItems.join(", ")}`);

const options = await sql`
  select
    options.external_id as "externalId",
    options.name,
    options.price_delta::float as "priceDelta"
  from menu_options options
  join menu_option_groups groups on groups.id = options.option_group_id
  where groups.brand_id = ${brand.id}
    and groups.rule_json ->> 'source' = 'uber_eats'
    and options.external_id = any(${Array.from(optionPrices.keys())})
  order by options.external_id, options.name
`;
const optionsByExternalId = Map.groupBy(options, (option) => option.externalId);
const missingOptions = Array.from(optionPrices.keys()).filter((externalId) => !optionsByExternalId.has(externalId));
if (missingOptions.length) throw new Error(`Missing imported options: ${missingOptions.join(", ")}`);

for (const [externalId, [expectedName]] of optionPrices) {
  const names = new Set(optionsByExternalId.get(externalId).map((option) => option.name));
  if (names.size !== 1 || !names.has(expectedName)) {
    throw new Error(`Option name mismatch for ${externalId}: ${Array.from(names).join(", ")}`);
  }
}

const itemUpdates = Array.from(itemPrices, ([name, basePrice]) => ({ name, base_price: basePrice }));
const optionUpdates = Array.from(optionPrices, ([externalId, [, priceDelta]]) => ({
  external_id: externalId,
  price_delta: priceDelta
}));

if (shouldApply) {
  await sql`
    update menu_catalog_items as items
    set
      base_price = updates.base_price,
      updated_at = now()
    from jsonb_to_recordset(${JSON.stringify(itemUpdates)}::jsonb) as updates(
      name text,
      base_price numeric
    )
    where items.brand_id = ${brand.id}
      and items.name = updates.name
      and items.variable_schema ? 'uberEatsImport'
  `;
  await sql`
    update menu_options as options
    set
      price_delta = updates.price_delta,
      updated_at = now()
    from
      menu_option_groups groups,
      jsonb_to_recordset(${JSON.stringify(optionUpdates)}::jsonb) as updates(
        external_id text,
        price_delta numeric
      )
    where options.option_group_id = groups.id
      and groups.brand_id = ${brand.id}
      and groups.rule_json ->> 'source' = 'uber_eats'
      and options.external_id = updates.external_id
  `;
}

const itemChanges = items.filter((item) => item.basePrice !== itemPrices.get(item.name)).length;
const optionRows = options.length;
const optionChanges = options.filter((option) => (
  option.priceDelta !== optionPrices.get(option.externalId)[1]
)).length;

console.log(JSON.stringify({
  mode: shouldApply ? "applied" : "preview",
  itemMatches: items.length,
  itemChanges,
  optionExternalIdMatches: optionsByExternalId.size,
  optionRows,
  optionChanges,
  inactiveDraftItems: items.filter((item) => !item.isActive).length
}, null, 2));
