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
    body: "まぁ麻は、具材、麺、辛さ、しびれを自分好みに選べる麻辣湯専門店です。ご注文ごとに鍋を分け、スープと具材を一杯ずつ合わせて仕上げます。店舗ごとの受付状況に合わせて、店頭受け取り、店内飲食、デリバリーでお楽しみいただけます。",
    tags: ["出来立て", "麻辣湯", "Web予約"]
  },
  {
    pageKey: "home",
    sectionKey: "concept",
    title: "一杯ごとに、鍋を分けて仕上げる。",
    subtitle: "Brand concept",
    body: "ご注文ごとに鍋を分け、選んだ具材とスープを一杯ずつ合わせます。辛さ、しびれ、具材の組み合わせをその一杯に合わせて整え、香りと温度感のある麻辣湯としてお渡しします。",
    tags: ["一杯ごと", "鍋を分ける", "出来立て"]
  },
  {
    pageKey: "home",
    sectionKey: "build-a-bowl",
    title: "選べる自由と、一杯ごとの仕上げ。",
    subtitle: "Build a bowl",
    body: "野菜、きのこ、肉、海鮮、麺を組み合わせ、辛さ、しびれ、香りのバランスまで自分好みに整えられます。",
    tags: ["Cook", "Select", "Balance"],
    fields: {
      cards: [
        { title: "Cook", body: "ご注文ごとに鍋を分け、スープと具材を一杯ずつ合わせて仕上げます。" },
        { title: "Select", body: "野菜、きのこ、肉、海鮮、麺を組み合わせ、自分好みの一杯に。" },
        { title: "Balance", body: "辛さ、しびれ、香りのバランスを整え、出来立てでお渡しします。" }
      ]
    }
  },
  {
    pageKey: "home",
    sectionKey: "shops",
    title: "店舗ごとの楽しみ方を。",
    subtitle: "Shop information",
    body: "店舗ごとの営業状況に合わせて、Web予約、デリバリー、テイクアウト、店内飲食の案内をお知らせします。",
    tags: ["Web予約", "デリバリー", "テイクアウト", "店内飲食"]
  },
  {
    pageKey: "menu",
    sectionKey: "menu-hero",
    title: "一杯ずつ、鍋を分けて仕上げる麻辣湯。",
    subtitle: "Web予約",
    body: "辛さ、痺れ、麺、具材を選んで、ご注文ごとに鍋を分けて仕上げる一杯をご予約いただけます。受付時間と受け取り方法は店舗の営業状況により異なります。",
    tags: ["Web予約", "辛さ", "痺れ", "具材"]
  },
  {
    pageKey: "footer",
    sectionKey: "footer",
    title: "まぁ麻",
    body: "鍋を分けて一杯ずつ仕上げる、出来立て麻辣湯の専門店。"
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
