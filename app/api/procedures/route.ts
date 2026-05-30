import { getSessionStoreScope, requireOpsSession } from "../../../lib/api-auth";
import type { EmployeeSession } from "../../../lib/auth";
import { sql } from "../../../lib/db";

type ProcedureProductPayload = {
  productId?: string;
  quantity?: string | number | null;
  unit?: string;
  note?: string;
};

type ProcedureStepPayload = {
  title?: string;
  instruction?: string;
  caution?: string;
  estimatedMinutes?: string | number | null;
  mediaUrl?: string;
  products?: ProcedureProductPayload[];
};

type ProcedureBookPayload = {
  id?: string;
  title?: string;
  category?: string;
  summary?: string;
  status?: string;
  brandId?: string;
  storeIds?: string[];
  steps?: ProcedureStepPayload[];
};

const procedureEditorRoles = new Set(["owner", "manager"]);

function canEditProcedures(session: EmployeeSession) {
  return procedureEditorRoles.has(session.role);
}

function cleanStatus(value: unknown) {
  return String(value ?? "") === "published" ? "published" : "draft";
}

function parseOptionalNumber(value: unknown) {
  const normalized = String(value ?? "").replace(/[,\s]/g, "");
  if (!normalized) return null;
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function parseOptionalInteger(value: unknown) {
  const numberValue = parseOptionalNumber(value);
  return numberValue === null ? null : Math.round(numberValue);
}

async function readProcedures(session: EmployeeSession, mode: string) {
  const scope = await getSessionStoreScope(session);
  const includeDraft = mode === "admin" && canEditProcedures(session);

  const books = await sql`
    select
      procedure_books.id::text,
      procedure_books.title,
      procedure_books.category,
      coalesce(procedure_books.summary, '') as summary,
      procedure_books.status,
      procedure_books.version_number as "versionNumber",
      procedure_books.published_at as "publishedAt",
      procedure_books.updated_at as "updatedAt",
      brands.id::text as "brandId",
      coalesce(brands.name, '') as brand,
      coalesce((
        select json_agg(json_build_object('id', stores.id::text, 'name', stores.name) order by stores.name)
        from procedure_book_stores
        join stores on stores.id = procedure_book_stores.store_id
        where procedure_book_stores.procedure_book_id = procedure_books.id
      ), '[]'::json) as stores
    from procedure_books
    left join brands on brands.id = procedure_books.brand_id
    where (${includeDraft} or procedure_books.status = 'published')
      and (
        ${scope.allStores}
        or not exists (
          select 1
          from procedure_book_stores scoped_assignments
          where scoped_assignments.procedure_book_id = procedure_books.id
        )
        or exists (
          select 1
          from procedure_book_stores scoped_assignments
          where scoped_assignments.procedure_book_id = procedure_books.id
            and scoped_assignments.store_id::text = any(${scope.storeIds})
        )
      )
    order by procedure_books.updated_at desc, procedure_books.title
  `;

  const bookIds = books.map((book) => String(book.id));
  const steps = bookIds.length
    ? await sql`
        select
          procedure_steps.id::text,
          procedure_steps.procedure_book_id::text as "bookId",
          procedure_steps.sort_order as "sortOrder",
          procedure_steps.title,
          procedure_steps.instruction,
          coalesce(procedure_steps.caution, '') as caution,
          procedure_steps.estimated_minutes as "estimatedMinutes",
          coalesce(procedure_steps.media_url, '') as "mediaUrl"
        from procedure_steps
        where procedure_steps.procedure_book_id::text = any(${bookIds})
        order by procedure_steps.procedure_book_id, procedure_steps.sort_order, procedure_steps.created_at
      `
    : [];

  const stepIds = steps.map((step) => String(step.id));
  const stepProducts = stepIds.length
    ? await sql`
        select
          procedure_step_products.id::text,
          procedure_step_products.procedure_step_id::text as "stepId",
          products.id::text as "productId",
          products.name as "productName",
          coalesce(products.japanese_note, '') as "japaneseNote",
          products.category,
          coalesce(products.subcategory, '未分類') as subcategory,
          coalesce(products.photo_url, '') as "photoUrl",
          procedure_step_products.quantity::float as quantity,
          coalesce(procedure_step_products.unit, products.unit) as unit,
          coalesce(procedure_step_products.note, '') as note,
          procedure_step_products.sort_order as "sortOrder"
        from procedure_step_products
        join products on products.id = procedure_step_products.product_id
        where procedure_step_products.procedure_step_id::text = any(${stepIds})
        order by procedure_step_products.procedure_step_id, procedure_step_products.sort_order, products.name
      `
    : [];

  const productsByStep = new Map<string, unknown[]>();
  for (const item of stepProducts) {
    const stepId = String(item.stepId);
    productsByStep.set(stepId, [...(productsByStep.get(stepId) ?? []), item]);
  }

  const stepsByBook = new Map<string, unknown[]>();
  for (const step of steps) {
    const bookId = String(step.bookId);
    stepsByBook.set(bookId, [
      ...(stepsByBook.get(bookId) ?? []),
      {
        ...step,
        products: productsByStep.get(String(step.id)) ?? []
      }
    ]);
  }

  return books.map((book) => ({
    ...book,
    steps: stepsByBook.get(String(book.id)) ?? []
  }));
}

async function readAdminOptions() {
  const [stores, brands, products] = await Promise.all([
    sql`
      select id::text, name
      from stores
      where status = 'active'
      order by name
    `,
    sql`
      select id::text, name
      from brands
      where status = 'active'
      order by name
    `,
    sql`
      select
        id::text,
        name,
        category,
        coalesce(subcategory, '未分類') as subcategory,
        unit,
        coalesce(brand_scope, 'unset') as "brandScope",
        coalesce((
          select array_agg(product_brand_usages.brand_id::text order by product_brand_usages.brand_id::text)
          from product_brand_usages
          where product_brand_usages.product_id = products.id
        ), '{}') as "brandIds",
        coalesce(japanese_note, '') as "japaneseNote",
        coalesce(photo_url, '') as "photoUrl"
      from products
      order by category, subcategory, name
    `
  ]);

  return { stores, brands, products };
}

export async function GET(request: Request) {
  const session = await requireOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const mode = new URL(request.url).searchParams.get("mode") ?? "";
  const procedures = await readProcedures(session, mode);
  const options = mode === "admin" && canEditProcedures(session)
    ? await readAdminOptions()
    : { stores: [], brands: [], products: [] };

  return Response.json({
    procedures,
    canEdit: canEditProcedures(session),
    ...options
  });
}

export async function POST(request: Request) {
  const session = await requireOpsSession();
  if (!session || !canEditProcedures(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  try {
    const body = await request.json() as ProcedureBookPayload;
    const saved = await saveProcedureBook(body, session);
    return Response.json({ ok: true, id: saved.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存できませんでした。" }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const session = await requireOpsSession();
  if (!session || !canEditProcedures(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json() as ProcedureBookPayload;
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "手順書IDが必要です。" }, { status: 400 });

  try {
    const saved = await saveProcedureBook(body, session);
    return Response.json({ ok: true, id: saved.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存できませんでした。" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireOpsSession();
  if (!session || !canEditProcedures(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json() as { id?: string };
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "手順書IDが必要です。" }, { status: 400 });

  await sql`delete from procedure_books where id = ${id}`;
  return Response.json({ ok: true });
}

async function saveProcedureBook(body: ProcedureBookPayload, session: EmployeeSession) {
  const id = String(body.id ?? "").trim();
  const title = String(body.title ?? "").trim();
  const category = String(body.category ?? "").trim() || "未分類";
  const summary = String(body.summary ?? "").trim();
  const status = cleanStatus(body.status);
  const brandId = String(body.brandId ?? "").trim() || null;
  const storeIds = Array.isArray(body.storeIds)
    ? Array.from(new Set(body.storeIds.map((item) => String(item).trim()).filter(Boolean)))
    : [];
  const steps = Array.isArray(body.steps) ? body.steps : [];

  if (!title) {
    throw new Error("手順書名を入力してください。");
  }

  const rows = id
    ? await sql`
        update procedure_books
        set
          title = ${title},
          category = ${category},
          summary = ${summary},
          status = ${status},
          brand_id = ${brandId},
          version_number = version_number + 1,
          published_at = case when ${status} = 'published' then coalesce(published_at, now()) else null end,
          updated_at = now()
        where id = ${id}
        returning id::text
      `
    : await sql`
        insert into procedure_books (
          title,
          category,
          summary,
          status,
          brand_id,
          published_at,
          created_by,
          updated_at
        )
        values (
          ${title},
          ${category},
          ${summary},
          ${status},
          ${brandId},
          case when ${status} = 'published' then now() else null end,
          ${session.id},
          now()
        )
        returning id::text
      `;

  const procedureId = rows[0]?.id;
  if (!procedureId) {
    throw new Error("手順書が見つかりません。");
  }

  await sql`delete from procedure_book_stores where procedure_book_id = ${procedureId}`;
  for (const storeId of storeIds) {
    await sql`
      insert into procedure_book_stores (procedure_book_id, store_id)
      values (${procedureId}, ${storeId})
      on conflict do nothing
    `;
  }

  await sql`delete from procedure_steps where procedure_book_id = ${procedureId}`;

  for (const [stepIndex, step] of steps.entries()) {
    const stepTitle = String(step.title ?? "").trim();
    const instruction = String(step.instruction ?? "").trim();
    if (!stepTitle && !instruction) continue;

    const stepRows = await sql`
      insert into procedure_steps (
        procedure_book_id,
        sort_order,
        title,
        instruction,
        caution,
        estimated_minutes,
        media_url,
        updated_at
      )
      values (
        ${procedureId},
        ${stepIndex},
        ${stepTitle || `Step ${stepIndex + 1}`},
        ${instruction},
        ${String(step.caution ?? "").trim()},
        ${parseOptionalInteger(step.estimatedMinutes)},
        ${String(step.mediaUrl ?? "").trim()},
        now()
      )
      returning id::text
    `;

    const stepId = stepRows[0]?.id;
    if (!stepId) continue;

    const products = Array.isArray(step.products) ? step.products : [];
    for (const [productIndex, product] of products.entries()) {
      const productId = String(product.productId ?? "").trim();
      if (!productId) continue;

      await sql`
        insert into procedure_step_products (
          procedure_step_id,
          product_id,
          quantity,
          unit,
          note,
          sort_order
        )
        values (
          ${stepId},
          ${productId},
          ${parseOptionalNumber(product.quantity)},
          ${String(product.unit ?? "").trim()},
          ${String(product.note ?? "").trim()},
          ${productIndex}
        )
      `;
    }
  }

  return { id: procedureId };
}
