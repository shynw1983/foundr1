import { requireOsSession } from "../../../../../lib/api-auth";
import {
  canEditBrandSiteContent,
  collectBrandSiteTranslationTargets,
  generateBrandSiteTranslationPreview
} from "../../../../../lib/brand-site-content";

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !canEditBrandSiteContent(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const entries = await collectBrandSiteTranslationTargets({
      brandId: body.brandId,
      languages: body.languages,
      overwriteExisting: body.overwriteExisting === true
    });
    return Response.json(await generateBrandSiteTranslationPreview(entries));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "翻訳プレビューを作成できませんでした。" }, { status: 400 });
  }
}
