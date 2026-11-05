import { createHash, randomUUID } from "node:crypto";
import { getSessionStoreScope, requireOsSession } from "./api-auth";
import type { EmployeeSession } from "./auth";
import { sql } from "./db";
import { roleHasPermission } from "./role-permissions";
import { normalizeSnsLibraryDocument, normalizeSnsTemplateName, type SnsLibraryDocument } from "./sns-library-document";

export const snsLibraryHeaders = { "Cache-Control": "private, no-store, max-age=0" };
export const snsLibraryUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class SnsLibraryError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); this.name = "SnsLibraryError"; }
}
export type SnsLibraryAccess = { session: EmployeeSession; storeId: string; surface: "store" | "os" };
export type SnsTemplateRecord = {
  id: string; name: string; revision: string; createdBy: string; createdAt: string; updatedAt: string;
  photoAssetId: string; previewAssetId: string | null; document: SnsLibraryDocument; fingerprint: string;
  deletedAt?: string;
};
export type SnsAssetRecord = {
  id: string; kind: "photo" | "preview"; pathname: string; mimeType: "image/png" | "image/jpeg"; size: number;
  createdBy: string; createdAt: string; expiresAt: string; status: "pending" | "ready";
  width?: number; height?: number; sha256?: string;
};
export const snsStoreScopeKey = (storeId: string) => `store:${storeId}`;
export const snsTemplateKey = (id: string) => `sns_template:${id}`;
export const snsAssetKey = (id: string) => `sns_asset:${id}`;
const managementRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);

export function assertSnsLibrarySameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site")
    throw new SnsLibraryError("不正なリクエスト元です。", 403, "invalid_origin");
}
export async function requireSnsLibraryAccess(storeId: unknown, surface: unknown): Promise<SnsLibraryAccess> {
  const session = await requireOsSession();
  if (!session) throw new SnsLibraryError("ログインしてください。", 401, "session_required");
  if (typeof storeId !== "string" || !snsLibraryUuid.test(storeId) || (surface !== "store" && surface !== "os"))
    throw new SnsLibraryError("店舗と利用画面を確認してください。", 400, "invalid_scope");
  if (surface === "os" && !await roleHasPermission(session.role, "module.procedures", { fresh: true }))
    throw new SnsLibraryError("権限がありません。", 403, "sns_permission");
  const scope = await getSessionStoreScope(session);
  if (!scope.allStores && !scope.storeIds.includes(storeId)) throw new SnsLibraryError("この店舗を利用する権限がありません。", 403, "store_scope");
  const rows = await sql`select distinct stores.id from stores join store_brands on store_brands.store_id=stores.id
    join brands on brands.id=store_brands.brand_id where stores.id=${storeId}::uuid and stores.status='active'
    and brands.status='active' and brands.name in ('まぁ麻','maamaa') limit 1`;
  if (!rows[0]) throw new SnsLibraryError("この店舗で利用できるテンプレートはありません。", 403, "sns_brand");
  return { session, storeId, surface };
}
export function canEditSnsTemplate(access: SnsLibraryAccess, template: Pick<SnsTemplateRecord, "createdBy">) {
  return access.session.id === template.createdBy || managementRoles.has(access.session.role);
}
export async function getSnsLibrarySetting<T>(storeId: string, moduleKey: string): Promise<T | null> {
  const rows = await sql`select settings from module_settings where scope_key=${snsStoreScopeKey(storeId)} and module_key=${moduleKey} limit 1`;
  return rows[0]?.settings as T ?? null;
}
export async function getSnsTemplate(access: SnsLibraryAccess, id: string) {
  if (!snsLibraryUuid.test(id)) throw new SnsLibraryError("テンプレートを確認してください。", 400, "invalid_template");
  const template = await getSnsLibrarySetting<SnsTemplateRecord>(access.storeId, snsTemplateKey(id));
  if (!template || template.deletedAt) throw new SnsLibraryError("テンプレートが見つかりません。", 404, "template_missing");
  return template;
}
export function snsAssetUrl(access: Pick<SnsLibraryAccess, "storeId" | "surface">, id: string) {
  return `/api/sns/assets/${encodeURIComponent(id)}?storeId=${access.storeId}&surface=${access.surface}`;
}
export function presentSnsTemplate(access: SnsLibraryAccess, template: SnsTemplateRecord, detail = false) {
  return { id: template.id, name: template.name, revision: template.revision, createdBy: template.createdBy,
    createdAt: template.createdAt, updatedAt: template.updatedAt, photoAssetId: template.photoAssetId, previewAssetId: template.previewAssetId,
    previewUrl: template.previewAssetId ? snsAssetUrl(access, template.previewAssetId) : null,
    photoUrl: snsAssetUrl(access, template.photoAssetId), canEdit: canEditSnsTemplate(access, template),
    ...(detail ? { document: template.document } : {}) };
}
export async function listSnsTemplates(access: SnsLibraryAccess, cursor?: string | null) {
  let cursorAt: string | null = null, cursorKey: string | null = null;
  if (cursor) {
    try {
      if (cursor.length > 512) throw Error();
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (decoded.storeId !== access.storeId || typeof decoded.at !== "string" || decoded.at.length > 64 || !Number.isFinite(Date.parse(decoded.at)) ||
        typeof decoded.id !== "string" || !snsLibraryUuid.test(decoded.id)) throw Error();
      cursorAt = decoded.at; cursorKey = snsTemplateKey(decoded.id);
    } catch { throw new SnsLibraryError("一覧の続きから読み直してください。", 400, "invalid_cursor"); }
  }
  // Project only list metadata; large documents never travel with the collection.
  const rows = await sql`select settings-'document'-'fingerprint' as settings, updated_at::text as "cursorAt" from module_settings
    where scope_key=${snsStoreScopeKey(access.storeId)} and module_key like 'sns_template:%' and not (settings ? 'deletedAt')
      and (${cursorAt}::timestamptz is null or (updated_at,module_key)<(${cursorAt}::timestamptz,${cursorKey}::text))
    order by updated_at desc, module_key desc limit 41`;
  const visible = rows.slice(0, 40), last = visible[visible.length - 1];
  return { templates: visible.map(row => presentSnsTemplate(access, row.settings as SnsTemplateRecord)),
    nextCursor: rows.length > 40 && last ? Buffer.from(JSON.stringify({ storeId: access.storeId, at: last.cursorAt, id: (last.settings as SnsTemplateRecord).id })).toString("base64url") : null };
}
export async function getReadableSnsAsset(access: SnsLibraryAccess, id: string, kind?: SnsAssetRecord["kind"]): Promise<SnsAssetRecord> {
  if (!snsLibraryUuid.test(id)) throw new SnsLibraryError("写真を確認してください。", 400, "invalid_asset");
  const asset = await getSnsLibrarySetting<SnsAssetRecord>(access.storeId, snsAssetKey(id));
  if (!asset || asset.status !== "ready" || (kind && asset.kind !== kind)) throw new SnsLibraryError("保存済みの写真が見つかりません。", 404, "asset_missing");
  if (asset.createdBy !== access.session.id) {
    const rows = await sql`select 1 from module_settings where scope_key=${snsStoreScopeKey(access.storeId)}
      and module_key like 'sns_template:%' and not(settings ? 'deletedAt')
      and (settings->>'photoAssetId'=${id} or settings->>'previewAssetId'=${id}) limit 1`;
    if (!rows[0]) throw new SnsLibraryError("この写真を利用する権限がありません。", 403, "asset_scope");
  }
  return asset;
}
export async function saveSnsTemplate(access: SnsLibraryAccess, value: unknown, id: string, create: boolean) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const name = normalizeSnsTemplateName(input.name), document = normalizeSnsLibraryDocument(input.document);
  if (!snsLibraryUuid.test(id) || !name || !document || typeof input.photoAssetId !== "string" || !snsLibraryUuid.test(input.photoAssetId) ||
    !(input.previewAssetId === null || (typeof input.previewAssetId === "string" && snsLibraryUuid.test(input.previewAssetId))) ||
    (!create && (typeof input.expectedRevision !== "string" || !snsLibraryUuid.test(input.expectedRevision))))
    throw new SnsLibraryError("テンプレートの名前・写真・文字内容を確認してください。", 400, "invalid_document");
  const current = await getSnsLibrarySetting<SnsTemplateRecord>(access.storeId, snsTemplateKey(id));
  if (!create && (!current || current.deletedAt)) throw new SnsLibraryError("テンプレートが見つかりません。", 404, "template_missing");
  if (!create && current && !canEditSnsTemplate(access, current)) throw new SnsLibraryError("このテンプレートは別名で保存してください。", 403, "template_read_only");
  const photo = await getReadableSnsAsset(access, input.photoAssetId, "photo");
  if (photo.width !== document.photoWidth || photo.height !== document.photoHeight)
    throw new SnsLibraryError("写真のサイズが変わっています。写真を読み込み直してください。", 400, "photo_dimensions");
  if (input.previewAssetId) await getReadableSnsAsset(access, input.previewAssetId as string, "preview");
  const fingerprint = createHash("sha256").update(JSON.stringify({ name, document, photoAssetId: input.photoAssetId, previewAssetId: input.previewAssetId })).digest("hex");
  if (create && current) {
    if (!current.deletedAt && current.createdBy === access.session.id && current.fingerprint === fingerprint) return current;
    throw new SnsLibraryError("同じ保存先がすでに存在します。別名で保存してください。", 409, "template_conflict");
  }
  // A lost response can be retried without reapplying or overwriting anything.
  if (!create && current?.fingerprint === fingerprint) return current;
  if (!create && current?.revision !== input.expectedRevision)
    throw new SnsLibraryError("テンプレートが更新されています。別名で保存するか、最新の内容を開いてください。", 409, "template_conflict");
  const now = new Date().toISOString();
  const saved: SnsTemplateRecord = { id, name, revision: randomUUID(), createdBy: current?.createdBy ?? access.session.id,
    createdAt: current?.createdAt ?? now, updatedAt: now, photoAssetId: input.photoAssetId, previewAssetId: input.previewAssetId as string | null, document, fingerprint };
  const rows = create
    ? await sql`insert into module_settings(scope_key,module_key,settings,updated_by,updated_at)
        values(${snsStoreScopeKey(access.storeId)},${snsTemplateKey(id)},${JSON.stringify(saved)}::jsonb,${access.session.id}::uuid,now())
        on conflict(scope_key,module_key) do nothing returning settings`
    : await sql`update module_settings set settings=${JSON.stringify(saved)}::jsonb,updated_by=${access.session.id}::uuid,updated_at=now()
        where scope_key=${snsStoreScopeKey(access.storeId)} and module_key=${snsTemplateKey(id)} and settings->>'revision'=${input.expectedRevision as string}
        and not(settings ? 'deletedAt') and (settings->>'createdBy'=${access.session.id} or ${managementRoles.has(access.session.role)}) returning settings`;
  if (!rows[0]) {
    // A concurrent retry of the exact same create is successful; a different body is not.
    const retry = await getSnsLibrarySetting<SnsTemplateRecord>(access.storeId, snsTemplateKey(id));
    if (retry && !retry.deletedAt && (create ? retry.createdBy === access.session.id : canEditSnsTemplate(access, retry)) && retry.fingerprint === fingerprint) return retry;
    throw new SnsLibraryError("テンプレートが更新されています。編集内容を残して再確認してください。", 409, "template_conflict");
  }
  return rows[0].settings as SnsTemplateRecord;
}
