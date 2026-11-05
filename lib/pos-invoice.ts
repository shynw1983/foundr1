/** Payloads carry the recipient without 様 because existing Android renderers add it. */
export function invoiceRecipientStem(value: unknown): string {
  const name = String(value ?? '').trim().replace(/\s*様$/u, '').trim();
  return name || '上';
}
export function invoiceRecipientLabel(value: unknown): string {
  return `${invoiceRecipientStem(value)}様`;
}
export function validateInvoiceDetails(body: { receiptRecipientName?: unknown; receiptPurposeText?: unknown }) {
  for (const [key, limit] of [['receiptRecipientName', 120], ['receiptPurposeText', 160]] as const) {
    const value = body[key];
    if (value !== undefined && (typeof value !== 'string' || value.trim().length > limit || /[\u0000-\u001f\u007f]/u.test(value))) {
      throw Object.assign(new Error('宛名は120文字以内、但し書きは160文字以内で入力してください。改行や制御文字は使用できません。'), { status: 400 });
    }
  }
  return {
    receiptRecipientName: body.receiptRecipientName === undefined ? undefined : invoiceRecipientStem(body.receiptRecipientName),
    receiptPurposeText: body.receiptPurposeText === undefined ? undefined : String(body.receiptPurposeText).trim() || '飲食代'
  };
}
