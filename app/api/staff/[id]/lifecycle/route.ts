import { requireStaffAdminSession, type StaffAdminAccess } from "../../../../../lib/staff-admin-access";
import { sql } from "../../../../../lib/db";

type LifecycleCaseType = "onboarding" | "offboarding";

type LifecycleTemplateTask = {
  key: string;
  title: string;
  description: string;
  requiredDocumentTypes: string[];
  appliesWhen?: (context: LifecycleWorkStoreContext) => boolean;
  notRequiredNote?: string;
};

type LifecycleWorkStoreContext = {
  storeId: string;
  storeName: string;
  hireDate: string | null;
  resignationDate: string | null;
  isForeignNational: boolean;
  applySocialInsurance: boolean;
  applyEmploymentInsurance: boolean;
  applyLaborInsurance: boolean;
  applyIncomeTax: boolean;
  applyResidentTax: boolean;
};

const allowedCaseTypes = new Set(["onboarding", "offboarding"]);
const allowedTaskStatuses = new Set(["todo", "doing", "done", "not_required"]);

const lifecycleTemplates: Record<LifecycleCaseType, { title: string; tasks: LifecycleTemplateTask[] }> = {
  onboarding: {
    title: "入社手続き",
    tasks: [
      {
        key: "employment_terms",
        title: "採用条件と勤務区分を確定",
        description: "雇用形態、所属店舗、入社日、勤務時間、賃金、交通費、給与対象区分を確定します。",
        requiredDocumentTypes: ["労働条件通知書", "雇用契約書"]
      },
      {
        key: "personal_info",
        title: "本人情報・必要書類を回収",
        description: "氏名、住所、生年月日、緊急連絡先、振込口座、雇用保険番号、基礎年金番号またはマイナンバーを確認します。",
        requiredDocumentTypes: ["本人確認書類", "振込口座", "前職源泉徴収票"]
      },
      {
        key: "foreign_national",
        title: "外国籍スタッフの就労可否を確認",
        description: "在留カード、在留資格、在留期間、資格外活動許可を確認します。",
        requiredDocumentTypes: ["在留カード"],
        appliesWhen: (context) => context.isForeignNational,
        notRequiredNote: "外国籍スタッフではないため対象外です。"
      },
      {
        key: "tax_setup",
        title: "税務・給与控除を設定",
        description: "扶養控除等申告書、所得税区分、住民税、交通費、給与締日支払日を確認します。",
        requiredDocumentTypes: ["扶養控除等申告書"],
        appliesWhen: (context) => context.applyIncomeTax || context.applyResidentTax,
        notRequiredNote: "この店舗の給与設定で源泉所得税・住民税が対象外のため不要です。"
      },
      {
        key: "social_insurance",
        title: "社会保険の資格取得",
        description: "健康保険・厚生年金の加入対象を判定し、対象者は資格取得届を処理します。",
        requiredDocumentTypes: ["社会保険資格取得控え"],
        appliesWhen: (context) => context.applySocialInsurance,
        notRequiredNote: "この店舗の給与設定で社会保険が対象外のため不要です。"
      },
      {
        key: "employment_insurance",
        title: "雇用保険の資格取得",
        description: "雇用保険対象者は資格取得届を処理します。提出期限は翌月10日までです。",
        requiredDocumentTypes: ["雇用保険資格取得控え"],
        appliesWhen: (context) => context.applyEmploymentInsurance,
        notRequiredNote: "この店舗の給与設定で雇用保険が対象外のため不要です。"
      },
      {
        key: "labor_insurance",
        title: "労働保険の給与設定を確認",
        description: "労働保険の対象設定と給与計算への反映を確認します。",
        requiredDocumentTypes: [],
        appliesWhen: (context) => context.applyLaborInsurance,
        notRequiredNote: "この店舗の給与設定で労働保険が対象外のため不要です。"
      },
      {
        key: "os_access",
        title: "Foundr1 OSアカウント・権限を設定",
        description: "役割、所属店舗、勤務店舗、初回パスワード変更、プライバシー同意を設定します。",
        requiredDocumentTypes: []
      },
      {
        key: "first_shift",
        title: "初回勤務前の受け入れ準備",
        description: "制服、名札、衛生ルール、勤怠打刻、研修、初回シフトを確認します。",
        requiredDocumentTypes: []
      }
    ]
  },
  offboarding: {
    title: "退社手続き",
    tasks: [
      {
        key: "resignation_terms",
        title: "退職日と退職理由を確定",
        description: "退職申出、契約満了、解雇などの区分と最終出勤日、退職日、有給残を確認します。",
        requiredDocumentTypes: ["退職届", "退職理由確認資料"]
      },
      {
        key: "final_attendance",
        title: "最終勤務・勤怠・給与データを締める",
        description: "最終打刻、休憩、有給、交通費、立替精算、未返却品を確認します。",
        requiredDocumentTypes: ["最終勤怠確認"]
      },
      {
        key: "access_return",
        title: "貸与物回収・アクセス停止",
        description: "制服、鍵、ICカード、店舗Pad、Lark、POS、Foundr1 OS権限を停止します。",
        requiredDocumentTypes: ["貸与物回収記録"]
      },
      {
        key: "social_insurance_loss",
        title: "社会保険の資格喪失",
        description: "健康保険・厚生年金の資格喪失届を処理します。提出期限は事実発生から5日以内です。",
        requiredDocumentTypes: ["社会保険資格喪失控え"],
        appliesWhen: (context) => context.applySocialInsurance,
        notRequiredNote: "この店舗の給与設定で社会保険が対象外のため不要です。"
      },
      {
        key: "employment_insurance_loss",
        title: "雇用保険資格喪失・離職票",
        description: "資格喪失届、離職証明書、離職票要否を確認します。提出期限は翌日から10日以内です。",
        requiredDocumentTypes: ["雇用保険資格喪失控え", "離職証明書"],
        appliesWhen: (context) => context.applyEmploymentInsurance,
        notRequiredNote: "この店舗の給与設定で雇用保険が対象外のため不要です。"
      },
      {
        key: "foreign_national_loss",
        title: "外国籍スタッフの離職届出",
        description: "外国人雇用状況の離職届出を確認します。",
        requiredDocumentTypes: ["外国人雇用状況届出控え"],
        appliesWhen: (context) => context.isForeignNational,
        notRequiredNote: "外国籍スタッフではないため対象外です。"
      },
      {
        key: "tax_documents",
        title: "税務・住民税・退職書類を交付",
        description: "源泉徴収票、退職証明書、住民税切替、退職所得書類を確認します。",
        requiredDocumentTypes: ["源泉徴収票", "退職証明書"],
        appliesWhen: (context) => context.applyIncomeTax || context.applyResidentTax,
        notRequiredNote: "この店舗の給与設定で源泉所得税・住民税が対象外のため不要です。"
      },
      {
        key: "archive",
        title: "最終確認と履歴保存",
        description: "スタッフ状態、退職日、退職理由、届出完了日、書類交付を記録します。",
        requiredDocumentTypes: []
      }
    ]
  }
};

function normalizeCaseType(value: unknown): LifecycleCaseType | null {
  const caseType = String(value ?? "").trim();
  return allowedCaseTypes.has(caseType) ? caseType as LifecycleCaseType : null;
}

function normalizeStatus(value: unknown) {
  const status = String(value ?? "").trim();
  return allowedTaskStatuses.has(status) ? status : "todo";
}

function toNullableDate(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

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

async function readLifecycleContexts(employeeId: string, access: StaffAdminAccess): Promise<LifecycleWorkStoreContext[]> {
  const rows = await sql`
    select
      stores.id::text as "storeId",
      stores.name as "storeName",
      employee_work_stores.hire_date as "hireDate",
      employee_work_stores.resignation_date as "resignationDate",
      employees.is_foreign_national as "isForeignNational",
      employee_work_stores.apply_social_insurance as "applySocialInsurance",
      employee_work_stores.apply_employment_insurance as "applyEmploymentInsurance",
      employee_work_stores.apply_labor_insurance as "applyLaborInsurance",
      employee_work_stores.apply_income_tax as "applyIncomeTax",
      employee_work_stores.apply_resident_tax as "applyResidentTax"
    from employee_work_stores
    join stores on stores.id = employee_work_stores.store_id
    join employees on employees.id = employee_work_stores.employee_id
    where employee_work_stores.employee_id = ${employeeId}
      and (${access.allStores} or employee_work_stores.store_id::text = any(${access.storeIds}))
    order by stores.name
  `;

  return rows.map((row) => ({
    storeId: String(row.storeId),
    storeName: String(row.storeName ?? ""),
    hireDate: row.hireDate ? String(row.hireDate).slice(0, 10) : null,
    resignationDate: row.resignationDate ? String(row.resignationDate).slice(0, 10) : null,
    isForeignNational: row.isForeignNational === true,
    applySocialInsurance: row.applySocialInsurance === true,
    applyEmploymentInsurance: row.applyEmploymentInsurance === true,
    applyLaborInsurance: row.applyLaborInsurance === true,
    applyIncomeTax: row.applyIncomeTax === true,
    applyResidentTax: row.applyResidentTax === true
  }));
}

function getTaskStatusForContext(task: LifecycleTemplateTask, context: LifecycleWorkStoreContext) {
  return task.appliesWhen && !task.appliesWhen(context) ? "not_required" : "todo";
}

async function upsertLifecycleCase(employeeId: string, caseType: LifecycleCaseType, context: LifecycleWorkStoreContext, sessionId: string) {
  const template = lifecycleTemplates[caseType];
  const startedAt = caseType === "onboarding" ? context.hireDate : context.resignationDate;
  if (!startedAt) return null;

  const title = `${context.storeName} ${template.title}チェックリスト`;
  const existingRows = await sql`
    select id::text
    from employee_lifecycle_cases
    where employee_id = ${employeeId}
      and case_type = ${caseType}
      and store_id is not distinct from ${context.storeId}
      and status <> 'archived'
    order by created_at
    limit 1
  `;
  const existingId = String(existingRows[0]?.id ?? "");
  const caseRows = existingId ? await sql`
    update employee_lifecycle_cases
    set
      title = ${title},
      started_at = ${startedAt},
      updated_by = ${sessionId},
      updated_at = now()
    where id = ${existingId}
    returning id::text
  ` : await sql`
    insert into employee_lifecycle_cases (
      employee_id,
      case_type,
      title,
      status,
      store_id,
      started_at,
      created_by,
      updated_by,
      updated_at
    )
    values (
      ${employeeId},
      ${caseType},
      ${title},
      'open',
      ${context.storeId},
      ${startedAt},
      ${sessionId},
      ${sessionId},
      now()
    )
    returning id::text
  `;
  const caseId = String(caseRows[0]?.id ?? "");

  for (const [index, task] of template.tasks.entries()) {
    const targetStatus = getTaskStatusForContext(task, context);
    const targetNote = targetStatus === "not_required" ? task.notRequiredNote ?? "条件により対象外です。" : "";
    await sql`
      insert into employee_lifecycle_tasks (
        lifecycle_case_id,
        task_key,
        title,
        description,
        status,
        note,
        required_document_types,
        sort_order,
        updated_at
      )
      values (
        ${caseId},
        ${task.key},
        ${task.title},
        ${task.description},
        ${targetStatus},
        ${targetNote},
        ${JSON.stringify(task.requiredDocumentTypes)}::jsonb,
        ${index * 10},
        now()
      )
      on conflict (lifecycle_case_id, task_key)
      do update set
        title = excluded.title,
        description = excluded.description,
        status = case
          when employee_lifecycle_tasks.status = 'not_required' and excluded.status = 'todo' then 'todo'
          when excluded.status = 'not_required' and employee_lifecycle_tasks.status in ('todo', 'doing') then 'not_required'
          else employee_lifecycle_tasks.status
        end,
        note = case
          when excluded.status = 'not_required' and employee_lifecycle_tasks.status in ('todo', 'doing', 'not_required') then excluded.note
          when employee_lifecycle_tasks.status = 'not_required' and excluded.status = 'todo' then ''
          else employee_lifecycle_tasks.note
        end,
        required_document_types = excluded.required_document_types,
        sort_order = excluded.sort_order,
        updated_at = now()
    `;
  }

  await refreshCaseCompletion(caseId, sessionId);
  return caseId;
}

async function syncLifecycleCases(employeeId: string, access: StaffAdminAccess, caseType?: LifecycleCaseType, storeId?: string | null) {
  const contexts = await readLifecycleContexts(employeeId, access);
  const scopedContexts = contexts.filter((context) => (!storeId || context.storeId === storeId));
  for (const context of scopedContexts) {
    if (!caseType || caseType === "onboarding") {
      await upsertLifecycleCase(employeeId, "onboarding", context, access.session.id);
    }
    if (!caseType || caseType === "offboarding") {
      await upsertLifecycleCase(employeeId, "offboarding", context, access.session.id);
    }
  }
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
    order by created_at desc, title
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

async function refreshCaseCompletion(caseId: string, sessionId: string) {
  const rows = await sql`
    select
      count(*)::int as total,
      count(*) filter (where status in ('done', 'not_required'))::int as finished
    from employee_lifecycle_tasks
    where lifecycle_case_id = ${caseId}
  `;
  const total = Number(rows[0]?.total ?? 0);
  const finished = Number(rows[0]?.finished ?? 0);
  const complete = total > 0 && total === finished;

  await sql`
    update employee_lifecycle_cases
    set
      status = case when ${complete} then 'completed' else 'open' end,
      completed_at = case when ${complete} then coalesce(completed_at, now()) else null end,
      updated_by = ${sessionId},
      updated_at = now()
    where id = ${caseId}
  `;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireStaffAdminSession();
  if (!access) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const { id } = await context.params;
  if (!await canAccessEmployee(access, id)) {
    return Response.json({ error: "このスタッフを操作する権限がありません。" }, { status: 403 });
  }

  await syncLifecycleCases(id, access);
  return Response.json({ cases: await readLifecycleCases(id) });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireStaffAdminSession();
  if (!access) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const { id } = await context.params;
  if (!await canAccessEmployee(access, id)) {
    return Response.json({ error: "このスタッフを操作する権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { caseType?: string; storeId?: string };
  const caseType = normalizeCaseType(body.caseType);
  if (!caseType) return Response.json({ error: "手続き種別を選択してください。" }, { status: 400 });

  const selectedStoreId = String(body.storeId ?? "").trim();
  const storeId = selectedStoreId && (access.allStores || access.storeIds.includes(selectedStoreId)) ? selectedStoreId : null;
  await syncLifecycleCases(id, access, caseType, storeId);
  const syncedCases = await readLifecycleCases(id) as Array<{ caseType?: string; storeId?: string | null }>;
  const hasCase = syncedCases.some((item) => (
    String(item.caseType) === caseType && (!storeId || String(item.storeId) === storeId)
  ));
  if (!hasCase) {
    const message = caseType === "onboarding"
      ? "勤務店舗の入社日が未設定のため、入社手続きを自動生成できません。勤務・給与情報で入社日を入力してください。"
      : "勤務店舗の退職日が未設定のため、退社手続きを自動生成できません。勤務・給与情報で退職日を入力してください。";
    return Response.json({ error: message }, { status: 400 });
  }

  return Response.json({ ok: true, cases: await readLifecycleCases(id) });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireStaffAdminSession();
  if (!access) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const { id } = await context.params;
  if (!await canAccessEmployee(access, id)) {
    return Response.json({ error: "このスタッフを操作する権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as {
    taskId?: string;
    status?: string;
    dueDate?: string;
    assigneeEmployeeId?: string;
    note?: string;
  };
  const taskId = String(body.taskId ?? "").trim();
  if (!taskId) return Response.json({ error: "タスクIDが必要です。" }, { status: 400 });

  const status = normalizeStatus(body.status);
  const rows = await sql`
    update employee_lifecycle_tasks
    set
      status = ${status},
      assignee_employee_id = ${String(body.assigneeEmployeeId ?? "").trim() || null},
      due_date = ${toNullableDate(body.dueDate)},
      note = ${String(body.note ?? "").trim()},
      completed_at = case when ${status} = 'done' then coalesce(completed_at, now()) else null end,
      completed_by = case when ${status} = 'done' then ${access.session.id} else null end,
      updated_at = now()
    from employee_lifecycle_cases
    where employee_lifecycle_tasks.id = ${taskId}
      and employee_lifecycle_tasks.lifecycle_case_id = employee_lifecycle_cases.id
      and employee_lifecycle_cases.employee_id = ${id}
    returning employee_lifecycle_tasks.lifecycle_case_id::text as "caseId"
  `;
  const caseId = String(rows[0]?.caseId ?? "");
  if (!caseId) return Response.json({ error: "タスクが見つかりません。" }, { status: 404 });

  await refreshCaseCompletion(caseId, access.session.id);

  return Response.json({ ok: true, cases: await readLifecycleCases(id) });
}
