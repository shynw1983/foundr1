import { requireOsSession } from "../../../../../lib/api-auth";
import {
  applyMenuTranslationEntries,
  canEditMenuTranslations
} from "../../../../../lib/menu-auto-translation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !canEditMenuTranslations(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    return Response.json(await applyMenuTranslationEntries({
      brandId: body.brandId,
      entries: body.entries
    }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "翻訳を書き込めませんでした。" }, { status: 400 });
  }
}
