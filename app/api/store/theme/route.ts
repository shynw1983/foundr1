import { requireOsSession } from "../../../../lib/api-auth";
import { normalizeStoreThemeColor, normalizeStoreThemeTarget } from "../../../../lib/store-theme";
import { getStoreThemeAccess, getStoreThemeSettings, saveStoreThemeSettings, StoreThemeError } from "../../../../lib/store-theme-settings";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };
const fail = (error: string, status: number, code: string) => Response.json({ error, code }, { status, headers });

function handleError(error: unknown) {
  if (error instanceof StoreThemeError) return fail(error.message, error.status, error.code);
  console.error("Store theme request failed", error);
  return fail("テーマ設定を処理できませんでした。もう一度お試しください。", 500, "theme_unavailable");
}

export async function GET(request: Request) {
  try {
    const session = await requireOsSession();
    if (!session) return fail("ログインしてください。", 401, "session_required");
    const params = new URL(request.url).searchParams;
    if (params.has("storeId") && !params.get("storeId")?.trim()) return fail("店舗を確認してください。", 400, "invalid_store");
    if (params.getAll("target").length > 1) return fail("表示設定の対象を確認してください。", 400, "invalid_target");
    const target = normalizeStoreThemeTarget(params.has("target") ? params.get("target") : undefined);
    if (!target) return fail("表示設定の対象を確認してください。", 400, "invalid_target");
    const access = await getStoreThemeAccess(session, params.get("storeId") ?? "");
    return Response.json({ ...access, ...await getStoreThemeSettings(access.storeId, target) }, { headers });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return fail("不正なリクエスト元です。", 403, "invalid_origin");
  }
  try {
    const session = await requireOsSession();
    if (!session) return fail("ログインしてください。", 401, "session_required");
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("設定内容を確認してください。", 400, "invalid_theme");
    const input = body as Record<string, unknown>;
    const target = normalizeStoreThemeTarget(input.target);
    if (!target) return fail("表示設定の対象を確認してください。", 400, "invalid_target");
    const mode = input.mode === undefined && target === "operations" ? "custom" : input.mode;
    if ((mode !== "custom" && mode !== "brand") || (target === "operations" && mode !== "custom")) {
      return fail("テーマカラーの設定方法を確認してください。", 400, "invalid_mode");
    }
    const primaryColor = mode === "custom" ? normalizeStoreThemeColor(input.primaryColor) : null;
    const expectedRevision = input.expectedRevision;
    if (typeof input.storeId !== "string" || !input.storeId.trim() || (mode === "custom" && !primaryColor) ||
      !(expectedRevision === null || (typeof expectedRevision === "string" && expectedRevision.length > 0 && expectedRevision.length <= 128))) {
      return fail("店舗・テーマカラー・設定バージョンを確認してください。", 400, "invalid_theme");
    }
    const access = await getStoreThemeAccess(session, input.storeId, { freshPermissions: true });
    if (!access.canManageTheme) return fail("テーマを変更する権限がありません。", 403, "theme_permission");
    const saved = await saveStoreThemeSettings({ storeId: access.storeId, target, mode, ...(primaryColor ? {primaryColor} : {}), expectedRevision, actorId: session.id, request });
    if (!saved) return fail("設定が変更されています。最新の内容を読み込んでから保存してください。", 409, "theme_conflict");
    return Response.json({ ...access, ...saved }, { headers });
  } catch (error) {
    return handleError(error);
  }
}
