import { requireOsSession } from "../../../../lib/api-auth";
import { getLoyaltyDashboard, upsertMember } from "../../../../lib/loyalty";

export const dynamic = "force-dynamic";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "manager"].includes(session.role)) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const dashboard = await getLoyaltyDashboard();
  return Response.json(dashboard, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "manager"].includes(session.role)) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const member = await upsertMember({
    phone: normalizeText(body.phone),
    email: normalizeText(body.email),
    displayName: normalizeText(body.displayName),
    identityProvider: normalizeText(body.identityProvider),
    identitySubject: normalizeText(body.identitySubject),
    identityLabel: normalizeText(body.identityLabel),
    metadata: { source: "os_manual", updatedBy: session.id }
  });
  if (!member) return Response.json({ error: "会員を保存できませんでした。" }, { status: 500 });

  const dashboard = await getLoyaltyDashboard();
  return Response.json({ ok: true, member, ...dashboard });
}
