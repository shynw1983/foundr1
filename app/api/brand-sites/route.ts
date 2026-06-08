import { requireOsSession } from "../../../lib/api-auth";
import {
  canEditBrandSiteContent,
  deleteBrandSiteSection,
  readBrandSiteContent,
  upsertBrandSiteSection
} from "../../../lib/brand-site-content";

export async function GET() {
  const session = await requireOsSession();
  if (!session || !canEditBrandSiteContent(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  return Response.json(await readBrandSiteContent());
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !canEditBrandSiteContent(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    return Response.json(await upsertBrandSiteSection(body));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存できませんでした。" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireOsSession();
  if (!session || !canEditBrandSiteContent(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { id?: unknown };
  try {
    return Response.json(await deleteBrandSiteSection(body.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "削除できませんでした。" }, { status: 400 });
  }
}
