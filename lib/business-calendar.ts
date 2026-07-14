import { sql } from "./db";

export type BusinessCalendarEvent = {
  id: string;
  storeId: string | null;
  sourceType: "holiday" | "sports" | "festival" | "concert" | "convention" | "cruise" | "manual";
  title: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  category: string;
  impactLevel: "reference" | "busy" | "major";
  flowDirection: "inbound" | "outbound" | "mixed";
  impactStartTime: string | null;
  impactEndTime: string | null;
  venue: string;
  sourceUrl: string;
  note: string;
};

type CalendarEventInput = Omit<BusinessCalendarEvent, "id" | "storeId" | "flowDirection" | "impactStartTime" | "impactEndTime"> & {
  sourceKey: string;
  storeId?: string | null;
  flowDirection?: BusinessCalendarEvent["flowDirection"];
  impactStartTime?: string | null;
  impactEndTime?: string | null;
  prefecture?: string;
  locality?: string;
  audiencePrefecture?: string;
  metadata?: Record<string, unknown>;
};

const holidaySourceUrl = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";
const hawksSourceBaseUrl = "https://ticket.softbankhawks.co.jp/event/games";
const yamakasaSourceUrl = "https://www.hakatayamakasa.com/162358.html";
const payPayDomeEventsBaseUrl = "https://www.softbankhawks.co.jp/stadium/event_schedule";
const marineMesseEventsUrl = "https://www.marinemesse.or.jp/messe/event";
const marineMesseCmsUrl = "https://api.cms.studiodesignapp.com/v2/search";
const cruiseScheduleUrl = "https://www.city.fukuoka.lg.jp/kowan/k-kikaku/hakata-port/cruise1.html";
const fukuokaConventionCalendarUrl = "https://www.welcome-fukuoka.or.jp/wp-content/themes/fcvb_main/images/about/oceans/2026_NewYear.pdf";

type ForeignMajorLongBreak = {
  market: "中国" | "韓国" | "台湾" | "香港";
  title: string;
  startDate: string;
  endDate: string;
  sourceUrl: string;
};

const foreignMajorLongBreaks: ForeignMajorLongBreak[] = [
  {
    market: "中国", title: "中国・春節大型連休", startDate: "2026-02-15", endDate: "2026-02-23",
    sourceUrl: "https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm"
  },
  {
    market: "中国", title: "中国・労働節大型連休", startDate: "2026-05-01", endDate: "2026-05-05",
    sourceUrl: "https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm"
  },
  {
    market: "中国", title: "中国・国慶節大型連休", startDate: "2026-10-01", endDate: "2026-10-07",
    sourceUrl: "https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm"
  },
  {
    market: "韓国", title: "韓国・旧正月（ソルラル）連休", startDate: "2026-02-14", endDate: "2026-02-18",
    sourceUrl: "https://customs.go.kr/engportal/cm/cntnts/cntntsView.do?cntntsId=7401&mi=13284"
  },
  {
    market: "韓国", title: "韓国・秋夕（チュソク）連休", startDate: "2026-09-24", endDate: "2026-09-27",
    sourceUrl: "https://customs.go.kr/engportal/cm/cntnts/cntntsView.do?cntntsId=7401&mi=13284"
  },
  {
    market: "韓国", title: "韓国・旧正月（ソルラル）連休", startDate: "2027-02-06", endDate: "2027-02-09",
    sourceUrl: "https://www.kasa.go.kr/prog/plcyBrf/brief/kor/sub01_01_04/view.do?plcyBrfNo=431"
  },
  {
    market: "韓国", title: "韓国・秋夕（チュソク）連休", startDate: "2027-09-14", endDate: "2027-09-16",
    sourceUrl: "https://www.kasa.go.kr/prog/plcyBrf/brief/kor/sub01_01_04/view.do?plcyBrfNo=431"
  },
  {
    market: "台湾", title: "台湾・春節大型連休", startDate: "2026-02-14", endDate: "2026-02-22",
    sourceUrl: "https://www.dgpa.gov.tw/information?pid=12685&uid=55"
  },
  {
    market: "台湾", title: "台湾・児童節／清明節連休", startDate: "2026-04-03", endDate: "2026-04-06",
    sourceUrl: "https://www.dgpa.gov.tw/information?pid=12685&uid=55"
  },
  {
    market: "台湾", title: "台湾・中秋節連休", startDate: "2026-09-25", endDate: "2026-09-28",
    sourceUrl: "https://www.dgpa.gov.tw/information?pid=12685&uid=55"
  },
  {
    market: "台湾", title: "台湾・春節大型連休", startDate: "2027-02-04", endDate: "2027-02-10",
    sourceUrl: "https://www.dgpa.gov.tw/information?pid=12983&uid=2"
  },
  {
    market: "台湾", title: "台湾・児童節／清明節連休", startDate: "2027-04-03", endDate: "2027-04-06",
    sourceUrl: "https://www.dgpa.gov.tw/information?pid=12983&uid=2"
  },
  {
    market: "香港", title: "香港・旧正月連休", startDate: "2026-02-17", endDate: "2026-02-19",
    sourceUrl: "https://www.gov.hk/en/about/abouthk/holiday/2026.htm"
  },
  {
    market: "香港", title: "香港・清明節／復活祭連休", startDate: "2026-04-03", endDate: "2026-04-07",
    sourceUrl: "https://www.gov.hk/en/about/abouthk/holiday/2026.htm"
  },
  {
    market: "香港", title: "香港・クリスマス連休", startDate: "2026-12-25", endDate: "2026-12-27",
    sourceUrl: "https://www.gov.hk/en/about/abouthk/holiday/2026.htm"
  },
  {
    market: "香港", title: "香港・旧正月連休", startDate: "2027-02-06", endDate: "2027-02-09",
    sourceUrl: "https://www.gov.hk/en/about/abouthk/holiday/2027.htm"
  },
  {
    market: "香港", title: "香港・復活祭連休", startDate: "2027-03-26", endDate: "2027-03-29",
    sourceUrl: "https://www.gov.hk/en/about/abouthk/holiday/2027.htm"
  },
  {
    market: "香港", title: "香港・クリスマス連休", startDate: "2027-12-25", endDate: "2027-12-27",
    sourceUrl: "https://www.gov.hk/en/about/abouthk/holiday/2027.htm"
  }
];

function timeToMinutes(value: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

function minutesToTime(value: number) {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, value));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function expandImpactWindow(startTime: string | null, beforeMinutes: number, afterMinutes: number) {
  const start = timeToMinutes(startTime);
  if (start === null) return { impactStartTime: "10:00", impactEndTime: "23:00" };
  return {
    impactStartTime: minutesToTime(start - beforeMinutes),
    impactEndTime: minutesToTime(start + afterMinutes)
  };
}

function normalizeDate(value: string) {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
}

function addDays(dateString: string, amount: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function isWeekend(dateString: string) {
  const day = new Date(`${dateString}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stableSourceSuffix(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function toAbsoluteUrl(value: string, baseUrl: string) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

async function upsertEvent(event: CalendarEventInput) {
  await sql`
    insert into business_calendar_events (
      store_id, source_type, source_key, title, start_date, end_date, start_time, end_time,
      category, impact_level, flow_direction, impact_start_time, impact_end_time,
      venue, prefecture, locality, audience_prefecture, source_url, note, metadata, is_active, updated_at
    ) values (
      ${event.storeId ?? null}, ${event.sourceType}, ${event.sourceKey}, ${event.title},
      ${event.startDate}::date, ${event.endDate}::date, ${event.startTime}::time, ${event.endTime}::time,
      ${event.category}, ${event.impactLevel}, ${event.flowDirection ?? "mixed"}, ${event.impactStartTime ?? null}::time, ${event.impactEndTime ?? null}::time,
      ${event.venue}, ${event.prefecture ?? ""}, ${event.locality ?? ""}, ${event.audiencePrefecture ?? ""},
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
      flow_direction = excluded.flow_direction,
      impact_start_time = excluded.impact_start_time,
      impact_end_time = excluded.impact_end_time,
      venue = excluded.venue,
      prefecture = excluded.prefecture,
      locality = excluded.locality,
      audience_prefecture = excluded.audience_prefecture,
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
      flowDirection: "mixed",
      impactStartTime: "00:00",
      impactEndTime: "23:59",
      venue: "",
      sourceUrl: holidaySourceUrl,
      note: "国民の祝日・休日",
      metadata: { official: true }
    });
    count += 1;
  }
  return count;
}

export async function syncJapaneseLongBreaks(referenceDate = new Date()) {
  const response = await fetch(holidaySourceUrl, { headers: { "User-Agent": "Foundr1-OS/1.0" } });
  if (!response.ok) throw new Error(`Holiday source returned ${response.status}`);
  const csv = new TextDecoder("shift_jis").decode(await response.arrayBuffer());
  const holidayByDate = new Map<string, string>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [rawDate, rawTitle] = line.split(",");
    const date = rawDate ? normalizeDate(rawDate) : null;
    if (date && rawTitle?.trim()) holidayByDate.set(date, rawTitle.trim());
  }

  const targetYears = [referenceDate.getUTCFullYear(), referenceDate.getUTCFullYear() + 1];
  const events: CalendarEventInput[] = [];
  for (const year of targetYears) {
    let sequenceStart = "";
    let sequenceDates: string[] = [];
    const flushSequence = () => {
      if (sequenceDates.length < 3 || !sequenceDates.some((date) => holidayByDate.has(date))) {
        sequenceStart = "";
        sequenceDates = [];
        return;
      }
      const sequenceEnd = sequenceDates.at(-1) ?? sequenceStart;
      if (sequenceDates.some((date) => date.endsWith("-01-01"))) {
        sequenceStart = "";
        sequenceDates = [];
        return;
      }
      const holidayTitle = sequenceDates.map((date) => holidayByDate.get(date)).find(Boolean) ?? "祝日";
      const title = sequenceDates.some((date) => date.slice(5, 7) === "05")
        ? "ゴールデンウィーク"
        : sequenceDates.length >= 4 && sequenceDates.some((date) => date.slice(5, 7) === "09")
          ? "シルバーウィーク"
          : `${holidayTitle}を含む${sequenceDates.length}連休`;
      events.push({
        sourceType: "holiday",
        sourceKey: `jp-long-break:${sequenceStart}:${sequenceEnd}`,
        title,
        startDate: sequenceStart,
        endDate: sequenceEnd,
        startTime: null,
        endTime: null,
        category: "long_break",
        impactLevel: sequenceDates.length >= 5 ? "major" : "busy",
        flowDirection: "mixed",
        impactStartTime: "00:00",
        impactEndTime: "23:59",
        venue: "全国",
        sourceUrl: holidaySourceUrl,
        note: "祝日と週末が連続する人流変動期間",
        metadata: { officialHolidays: true, dayCount: sequenceDates.length }
      });
      sequenceStart = "";
      sequenceDates = [];
    };

    for (let date = `${year}-01-01`; date <= `${year}-12-31`; date = addDays(date, 1)) {
      if (isWeekend(date) || holidayByDate.has(date)) {
        if (!sequenceStart) sequenceStart = date;
        sequenceDates.push(date);
      } else {
        flushSequence();
      }
    }
    flushSequence();

    events.push(
      {
        sourceType: "holiday", sourceKey: `obon-travel:${year}`, title: "お盆・帰省ピーク",
        startDate: `${year}-08-13`, endDate: `${year}-08-16`, startTime: null, endTime: null,
        category: "long_break", impactLevel: "major", flowDirection: "mixed", impactStartTime: "00:00", impactEndTime: "23:59",
        venue: "全国", sourceUrl: "https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html",
        note: "法定祝日ではない社会休暇・帰省の集中期間", metadata: { socialHoliday: true }
      },
      {
        sourceType: "holiday", sourceKey: `year-end-travel:${year}`, title: "年末年始・帰省ピーク",
        startDate: `${year}-12-29`, endDate: `${year + 1}-01-03`, startTime: null, endTime: null,
        category: "long_break", impactLevel: "major", flowDirection: "mixed", impactStartTime: "00:00", impactEndTime: "23:59",
        venue: "全国", sourceUrl: "https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html",
        note: "法定祝日の範囲を超える一般的な年末年始休暇", metadata: { socialHoliday: true }
      }
    );
  }
  for (const event of events) await upsertEvent(event);
  return events.length;
}

export async function syncForeignMajorLongBreaks(referenceDate = new Date()) {
  const targetYears = new Set([referenceDate.getUTCFullYear(), referenceDate.getUTCFullYear() + 1]);
  const events = foreignMajorLongBreaks.filter((event) => targetYears.has(Number(event.startDate.slice(0, 4))));

  for (const event of events) {
    const dayCount = Math.round(
      (new Date(`${event.endDate}T00:00:00Z`).getTime() - new Date(`${event.startDate}T00:00:00Z`).getTime()) / 86_400_000
    ) + 1;
    await upsertEvent({
      sourceType: "holiday",
      sourceKey: `foreign-long-break:${event.market}:${event.startDate}:${event.endDate}`,
      title: event.title,
      startDate: event.startDate,
      endDate: event.endDate,
      startTime: null,
      endTime: null,
      category: "foreign_long_break",
      impactLevel: dayCount >= 5 ? "major" : "busy",
      flowDirection: "inbound",
      impactStartTime: "00:00",
      impactEndTime: "23:59",
      venue: event.market,
      sourceUrl: event.sourceUrl,
      note: `${event.market}の大型連休。福岡への訪日旅行需要が高まる可能性がある参考期間`,
      metadata: { official: true, originMarket: event.market, dayCount, visitorSignal: true }
    });
  }

  if (events.length) {
    const sourceKeys = events.map((event) => `foreign-long-break:${event.market}:${event.startDate}:${event.endDate}`);
    const firstYear = Math.min(...targetYears);
    const lastYear = Math.max(...targetYears);
    await sql`
      update business_calendar_events
      set is_active = false, updated_at = now()
      where source_type = 'holiday'
        and source_key like 'foreign-long-break:%'
        and start_date >= ${`${firstYear}-01-01`}::date
        and start_date <= ${`${lastYear}-12-31`}::date
        and not (source_key = any(${sourceKeys}))
    `;
  }

  return events.length;
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
      flowDirection: "mixed",
      ...expandImpactWindow(gameMatch[1], 180, 300),
      venue: "みずほPayPayドーム福岡",
      prefecture: "福岡県",
      locality: "福岡市",
      sourceUrl: `${hawksSourceBaseUrl}/${year}/${String(month).padStart(2, "0")}/`,
      note: specialLabel ? stripHtml(specialLabel[1]) : "市外客の来訪と、地域客の会場方面への移動が同時に起こる可能性あり",
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

function isMusicEventTitle(title: string) {
  return /(LIVE|TOUR|CONCERT|MUSIC|FES(?:TIVAL)?|ROCK|NUMBER SHOT|ライブ|ツアー|コンサート|音楽)/i.test(title);
}

function isClearlyNonConcertPerformance(title: string) {
  return /(ディズニー・オン・アイス|アイスショー|K-1|プロレス|格闘技|お笑い|漫才|ミュージカル|サーカス|舞台公演)/i.test(title);
}

export function parsePayPayDomeConcerts(html: string) {
  const events: CalendarEventInput[] = [];
  const entryPattern = /<dt>\s*(\d{4})\/(\d{1,2})\/(\d{1,2})[\s\S]*?<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g;
  for (const match of html.matchAll(entryPattern)) {
    const body = match[4];
    const titleCell = /<th>\s*イベント\s*<\/th>\s*<td>([\s\S]*?)<\/td>/.exec(body)?.[1] ?? "";
    const title = stripHtml(titleCell);
    if (!title || !isMusicEventTitle(title)) continue;
    const date = `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
    const timeCell = /<th>\s*開演時間\s*<\/th>\s*<td>([\s\S]*?)<\/td>/.exec(body)?.[1] ?? "";
    const startTime = /(\d{1,2}:\d{2})\s*開演/.exec(stripHtml(timeCell))?.[1]
      ?? /開演\s*(\d{1,2}:\d{2})/.exec(stripHtml(timeCell))?.[1]
      ?? /(\d{1,2}:\d{2})/.exec(stripHtml(timeCell))?.[1]
      ?? null;
    const link = /<a[^>]+href="([^"]+)"/.exec(titleCell)?.[1] ?? "";
    events.push({
      sourceType: "concert",
      sourceKey: `paypay-concert:${date}:${stableSourceSuffix(title)}`,
      title,
      startDate: date,
      endDate: date,
      startTime,
      endTime: null,
      category: "concert",
      impactLevel: "major",
      flowDirection: "mixed",
      ...expandImpactWindow(startTime, 180, 300),
      venue: "みずほPayPayドーム福岡",
      prefecture: "福岡県",
      locality: "福岡市",
      sourceUrl: toAbsoluteUrl(link, `${payPayDomeEventsBaseUrl}/${match[1]}/`),
      note: "市外客の流入と、地域客の会場方面への流出が同時に起こる可能性あり",
      metadata: { official: true, venueSource: "paypay-dome" }
    });
  }
  return events;
}

export async function syncPayPayDomeConcerts(referenceDate = new Date()) {
  let count = 0;
  const sourceKeys: string[] = [];
  for (const year of [referenceDate.getUTCFullYear(), referenceDate.getUTCFullYear() + 1]) {
    const url = `${payPayDomeEventsBaseUrl}/${year}/`;
    const response = await fetch(url, { headers: { "User-Agent": "Foundr1-OS/1.0" } });
    if (!response.ok) continue;
    for (const event of parsePayPayDomeConcerts(await response.text())) {
      await upsertEvent(event);
      sourceKeys.push(event.sourceKey);
      count += 1;
    }
  }
  if (sourceKeys.length) {
    await sql`
      update business_calendar_events
      set is_active = false, updated_at = now()
      where source_type = 'concert'
        and source_key like 'paypay-concert:%'
        and start_date >= current_date
        and not (source_key = any(${sourceKeys}))
    `;
  }
  return count;
}

type StudioCmsValue = {
  stringValue?: string;
  mapValue?: { fields?: Record<string, StudioCmsValue> };
  document?: { fields?: Record<string, StudioCmsValue> };
};

function getStudioCmsFields(record: unknown) {
  const item = record as { document?: { fields?: { default?: StudioCmsValue; _meta?: StudioCmsValue } } };
  return {
    fields: item.document?.fields?.default?.mapValue?.fields ?? {},
    meta: item.document?.fields?._meta?.mapValue?.fields ?? {}
  };
}

function getStudioCmsString(fields: Record<string, StudioCmsValue>, key: string) {
  return fields[key]?.stringValue?.trim() ?? "";
}

function getStudioCmsTitle(fields: Record<string, StudioCmsValue>, key: string) {
  return fields[key]?.mapValue?.fields?.title?.stringValue?.trim() ?? "";
}

function getStudioCmsReferenceTitle(fields: Record<string, StudioCmsValue>, key: string) {
  return fields[key]?.document?.fields?.default?.mapValue?.fields?.title?.stringValue?.trim() ?? "";
}

function inferEventYear(month: number, day: number, referenceDate: Date) {
  const year = referenceDate.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, month - 1, day));
  const staleThreshold = new Date(referenceDate.getTime() - 31 * 24 * 60 * 60 * 1000);
  return candidate < staleThreshold ? year + 1 : year;
}

export function parseMarineMesseConcerts(payload: unknown, referenceDate = new Date()) {
  if (!Array.isArray(payload)) return [] satisfies CalendarEventInput[];
  const events: CalendarEventInput[] = [];
  for (const record of payload) {
    const { fields, meta } = getStudioCmsFields(record);
    const title = getStudioCmsString(fields, "title");
    const eventType = getStudioCmsTitle(fields, "tZdl9ryM");
    const venue = getStudioCmsReferenceTitle(fields, "zu0OnEpi");
    if (!title || eventType !== "コンサート・興行" || venue !== "マリンメッセA館" || isClearlyNonConcertPerformance(title)) continue;
    const schedule = getStudioCmsString(fields, "RIeOyB9L");
    const sourceUrl = getStudioCmsString(fields, "TyvtSOey") || marineMesseEventsUrl;
    const uid = getStudioCmsString(meta, "uid") || stableSourceSuffix(title);
    const datePattern = /(\d{1,2})\.(\d{1,2})\([^)]*\)\s*(\d{1,2}:\d{2})?/g;
    for (const dateMatch of stripHtml(schedule).matchAll(datePattern)) {
      const month = Number(dateMatch[1]);
      const day = Number(dateMatch[2]);
      const year = inferEventYear(month, day, referenceDate);
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      events.push({
        sourceType: "concert",
        sourceKey: `marine-concert:${uid}:${date}`,
        title,
        startDate: date,
        endDate: date,
        startTime: dateMatch[3] ?? null,
        endTime: null,
        category: "concert",
        impactLevel: "major",
        flowDirection: "mixed",
        ...expandImpactWindow(dateMatch[3] ?? null, 180, 300),
        venue: "マリンメッセ福岡A館",
        prefecture: "福岡県",
        locality: "福岡市",
        sourceUrl,
        note: "市外客の流入と、地域客の会場方面への流出が同時に起こる可能性あり",
        metadata: { official: true, venueSource: "marine-messe-a", cmsUid: uid }
      });
    }
  }
  return events;
}

export async function syncMarineMesseConcerts(referenceDate = new Date()) {
  const pageResponse = await fetch(marineMesseEventsUrl, { headers: { "User-Agent": "Foundr1-OS/1.0" } });
  if (!pageResponse.ok) throw new Error(`Marine Messe page returned ${pageResponse.status}`);
  const pageHtml = await pageResponse.text();
  const publishedUid = /"(\d{14})",\[\],\{\},\["Map"\]/.exec(pageHtml)?.[1];
  if (!publishedUid) throw new Error("Marine Messe published UID was not found");

  const query = Buffer.from(JSON.stringify({
    uid: publishedUid,
    project_id: "gjliOqGf6PL86iEKnjya",
    schema_key: "rMR9xdMj",
    filters: "zu0OnEpi:ref[equals]sdl2o80Z",
    orders: "order",
    offset: 0,
    limit: 100
  })).toString("base64");
  const response = await fetch(`${marineMesseCmsUrl}?q=${encodeURIComponent(query)}`, { headers: { "User-Agent": "Foundr1-OS/1.0" } });
  if (!response.ok) throw new Error(`Marine Messe CMS returned ${response.status}`);
  const events = parseMarineMesseConcerts(await response.json(), referenceDate);
  for (const event of events) await upsertEvent(event);
  if (events.length) {
    const sourceKeys = events.map((event) => event.sourceKey);
    await sql`
      update business_calendar_events
      set is_active = false, updated_at = now()
      where source_type = 'concert'
        and source_key like 'marine-concert:%'
        and start_date >= current_date
        and not (source_key = any(${sourceKeys}))
    `;
  }
  return events.length;
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
        flowDirection: "inbound", impactStartTime: "09:00", impactEndTime: "21:00", audiencePrefecture: "福岡県",
        sourceUrl: "https://www.dontaku.fukunet.or.jp/", note: "市内中心部の混雑・交通規制に注意"
      },
      {
        sourceType: "festival", sourceKey: `hakata-yamakasa:${year}`, title: "博多祇園山笠",
        startDate: `${year}-07-01`, endDate: `${year}-07-15`, startTime: null, endTime: null,
        category: "festival", impactLevel: "busy", venue: "博多部・天神周辺", prefecture: "福岡県", locality: "福岡市",
        flowDirection: "mixed", impactStartTime: "08:00", impactEndTime: "21:00", audiencePrefecture: "福岡県",
        sourceUrl: yamakasaSourceUrl, note: "期間中は行事・交通規制による人流変化に注意"
      },
      {
        sourceType: "festival", sourceKey: `hakata-yamakasa-oi:${year}`, title: "追い山笠ならし",
        startDate: `${year}-07-12`, endDate: `${year}-07-12`, startTime: "15:59", endTime: null,
        category: "festival", impactLevel: "major", venue: "櫛田神社～博多部", prefecture: "福岡県", locality: "福岡市",
        flowDirection: "mixed", impactStartTime: "13:00", impactEndTime: "19:00", audiencePrefecture: "福岡県",
        sourceUrl: yamakasaSourceUrl, note: "大規模な観覧客・交通規制を想定"
      },
      {
        sourceType: "festival", sourceKey: `hakata-yamakasa-group:${year}`, title: "集団山笠見せ",
        startDate: `${year}-07-13`, endDate: `${year}-07-13`, startTime: "15:30", endTime: null,
        category: "festival", impactLevel: "major", venue: "呉服町～天神", prefecture: "福岡県", locality: "福岡市",
        flowDirection: "mixed", impactStartTime: "13:00", impactEndTime: "19:00", audiencePrefecture: "福岡県",
        sourceUrl: yamakasaSourceUrl, note: "天神方面まで運行・交通規制あり"
      },
      {
        sourceType: "festival", sourceKey: `hakata-yamakasa-final:${year}`, title: "追い山笠",
        startDate: `${year}-07-15`, endDate: `${year}-07-15`, startTime: "04:59", endTime: null,
        category: "festival", impactLevel: "major", venue: "櫛田神社～博多部", prefecture: "福岡県", locality: "福岡市",
        flowDirection: "mixed", impactStartTime: "03:30", impactEndTime: "09:00", audiencePrefecture: "福岡県",
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

export async function syncKyushuMobilityEvents(referenceDate = new Date()) {
  if (![referenceDate.getUTCFullYear(), referenceDate.getUTCFullYear() + 1].includes(2026)) return 0;
  const events: CalendarEventInput[] = [
    {
      sourceType: "festival", sourceKey: "chikugo-fireworks:2026", title: "筑後川花火大会",
      startDate: "2026-08-05", endDate: "2026-08-05", startTime: "19:40", endTime: "20:40",
      category: "fireworks", impactLevel: "major", flowDirection: "outbound", impactStartTime: "15:30", impactEndTime: "23:00",
      venue: "久留米市 筑後川河川敷", prefecture: "福岡県", locality: "久留米市", audiencePrefecture: "福岡県",
      sourceUrl: "https://www.crossroadfukuoka.jp/event/13612", note: "福岡市から久留米方面への移動。荒天時は8月7日に順延",
      metadata: { official: true, fireworks: 15000, fallbackDate: "2026-08-07" }
    },
    {
      sourceType: "festival", sourceKey: "kanmon-fireworks:2026", title: "関門海峡花火大会",
      startDate: "2026-08-13", endDate: "2026-08-13", startTime: "19:35", endTime: "20:30",
      category: "fireworks", impactLevel: "major", flowDirection: "outbound", impactStartTime: "14:00", impactEndTime: "23:59",
      venue: "北九州市門司区・下関市", prefecture: "福岡県", locality: "北九州市", audiencePrefecture: "福岡県",
      sourceUrl: "https://www.city.kitakyushu.lg.jp/moji/w1100625.html", note: "福岡市から北九州・下関方面への移動と大規模交通規制",
      metadata: { official: true }
    },
    {
      sourceType: "festival", sourceKey: "htb-kyushu-fireworks:2026", title: "ハウステンボス 九州一 大花火まつり",
      startDate: "2026-11-14", endDate: "2026-11-14", startTime: "18:45", endTime: "20:30",
      category: "fireworks", impactLevel: "major", flowDirection: "outbound", impactStartTime: "10:00", impactEndTime: "23:59",
      venue: "ハウステンボス", prefecture: "長崎県", locality: "佐世保市", audiencePrefecture: "福岡県",
      sourceUrl: "https://www.huistenbosch.co.jp/event/fireworks/kyushu_autumn/", note: "福岡県から佐世保方面への日帰り・宿泊移動",
      metadata: { official: true, fireworks: 22000 }
    },
    {
      sourceType: "festival", sourceKey: "saga-balloon-fiesta:2026", title: "佐賀インターナショナルバルーンフェスタ",
      startDate: "2026-10-30", endDate: "2026-11-03", startTime: null, endTime: null,
      category: "festival", impactLevel: "major", flowDirection: "outbound", impactStartTime: "04:00", impactEndTime: "20:00",
      venue: "佐賀市嘉瀬川河川敷", prefecture: "佐賀県", locality: "佐賀市", audiencePrefecture: "福岡県",
      sourceUrl: "https://www.city.saga.lg.jp/kanko/event/4346.html", note: "福岡県から佐賀方面への早朝出発・日帰り移動",
      metadata: { official: true }
    }
  ];
  for (const event of events) await upsertEvent(event);
  return events.length;
}

export async function syncFukuokaLargeMiceEvents() {
  const definitions = [
    ["2026-02-16", "2026-02-18", "ビューティーワールド ジャパン 福岡", 11000, "マリンメッセ福岡A館"],
    ["2026-03-20", "2026-03-22", "第90回日本循環器学会学術集会", 15000, "福岡国際会議場・マリンメッセ福岡A館/B館・福岡サンパレス"],
    ["2026-03-22", "2026-03-26", "Fukuoka Flower Show 2026", 38000, "福岡市植物園"],
    ["2026-05-20", "2026-05-22", "第36回西日本食品産業創造展'26", 23000, "マリンメッセ福岡A館・B館"],
    ["2026-06-05", "2026-06-06", "2026九州印刷情報産業展", 10000, "福岡国際センター"],
    ["2026-06-11", "2026-06-12", "福岡ギフト・ショー2026 / 福岡プレミアム・インセンティブショー2026", 10000, "マリンメッセ福岡B館"],
    ["2026-06-24", "2026-06-25", "九州・東アジア 国際物流総合展 INNOVATION EXPO 2026", 10000, "マリンメッセ福岡A館・B館"]
  ] as const;
  for (const [startDate, endDate, title, attendees, venue] of definitions) {
    await upsertEvent({
      sourceType: "convention",
      sourceKey: `fukuoka-mice:${startDate}:${stableSourceSuffix(title)}`,
      title,
      startDate,
      endDate,
      startTime: null,
      endTime: null,
      category: "convention",
      impactLevel: "major",
      flowDirection: "inbound",
      impactStartTime: "08:00",
      impactEndTime: "21:00",
      venue,
      prefecture: "福岡県",
      locality: "福岡市",
      audiencePrefecture: "福岡県",
      sourceUrl: fukuokaConventionCalendarUrl,
      note: `公表参加予定 ${attendees.toLocaleString("ja-JP")}人`,
      metadata: { official: true, expectedAttendees: attendees, threshold: 10000 }
    });
  }
  return definitions.length;
}

const largeCruisePassengerCapacity: Record<string, number> = {
  MSCBELLISSIMA: 5655,
  SPECTRUMOFTHESEAS: 4905,
  COSTASERENA: 3780
};

export function parseHakataLargeCruiseCalls(html: string, referenceDate = new Date()) {
  const events: CalendarEventInput[] = [];
  const pageYear = Number(/(20\d{2})年（令和\d+年）クルーズ客船寄港予定/.exec(stripHtml(html))?.[1]) || referenceDate.getUTCFullYear();
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((match) => stripHtml(match[1]));
    if (cells.length < 3) continue;
    const arrival = /(\d{1,2})月(\d{1,2})日[^\d]*(\d{1,2})時(\d{2})分/.exec(cells[0]);
    if (!arrival) continue;
    const canonicalShipName = cells[2].replace(/\s+/g, "").toUpperCase();
    const passengerCapacity = largeCruisePassengerCapacity[canonicalShipName];
    if (!passengerCapacity) continue;
    const shipName = canonicalShipName === "SPECTRUMOFTHESEAS" ? "SPECTRUM OF THE SEAS" : cells[2].replace(/\s+/g, " ");
    const departure = /(\d{1,2})時(\d{2})分/.exec(cells[1]);
    const date = `${pageYear}-${String(Number(arrival[1])).padStart(2, "0")}-${String(Number(arrival[2])).padStart(2, "0")}`;
    const startTime = `${String(Number(arrival[3])).padStart(2, "0")}:${arrival[4]}`;
    const endTime = departure ? `${String(Number(departure[1])).padStart(2, "0")}:${departure[2]}` : null;
    events.push({
      sourceType: "cruise",
      sourceKey: `hakata-cruise:${date}:${canonicalShipName}`,
      title: `${shipName} 博多港寄港`,
      startDate: date,
      endDate: date,
      startTime,
      endTime,
      category: "cruise",
      impactLevel: "major",
      flowDirection: "inbound",
      impactStartTime: startTime,
      impactEndTime: endTime ?? "22:00",
      venue: "博多港",
      prefecture: "福岡県",
      locality: "福岡市",
      audiencePrefecture: "福岡県",
      sourceUrl: cruiseScheduleUrl,
      note: `大型客船・最大乗客数目安 ${passengerCapacity.toLocaleString("ja-JP")}人`,
      metadata: { official: true, passengerCapacity, berth: cells[3] ?? "", origin: cells[6] ?? "" }
    });
  }
  return events;
}

export async function syncHakataLargeCruiseCalls(referenceDate = new Date()) {
  const response = await fetch(cruiseScheduleUrl, { headers: { "User-Agent": "Foundr1-OS/1.0" } });
  if (!response.ok) throw new Error(`Hakata cruise schedule returned ${response.status}`);
  const events = parseHakataLargeCruiseCalls(await response.text(), referenceDate);
  for (const event of events) await upsertEvent(event);
  if (events.length) {
    const sourceKeys = events.map((event) => event.sourceKey);
    await sql`
      update business_calendar_events
      set is_active = false, updated_at = now()
      where source_type = 'cruise'
        and source_key like 'hakata-cruise:%'
        and start_date >= current_date
        and not (source_key = any(${sourceKeys}))
    `;
  }
  return events.length;
}

export async function syncBusinessCalendarSources(referenceDate = new Date()) {
  const [holidayResult, longBreakResult, foreignLongBreakResult, hawksResult, localResult, mobilityResult, miceResult, cruiseResult, payPayConcertResult, marineConcertResult] = await Promise.allSettled([
    syncJapaneseHolidays(),
    syncJapaneseLongBreaks(referenceDate),
    syncForeignMajorLongBreaks(referenceDate),
    syncHawksHomeGames(referenceDate),
    syncFukuokaMajorEvents(referenceDate),
    syncKyushuMobilityEvents(referenceDate),
    syncFukuokaLargeMiceEvents(),
    syncHakataLargeCruiseCalls(referenceDate),
    syncPayPayDomeConcerts(referenceDate),
    syncMarineMesseConcerts(referenceDate)
  ]);
  return {
    holidays: holidayResult.status === "fulfilled" ? holidayResult.value : 0,
    longBreaks: longBreakResult.status === "fulfilled" ? longBreakResult.value : 0,
    foreignLongBreaks: foreignLongBreakResult.status === "fulfilled" ? foreignLongBreakResult.value : 0,
    hawksGames: hawksResult.status === "fulfilled" ? hawksResult.value : 0,
    localEvents: localResult.status === "fulfilled" ? localResult.value : 0,
    mobilityEvents: mobilityResult.status === "fulfilled" ? mobilityResult.value : 0,
    largeMiceEvents: miceResult.status === "fulfilled" ? miceResult.value : 0,
    largeCruiseCalls: cruiseResult.status === "fulfilled" ? cruiseResult.value : 0,
    payPayDomeConcerts: payPayConcertResult.status === "fulfilled" ? payPayConcertResult.value : 0,
    marineMesseConcerts: marineConcertResult.status === "fulfilled" ? marineConcertResult.value : 0,
    errors: [holidayResult, longBreakResult, foreignLongBreakResult, hawksResult, localResult, mobilityResult, miceResult, cruiseResult, payPayConcertResult, marineConcertResult]
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
      flow_direction as "flowDirection",
      to_char(impact_start_time, 'HH24:MI') as "impactStartTime",
      to_char(impact_end_time, 'HH24:MI') as "impactEndTime",
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
          and (
            audience_prefecture = ${prefecture}
            or (
              audience_prefecture = ''
              and (prefecture = '' or ${prefecture} = prefecture)
              and (locality = '' or position(locality in ${locationText}) > 0 or (${locationText} = '' and ${prefecture} = prefecture))
            )
          )
        )
      )
    order by start_date, case impact_level when 'major' then 1 when 'busy' then 2 else 3 end, start_time nulls first, title
  `;
  return rows as BusinessCalendarEvent[];
}
