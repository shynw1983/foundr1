import { sql } from "./db";

export type BusinessCalendarEvent = {
  id: string;
  storeId: string | null;
  sourceType: "holiday" | "sports" | "festival" | "manual";
  title: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  category: string;
  impactLevel: "reference" | "busy" | "major";
  venue: string;
  sourceUrl: string;
  note: string;
};

type CalendarEventInput = Omit<BusinessCalendarEvent, "id" | "storeId"> & {
  sourceKey: string;
  storeId?: string | null;
  prefecture?: string;
  locality?: string;
  metadata?: Record<string, unknown>;
};

const holidaySourceUrl = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";
const hawksSourceBaseUrl = "https://ticket.softbankhawks.co.jp/event/games";
const yamakasaSourceUrl = "https://www.hakatayamakasa.com/162358.html";

function normalizeDate(value: string) {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
}

function stripHtml(value: string) {
  return value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

async function upsertEvent(event: CalendarEventInput) {
  await sql`
    insert into business_calendar_events (
      store_id, source_type, source_key, title, start_date, end_date, start_time, end_time,
      category, impact_level, venue, prefecture, locality, source_url, note, metadata, is_active, updated_at
    ) values (
      ${event.storeId ?? null}, ${event.sourceType}, ${event.sourceKey}, ${event.title},
      ${event.startDate}::date, ${event.endDate}::date, ${event.startTime}::time, ${event.endTime}::time,
      ${event.category}, ${event.impactLevel}, ${event.venue}, ${event.prefecture ?? ""}, ${event.locality ?? ""},
      ${event.sourceUrl}, ${event.note}, ${JSON.stringify(event.metadata ?? {})}, true, now()
    )
    on conflict (source_type, source_key) do update set
      store_id = excluded.store_id,
      title = excluded.title,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      category = excluded.category,
      impact_level = excluded.impact_level,
      venue = excluded.venue,
      prefecture = excluded.prefecture,
      locality = excluded.locality,
      source_url = excluded.source_url,
      note = excluded.note,
      metadata = excluded.metadata,
      is_active = true,
      updated_at = now()
  `;
}

export async function syncJapaneseHolidays() {
  const response = await fetch(holidaySourceUrl, { headers: { "User-Agent": "Foundr1-OS/1.0" } });
  if (!response.ok) throw new Error(`Holiday source returned ${response.status}`);
  const csv = new TextDecoder("shift_jis").decode(await response.arrayBuffer());
  const currentYear = new Date().getUTCFullYear();
  let count = 0;
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [rawDate, rawTitle] = line.split(",");
    const date = rawDate ? normalizeDate(rawDate) : null;
    const title = rawTitle?.trim();
    if (!date || !title || Number(date.slice(0, 4)) < currentYear - 1) continue;
    await upsertEvent({
      sourceType: "holiday",
      sourceKey: `jp-holiday:${date}`,
      title,
      startDate: date,
      endDate: date,
      startTime: null,
      endTime: null,
      category: "holiday",
      impactLevel: "busy",
      venue: "",
      sourceUrl: holidaySourceUrl,
      note: "国民の祝日・休日",
      metadata: { official: true }
    });
    count += 1;
  }
  return count;
}

function parseHawksMonth(html: string, year: number, month: number) {
  const events: CalendarEventInput[] = [];
  const blockPattern = /<li class="([^"]*p-schedule-calendar2-week--item[^"]*)">([\s\S]*?)<\/li>/g;
  for (const match of html.matchAll(blockPattern)) {
    if (match[1].includes("next-month-item")) continue;
    const block = match[2];
    const dayMatch = /p-schedule-calendar2-day--head">(\d{1,2})</.exec(block);
    const opponentMatch = /<img[^>]+alt="([^"]+)"/.exec(block);
    const gameMatch = /<p>\s*(\d{1,2}:\d{2})\s*<br\s*\/?>\s*([^<]+)<\/p>/.exec(block);
    if (!dayMatch || !opponentMatch || !gameMatch || !gameMatch[2].includes("みずほPayPay")) continue;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(Number(dayMatch[1])).padStart(2, "0")}`;
    const specialLabel = /p-schedule-calendar--label[^>]*>([\s\S]*?)<\/p>/.exec(block);
    events.push({
      sourceType: "sports",
      sourceKey: `hawks-home:${date}`,
      title: `ホークス vs ${stripHtml(opponentMatch[1])}`,
      startDate: date,
      endDate: date,
      startTime: gameMatch[1],
      endTime: null,
      category: "sports",
      impactLevel: "busy",
      venue: "みずほPayPayドーム福岡",
      prefecture: "福岡県",
      locality: "福岡市",
      sourceUrl: `${hawksSourceBaseUrl}/${year}/${String(month).padStart(2, "0")}/`,
      note: specialLabel ? stripHtml(specialLabel[1]) : "福岡ソフトバンクホークス主催試合",
      metadata: { opponent: stripHtml(opponentMatch[1]), official: true }
    });
  }
  return events;
}

export async function syncHawksHomeGames(referenceDate = new Date()) {
  let count = 0;
  for (let offset = -1; offset <= 6; offset += 1) {
    const date = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + offset, 1));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const url = `${hawksSourceBaseUrl}/${year}/${String(month).padStart(2, "0")}/`;
    const response = await fetch(url, { headers: { "User-Agent": "Foundr1-OS/1.0" } });
    if (!response.ok) continue;
    for (const event of parseHawksMonth(await response.text(), year, month)) {
      await upsertEvent(event);
      count += 1;
    }
  }
  return count;
}

export async function syncFukuokaMajorEvents(referenceDate = new Date()) {
  const years = [referenceDate.getUTCFullYear(), referenceDate.getUTCFullYear() + 1];
  let count = 0;
  for (const year of years) {
    const events: CalendarEventInput[] = [
      {
        sourceType: "festival", sourceKey: `hakata-dontaku:${year}`, title: "博多どんたく港まつり",
        startDate: `${year}-05-03`, endDate: `${year}-05-04`, startTime: null, endTime: null,
        category: "festival", impactLevel: "major", venue: "福岡市中心部", prefecture: "福岡県", locality: "福岡市",
        sourceUrl: "https://www.dontaku.fukunet.or.jp/", note: "市内中心部の混雑・交通規制に注意"
      },
      {
        sourceType: "festival", sourceKey: `hakata-yamakasa:${year}`, title: "博多祇園山笠",
        startDate: `${year}-07-01`, endDate: `${year}-07-15`, startTime: null, endTime: null,
        category: "festival", impactLevel: "busy", venue: "博多部・天神周辺", prefecture: "福岡県", locality: "福岡市",
        sourceUrl: yamakasaSourceUrl, note: "期間中は行事・交通規制による人流変化に注意"
      },
      {
        sourceType: "festival", sourceKey: `hakata-yamakasa-oi:${year}`, title: "追い山笠ならし",
        startDate: `${year}-07-12`, endDate: `${year}-07-12`, startTime: "15:59", endTime: null,
        category: "festival", impactLevel: "major", venue: "櫛田神社～博多部", prefecture: "福岡県", locality: "福岡市",
        sourceUrl: yamakasaSourceUrl, note: "大規模な観覧客・交通規制を想定"
      },
      {
        sourceType: "festival", sourceKey: `hakata-yamakasa-group:${year}`, title: "集団山笠見せ",
        startDate: `${year}-07-13`, endDate: `${year}-07-13`, startTime: "15:30", endTime: null,
        category: "festival", impactLevel: "major", venue: "呉服町～天神", prefecture: "福岡県", locality: "福岡市",
        sourceUrl: yamakasaSourceUrl, note: "天神方面まで運行・交通規制あり"
      },
      {
        sourceType: "festival", sourceKey: `hakata-yamakasa-final:${year}`, title: "追い山笠",
        startDate: `${year}-07-15`, endDate: `${year}-07-15`, startTime: "04:59", endTime: null,
        category: "festival", impactLevel: "major", venue: "櫛田神社～博多部", prefecture: "福岡県", locality: "福岡市",
        sourceUrl: yamakasaSourceUrl, note: "早朝から大規模な観覧客・交通規制を想定"
      }
    ];
    for (const event of events) {
      await upsertEvent(event);
      count += 1;
    }
  }
  return count;
}

export async function syncBusinessCalendarSources(referenceDate = new Date()) {
  const [holidayResult, hawksResult, localResult] = await Promise.allSettled([
    syncJapaneseHolidays(),
    syncHawksHomeGames(referenceDate),
    syncFukuokaMajorEvents(referenceDate)
  ]);
  return {
    holidays: holidayResult.status === "fulfilled" ? holidayResult.value : 0,
    hawksGames: hawksResult.status === "fulfilled" ? hawksResult.value : 0,
    localEvents: localResult.status === "fulfilled" ? localResult.value : 0,
    errors: [holidayResult, hawksResult, localResult]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
  };
}

export async function getBusinessCalendarEvents(input: {
  storeId: string;
  startDate: string;
  endDate: string;
  storeLocationText?: string;
  storePrefecture?: string;
}) {
  const locationText = input.storeLocationText ?? "";
  const prefecture = input.storePrefecture ?? "";
  const rows = await sql`
    select
      id::text,
      store_id::text as "storeId",
      source_type as "sourceType",
      title,
      to_char(start_date, 'YYYY-MM-DD') as "startDate",
      to_char(end_date, 'YYYY-MM-DD') as "endDate",
      to_char(start_time, 'HH24:MI') as "startTime",
      to_char(end_time, 'HH24:MI') as "endTime",
      category,
      impact_level as "impactLevel",
      venue,
      source_url as "sourceUrl",
      note
    from business_calendar_events
    where is_active = true
      and start_date < ${input.endDate}::date
      and end_date >= ${input.startDate}::date
      and (
        store_id::text = ${input.storeId}
        or (
          store_id is null
          and (prefecture = '' or ${prefecture} = prefecture)
          and (locality = '' or position(locality in ${locationText}) > 0 or (${locationText} = '' and ${prefecture} = prefecture))
        )
      )
    order by start_date, case impact_level when 'major' then 1 when 'busy' then 2 else 3 end, start_time nulls first, title
  `;
  return rows as BusinessCalendarEvent[];
}
