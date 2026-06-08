import { evaluateExternalServiceUsageAlerts } from "../../../../lib/external-service-usage";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await evaluateExternalServiceUsageAlerts();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
