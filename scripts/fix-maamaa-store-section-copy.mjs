import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);

const title = "店舗ごとの受付状況をお知らせします。";
const body = "清水店のWeb予約・デリバリー・テイクアウト受付と、準備中店舗のお知らせを案内します。";
const tags = ["清水店", "Web予約", "デリバリー", "テイクアウト"];

const titleDisplayNames = {
  en: "Shop availability and ordering options by location.",
  zh: "各店铺的受理状态与点餐方式。",
  "zh-Hant": "各店鋪的受理狀態與點餐方式。",
  ko: "매장별 접수 상황과 주문 방법을 안내합니다.",
  vi: "Thông tin nhận đơn theo từng cửa hàng.",
  ne: "प्रत्येक स्टोरको अर्डर स्थिति र तरिका यहाँ हेर्न सकिन्छ。"
};

const bodyDisplayNames = {
  en: "We share the Shimizu shop's web reservation, delivery, and takeout availability, plus updates for shops now in preparation.",
  zh: "介绍清水店的 Web 预约、外送和外带受理情况，以及筹备中店铺的最新信息。",
  "zh-Hant": "介紹清水店的 Web 預約、外送和外帶受理情況，以及籌備中店鋪的最新資訊。",
  ko: "시미즈점의 웹 예약, 배달, 테이크아웃 접수 상황과 준비 중인 매장 소식을 안내합니다.",
  vi: "Thông tin về đặt trước qua web, giao hàng, mang đi tại cửa hàng Shimizu và cập nhật về cửa hàng đang chuẩn bị.",
  ne: "Shimizu स्टोरको वेब आरक्षण, डेलिभरी, टेकआउट उपलब्धता र तयारीमा रहेका स्टोरका सूचना यहाँ दिइन्छ।"
};

const tagDisplayNames = {
  0: { en: "Shimizu shop", zh: "清水店", "zh-Hant": "清水店", ko: "시미즈점", vi: "Cửa hàng Shimizu", ne: "Shimizu स्टोर" },
  1: { en: "Web reservation", zh: "Web 预约", "zh-Hant": "Web 預約", ko: "웹 예약", vi: "Đặt trước qua web", ne: "वेब आरक्षण" },
  2: { en: "Delivery", zh: "外送", "zh-Hant": "外送", ko: "배달", vi: "Giao hàng", ne: "डेलिभरी" },
  3: { en: "Takeout", zh: "外带", "zh-Hant": "外帶", ko: "테이크아웃", vi: "Mang đi", ne: "टेकआउट" }
};

const shopRows = await sql`
  update brand_site_sections
  set
    title = ${title},
    body = ${body},
    tags = ${JSON.stringify(tags)}::jsonb,
    title_display_names = ${JSON.stringify(titleDisplayNames)}::jsonb,
    body_display_names = ${JSON.stringify(bodyDisplayNames)}::jsonb,
    tag_display_names = ${JSON.stringify(tagDisplayNames)}::jsonb,
    updated_at = now()
  where page_key = 'home'
    and section_key = 'shops'
    and brand_id in (
      select id
      from brands
      where lower(name) in ('maamaa', 'まぁ麻')
        or name ilike '%maamaa%'
        or name like '%まぁ麻%'
    )
  returning id::text, brand_id::text as "brandId", title
`;

const footerBody = "出来立て麻辣湯 for web reservation, delivery, and takeout.";
const footerBodyDisplayNames = {
  en: "Freshly made malatang for web reservation, delivery, and takeout.",
  zh: "现做麻辣烫，支持 Web 预约、外送和外带。",
  "zh-Hant": "現做麻辣燙，支持 Web 預約、外送和外帶。",
  ko: "웹 예약, 배달, 테이크아웃을 위한 갓 만든 마라탕.",
  vi: "Malatang mới nấu cho đặt trước qua web, giao hàng và mang đi.",
  ne: "वेब आरक्षण, डेलिभरी र टेकआउटका लागि ताजा मालाताङ।"
};

const footerRows = await sql`
  update brand_site_sections
  set
    body = ${footerBody},
    body_display_names = ${JSON.stringify(footerBodyDisplayNames)}::jsonb,
    updated_at = now()
  where page_key = 'footer'
    and section_key = 'footer'
    and brand_id in (
      select id
      from brands
      where lower(name) in ('maamaa', 'まぁ麻')
        or name ilike '%maamaa%'
        or name like '%まぁ麻%'
    )
  returning id::text, brand_id::text as "brandId", body
`;

console.log(`Updated ${shopRows.length} maamaa shops section(s).`);
for (const row of shopRows) {
  console.log(`${row.id} ${row.brandId} ${row.title}`);
}
console.log(`Updated ${footerRows.length} maamaa footer section(s).`);
for (const row of footerRows) {
  console.log(`${row.id} ${row.brandId} ${row.body}`);
}
