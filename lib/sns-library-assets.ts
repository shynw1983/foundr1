import { createHash, randomUUID } from "node:crypto";
import { get, head } from "@vercel/blob";
import sharp from "sharp";
import { sql } from "./db";
import { getReadableSnsAsset, getSnsLibrarySetting, snsAssetKey, snsAssetUrl, snsLibraryUuid, snsStoreScopeKey,
  SnsLibraryError, type SnsAssetRecord, type SnsLibraryAccess } from "./sns-library";
import type { SnsLibraryAllocatedAsset, SnsLibraryAsset } from "./sns-library-types";

const photoLimit = 25 * 1024 * 1024, previewLimit = 1024 * 1024;
export function presentSnsAsset(access: SnsLibraryAccess, asset: SnsAssetRecord): SnsLibraryAsset {
  return { id: asset.id, kind: asset.kind, mimeType: asset.mimeType, size: asset.size,
    width: asset.width!, height: asset.height!, url: snsAssetUrl(access, asset.id) };
}
export function assertSnsBlobConfigured() {
  // SDK handleUpload issues legacy client tokens with the read/write secret;
  // unlike head/get, BLOB_STORE_ID plus OIDC alone cannot sign these uploads.
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    throw new SnsLibraryError("写真の保存先が未設定です。管理者に確認してください。", 503, "blob_unavailable");
}
export async function allocateSnsAsset(access: SnsLibraryAccess, value: Record<string, unknown>): Promise<SnsLibraryAllocatedAsset> {
  assertSnsBlobConfigured();
  const kind = value.kind, mimeType = value.mimeType, size = value.size;
  const limit = kind === "photo" ? photoLimit : previewLimit;
  if ((kind !== "photo" && kind !== "preview") || mimeType !== (kind === "photo" ? "image/png" : "image/jpeg") ||
    typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > limit)
    throw new SnsLibraryError("写真は25MB以下のPNG、プレビューは1MB以下のJPEGを指定してください。", 400, "invalid_upload");
  const id = randomUUID(), now = new Date();
  const asset: SnsAssetRecord = { id, kind, mimeType: mimeType as SnsAssetRecord["mimeType"], size, pathname: `sns/${access.storeId}/${id}/${kind === "photo" ? "source.png" : "preview.jpg"}`,
    createdBy: access.session.id, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 10 * 60000).toISOString(), status: "pending" };
  // Bounded pending work per account/store. Ready immutable assets remain available
  // for Save As; nothing deletes or replaces an existing image.
  const rows = await sql`insert into module_settings(scope_key,module_key,settings,updated_by,updated_at)
    select ${snsStoreScopeKey(access.storeId)},${snsAssetKey(id)},${JSON.stringify(asset)}::jsonb,${access.session.id}::uuid,now()
    where (select count(*) from module_settings where scope_key=${snsStoreScopeKey(access.storeId)} and module_key like 'sns_asset:%'
      and settings->>'createdBy'=${access.session.id} and settings->>'status'='pending' and (settings->>'expiresAt')::timestamptz>now())<32
    returning id`;
  if (!rows[0]) throw new SnsLibraryError("アップロード中の写真が多すぎます。少し待ってから再試行してください。", 429, "upload_limit");
  const params = `storeId=${access.storeId}&surface=${access.surface}`;
  return { id, kind, mimeType: asset.mimeType, size, pathname: asset.pathname, maxSizeBytes: limit,
    uploadUrl: `/api/sns/assets/${id}/upload?${params}`, completeUrl: `/api/sns/assets/${id}/complete`, url: snsAssetUrl(access, id) };
}
export async function getOwnedSnsAsset(access: SnsLibraryAccess, id: string) {
  if (!snsLibraryUuid.test(id)) throw new SnsLibraryError("写真を確認してください。", 400, "invalid_asset");
  const asset = await getSnsLibrarySetting<SnsAssetRecord>(access.storeId, snsAssetKey(id));
  if (!asset || asset.createdBy !== access.session.id) throw new SnsLibraryError("この写真をアップロードする権限がありません。", 403, "asset_scope");
  return asset;
}
export function assertPendingSnsAsset(asset: SnsAssetRecord) {
  if (asset.status !== "pending" || !Number.isFinite(Date.parse(asset.expiresAt)) || Date.parse(asset.expiresAt) <= Date.now())
    throw new SnsLibraryError("写真のアップロード期限が切れています。編集内容を残して再試行してください。", 409, "upload_expired");
}
export async function validateSnsAssetBytes(asset: Pick<SnsAssetRecord, "kind" | "mimeType" | "size">, bytes: Uint8Array) {
  const png = bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n);
  const jpeg = bytes.length >= 3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  if (bytes.length !== asset.size || (asset.mimeType === "image/png" ? !png : !jpeg))
    throw new SnsLibraryError("写真の内容と形式・サイズが一致しません。", 400, "upload_mismatch");
  const image = sharp(bytes, { limitInputPixels: 80000000, failOn: "warning" });
  let metadata: sharp.Metadata;
  try { metadata = await image.metadata(); }
  catch { throw new SnsLibraryError("写真を読み取れません。作成し直して保存してください。", 400, "invalid_image"); }
  const width = metadata.width ?? 0, height = metadata.height ?? 0;
  if (metadata.format !== (asset.mimeType === "image/png" ? "png" : "jpeg") || !width || !height || (metadata.pages ?? 1) !== 1 ||
    (metadata.orientation !== undefined && metadata.orientation !== 1) ||
    (asset.kind === "photo" ? Math.max(width,height)>2160 || Math.max(width,height)/Math.min(width,height)>8 : width>540 || height>960))
    throw new SnsLibraryError("保存用の写真サイズを確認してください。写真は長辺2160px以下、プレビューは540×960px以下です。", 400, "image_dimensions");
  // Dimensions are bounded before decoding, so a truncated compressed body cannot
  // become a ready asset merely by supplying a valid header.
  try { await image.stats(); }
  catch { throw new SnsLibraryError("写真を読み取れません。作成し直して保存してください。", 400, "invalid_image"); }
  return { width, height, sha256: createHash("sha256").update(bytes).digest("hex") };
}
async function boundedSnsBlobBytes(stream: ReadableStream<Uint8Array>, expected: number) {
  const reader = stream.getReader(), chunks: Buffer[] = []; let length = 0;
  while (true) {
    const {done,value}=await reader.read(); if(done) break;
    length+=value.byteLength;
    if(length>expected || length>photoLimit) { await reader.cancel(); throw new SnsLibraryError("保存データが大きすぎます。",400,"upload_mismatch"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks,length);
}
export async function completeSnsAsset(access: SnsLibraryAccess, id: string) {
  const asset = await getOwnedSnsAsset(access,id);
  if(asset.status==='ready') return presentSnsAsset(access,asset);
  assertPendingSnsAsset(asset); assertSnsBlobConfigured();
  let metadata;
  try { metadata=await head(asset.pathname); }
  catch(error) {
    if(error instanceof Error && error.name.includes('NotFound')) throw new SnsLibraryError("写真のアップロード完了を確認してください。",409,"upload_missing");
    throw error;
  }
  if(metadata.pathname!==asset.pathname || metadata.size!==asset.size || metadata.contentType!==asset.mimeType)
    throw new SnsLibraryError("写真の形式・サイズを確認してください。",400,"upload_mismatch");
  const result=await get(asset.pathname,{access:'private',useCache:false});
  if(!result || result.statusCode!==200) throw new SnsLibraryError("写真のアップロード完了を確認してください。",409,"upload_missing");
  const bytes=await boundedSnsBlobBytes(result.stream,asset.size);
  const inspected=await validateSnsAssetBytes(asset,bytes);
  const ready: SnsAssetRecord={...asset,...inspected,status:'ready'};
  const rows=await sql`update module_settings set settings=${JSON.stringify(ready)}::jsonb,updated_at=now(),updated_by=${access.session.id}::uuid
    where scope_key=${snsStoreScopeKey(access.storeId)} and module_key=${snsAssetKey(id)} and settings->>'status'='pending'
      and settings->>'createdBy'=${access.session.id} returning settings`;
  if(!rows[0]) {
    const current=await getOwnedSnsAsset(access,id);
    if(current.status==='ready' && current.sha256===ready.sha256) return presentSnsAsset(access,current);
    throw new SnsLibraryError("写真の保存状態が変わっています。再確認してください。",409,"asset_conflict");
  }
  return presentSnsAsset(access,ready);
}
export async function readSnsAsset(access: SnsLibraryAccess,id:string) {
  const asset=await getReadableSnsAsset(access,id);
  const result=await get(asset.pathname,{access:'private'});
  if(!result || result.statusCode!==200) throw new SnsLibraryError("写真が見つかりません。",404,"asset_missing");
  return new Response(result.stream,{headers:{'Content-Type':asset.mimeType,'Content-Length':String(asset.size),
    'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
}
