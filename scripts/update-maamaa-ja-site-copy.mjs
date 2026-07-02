import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);

const sections = [
  {
    pageKey: "home",
    sectionKey: "hero",
    title: "まぁ麻",
    subtitle: "出来立て麻辣湯",
    body: "その日の気分に合わせて、具材も、辛さも、しびれも自由に。まぁ麻は、選ぶ楽しさと出来立ての香りを大切にする麻辣湯専門店です。一杯ずつ鍋を分けて仕上げる、熱々の一杯をお楽しみください。",
    tags: ["出来立て", "麻辣湯", "Web予約"]
  },
  {
    pageKey: "home",
    sectionKey: "concept",
    title: "選ぶたのしさを、出来立てで。",
    subtitle: "Brand concept",
    body: "野菜、きのこ、肉、海鮮、麺。好きな具材を選んだら、辛さとしびれを好みに合わせて。一杯ずつ鍋を分け、スープの香りと具材の食感が立つ麻辣湯に仕上げます。",
    tags: ["選ぶ楽しさ", "出来立て", "香り"]
  },
  {
    pageKey: "home",
    sectionKey: "build-a-bowl",
    title: "一杯の中に、好きなものを少しずつ。",
    subtitle: "Build a bowl",
    body: "具材を選び、辛さとしびれを整え、気分に合う一杯へ。まぁ麻の麻辣湯は、選ぶ時間からおいしさが始まります。",
    tags: ["Cook", "Select", "Balance"],
    fields: {
      cards: [
        { title: "Cook", body: "一杯ずつ鍋を分けて、スープの香りと具材の食感を引き出します。" },
        { title: "Select", body: "野菜、きのこ、肉、海鮮、麺まで。その日の気分で自由に選べます。" },
        { title: "Balance", body: "辛さ、しびれ、香りを重ねて、自分にちょうどいい一杯へ。" }
      ]
    }
  },
  {
    pageKey: "home",
    sectionKey: "shops",
    title: "今日の一杯を、好きな場所で。",
    subtitle: "Shop information",
    body: "店頭受け取り、デリバリー、テイクアウト、店内飲食。店舗ごとの受付状況に合わせて、出来立ての麻辣湯をお届けします。",
    tags: ["Web予約", "デリバリー", "テイクアウト", "店内飲食"]
  },
  {
    pageKey: "menu",
    sectionKey: "menu-hero",
    title: "好きな具材で、今日の麻辣湯を。",
    subtitle: "Web予約",
    body: "具材、麺、辛さ、痺れを選んで、自分好みの一杯をWeb予約できます。一杯ずつ鍋を分けて仕上げる、出来立ての麻辣湯をお楽しみください。",
    tags: ["Web予約", "辛さ", "痺れ", "具材"]
  },
  {
    pageKey: "footer",
    sectionKey: "footer",
    title: "まぁ麻",
    body: "選ぶ楽しさと出来立ての香りを届ける、麻辣湯専門店。"
  }
];

let total = 0;

for (const section of sections) {
  const rows = await sql`
    update brand_site_sections
    set
      title = ${section.title},
      subtitle = ${section.subtitle ?? ""},
      body = ${section.body},
      tags = ${JSON.stringify(section.tags ?? [])}::jsonb,
      fields = case
        when ${Boolean(section.fields)} then ${JSON.stringify(section.fields ?? {})}::jsonb
        else fields
      end,
      updated_at = now()
    where page_key = ${section.pageKey}
      and section_key = ${section.sectionKey}
      and brand_id in (
        select id
        from brands
        where lower(name) in ('maamaa', 'まぁ麻')
          or name ilike '%maamaa%'
          or name like '%まぁ麻%'
          or name like '%麻辣%'
      )
    returning id::text
  `;
  total += rows.length;
  console.log(`Updated ${rows.length} ${section.pageKey}/${section.sectionKey}`);
}

console.log(`Updated ${total} maamaa Japanese source section(s).`);
