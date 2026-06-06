type ReceiptPdfInput = {
  receiptNo: string;
  issuedAt: string;
  recipientName: string;
  amount: number;
  currency: string;
  pickupCode: string;
  pickupDate: string;
  pickupTime: string;
  itemSummary: string;
  paymentProvider: string;
  paidAt: string;
  issuerName: string;
  issuerAddress: string;
  issuerPhone: string;
  invoiceRegistrationNumber: string;
  purposeText: string;
  taxRate: number;
};

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function toUtf16Hex(value: string) {
  const bytes: number[] = [0xfe, 0xff];
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0xffff) {
      const normalized = char.normalize("NFKC");
      for (const fallback of normalized) {
        const fallbackCode = fallback.charCodeAt(0);
        bytes.push((fallbackCode >> 8) & 0xff, fallbackCode & 0xff);
      }
    } else {
      bytes.push((code >> 8) & 0xff, code & 0xff);
    }
  }
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function textLine(text: string, x: number, y: number, size = 11, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td <${toUtf16Hex(text)}> Tj ET`;
}

function latinTextLine(text: string, x: number, y: number, size = 11, font = "F2") {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function horizontalLine(x1: number, y: number, x2: number) {
  return `${x1} ${y} m ${x2} ${y} l S`;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(amount);
}

function splitSummary(value: string) {
  return value.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 9);
}

export function createReceiptPdf(input: ReceiptPdfInput) {
  const amount = Number.isFinite(input.amount) ? input.amount : 0;
  const taxRate = Number.isFinite(input.taxRate) && input.taxRate > 0 ? input.taxRate : 8;
  const taxIncluded = Math.round(amount * taxRate / (100 + taxRate));
  const purposeText = input.purposeText.trim() || "テイクアウト飲食代";
  const lines = [
    textLine("領収書", 250, 790, 24),
    textLine(`${input.recipientName || "お客様"} 様`, 56, 735, 14),
    horizontalLine(56, 724, 300),
    textLine("金額", 56, 684, 12),
    latinTextLine(formatCurrency(amount), 118, 677, 28),
    textLine(`但し ${purposeText}として`, 56, 642, 11),
    textLine(`内消費税等 ${taxRate}%対象 ${formatCurrency(taxIncluded)} / 税込`, 56, 622, 10),
    horizontalLine(56, 605, 540),
    textLine("ご注文内容", 56, 574, 13),
    textLine(`取餐番号: ${input.pickupCode}`, 56, 548, 11),
    textLine(`受取日時: ${input.pickupDate} ${input.pickupTime}`, 56, 530, 11),
    textLine(`支払方法: ${input.paymentProvider.toUpperCase()}`, 56, 512, 11),
    textLine(`支払日時: ${input.paidAt || input.issuedAt}`, 56, 494, 11),
    textLine("明細", 56, 464, 11),
    ...splitSummary(input.itemSummary).map((line, index) => textLine(line, 76, 444 - index * 17, 9)),
    textLine("発行者", 350, 574, 13),
    textLine(input.issuerName || "会社名未設定", 350, 548, 11),
    ...(input.invoiceRegistrationNumber ? [textLine(`登録番号: ${input.invoiceRegistrationNumber}`, 350, 530, 10)] : []),
    ...(input.issuerAddress ? [textLine(input.issuerAddress, 350, 512, 9)] : []),
    ...(input.issuerPhone ? [textLine(`TEL: ${input.issuerPhone}`, 350, 494, 9)] : []),
    textLine(`発行日: ${input.issuedAt}`, 350, 456, 9),
    latinTextLine(`Receipt No. ${input.receiptNo}`, 350, 438, 9),
    textLine("この領収書は電子的に発行されています。", 56, 86, 8)
  ];
  const content = `q\n1 w\n${lines.join("\n")}\nQ`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 5 >> >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];

  const chunks = ["%PDF-1.7\n"];
  const offsets: number[] = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(chunks.join("")));
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.from(chunks.join(""), "binary");
}
