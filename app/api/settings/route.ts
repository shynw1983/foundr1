import { requireMasterOsSession, requireOsSession } from "../../../lib/api-auth";
import { normalizeStoreModuleSettings } from "../../../lib/module-setting-defaults";
import { getStoreModuleSettings, saveStoreModuleSettings } from "../../../lib/module-settings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const moduleKey = new URL(request.url).searchParams.get("module") ?? "store";
  if (moduleKey !== "store") {
    return Response.json({ error: "Unknown module" }, { status: 404 });
  }

  return Response.json({
    moduleKey,
    settings: await getStoreModuleSettings()
  });
}

export async function POST(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => null) as { moduleKey?: string; settings?: unknown } | null;
  if (body?.moduleKey !== "store") {
    return Response.json({ error: "Unknown module" }, { status: 404 });
  }

  const settings = await saveStoreModuleSettings(normalizeStoreModuleSettings(body.settings), session.id);
  return Response.json({ ok: true, settings });
}
