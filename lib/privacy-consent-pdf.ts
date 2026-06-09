type PrivacyConsentPdfInput = {
  consentId: string;
  companyLegalName: string;
  version: string;
  title: string;
  body: string;
  effectiveDate: string;
  agreedAt: string;
  storeNames: string[];
};

const pageWidth = 595;
const pageHeight = 842;
const marginX = 48;
const contentBottom = 56;

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

function textLine(text: string, x: number, y: number, size = 10, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td <${toUtf16Hex(text)}> Tj ET`;
}

function horizontalLine(x1: number, y: number, x2: number) {
  return `${x1} ${y} m ${x2} ${y} l S`;
}

function formatDateTime(value: string) {
  if (!value) return "未記録";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未記録";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function wrapText(value: string, maxChars: number) {
  const text = String(value ?? "").trim();
  if (!text) return [""];

  const lines: string[] = [];
  let current = "";
  for (const char of Array.from(text)) {
    if (current.length >= maxChars) {
      lines.push(current);
      current = "";
    }
    current += char;
  }
  if (current) lines.push(current);
  return lines;
}

function bodyLines(value: string) {
  const lines: string[] = [];
  for (const paragraph of String(value ?? "").split(/\r?\n/)) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    lines.push(...wrapText(paragraph, 43));
  }
  return lines;
}

function drawWrapped(lines: string[], x: number, startY: number, size: number, lineHeight: number) {
  return {
    commands: lines.map((line, index) => line ? textLine(line, x, startY - index * lineHeight, size) : ""),
    endY: startY - lines.length * lineHeight
  };
}

function buildPages(input: PrivacyConsentPdfInput) {
  const stores = input.storeNames.length ? input.storeNames.join("、") : "未設定";
  const pages: string[][] = [];
  let commands: string[] = ["q", "0.8 w"];
  let y = 794;

  commands.push(textLine("Foundr1 STORE", marginX, y, 10));
  y -= 30;
  commands.push(textLine(input.title || "個人情報文書", marginX, y, 19));
  y -= 16;
  commands.push(horizontalLine(marginX, y, pageWidth - marginX));
  y -= 28;

  const metaRows = [
    ["会社名", input.companyLegalName || "未設定"],
    ["対象店舗", stores],
    ["文書バージョン", input.version || "未設定"],
    ["効力発生日", input.effectiveDate || "未設定"],
    ["同意日時", formatDateTime(input.agreedAt)],
    ["同意記録ID", input.consentId]
  ];

  for (const [label, value] of metaRows) {
    commands.push(textLine(label, marginX, y, 9));
    const wrapped = wrapText(value, 34);
    const result = drawWrapped(wrapped, 138, y, 9, 13);
    commands.push(...result.commands);
    y = Math.min(y - 18, result.endY - 5);
  }

  commands.push(horizontalLine(marginX, y, pageWidth - marginX));
  y -= 26;

  const lines = bodyLines(input.body);
  for (const line of lines) {
    if (y < contentBottom) {
      commands.push("Q");
      pages.push(commands);
      commands = ["q", "0.8 w", textLine(input.title || "個人情報文書", marginX, 794, 10), horizontalLine(marginX, 780, pageWidth - marginX)];
      y = 756;
    }
    if (line) commands.push(textLine(line, marginX, y, 10));
    y -= line ? 17 : 10;
  }

  y -= 10;
  if (y < contentBottom) {
    commands.push("Q");
    pages.push(commands);
    commands = ["q", "0.8 w"];
    y = 794;
  }
  commands.push(horizontalLine(marginX, y, pageWidth - marginX));
  y -= 18;
  commands.push(textLine("このPDFはFoundr1 STOREに保存された同意記録から生成されています。", marginX, y, 8));
  commands.push("Q");
  pages.push(commands);

  return pages;
}

export function createPrivacyConsentPdf(input: PrivacyConsentPdfInput) {
  const pageContents = buildPages(input).map((commands) => commands.filter(Boolean).join("\n"));
  const pageCount = pageContents.length;
  const fontObjectId = 3 + pageCount * 2;
  const cidFontObjectId = fontObjectId + 1;
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids ${pageContents.map((_, index) => `${3 + index * 2} 0 R`).join(" ")} ] /Count ${pageCount} >>`.replace("/Kids ", "/Kids [")
  ];

  pageContents.forEach((content, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });

  objects.push(`<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UCS2-H /DescendantFonts [${cidFontObjectId} 0 R] >>`);
  objects.push("<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 5 >> >>");

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
