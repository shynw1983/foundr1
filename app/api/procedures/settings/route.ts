import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

const procedureEditorRoles = new Set(["owner", "manager"]);
const settingTables = {
  action_types: "procedure_action_types",
  materials: "procedure_materials",
  locations: "procedure_locations",
  equipment: "procedure_equipment",
  containers: "procedure_containers"
} as const;

type SettingKind = keyof typeof settingTables;

type SettingPayload = {
  kind?: SettingKind;
  id?: string;
  actionKey?: string;
  label?: string;
  sentenceTemplate?: string;
  name?: string;
  materialType?: string;
  category?: string;
  subcategory?: string;
  unit?: string;
  note?: string;
  isActive?: boolean;
  sortOrder?: number | string;
};

function normalizeKind(value: unknown): SettingKind | null {
  return Object.keys(settingTables).includes(String(value)) ? String(value) as SettingKind : null;
}

function parseSortOrder(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? Math.round(numberValue) : 0;
}

async function requireProcedureEditor() {
  const session = await requireOsSession();
  return session && procedureEditorRoles.has(session.role) ? session : null;
}

export async function POST(request: Request) {
  const session = await requireProcedureEditor();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as SettingPayload;
  const kind = normalizeKind(body.kind);
  if (!kind) return Response.json({ error: "設定種別が必要です。" }, { status: 400 });

  const sortOrder = parseSortOrder(body.sortOrder);
  const isActive = body.isActive !== false;

  if (kind === "action_types") {
    const actionKey = String(body.actionKey ?? "").trim();
    const label = String(body.label ?? "").trim();
    if (!actionKey || !label) return Response.json({ error: "アクションキーと表示名を入力してください。" }, { status: 400 });

    await sql`
      insert into procedure_action_types (action_key, label, sentence_template, is_active, sort_order, updated_at)
      values (${actionKey}, ${label}, ${String(body.sentenceTemplate ?? "").trim()}, ${isActive}, ${sortOrder}, now())
      on conflict (action_key)
      do update set
        label = excluded.label,
        sentence_template = excluded.sentence_template,
        is_active = excluded.is_active,
        sort_order = excluded.sort_order,
        updated_at = now()
    `;
    return Response.json({ ok: true });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return Response.json({ error: "名称を入力してください。" }, { status: 400 });

  if (kind === "materials") {
    await sql`
      insert into procedure_materials (name, material_type, category, subcategory, unit, note, is_active, sort_order, updated_at)
      values (
        ${name},
        ${String(body.materialType ?? "utility").trim() || "utility"},
        ${String(body.category ?? "").trim()},
        ${String(body.subcategory ?? "").trim()},
        ${String(body.unit ?? "").trim()},
        ${String(body.note ?? "").trim()},
        ${isActive},
        ${sortOrder},
        now()
      )
      on conflict (name)
      do update set
        material_type = excluded.material_type,
        category = excluded.category,
        subcategory = excluded.subcategory,
        unit = excluded.unit,
        note = excluded.note,
        is_active = excluded.is_active,
        sort_order = excluded.sort_order,
        updated_at = now()
    `;
  } else if (kind === "locations") {
    await upsertMaster("procedure_locations", name, body.category, body.note, isActive, sortOrder);
  } else if (kind === "equipment") {
    await upsertMaster("procedure_equipment", name, body.category, body.note, isActive, sortOrder);
  } else {
    await upsertMaster("procedure_containers", name, body.category, body.note, isActive, sortOrder);
  }

  return Response.json({ ok: true });
}

async function upsertMaster(table: "procedure_locations" | "procedure_equipment" | "procedure_containers", name: string, category: unknown, note: unknown, isActive: boolean, sortOrder: number) {
  if (table === "procedure_locations") {
    await sql`
      insert into procedure_locations (name, category, note, is_active, sort_order, updated_at)
      values (${name}, ${String(category ?? "").trim()}, ${String(note ?? "").trim()}, ${isActive}, ${sortOrder}, now())
      on conflict (name)
      do update set category = excluded.category, note = excluded.note, is_active = excluded.is_active, sort_order = excluded.sort_order, updated_at = now()
    `;
  } else if (table === "procedure_equipment") {
    await sql`
      insert into procedure_equipment (name, category, note, is_active, sort_order, updated_at)
      values (${name}, ${String(category ?? "").trim()}, ${String(note ?? "").trim()}, ${isActive}, ${sortOrder}, now())
      on conflict (name)
      do update set category = excluded.category, note = excluded.note, is_active = excluded.is_active, sort_order = excluded.sort_order, updated_at = now()
    `;
  } else {
    await sql`
      insert into procedure_containers (name, category, note, is_active, sort_order, updated_at)
      values (${name}, ${String(category ?? "").trim()}, ${String(note ?? "").trim()}, ${isActive}, ${sortOrder}, now())
      on conflict (name)
      do update set category = excluded.category, note = excluded.note, is_active = excluded.is_active, sort_order = excluded.sort_order, updated_at = now()
    `;
  }
}

export async function PATCH(request: Request) {
  const session = await requireProcedureEditor();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as SettingPayload;
  const kind = normalizeKind(body.kind);
  const id = String(body.id ?? "").trim();
  if (!kind || !id) return Response.json({ error: "設定IDが必要です。" }, { status: 400 });

  const isActive = body.isActive !== false;
  const sortOrder = parseSortOrder(body.sortOrder);

  if (kind === "action_types") {
    await sql`
      update procedure_action_types
      set
        label = ${String(body.label ?? "").trim()},
        sentence_template = ${String(body.sentenceTemplate ?? "").trim()},
        is_active = ${isActive},
        sort_order = ${sortOrder},
        updated_at = now()
      where id = ${id}
    `;
    return Response.json({ ok: true });
  }

  if (kind === "materials") {
    await sql`
      update procedure_materials
      set
        name = ${String(body.name ?? "").trim()},
        material_type = ${String(body.materialType ?? "utility").trim() || "utility"},
        category = ${String(body.category ?? "").trim()},
        subcategory = ${String(body.subcategory ?? "").trim()},
        unit = ${String(body.unit ?? "").trim()},
        note = ${String(body.note ?? "").trim()},
        is_active = ${isActive},
        sort_order = ${sortOrder},
        updated_at = now()
      where id = ${id}
    `;
  } else if (kind === "locations") {
    await updateMaster("procedure_locations", id, body.name, body.category, body.note, isActive, sortOrder);
  } else if (kind === "equipment") {
    await updateMaster("procedure_equipment", id, body.name, body.category, body.note, isActive, sortOrder);
  } else {
    await updateMaster("procedure_containers", id, body.name, body.category, body.note, isActive, sortOrder);
  }

  return Response.json({ ok: true });
}

async function updateMaster(table: "procedure_locations" | "procedure_equipment" | "procedure_containers", id: string, name: unknown, category: unknown, note: unknown, isActive: boolean, sortOrder: number) {
  if (table === "procedure_locations") {
    await sql`
      update procedure_locations
      set name = ${String(name ?? "").trim()}, category = ${String(category ?? "").trim()}, note = ${String(note ?? "").trim()}, is_active = ${isActive}, sort_order = ${sortOrder}, updated_at = now()
      where id = ${id}
    `;
  } else if (table === "procedure_equipment") {
    await sql`
      update procedure_equipment
      set name = ${String(name ?? "").trim()}, category = ${String(category ?? "").trim()}, note = ${String(note ?? "").trim()}, is_active = ${isActive}, sort_order = ${sortOrder}, updated_at = now()
      where id = ${id}
    `;
  } else {
    await sql`
      update procedure_containers
      set name = ${String(name ?? "").trim()}, category = ${String(category ?? "").trim()}, note = ${String(note ?? "").trim()}, is_active = ${isActive}, sort_order = ${sortOrder}, updated_at = now()
      where id = ${id}
    `;
  }
}
