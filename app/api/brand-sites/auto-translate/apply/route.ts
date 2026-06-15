import { requireOsSession } from "../../../../../lib/api-auth";
import {
  applyBrandSiteTranslationEntries,
  canApproveBrandSiteContent,
  canEditBrandSiteContent
} from "../../../../../lib/brand-site-content";

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !(await canEditBrandSiteContent(session))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }
  if (!(await canApproveBrandSiteContent(session))) {
    return Response.json({ error: "AI翻訳の書き込みは老板の承認が必要です。经理はプレビューを作成して老板へ依頼してください。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    return Response.json(await applyBrandSiteTranslationEntries({
      brandId: body.brandId,
      entries: body.entries
    }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "翻訳を書き込めませんでした。" }, { status: 400 });
  }
}
