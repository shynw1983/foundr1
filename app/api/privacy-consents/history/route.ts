import { requireOsSession } from "../../../../lib/api-auth";
import { getAgreedPrivacyConsents } from "../../../../lib/privacy-consents";

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const consents = await getAgreedPrivacyConsents(session);
  return Response.json({ consents }, { headers: { "Cache-Control": "no-store" } });
}
