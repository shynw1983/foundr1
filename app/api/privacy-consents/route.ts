import { requireOsSession } from "../../../lib/api-auth";
import { getPendingPrivacyConsents, recordPrivacyConsents } from "../../../lib/privacy-consents";

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const pendingConsents = await getPendingPrivacyConsents(session);
  return Response.json({ pendingConsents }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { documentIds?: string[] };
  const documentIds = Array.isArray(body.documentIds) ? body.documentIds.map(String) : [];

  try {
    const consentCount = await recordPrivacyConsents(session, documentIds, request);
    return Response.json({ ok: true, consentCount });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "同意記録を保存できませんでした。" },
      { status: 400 }
    );
  }
}
