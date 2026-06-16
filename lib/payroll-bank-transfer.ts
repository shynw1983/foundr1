import { createHash } from "crypto";

export type PayrollBankAccountType = "ordinary" | "current" | "savings";

export type PayrollTransferItem = {
  employeeId: string;
  employeeName: string;
  employeeNameKana?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
  accountType?: string | null;
  accountNumber?: string | null;
  accountHolderKana?: string | null;
  amount: number;
  alerts?: string[];
};

export type PayrollTransferOrigin = {
  companyCode?: string | null;
  companyName: string;
  debitBankCode: string;
  debitBankName?: string | null;
  debitBranchCode: string;
  debitBranchName?: string | null;
  debitAccountType: PayrollBankAccountType;
  debitAccountNumber: string;
  debitAccountHolderKana: string;
};

const zenginKanaPattern = /^[0-9A-Z ｦ-ﾟ().,/'"+-]*$/;

function onlyDigits(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizePayrollAccountType(value: string | null | undefined): PayrollBankAccountType {
  return value === "current" || value === "savings" ? value : "ordinary";
}

export function getZenginAccountTypeCode(value: string | null | undefined) {
  const type = normalizePayrollAccountType(value);
  if (type === "current") return "2";
  if (type === "savings") return "4";
  return "1";
}

export function normalizeZenginText(value: string | null | undefined, length: number) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .slice(0, length);
}

function fitText(value: string | null | undefined, length: number) {
  return normalizeZenginText(value, length).padEnd(length, " ");
}

function fitNumber(value: string | number | null | undefined, length: number) {
  return onlyDigits(String(value ?? "")).slice(-length).padStart(length, "0");
}

function makeRecord(parts: string[]) {
  const line = parts.join("");
  return line.length >= 120 ? line.slice(0, 120) : line.padEnd(120, " ");
}

export function validatePayrollTransferItem(item: PayrollTransferItem) {
  const alerts = [...(item.alerts ?? [])];
  const amount = Math.round(Number(item.amount) || 0);
  const bankCode = onlyDigits(item.bankCode);
  const branchCode = onlyDigits(item.branchCode);
  const accountNumber = onlyDigits(item.accountNumber);
  const holder = normalizeZenginText(item.accountHolderKana, 30);

  if (amount <= 0) alerts.push("振込金額なし");
  if (bankCode.length !== 4) alerts.push("銀行コード未設定");
  if (branchCode.length !== 3) alerts.push("支店コード未設定");
  if (!accountNumber || accountNumber.length > 7) alerts.push("口座番号未設定");
  if (!holder) alerts.push("受取人名義カナ未設定");
  if (holder && !zenginKanaPattern.test(holder)) alerts.push("受取人名義カナ形式確認");

  return Array.from(new Set(alerts));
}

export function validatePayrollTransferOrigin(origin: PayrollTransferOrigin) {
  const alerts: string[] = [];
  if (onlyDigits(origin.debitBankCode).length !== 4) alerts.push("出金銀行コード未設定");
  if (onlyDigits(origin.debitBranchCode).length !== 3) alerts.push("出金支店コード未設定");
  if (!onlyDigits(origin.debitAccountNumber) || onlyDigits(origin.debitAccountNumber).length > 7) alerts.push("出金口座番号未設定");
  if (!normalizeZenginText(origin.debitAccountHolderKana, 40)) alerts.push("委託者名カナ未設定");
  return alerts;
}

export function buildZenginPayrollFile(input: {
  transferType: "salary" | "bonus" | "general";
  paymentDate: string;
  origin: PayrollTransferOrigin;
  items: PayrollTransferItem[];
}) {
  const dataTypeCode = input.transferType === "bonus" ? "12" : input.transferType === "general" ? "21" : "11";
  const paymentMonthDay = input.paymentDate.replace(/\D/g, "").slice(4, 8);
  const header = makeRecord([
    "1",
    dataTypeCode,
    "0",
    fitNumber(input.origin.companyCode || "0", 10),
    fitText(input.origin.companyName || input.origin.debitAccountHolderKana, 40),
    fitNumber(paymentMonthDay, 4),
    fitNumber(input.origin.debitBankCode, 4),
    fitText(input.origin.debitBankName, 15),
    fitNumber(input.origin.debitBranchCode, 3),
    fitText(input.origin.debitBranchName, 15),
    "0000",
    getZenginAccountTypeCode(input.origin.debitAccountType),
    fitNumber(input.origin.debitAccountNumber, 7),
    " ".repeat(17)
  ]);

  const dataRecords = input.items.map((item) => makeRecord([
    "2",
    fitNumber(item.bankCode, 4),
    fitText(item.bankName, 15),
    fitNumber(item.branchCode, 3),
    fitText(item.branchName, 15),
    "0000",
    getZenginAccountTypeCode(item.accountType),
    fitNumber(item.accountNumber, 7),
    fitText(item.accountHolderKana, 30),
    fitNumber(Math.round(item.amount), 10),
    "0",
    "0".repeat(10),
    "0".repeat(10),
    "7",
    " ".repeat(8)
  ]));

  const totalAmount = input.items.reduce((sum, item) => sum + Math.round(Number(item.amount) || 0), 0);
  const trailer = makeRecord([
    "8",
    fitNumber(input.items.length, 6),
    fitNumber(totalAmount, 12),
    " ".repeat(101)
  ]);
  const end = makeRecord(["9", " ".repeat(119)]);

  return [header, ...dataRecords, trailer, end].join("\r\n") + "\r\n";
}

function csvEscape(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildGmoPayrollCsv(items: PayrollTransferItem[]) {
  const headers = [
    "金融機関コード",
    "金融機関名",
    "支店コード",
    "支店名",
    "科目",
    "口座番号",
    "受取人名",
    "振込金額"
  ];
  const rows = items.map((item) => [
    onlyDigits(item.bankCode),
    item.bankName ?? "",
    onlyDigits(item.branchCode),
    item.branchName ?? "",
    getZenginAccountTypeCode(item.accountType),
    fitNumber(item.accountNumber, 7),
    normalizeZenginText(item.accountHolderKana, 30),
    Math.round(Number(item.amount) || 0)
  ]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

export function sha256Hex(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
