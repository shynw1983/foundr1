import { SnsLibraryError, snsLibraryHeaders } from "./sns-library";
export const snsLibraryJson = (value: unknown, status = 200) => Response.json(value, { status, headers: snsLibraryHeaders });
export function snsLibraryFailure(error: unknown) {
  if (error instanceof SnsLibraryError) return snsLibraryJson({ error: error.message, code: error.code }, error.status);
  console.error("SNS library request failed", error instanceof Error ? error.message : "unknown error");
  return snsLibraryJson({ error: "保存ライブラリを処理できませんでした。編集内容を残して再試行してください。", code: "sns_library_unavailable" }, 503);
}
export async function readSnsLibraryBody(request: Request): Promise<Record<string, unknown>> {
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > 100000) throw new SnsLibraryError("保存内容が大きすぎます。", 413, "body_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new SnsLibraryError("保存内容を確認してください。", 400, "invalid_body");
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 100000) { await reader.cancel(); throw new SnsLibraryError("保存内容が大きすぎます。", 413, "body_too_large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let result: unknown;
  try { result = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new SnsLibraryError("保存内容を確認してください。", 400, "invalid_body"); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new SnsLibraryError("保存内容を確認してください。", 400, "invalid_body");
  return result as Record<string, unknown>;
}
