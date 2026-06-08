import { sql } from "./db";
import { createOsNotification } from "./web-push";

type MetricUnit = "count" | "bytes" | "jpy";
type PeriodKind = "month" | "day" | "current";
type UsageStatus = "safe" | "watch" | "warning" | "critical" | "unknown";

type ServiceMetricDefinition = {
  serviceKey: string;
  serviceName: string;
  metricKey: string;
  metricLabel: string;
  unit: MetricUnit;
  periodKind: PeriodKind;
  limitValue: number | null;
  includedLabel: string;
  paidTrigger: string;
  sourceLabel: string;
};

export type ExternalServiceMetric = ServiceMetricDefinition & {
  value: number;
  displayValue: string;
  displayLimit: string;
  percent: number | null;
  status: UsageStatus;
  periodLabel: string;
  note: string;
};

export type ExternalServiceUsageDashboard = {
  month: string;
  generatedAt: string;
  summary: {
    configuredCount: number;
    watchCount: number;
    warningCount: number;
    criticalCount: number;
    estimatedMonthlyCostJpy: number;
  };
  metrics: ExternalServiceMetric[];
  services: Array<{
    serviceKey: string;
    serviceName: string;
    status: UsageStatus;
    metrics: ExternalServiceMetric[];
  }>;
  trend: Array<{
    month: string;
    resendEmails: number;
    pusherMessages: number;
    blobBytes: number;
    squareAmount: number;
    komojuAmount: number;
  }>;
};

const gib = 1024 * 1024 * 1024;
const daysInPusherMonthAllowance = 30;

const metricDefinitions: ServiceMetricDefinition[] = [
  {
    serviceKey: "vercel_hosting",
    serviceName: "Vercel Hosting / Functions",
    metricKey: "commercial_plan",
    metricLabel: "商用利用プラン確認",
    unit: "count",
    periodKind: "current",
    limitValue: 0,
    includedLabel: "Hobby は個人・非商用のみ",
    paidTrigger: "Foundr1 OS を店舗運営や Web予約に使う時点で Pro 以上の確認対象です。",
    sourceLabel: "環境設定"
  },
  {
    serviceKey: "neon",
    serviceName: "Neon Postgres",
    metricKey: "database_storage_bytes",
    metricLabel: "DB ストレージ",
    unit: "bytes",
    periodKind: "current",
    limitValue: 0.5 * gib,
    includedLabel: "Free: 0.5GB / project",
    paidTrigger: "0.5GB を超える、または本番運用で長期メトリクス/復元が必要になった時。",
    sourceLabel: "pg_database_size"
  },
  {
    serviceKey: "vercel_blob",
    serviceName: "Vercel Blob",
    metricKey: "storage_bytes",
    metricLabel: "Blob 保存量",
    unit: "bytes",
    periodKind: "month",
    limitValue: 1 * gib,
    includedLabel: "Hobby: 1GB / month",
    paidTrigger: "画像・レシート保存量が 1GB に近づいた時。",
    sourceLabel: "アップロード台帳"
  },
  {
    serviceKey: "resend",
    serviceName: "Resend",
    metricKey: "emails_sent",
    metricLabel: "メール送信",
    unit: "count",
    periodKind: "month",
    limitValue: 3000,
    includedLabel: "Free: 3,000 emails / month",
    paidTrigger: "クーポン・会員通知メールが月 3,000 通に近づいた時。",
    sourceLabel: "会員クーポン送信履歴"
  },
  {
    serviceKey: "pusher",
    serviceName: "Pusher Channels",
    metricKey: "messages",
    metricLabel: "リアルタイムメッセージ",
    unit: "count",
    periodKind: "month",
    limitValue: 200000 * daysInPusherMonthAllowance,
    includedLabel: "Sandbox: 200k messages / day",
    paidTrigger: "厨房・受取表示・POS客席表示のリアルタイム配信が日次上限に近づいた時。",
    sourceLabel: "Pusher trigger 台帳"
  },
  {
    serviceKey: "clerk",
    serviceName: "Clerk",
    metricKey: "member_identities",
    metricLabel: "会員ログイン連携",
    unit: "count",
    periodKind: "current",
    limitValue: 10000,
    includedLabel: "Free 目安: 10,000 MAU",
    paidTrigger: "会員ログイン利用者が 10,000 MAU に近づく、または高度な認証機能が必要になった時。",
    sourceLabel: "member_identity_links"
  },
  {
    serviceKey: "lark",
    serviceName: "Lark",
    metricKey: "linked_users",
    metricLabel: "Lark 連携スタッフ",
    unit: "count",
    periodKind: "current",
    limitValue: 20,
    includedLabel: "Starter: 20 users max",
    paidTrigger: "Lark 利用スタッフが 20 名に近づく、または高度な権限/履歴/自動化が必要になった時。",
    sourceLabel: "employees.lark_*"
  },
  {
    serviceKey: "square",
    serviceName: "Square",
    metricKey: "payment_amount",
    metricLabel: "Square 決済額",
    unit: "jpy",
    periodKind: "month",
    limitValue: null,
    includedLabel: "月額 0 円の場合も決済手数料は発生",
    paidTrigger: "nanacha Web予約の決済ごとに手数料が発生します。",
    sourceLabel: "store_customer_orders"
  },
  {
    serviceKey: "komoju",
    serviceName: "KOMOJU",
    metricKey: "payment_amount",
    metricLabel: "KOMOJU 決済額",
    unit: "jpy",
    periodKind: "month",
    limitValue: null,
    includedLabel: "固定費なし、決済ごとに手数料",
    paidTrigger: "maamaa Web予約の決済ごとに決済手数料・振込手数料が発生します。",
    sourceLabel: "store_customer_orders"
  }
];

function currentTokyoMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).format(new Date());
}

function monthRange(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const startDate = `${month}-01`;
  const endDate = `${month}-${String(new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()).padStart(2, "0")}`;
  return { startDate, endDate };
}

function formatValue(value: number, unit: MetricUnit) {
  if (unit === "bytes") {
    if (value >= gib) return `${(value / gib).toFixed(2)} GB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (unit === "jpy") {
    return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value);
  }
  return new Intl.NumberFormat("ja-JP").format(Math.round(value));
}

function getStatus(value: number, limitValue: number | null, warnRatio = 0.7, criticalRatio = 0.85): UsageStatus {
  if (!limitValue || limitValue <= 0) return "unknown";
  const ratio = value / limitValue;
  if (ratio >= criticalRatio) return "critical";
  if (ratio >= warnRatio) return "warning";
  if (ratio >= 0.5) return "watch";
  return "safe";
}

function metricPeriodLabel(definition: ServiceMetricDefinition, month: string) {
  if (definition.periodKind === "month") return month;
  if (definition.periodKind === "day") return "今日";
  return "現在";
}

function normalizeNumber(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function statusRank(status: UsageStatus) {
  return { unknown: 0, safe: 1, watch: 2, warning: 3, critical: 4 }[status];
}

export async function recordExternalServiceUsage(input: {
  serviceKey: string;
  metricKey: string;
  quantity?: number;
  unit?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await sql`
      insert into external_service_usage_events (service_key, metric_key, quantity, unit, source, metadata)
      values (
        ${input.serviceKey},
        ${input.metricKey},
        ${input.quantity ?? 1},
        ${input.unit ?? "count"},
        ${input.source ?? "app"},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
    `;
  } catch (error) {
    console.warn("external service usage event skipped", error);
  }
}

async function getMonthlyEventQuantity(serviceKey: string, metricKey: string, month: string) {
  const range = monthRange(month);
  const rows = await sql`
    select coalesce(sum(quantity), 0)::float as value
    from external_service_usage_events
    where service_key = ${serviceKey}
      and metric_key = ${metricKey}
      and recorded_at >= (${range.startDate}::date at time zone 'Asia/Tokyo')
      and recorded_at < ((${range.endDate}::date + interval '1 day') at time zone 'Asia/Tokyo')
  `;
  return normalizeNumber(rows[0]?.value);
}

async function readRawMetricValues(month: string) {
  const range = monthRange(month);
  const [
    databaseRows,
    blobRows,
    blobLegacyRows,
    emailEventValue,
    emailRows,
    pusherValue,
    clerkRows,
    larkRows,
    squareRows,
    komojuRows
  ] = await Promise.all([
    sql`select pg_database_size(current_database())::float as value`,
    getMonthlyEventQuantity("vercel_blob", "storage_bytes", month),
    sql`
      select (
        (select count(*) from products where coalesce(photo_url, '') <> '') +
        (select count(*) from field_notes where coalesce(photo_url, '') <> '') +
        (select count(*) from product_comparisons where coalesce(photo_url, '') <> '') +
        (select count(*) from purchase_order_supplier_fulfillments where coalesce(receipt_photo_url, '') <> '') +
        (select count(*) from menu_catalog_items where coalesce(image_url, '') <> '')
      )::int as count
    `,
    getMonthlyEventQuantity("resend", "emails_sent", month),
    sql`
      select count(*)::int as count
      from member_coupons
      where metadata->>'emailStatus' = 'sent'
        and coalesce(metadata->>'emailSentAt', metadata->>'emailCheckedAt') <> ''
        and nullif(coalesce(metadata->>'emailSentAt', metadata->>'emailCheckedAt'), '')::timestamptz >= (${range.startDate}::date at time zone 'Asia/Tokyo')
        and nullif(coalesce(metadata->>'emailSentAt', metadata->>'emailCheckedAt'), '')::timestamptz < ((${range.endDate}::date + interval '1 day') at time zone 'Asia/Tokyo')
    `,
    getMonthlyEventQuantity("pusher", "messages", month),
    sql`select count(*)::int as count from member_identity_links`,
    sql`
      select count(*)::int as count
      from employees
      where status = 'active'
        and (coalesce(lark_open_id, '') <> '' or coalesce(lark_user_id, '') <> '')
    `,
    sql`
      select coalesce(sum(amount), 0)::float as amount, count(*)::int as count
      from store_customer_orders
      where lower(payment_provider) = 'square'
        and coalesce(paid_at, payment_updated_at, created_at) >= (${range.startDate}::date at time zone 'Asia/Tokyo')
        and coalesce(paid_at, payment_updated_at, created_at) < ((${range.endDate}::date + interval '1 day') at time zone 'Asia/Tokyo')
    `,
    sql`
      select coalesce(sum(amount), 0)::float as amount, count(*)::int as count
      from store_customer_orders
      where lower(payment_provider) = 'komoju'
        and coalesce(paid_at, payment_updated_at, created_at) >= (${range.startDate}::date at time zone 'Asia/Tokyo')
        and coalesce(paid_at, payment_updated_at, created_at) < ((${range.endDate}::date + interval '1 day') at time zone 'Asia/Tokyo')
    `
  ]);

  return new Map<string, { value: number; note: string }>([
    ["vercel_hosting:commercial_plan", {
      value: process.env.VERCEL_ENV === "production" || process.env.VERCEL ? 1 : 0,
      note: "プラン名は Vercel 側で確認してください。商用利用の場合は Hobby のままにしない運用が必要です。"
    }],
    ["neon:database_storage_bytes", {
      value: normalizeNumber(databaseRows[0]?.value),
      note: "DB から直接取得した現在値です。"
    }],
    ["vercel_blob:storage_bytes", {
      value: blobRows,
      note: `新規アップロード台帳の合計です。既存画像/レシート ${normalizeNumber(blobLegacyRows[0]?.count)} 件は容量不明のため件数だけ補助表示しています。`
    }],
    ["resend:emails_sent", {
      value: Math.max(emailEventValue, normalizeNumber(emailRows[0]?.count)),
      note: "会員クーポン送信履歴と送信台帳の大きい方を表示しています。"
    }],
    ["pusher:messages", {
      value: pusherValue,
      note: "1 trigger x 配信先数で概算記録しています。Pusher 公式のメッセージ定義とは差が出る場合があります。"
    }],
    ["clerk:member_identities", {
      value: normalizeNumber(clerkRows[0]?.count),
      note: "Clerk API の MAU ではなく、OS に保存済みの会員 identity 連携数です。"
    }],
    ["lark:linked_users", {
      value: normalizeNumber(larkRows[0]?.count),
      note: "Lark open_id / user_id が設定された active スタッフ数です。"
    }],
    ["square:payment_amount", {
      value: normalizeNumber(squareRows[0]?.amount),
      note: `${normalizeNumber(squareRows[0]?.count)} 件の Square 注文から集計しています。`
    }],
    ["komoju:payment_amount", {
      value: normalizeNumber(komojuRows[0]?.amount),
      note: `${normalizeNumber(komojuRows[0]?.count)} 件の KOMOJU 注文から集計しています。`
    }]
  ]);
}

async function buildTrend(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(year, monthIndex - 1 - (5 - index), 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });

  return Promise.all(months.map(async (targetMonth) => {
    const range = monthRange(targetMonth);
    const [resendEmails, pusherMessages, blobBytes, paymentRows] = await Promise.all([
      getMonthlyEventQuantity("resend", "emails_sent", targetMonth),
      getMonthlyEventQuantity("pusher", "messages", targetMonth),
      getMonthlyEventQuantity("vercel_blob", "storage_bytes", targetMonth),
      sql`
        select
          coalesce(sum(amount) filter (where lower(payment_provider) = 'square'), 0)::float as "squareAmount",
          coalesce(sum(amount) filter (where lower(payment_provider) = 'komoju'), 0)::float as "komojuAmount"
        from store_customer_orders
        where coalesce(paid_at, payment_updated_at, created_at) >= (${range.startDate}::date at time zone 'Asia/Tokyo')
          and coalesce(paid_at, payment_updated_at, created_at) < ((${range.endDate}::date + interval '1 day') at time zone 'Asia/Tokyo')
      `
    ]);

    return {
      month: targetMonth,
      resendEmails,
      pusherMessages,
      blobBytes,
      squareAmount: normalizeNumber(paymentRows[0]?.squareAmount),
      komojuAmount: normalizeNumber(paymentRows[0]?.komojuAmount)
    };
  }));
}

export async function getExternalServiceUsageDashboard(month = currentTokyoMonth()): Promise<ExternalServiceUsageDashboard> {
  const rawValues = await readRawMetricValues(month);
  const metrics = metricDefinitions.map((definition): ExternalServiceMetric => {
    const raw = rawValues.get(`${definition.serviceKey}:${definition.metricKey}`);
    const value = raw?.value ?? 0;
    const percent = definition.limitValue && definition.limitValue > 0 ? Math.min(999, (value / definition.limitValue) * 100) : null;
    const status = getStatus(value, definition.limitValue);

    return {
      ...definition,
      value,
      displayValue: formatValue(value, definition.unit),
      displayLimit: definition.limitValue ? formatValue(definition.limitValue, definition.unit) : "従量課金",
      percent,
      status,
      periodLabel: metricPeriodLabel(definition, month),
      note: raw?.note ?? ""
    };
  });

  const serviceKeys = [...new Set(metrics.map((metric) => metric.serviceKey))];
  const services = serviceKeys.map((serviceKey) => {
    const serviceMetrics = metrics.filter((metric) => metric.serviceKey === serviceKey);
    const worstStatus = serviceMetrics.reduce<UsageStatus>((current, metric) => statusRank(metric.status) > statusRank(current) ? metric.status : current, "safe");
    return {
      serviceKey,
      serviceName: serviceMetrics[0]?.serviceName ?? serviceKey,
      status: worstStatus,
      metrics: serviceMetrics
    };
  });

  const estimatedMonthlyCostJpy = Math.round(
    normalizeNumber(rawValues.get("square:payment_amount")?.value) * 0.032 +
    normalizeNumber(rawValues.get("komoju:payment_amount")?.value) * 0.032
  );

  return {
    month,
    generatedAt: new Date().toISOString(),
    summary: {
      configuredCount: services.length,
      watchCount: metrics.filter((metric) => metric.status === "watch").length,
      warningCount: metrics.filter((metric) => metric.status === "warning").length,
      criticalCount: metrics.filter((metric) => metric.status === "critical").length,
      estimatedMonthlyCostJpy
    },
    metrics,
    services,
    trend: await buildTrend(month)
  };
}

export async function evaluateExternalServiceUsageAlerts(month = currentTokyoMonth()) {
  const dashboard = await getExternalServiceUsageDashboard(month);
  const alertMetrics = dashboard.metrics.filter((metric) => metric.status === "warning" || metric.status === "critical");
  if (alertMetrics.length === 0) return { ok: true, notificationCount: 0 };

  const owners = await sql`
    select id::text
    from employees
    where role = 'owner'
      and status = 'active'
  `;
  if (owners.length === 0) return { ok: true, notificationCount: 0 };

  let notificationCount = 0;
  for (const metric of alertMetrics) {
    if (!metric.limitValue) continue;
    const alertLevel = metric.status;
    const periodKey = `${metric.periodKind}:${metric.periodLabel}`;
    const inserted = await sql`
      insert into external_service_alert_events (
        service_key,
        metric_key,
        period_key,
        alert_level,
        usage_value,
        limit_value
      )
      values (
        ${metric.serviceKey},
        ${metric.metricKey},
        ${periodKey},
        ${alertLevel},
        ${metric.value},
        ${metric.limitValue}
      )
      on conflict (service_key, metric_key, period_key, alert_level) do nothing
      returning id::text
    `;
    if (!inserted[0]?.id) continue;

    const title = metric.status === "critical" ? "外部サービスの利用量が高くなっています" : "外部サービス利用量の確認が必要です";
    const message = `${metric.serviceName} / ${metric.metricLabel}: ${metric.displayValue} / ${metric.displayLimit}。${metric.paidTrigger}`;
    await Promise.all(owners.map((owner) => createOsNotification({
      employeeId: String(owner.id),
      type: "external_service_usage_alert",
      title,
      message,
      href: "/os/system-usage"
    })));
    notificationCount += owners.length;

    await sql`
      update external_service_alert_events
      set notification_count = ${owners.length}
      where id::text = ${String(inserted[0].id)}
    `;
  }

  return { ok: true, notificationCount };
}
