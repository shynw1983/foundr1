import { requireOsSession } from "../../../../../../lib/api-auth";
import { createPrivacyConsentPdf } from "../../../../../../lib/privacy-consent-pdf";
import { getAgreedPrivacyConsents } from "../../../../../../lib/privacy-consents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sanitizeFilename(value: string) {
  return (value || "privacy-document").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 120);
}

function asciiFilename(value: string) {
  return sanitizeFilename(value)
    .replace(/[^\x20-\x7e]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "privacy-document.pdf";
}

function contentDispositionFileName(filename: string) {
  return `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(_request: Request, context: { params: Promise<{ consentId: string }> }) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { consentId } = await context.params;
  const consents = await getAgreedPrivacyConsents(session);
  const consent = consents.find((record) => record.consentId === consentId);
  if (!consent) return Response.json({ error: "文書が見つかりません。" }, { status: 404 });

  const pdf = createPrivacyConsentPdf(consent);
  const filename = `${consent.companyLegalName || "company"}-個人情報文書-${consent.version}.pdf`;

  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDispositionFileName(filename),
      "Cache-Control": "private, no-store"
    }
  });
}
