import { requireMasterOsSession } from "../../../../lib/api-auth";
import { evaluateExternalServiceUsageAlerts, getExternalServiceUsageDashboard } from "../../../../lib/external-service-usage";

function normalizeMonth(value: string | null) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : undefined;
}

export async function GET(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const url = new URL(request.url);
  const dashboard = await getExternalServiceUsageDashboard(normalizeMonth(url.searchParams.get("month")));
  return Response.json(dashboard);
}

export async function POST(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { month?: string };
  const result = await evaluateExternalServiceUsageAlerts(normalizeMonth(body.month ?? null));
  return Response.json(result);
}
