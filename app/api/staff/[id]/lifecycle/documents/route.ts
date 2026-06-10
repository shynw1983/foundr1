import { put } from "@vercel/blob";
import { requireStaffAdminSession, type StaffAdminAccess } from "../../../../../../lib/staff-admin-access";
import { sql } from "../../../../../../lib/db";
import { recordExternalServiceUsage } from "../../../../../../lib/external-service-usage";
import { validateReceiptUpload } from "../../../../../../lib/upload-security";

const maxDocumentImageSizeBytes = 8 * 1024 * 1024;
const maxDocumentPdfSizeBytes = 50 * 1024 * 1024;

async function canAccessEmployee(access: StaffAdminAccess, employeeId: string) {
  if (access.allStores) return true;

  const rows = await sql`
    select exists (
      select 1
      from employee_scopes
      where employee_id = ${employeeId}
        and scope_type = 'store'
        and store_id::text = any(${access.storeIds})
    ) or exists (
      select 1
      from employee_work_stores
      where employee_id = ${employeeId}
        and store_id::text = any(${access.storeIds})
    ) as "canAccess"
  `;

  return rows[0]?.canAccess === true;
}

function safeFilename(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80) || "document";
}

async function readLifecycleCases(employeeId: string) {
  const cases = await sql`
    select
      id::text,
      employee_id::text as "employeeId",
      case_type as "caseType",
      title,
      status,
      store_id::text as "storeId",
      coalesce(stores.name, '') as "storeName",
      started_at as "startedAt",
      completed_at as "completedAt",
      created_at as "createdAt",
      updated_at as "updatedAt"
    from employee_lifecycle_cases
    left join stores on stores.id = employee_lifecycle_cases.store_id
    where employee_id = ${employeeId}
    order by created_at desc
  `;
  const caseIds = cases.map((item) => String(item.id));
  const tasks = caseIds.length ? await sql`
    select
      id::text,
      lifecycle_case_id::text as "caseId",
      task_key as "taskKey",
      title,
      description,
      status,
      assignee_employee_id::text as "assigneeEmployeeId",
      due_date as "dueDate",
      completed_at as "completedAt",
      completed_by::text as "completedBy",
      note,
      required_document_types as "requiredDocumentTypes",
      sort_order as "sortOrder",
      updated_at as "updatedAt"
    from employee_lifecycle_tasks
    where lifecycle_case_id::text = any(${caseIds})
    order by lifecycle_case_id, sort_order, created_at
  ` : [];
  const documents = caseIds.length ? await sql`
    select
      id::text,
      lifecycle_case_id::text as "caseId",
      lifecycle_task_id::text as "taskId",
      document_type as "documentType",
      file_name as "fileName",
      file_url as "fileUrl",
      file_size_bytes as "fileSizeBytes",
      content_type as "contentType",
      uploaded_by::text as "uploadedBy",
      uploaded_at as "uploadedAt",
      note
    from employee_lifecycle_documents
    where lifecycle_case_id::text = any(${caseIds})
    order by uploaded_at desc
  ` : [];

  const tasksByCase = new Map<string, unknown[]>();
  for (const task of tasks) {
    const caseId = String(task.caseId);
    tasksByCase.set(caseId, [...(tasksByCase.get(caseId) ?? []), task]);
  }

  const documentsByCase = new Map<string, unknown[]>();
  for (const document of documents) {
    const caseId = String(document.caseId);
    documentsByCase.set(caseId, [...(documentsByCase.get(caseId) ?? []), document]);
  }

  return cases.map((item) => ({
    ...item,
    tasks: tasksByCase.get(String(item.id)) ?? [],
    documents: documentsByCase.get(String(item.id)) ?? []
  }));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireStaffAdminSession();
  if (!access) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const { id } = await context.params;
  if (!await canAccessEmployee(access, id)) {
    return Response.json({ error: "このスタッフを操作する権限がありません。" }, { status: 403 });
  }

  const formData = await request.formData();
  const caseId = String(formData.get("caseId") ?? "").trim();
  const taskId = String(formData.get("taskId") ?? "").trim();
  const documentType = String(formData.get("documentType") ?? "other").trim() || "other";
  const note = String(formData.get("note") ?? "").trim();
  const file = formData.get("file");

  if (!caseId || !(file instanceof File) || file.size <= 0) {
    return Response.json({ error: "手続きとファイルを選択してください。" }, { status: 400 });
  }

  const caseRows = await sql`
    select exists (
      select 1
      from employee_lifecycle_cases
      where id = ${caseId}
        and employee_id = ${id}
    ) as "caseExists"
  `;
  if (caseRows[0]?.caseExists !== true) {
    return Response.json({ error: "手続きが見つかりません。" }, { status: 404 });
  }

  if (taskId) {
    const taskRows = await sql`
      select exists (
        select 1
        from employee_lifecycle_tasks
        where id = ${taskId}
          and lifecycle_case_id = ${caseId}
      ) as "taskExists"
    `;
    if (taskRows[0]?.taskExists !== true) {
      return Response.json({ error: "タスクが見つかりません。" }, { status: 404 });
    }
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json({ error: "Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。" }, { status: 400 });
  }

  try {
    const extension = validateReceiptUpload(file, maxDocumentImageSizeBytes, maxDocumentPdfSizeBytes, "スタッフ手続き書類");
    const blob = await put(`staff-lifecycle/${id}/${safeFilename(documentType)}-${Date.now()}.${extension}`, file, {
      access: "private"
    });
    await recordExternalServiceUsage({
      serviceKey: "vercel_blob",
      metricKey: "storage_bytes",
      quantity: file.size,
      unit: "bytes",
      source: "staff_lifecycle_document",
      metadata: { pathname: blob.pathname, employeeId: id, caseId, taskId }
    });

    const fileUrl = `/api/products/photo/view?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;
    await sql`
      insert into employee_lifecycle_documents (
        lifecycle_case_id,
        lifecycle_task_id,
        document_type,
        file_name,
        file_url,
        file_size_bytes,
        content_type,
        uploaded_by,
        note
      )
      values (
        ${caseId},
        ${taskId || null},
        ${documentType},
        ${file.name || ""},
        ${fileUrl},
        ${file.size},
        ${file.type || ""},
        ${access.session.id},
        ${note}
      )
    `;
    await sql`
      update employee_lifecycle_cases
      set updated_by = ${access.session.id}, updated_at = now()
      where id = ${caseId}
    `;

    return Response.json({ ok: true, cases: await readLifecycleCases(id) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "書類を保存できませんでした。" }, { status: 400 });
  }
}
