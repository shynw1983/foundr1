import { put } from "@vercel/blob";
import { requireOsSession, getSessionStoreScope } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";
import { recordExternalServiceUsage } from "../../../lib/external-service-usage";
import { validateImageUpload } from "../../../lib/upload-security";

const submitRoles = new Set(["owner", "manager", "store_owner", "store_manager", "staff", "store_terminal"]);
const manageRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const masterRoles = new Set(["owner", "manager"]);
const sources = new Set(["store", "os"]);
const severities = new Set(["normal", "work_blocked", "urgent"]);
const statuses = new Set(["open", "reviewing", "resolved", "closed"]);
const maxScreenshotSizeBytes = 5 * 1024 * 1024;

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "active-staff") {
    if (!submitRoles.has(session.role)) {
      return Response.json({ error: "権限がありません。" }, { status: 403 });
    }
    const storeId = String(url.searchParams.get("storeId") ?? "").trim();
    const activeStaff = await loadActiveFeedbackStaff(session, storeId);
    return Response.json({
      currentEmployeeRole: session.role,
      activeStaff
    });
  }

  if (!manageRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const source = normalizeSource(url.searchParams.get("source"));
  const status = normalizeOptionalStatus(url.searchParams.get("status"));
  const rows = await loadFeedbackReports(session, source, status);

  return Response.json({ reports: rows });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !submitRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const formData = await request.formData();
  const source = normalizeRequiredSource(formData.get("source"));
  const module = String(formData.get("module") ?? "").trim();
  const category = String(formData.get("category") ?? "bug").trim() || "bug";
  const severity = normalizeSeverity(formData.get("severity"));
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const expectedResult = String(formData.get("expectedResult") ?? "").trim();
  const pageUrl = String(formData.get("pageUrl") ?? "").trim();
  const userAgent = String(formData.get("userAgent") ?? "").trim();
  const language = String(formData.get("language") ?? "").trim();
  const viewportWidth = normalizeInteger(formData.get("viewportWidth"));
  const viewportHeight = normalizeInteger(formData.get("viewportHeight"));
  const metadata = parseMetadata(formData.get("metadata"));

  if (!description) {
    return Response.json({ error: "内容を入力してください。" }, { status: 400 });
  }

  const context = await resolveReportContext(session);
  const screenshotUrl = await uploadScreenshotIfNeeded(formData.get("screenshot"), title || description, "feedback-reports");

  await sql`
    insert into feedback_reports (
      source,
      module,
      category,
      severity,
      title,
      description,
      expected_result,
      page_url,
      screenshot_url,
      reported_by,
      store_id,
      brand_id,
      user_agent,
      viewport_width,
      viewport_height,
      language,
      metadata,
      updated_at
    ) values (
      ${source},
      ${module},
      ${category},
      ${severity},
      ${title},
      ${description},
      ${expectedResult},
      ${pageUrl},
      ${screenshotUrl},
      ${session.id},
      ${context.storeId},
      ${context.brandId},
      ${userAgent},
      ${viewportWidth},
      ${viewportHeight},
      ${language},
      ${JSON.stringify(metadata)}::jsonb,
      now()
    )
  `;

  return Response.json({ ok: true });
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session || !manageRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as {
    id?: string;
    status?: string;
    adminNote?: string;
  };
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "フィードバックが見つかりません。" }, { status: 404 });

  const canAccess = await canAccessReport(session, id);
  if (!canAccess) {
    return Response.json({ error: "このフィードバックを更新する権限がありません。" }, { status: 403 });
  }

  const status = normalizeStatus(body.status);
  await sql`
    update feedback_reports
    set
      status = ${status},
      admin_note = ${String(body.adminNote ?? "").trim()},
      handled_by = case when ${status} in ('resolved', 'closed') then ${session.id} else handled_by end,
      handled_at = case when ${status} in ('resolved', 'closed') then now() else null end,
      updated_at = now()
    where id = ${id}
  `;

  return Response.json({ ok: true });
}

async function loadFeedbackReports(session: { id: string; role: string }, source: string, status: string) {
  if (masterRoles.has(session.role)) {
    return sql`
      select
        feedback_reports.id::text as id,
        feedback_reports.source,
        feedback_reports.module,
        feedback_reports.category,
        feedback_reports.severity,
        feedback_reports.status,
        feedback_reports.title,
        feedback_reports.description,
        feedback_reports.expected_result as "expectedResult",
        feedback_reports.page_url as "pageUrl",
        feedback_reports.screenshot_url as "screenshotUrl",
        feedback_reports.reported_by::text as "reportedById",
        coalesce(reporter.name, '') as "reportedBy",
        feedback_reports.store_id::text as "storeId",
        coalesce(stores.name, '') as "storeName",
        feedback_reports.brand_id::text as "brandId",
        coalesce(brands.name, '') as "brandName",
        feedback_reports.user_agent as "userAgent",
        feedback_reports.viewport_width as "viewportWidth",
        feedback_reports.viewport_height as "viewportHeight",
        feedback_reports.language,
        feedback_reports.metadata,
        feedback_reports.admin_note as "adminNote",
        feedback_reports.handled_by::text as "handledById",
        coalesce(handler.name, '') as "handledBy",
        to_char(feedback_reports.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "createdLabel",
        to_char(feedback_reports.updated_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "updatedLabel",
        to_char(feedback_reports.handled_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "handledLabel"
      from feedback_reports
      left join employees reporter on reporter.id = feedback_reports.reported_by
      left join employees handler on handler.id = feedback_reports.handled_by
      left join stores on stores.id = feedback_reports.store_id
      left join brands on brands.id = feedback_reports.brand_id
      where (${source} = '' or feedback_reports.source = ${source})
        and (${status} = '' or feedback_reports.status = ${status})
      order by feedback_reports.created_at desc
      limit 200
    `;
  }

  const scope = await getSessionStoreScope(session as any);
  if (!scope.storeIds.length) {
    return sql`
      select
        feedback_reports.id::text as id,
        feedback_reports.source,
        feedback_reports.module,
        feedback_reports.category,
        feedback_reports.severity,
        feedback_reports.status,
        feedback_reports.title,
        feedback_reports.description,
        feedback_reports.expected_result as "expectedResult",
        feedback_reports.page_url as "pageUrl",
        feedback_reports.screenshot_url as "screenshotUrl",
        feedback_reports.reported_by::text as "reportedById",
        coalesce(reporter.name, '') as "reportedBy",
        feedback_reports.store_id::text as "storeId",
        coalesce(stores.name, '') as "storeName",
        feedback_reports.brand_id::text as "brandId",
        coalesce(brands.name, '') as "brandName",
        feedback_reports.user_agent as "userAgent",
        feedback_reports.viewport_width as "viewportWidth",
        feedback_reports.viewport_height as "viewportHeight",
        feedback_reports.language,
        feedback_reports.metadata,
        feedback_reports.admin_note as "adminNote",
        feedback_reports.handled_by::text as "handledById",
        coalesce(handler.name, '') as "handledBy",
        to_char(feedback_reports.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "createdLabel",
        to_char(feedback_reports.updated_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "updatedLabel",
        to_char(feedback_reports.handled_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "handledLabel"
      from feedback_reports
      left join employees reporter on reporter.id = feedback_reports.reported_by
      left join employees handler on handler.id = feedback_reports.handled_by
      left join stores on stores.id = feedback_reports.store_id
      left join brands on brands.id = feedback_reports.brand_id
      where feedback_reports.reported_by = ${session.id}
        and (${source} = '' or feedback_reports.source = ${source})
        and (${status} = '' or feedback_reports.status = ${status})
      order by feedback_reports.created_at desc
      limit 200
    `;
  }

  return sql`
    select
      feedback_reports.id::text as id,
      feedback_reports.source,
      feedback_reports.module,
      feedback_reports.category,
      feedback_reports.severity,
      feedback_reports.status,
      feedback_reports.title,
      feedback_reports.description,
      feedback_reports.expected_result as "expectedResult",
      feedback_reports.page_url as "pageUrl",
      feedback_reports.screenshot_url as "screenshotUrl",
      feedback_reports.reported_by::text as "reportedById",
      coalesce(reporter.name, '') as "reportedBy",
      feedback_reports.store_id::text as "storeId",
      coalesce(stores.name, '') as "storeName",
      feedback_reports.brand_id::text as "brandId",
      coalesce(brands.name, '') as "brandName",
      feedback_reports.user_agent as "userAgent",
      feedback_reports.viewport_width as "viewportWidth",
      feedback_reports.viewport_height as "viewportHeight",
      feedback_reports.language,
      feedback_reports.metadata,
      feedback_reports.admin_note as "adminNote",
      feedback_reports.handled_by::text as "handledById",
      coalesce(handler.name, '') as "handledBy",
      to_char(feedback_reports.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "createdLabel",
      to_char(feedback_reports.updated_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "updatedLabel",
      to_char(feedback_reports.handled_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "handledLabel"
    from feedback_reports
    left join employees reporter on reporter.id = feedback_reports.reported_by
    left join employees handler on handler.id = feedback_reports.handled_by
    left join stores on stores.id = feedback_reports.store_id
    left join brands on brands.id = feedback_reports.brand_id
    where (feedback_reports.reported_by = ${session.id} or feedback_reports.store_id::text = any(${scope.storeIds}))
      and (${source} = '' or feedback_reports.source = ${source})
      and (${status} = '' or feedback_reports.status = ${status})
    order by feedback_reports.created_at desc
    limit 200
  `;
}

async function loadActiveFeedbackStaff(session: { id: string; role: string }, requestedStoreId: string) {
  const scope = await getSessionStoreScope(session as any);
  const storeIds = scope.allStores
    ? requestedStoreId ? [requestedStoreId] : []
    : requestedStoreId && scope.storeIds.includes(requestedStoreId) ? [requestedStoreId] : scope.storeIds;

  if (!storeIds.length) return [];

  const rows = await sql`
    select
      latest_punch.employee_id::text as "employeeId",
      employees.name as "employeeName",
      latest_punch.store_id::text as "storeId",
      stores.name as "storeName",
      latest_punch.punch_type as "punchType",
      latest_punch.punched_at as "punchedAt"
    from (
      select distinct on (timecard_punches.employee_id)
        timecard_punches.employee_id,
        timecard_punches.store_id,
        timecard_punches.punch_type,
        timecard_punches.punched_at
      from timecard_punches
      where timecard_punches.store_id::text = any(${storeIds})
        and timecard_punches.punched_at >= now() - interval '36 hours'
      order by timecard_punches.employee_id, timecard_punches.punched_at desc
    ) latest_punch
    join employees on employees.id = latest_punch.employee_id
    join stores on stores.id = latest_punch.store_id
    where latest_punch.punch_type in ('clock_in', 'break_start', 'break_end')
      and employees.status = 'active'
    order by stores.name, employees.name
  `;

  return rows.map((row) => ({
    employeeId: String(row.employeeId),
    employeeName: String(row.employeeName),
    storeId: String(row.storeId),
    storeName: String(row.storeName),
    punchType: String(row.punchType),
    punchedAt: new Date(String(row.punchedAt)).toISOString()
  }));
}

async function canAccessReport(session: { id: string; role: string }, id: string) {
  if (masterRoles.has(session.role)) return true;
  const scope = await getSessionStoreScope(session as any);
  const rows = await sql`
    select id
    from feedback_reports
    where id = ${id}
      and (
        reported_by = ${session.id}
        or (${scope.storeIds.length} > 0 and store_id::text = any(${scope.storeIds}))
      )
    limit 1
  `;
  return rows.length > 0;
}

async function resolveReportContext(session: { id: string; role: string }) {
  const rows = await sql`
    select
      employee_scopes.store_id::text as "storeId",
      store_brands.brand_id::text as "brandId"
    from employee_scopes
    left join store_brands on store_brands.store_id = employee_scopes.store_id
    where employee_scopes.employee_id = ${session.id}
      and employee_scopes.scope_type = 'store'
      and employee_scopes.store_id is not null
    order by employee_scopes.created_at asc
    limit 1
  `;
  if (rows[0]?.storeId) {
    return {
      storeId: String(rows[0].storeId),
      brandId: rows[0]?.brandId ? String(rows[0].brandId) : null
    };
  }

  const workStoreRows = await sql`
    select
      employee_work_stores.store_id::text as "storeId",
      store_brands.brand_id::text as "brandId"
    from employee_work_stores
    left join store_brands on store_brands.store_id = employee_work_stores.store_id
    where employee_work_stores.employee_id = ${session.id}
    order by employee_work_stores.created_at asc
    limit 1
  `;

  return {
    storeId: workStoreRows[0]?.storeId ? String(workStoreRows[0].storeId) : null,
    brandId: workStoreRows[0]?.brandId ? String(workStoreRows[0].brandId) : null
  };
}

function normalizeSource(value: FormDataEntryValue | string | null) {
  const source = String(value ?? "");
  return sources.has(source) ? source : "";
}

function normalizeRequiredSource(value: FormDataEntryValue | string | null) {
  const source = String(value ?? "");
  return sources.has(source) ? source : "os";
}

function normalizeSeverity(value: FormDataEntryValue | null) {
  const severity = String(value ?? "");
  return severities.has(severity) ? severity : "normal";
}

function normalizeOptionalStatus(value: string | null) {
  const status = String(value ?? "");
  return statuses.has(status) ? status : "";
}

function normalizeStatus(value: unknown) {
  const status = String(value ?? "");
  return statuses.has(status) ? status : "open";
}

function normalizeInteger(value: FormDataEntryValue | null) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function parseMetadata(value: FormDataEntryValue | null) {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function uploadScreenshotIfNeeded(file: FormDataEntryValue | null, name: string, folder: string) {
  if (!(file instanceof File) || file.size === 0) return "";

  const extension = validateImageUpload(file, maxScreenshotSizeBytes, "スクリーンショット");

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。");
  }

  const safeName = name.replace(/[^\w.-]+/g, "-").toLowerCase().slice(0, 60) || "feedback";
  const blob = await put(`${folder}/${safeName}-${Date.now()}.${extension}`, file, {
    access: "private"
  });
  await recordExternalServiceUsage({
    serviceKey: "vercel_blob",
    metricKey: "storage_bytes",
    quantity: file.size,
    unit: "bytes",
    source: "feedback_screenshot",
    metadata: { pathname: blob.pathname }
  });

  return `/api/products/photo/view?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;
}
