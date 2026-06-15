import { requireOsSession } from "../../../lib/api-auth";
import {
  canApproveBrandSiteContent,
  canEditBrandSiteContent,
  deleteBrandSiteSection,
  readBrandSiteContent,
  reviewBrandSiteSectionRevision,
  submitBrandSiteSectionRevision,
  upsertBrandSiteSection
} from "../../../lib/brand-site-content";

export async function GET() {
  const session = await requireOsSession();
  if (!session || !(await canEditBrandSiteContent(session))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  return Response.json({ ...(await readBrandSiteContent()), canPublish: await canApproveBrandSiteContent(session) });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !(await canEditBrandSiteContent(session))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    if (String(body.action ?? "") === "reviewRevision") {
      if (!(await canApproveBrandSiteContent(session))) {
        return Response.json({ error: "老板の承認が必要です。" }, { status: 403 });
      }
      return Response.json(await reviewBrandSiteSectionRevision({
        id: body.id,
        action: body.reviewAction,
        reviewNote: body.reviewNote,
        reviewerId: session.id
      }));
    }
    if (!(await canApproveBrandSiteContent(session))) {
      return Response.json(await submitBrandSiteSectionRevision(body, session.id));
    }
    return Response.json(await upsertBrandSiteSection(body));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存できませんでした。" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireOsSession();
  if (!session || !(await canEditBrandSiteContent(session))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { id?: unknown };
  try {
    return Response.json(await deleteBrandSiteSection(body.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "削除できませんでした。" }, { status: 400 });
  }
}
