import chromium from "@sparticuz/chromium";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { requireOsSession } from "../../../../../lib/api-auth";
import { buildPayrollStatementHtml, type PayrollStatementInput } from "../../../../../lib/payroll-statement-html";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function clean(value: unknown) { return String(value ?? "").trim(); }

function filename(input: PayrollStatementInput) {
  const name = clean(input.row?.employeeName).replace(/[\\/:*?"<>|]+/g, "_") || "employee";
  const month = /^\d{4}-\d{2}$/.test(input.month) ? input.month.replace("-", "年") + "月" : "";
  return `給与明細${month}_${name}.pdf`;
}

function attachmentFilename(value: string) {
  const ascii = value.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(value)}`;
}

async function launchBrowser() {
  const configured = clean(process.env.CHROME_EXECUTABLE_PATH);
  const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const isLocal = Boolean(configured) || existsSync(localChrome);
  const executablePath = configured || (existsSync(localChrome) ? localChrome : await chromium.executablePath());
  return puppeteer.launch({
    args: isLocal ? ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "--disable-setuid-sandbox"] : [...chromium.args, "--disable-dev-shm-usage", "--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 1 }, executablePath, headless: true, timeout: 15000
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (!["owner", "manager", "store_owner", "store_manager"].includes(session.role)) {
    return Response.json({ error: "給与明細を出力する権限がありません。" }, { status: 403 });
  }

  const input = await request.json().catch(() => null) as PayrollStatementInput | null;
  if (!input?.row || !/^\d{4}-\d{2}$/.test(clean(input.month)) || !Array.isArray(input.days) || input.days.length > 40) {
    return Response.json({ error: "給与明細の内容を確認してください。" }, { status: 400 });
  }

  let browser = null;
  let page = null;
  try {
    browser = await launchBrowser();
    page = await browser.newPage();
    await page.setContent(buildPayrollStatementHtml(input), { waitUntil: "load", timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMediaType("print");
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": attachmentFilename(filename(input)), "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to render payroll statement PDF", error);
    return Response.json({ error: "給与明細PDFを作成できませんでした。" }, { status: 500 });
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}
