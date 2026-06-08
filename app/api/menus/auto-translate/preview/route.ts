import { requireOsSession } from "../../../../../lib/api-auth";
import {
  canEditMenuTranslations,
  collectMenuTranslationTargets,
  generateMenuTranslationPreview
} from "../../../../../lib/menu-auto-translation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !canEditMenuTranslations(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const targets = await collectMenuTranslationTargets({
      brandId: body.brandId,
      languages: body.languages,
      overwriteExisting: body.overwriteExisting === true
    });
    const result = await generateMenuTranslationPreview(targets);
    return Response.json({
      ...result,
      generatedAt: new Date().toISOString(),
      targetCount: targets.length
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "翻訳プレビューを作成できませんでした。" }, { status: 400 });
  }
}
