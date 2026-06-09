import chromium from "@sparticuz/chromium";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { requireOsSession } from "../../../../../../lib/api-auth";
import { getAgreedPrivacyConsents, type PrivacyConsentRecord } from "../../../../../../lib/privacy-consents";
import type { Browser, Page } from "puppeteer-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function sanitizeFilename(value: string) {
  return (value || "privacy-document").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 120);
}

function contentDispositionFileName(filename: string) {
  return `attachment; filename="${sanitizeFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

let fontFaceCss = "";

function getFontFaceCss() {
  if (fontFaceCss) return fontFaceCss;
  const fontPath = join(process.cwd(), "fonts/NotoSansCJKjp-Regular.otf");
  if (!existsSync(fontPath)) return "";
  const fontUrl = pathToFileURL(fontPath).href;
  fontFaceCss = `
@font-face {
  font-family: "Foundr1CJK";
  src: url("${fontUrl}") format("opentype");
  font-weight: 400 900;
  font-style: normal;
  font-display: block;
}`;
  return fontFaceCss;
}

function getPdfHtml(record: PrivacyConsentRecord) {
  const stores = record.storeNames.length ? record.storeNames.join("、") : "未設定";
  const bodyHtml = escapeHtml(record.body).replace(/\n/g, "<br />");
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <style>
      ${getFontFaceCss()}
      @page {
        size: A4;
        margin: 18mm 16mm 18mm;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: #172033;
        background: white;
        font-family: "Foundr1CJK", "Noto Sans JP", "Noto Sans CJK JP", sans-serif;
        font-size: 12px;
        line-height: 1.78;
      }

      .document-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
        padding-bottom: 14px;
        border-bottom: 1px solid #d8dee8;
      }

      .brand {
        display: flex;
        gap: 10px;
        align-items: center;
        color: #5c6a7e;
        font-size: 10px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .brand-mark {
        display: grid;
        width: 34px;
        height: 34px;
        place-items: center;
        border-radius: 8px;
        background: #0f7f68;
        color: white;
        font-weight: 700;
      }

      h1 {
        margin: 16px 0 8px;
        font-size: 22px;
        line-height: 1.35;
      }

      .meta {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 16px;
        margin: 16px 0 18px;
        padding: 12px;
        border: 1px solid #d8dee8;
        border-radius: 8px;
        background: #f7f9fb;
      }

      .meta div {
        display: grid;
        gap: 2px;
      }

      .meta dt {
        color: #66758a;
        font-size: 10px;
      }

      .meta dd {
        margin: 0;
        font-weight: 600;
      }

      .body {
        padding-top: 4px;
        font-size: 12px;
        word-break: normal;
        overflow-wrap: anywhere;
      }

      .footer {
        margin-top: 24px;
        padding-top: 10px;
        border-top: 1px solid #d8dee8;
        color: #66758a;
        font-size: 10px;
      }
    </style>
  </head>
  <body>
    <header class="document-header">
      <div>
        <div class="brand"><span class="brand-mark">F1</span><span>Foundr1 STORE</span></div>
        <h1>${escapeHtml(record.title)}</h1>
      </div>
      <div class="brand">Privacy Document</div>
    </header>

    <dl class="meta">
      <div><dt>会社名</dt><dd>${escapeHtml(record.companyLegalName || "未設定")}</dd></div>
      <div><dt>対象店舗</dt><dd>${escapeHtml(stores)}</dd></div>
      <div><dt>文書バージョン</dt><dd>${escapeHtml(record.version)}</dd></div>
      <div><dt>効力発生日</dt><dd>${escapeHtml(record.effectiveDate || "未設定")}</dd></div>
      <div><dt>同意日時</dt><dd>${escapeHtml(formatDateTime(record.agreedAt))}</dd></div>
      <div><dt>同意記録ID</dt><dd>${escapeHtml(record.consentId)}</dd></div>
    </dl>

    <main class="body">${bodyHtml}</main>

    <footer class="footer">このPDFはFoundr1 STOREに保存された同意記録から生成されています。</footer>
  </body>
</html>`;
}

async function getBrowserExecutable() {
  const configured = clean(process.env.CHROME_EXECUTABLE_PATH);
  if (configured) return { executablePath: configured, isLocalChrome: true };

  const localChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(localChromePath)) return { executablePath: localChromePath, isLocalChrome: true };

  return { executablePath: await chromium.executablePath(), isLocalChrome: false };
}

async function launchBrowser(): Promise<Browser> {
  const { executablePath, isLocalChrome } = await getBrowserExecutable();
  return puppeteer.launch({
    args: isLocalChrome
      ? ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "--disable-setuid-sandbox"]
      : [...chromium.args, "--disable-dev-shm-usage", "--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: {
      width: 794,
      height: 1123,
      deviceScaleFactor: 1
    },
    executablePath,
    headless: true,
    timeout: 15000
  });
}

let sharedBrowserPromise: Promise<Browser> | null = null;

async function getSharedBrowser() {
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = launchBrowser()
      .then((browser) => {
        browser.on("disconnected", () => {
          sharedBrowserPromise = null;
        });
        return browser;
      })
      .catch((error) => {
        sharedBrowserPromise = null;
        throw error;
      });
  }

  const browser = await sharedBrowserPromise;
  if (!browser.connected) {
    sharedBrowserPromise = null;
    return getSharedBrowser();
  }
  return browser;
}

export async function GET(_request: Request, context: { params: Promise<{ consentId: string }> }) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { consentId } = await context.params;
  const consents = await getAgreedPrivacyConsents(session);
  const consent = consents.find((record) => record.consentId === consentId);
  if (!consent) return Response.json({ error: "文書が見つかりません。" }, { status: 404 });

  let page: Page | null = null;
  try {
    const browser = await getSharedBrowser();
    page = await browser.newPage();
    await page.setContent(getPdfHtml(consent), { waitUntil: "load", timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMediaType("print");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true
    });
    const filename = `${consent.companyLegalName || "company"}-個人情報文書-${consent.version}.pdf`;

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDispositionFileName(filename),
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    console.error("Failed to render privacy consent PDF", error);
    return Response.json({ error: "PDFを生成できませんでした。" }, { status: 500 });
  } finally {
    await page?.close().catch(() => {});
  }
}
