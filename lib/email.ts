import { Resend } from "resend";
import { recordExternalServiceUsage } from "./external-service-usage";

type BirthdayCouponEmailInput = {
  to: string;
  memberName: string;
  couponName: string;
  couponCode: string;
  expiresAt: string;
  brandName?: string;
  memberUrl?: string;
};

type CouponEmailInput = BirthdayCouponEmailInput & {
  subject?: string;
  introText?: string;
  bodyText?: string;
};

let resendClient: Resend | null = null;
const DEFAULT_EMAIL_BRAND_NAME = "Foundr1 Members";

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  if (!resendClient) resendClient = new Resend(apiKey);
  return resendClient;
}

function getFromAddress() {
  return process.env.RESEND_FROM_EMAIL?.trim() || "Foundr1 Members <no-reply@foundr1.jp>";
}

function getMemberUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return baseUrl ? `${baseUrl}/member` : "";
}

function formatDate(value: string) {
  if (!value) return "期限なし";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "期限なし";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlFromText(value: string) {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
    .join("");
}

export async function sendCouponEmail(input: CouponEmailInput) {
  const client = getResendClient();
  if (!client) return { status: "skipped", id: "", error: "RESEND_API_KEY is not configured." };

  const memberName = input.memberName.trim() || "会員";
  const brandName = input.brandName?.trim() || DEFAULT_EMAIL_BRAND_NAME;
  const memberUrl = input.memberUrl?.trim() || getMemberUrl();
  const expiresLabel = formatDate(input.expiresAt);
  const subject = input.subject?.trim() || `【${brandName}】クーポンをお届けしました`;
  const introText = input.introText?.trim() || "Foundr1 Members にクーポンをお届けしました。";
  const defaultText = [
    `${memberName} 様`,
    "",
    introText,
    "",
    `クーポン: ${input.couponName}`,
    `クーポンコード: ${input.couponCode}`,
    `有効期限: ${expiresLabel}`,
    "",
    memberUrl ? `会員ページ: ${memberUrl}` : "会員ページからご確認ください。"
  ].join("\n");
  const text = input.bodyText?.trim() || defaultText;

  try {
    const response = await client.emails.send({
      from: getFromAddress(),
      to: input.to,
      subject,
      text,
      html: input.bodyText?.trim() ? `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#1f2937;">
          ${htmlFromText(text)}
        </div>
      ` : `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#1f2937;">
          <p>${escapeHtml(memberName)} 様</p>
          <p>${escapeHtml(introText)}</p>
          <div style="border:1px solid #dbe3df;border-radius:8px;padding:16px;margin:18px 0;background:#f8fafc;">
            <p style="margin:0 0 8px;color:#64748b;font-size:13px;">クーポン</p>
            <p style="margin:0;font-size:20px;font-weight:700;">${escapeHtml(input.couponName)}</p>
            <p style="margin:8px 0 0;">コード: <strong>${escapeHtml(input.couponCode)}</strong></p>
            <p style="margin:4px 0 0;">有効期限: ${escapeHtml(expiresLabel)}</p>
          </div>
          ${memberUrl ? `<p><a href="${escapeHtml(memberUrl)}" style="color:#1f6f55;">会員ページを開く</a></p>` : ""}
        </div>
      `
    });
    if (response.error) return { status: "failed", id: "", error: response.error.message };
    await recordExternalServiceUsage({
      serviceKey: "resend",
      metricKey: "emails_sent",
      quantity: 1,
      unit: "count",
      source: "coupon_email",
      metadata: {
        subject,
        recipientDomain: input.to.includes("@") ? input.to.split("@").pop() : ""
      }
    });
    return { status: "sent", id: response.data?.id ?? "", error: "" };
  } catch (error) {
    return { status: "failed", id: "", error: error instanceof Error ? error.message : "Email send failed." };
  }
}

export async function sendBirthdayCouponEmail(input: BirthdayCouponEmailInput) {
  return sendCouponEmail({
    ...input,
    subject: `【${input.brandName?.trim() || DEFAULT_EMAIL_BRAND_NAME}】お誕生日特典クーポンをお届けしました`,
    introText: "お誕生日月おめでとうございます。Foundr1 Members に誕生日特典クーポンをお届けしました。"
  });
}
