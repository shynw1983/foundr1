import { createHmac, timingSafeEqual } from "node:crypto";

function getVoucherPublicPreviewSecret() {
  return process.env.VOUCHER_PUBLIC_PREVIEW_SECRET
    || process.env.AUTH_SECRET
    || process.env.DATABASE_URL
    || "foundr1-local-dev-secret";
}

export function createVoucherPublicPreviewToken(voucherId: string) {
  return createHmac("sha256", getVoucherPublicPreviewSecret())
    .update(`voucher-preview:v1:${voucherId}`)
    .digest("base64url");
}

export function verifyVoucherPublicPreviewToken(voucherId: string, token: string) {
  const expected = Buffer.from(createVoucherPublicPreviewToken(voucherId));
  const actual = Buffer.from(String(token ?? ""));
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function buildVoucherPublicPreviewUrl(origin: string, voucherId: string) {
  const token = createVoucherPublicPreviewToken(voucherId);
  return `${origin}/api/public/vouchers/${encodeURIComponent(voucherId)}/preview?token=${encodeURIComponent(token)}`;
}
