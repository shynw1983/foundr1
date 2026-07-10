type PayrollStatementDay = {
  workDate?: string;
  storeName?: string;
  clockIn?: string | null;
  clockOut?: string | null;
  workMinutes?: number;
  breakMinutes?: number;
  nightMinutes?: number;
  alerts?: string[];
};

type PayrollStatementRow = {
  employeeName?: string;
  storeNames?: string[];
  workDays?: number;
  punchCount?: number;
  workMinutes?: number;
  overtimeMinutes?: number;
  nightMinutes?: number;
  regularPay?: number;
  basePay?: number;
  overtimePay?: number;
  nightPremiumPay?: number;
  allowancePay?: number;
  allowancePremiumPay?: number;
  commuteAllowance?: number;
  socialInsurance?: number;
  employmentInsurance?: number;
  incomeTax?: number;
  residentTax?: number;
  totalPay?: number;
};

export type PayrollStatementInput = {
  row: PayrollStatementRow;
  days: PayrollStatementDay[];
  month: string;
  periodLabel: string;
  companyName: string;
};

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return `${Math.round(number(value)).toLocaleString("ja-JP")}円`;
}

function duration(value: unknown) {
  const minutes = Math.max(0, Math.round(number(value)));
  return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

function time(value: unknown) {
  if (!value) return "--:--";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function monthLabel(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  return match ? `${match[1]}年${Number(match[2])}月分` : month;
}

export function buildPayrollStatementHtml(input: PayrollStatementInput) {
  const row = input.row;
  const grossPay = number(row.basePay) + number(row.commuteAllowance);
  const deductions = number(row.socialInsurance) + number(row.employmentInsurance) + number(row.incomeTax) + number(row.residentTax);
  const payments = [
    ["基本給", row.regularPay ?? row.basePay], ["時間外労働賃金", row.overtimePay], ["深夜割増", row.nightPremiumPay],
    ["手当", number(row.allowancePay) + number(row.allowancePremiumPay)], ["交通費", row.commuteAllowance]
  ];
  const deductionRows = [["社会保険", row.socialInsurance], ["雇用保険", row.employmentInsurance], ["源泉所得税", row.incomeTax], ["住民税", row.residentTax]];
  const dayRows = input.days.length ? input.days.map((day, index) => `<tr>
    <td>${index + 1}</td><td>${escapeHtml(day.workDate)}</td><td>${escapeHtml(day.storeName)}</td>
    <td>${escapeHtml(time(day.clockIn))} - ${escapeHtml(time(day.clockOut))}</td><td>${escapeHtml(duration(day.workMinutes))}</td>
    <td>${escapeHtml(duration(day.breakMinutes))}</td><td>${escapeHtml(duration(day.nightMinutes))}</td><td>${escapeHtml(day.alerts?.length ? day.alerts.join("、") : "OK")}</td>
  </tr>`).join("") : `<tr><td colspan="8" class="empty">勤務実績はありません。</td></tr>`;

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:11mm 12mm}*{box-sizing:border-box}body{margin:0;color:#17211e;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif;font-size:9.5px;line-height:1.35}
    header{display:grid;grid-template-columns:1fr 1.2fr 1fr;align-items:start;border-bottom:2px solid #173f35;padding:3mm 0 5mm;margin-bottom:5mm}h1{font-size:20px;margin:0;font-weight:650;letter-spacing:.04em}.month{color:#176b52;font-size:17px;font-weight:650;text-align:center}.issuer{text-align:right}.issuer strong{display:block;font-size:11px}.recipient{display:flex;justify-content:space-between;align-items:end;margin:0 0 5mm}.recipient strong{font-size:17px;font-weight:650;border-bottom:1px solid #aebbb7;padding:0 7mm 1.5mm 0}.recipient small{color:#61706c}.summary{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #b9c5c1;margin-bottom:4mm}.summary div{padding:2.6mm;border-right:1px solid #d2dad7}.summary div:last-child{border-right:0}.summary span{display:block;color:#63716d}.summary strong{display:block;margin-top:1mm;font-size:14px;font-weight:650}.summary .net{background:#eaf5f1;color:#0d6048}
    .blocks{display:grid;grid-template-columns:1.1fr .9fr;gap:4mm;margin-bottom:4mm}.block{display:flex;flex-direction:column;border:1px solid #b9c5c1}.block h2{font-size:10px;margin:0;padding:1.7mm 2.2mm;background:#edf4f1;color:#29463e}.money-grid{display:grid;grid-template-columns:1fr 1fr}.money-grid div{display:flex;justify-content:space-between;gap:2mm;padding:1.6mm 2.2mm;border-top:1px solid #d8dfdd}.money-grid div:nth-child(odd){border-right:1px solid #d8dfdd}.money-grid strong{font-weight:600;font-variant-numeric:tabular-nums}.totals{display:flex;justify-content:flex-end;gap:7mm;margin-top:auto;padding:2mm 2.2mm;border-top:1px solid #aab8b3;background:#f7faf9}.totals strong{font-size:12px}
    h3{font-size:12px;margin:5mm 0 2mm}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #c5cecb;padding:1.4mm 1.2mm;text-align:center;vertical-align:middle;word-break:break-word}th{background:#eef3f1;font-weight:600}th:nth-child(1){width:5%}th:nth-child(2){width:14%}th:nth-child(3){width:15%}th:nth-child(4){width:20%}th:nth-child(5),th:nth-child(6),th:nth-child(7){width:12%}th:nth-child(8){width:10%}tr{break-inside:avoid}.empty{padding:5mm;color:#6d7a76}.period{margin-top:2mm;color:#66736f}.notes{margin-top:4mm;color:#687570;font-size:8.5px}footer{margin-top:4mm;padding-top:2mm;border-top:1px solid #d7dfdc;display:flex;justify-content:space-between;color:#76827e;font-size:8px}
  </style></head><body>
    <header><h1>給与明細</h1><div class="month">${escapeHtml(monthLabel(input.month))}</div><div class="issuer"><strong>${escapeHtml(input.companyName || "会社名未設定")}</strong><span>発行日 ${escapeHtml(new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }))}</span></div></header>
    <section class="recipient"><div><strong>${escapeHtml(row.employeeName)} 様</strong><div class="period">対象期間 ${escapeHtml(input.periodLabel)}</div></div><small>${escapeHtml(row.storeNames?.join("、") || "店舗未設定")}</small></section>
    <section class="summary"><div><span>勤務日数</span><strong>${number(row.workDays)}日</strong></div><div><span>勤務時間</span><strong>${escapeHtml(duration(row.workMinutes))}</strong></div><div><span>総支給額</span><strong>${money(grossPay)}</strong></div><div class="net"><span>差引支給額</span><strong>${money(row.totalPay)}</strong></div></section>
    <section class="blocks"><div class="block"><h2>支給</h2><div class="money-grid">${payments.map(([label,value])=>`<div><span>${label}</span><strong>${money(value)}</strong></div>`).join("")}</div><div class="totals"><span>支給額合計</span><strong>${money(grossPay)}</strong></div></div><div class="block"><h2>控除</h2><div class="money-grid">${deductionRows.map(([label,value])=>`<div><span>${label}</span><strong>${money(value)}</strong></div>`).join("")}</div><div class="totals"><span>控除額合計</span><strong>${money(deductions)}</strong></div></div></section>
    <h3>勤務詳細</h3><table><thead><tr><th>No.</th><th>勤務日</th><th>事業所</th><th>出退勤</th><th>勤務時間</th><th>休憩</th><th>深夜</th><th>確認</th></tr></thead><tbody>${dayRows}</tbody></table>
    <p class="notes">この給与明細は Foundr1 OS に登録された勤怠・給与設定をもとに作成されています。</p><footer><span>${escapeHtml(input.companyName || "会社名未設定")}</span><span>Foundr1 OS</span></footer>
  </body></html>`;
}
