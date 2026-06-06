import chromium from "@sparticuz/chromium";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { getDemoOnlineReceiptViewModel, getOnlineReceiptViewModel } from "../../../../../../lib/receipt-data";
import type { Browser } from "puppeteer-core";
import type { Page } from "puppeteer-core";
import type { OnlineReceiptItem, OnlineReceiptViewModel } from "../../../../../../lib/receipt-data";

type ReceiptRecipientMode = "blank" | "registered" | "custom";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function getRecipientMode(value: string): ReceiptRecipientMode {
  return value === "registered" || value === "custom" ? value : "blank";
}

function getRegisteredRecipientName(receipt: OnlineReceiptViewModel) {
  const name = receipt.recipientName.trim();
  return name && name !== "お客様" ? name : "";
}

function applyRecipientChoice(receipt: OnlineReceiptViewModel, mode: ReceiptRecipientMode, customName: string) {
  const registeredName = getRegisteredRecipientName(receipt);
  const recipientName = mode === "custom"
    ? customName.trim()
    : mode === "registered" ? registeredName : "";
  return {
    ...receipt,
    recipientName
  };
}

function getReceiptFileName(receipt: OnlineReceiptViewModel) {
  return `領収書-${receipt.brandName}-${receipt.pickupCode}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
}

function contentDispositionFileName(filename: string) {
  return `inline; filename="receipt.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function getFooterBrandText() {
  return `© ${new Date().getFullYear()} Foundr1`;
}

let receiptFontFaceCss = "";
let receiptBaseCss = "";

function getReceiptFontFaceCss() {
  if (receiptFontFaceCss) return receiptFontFaceCss;
  const fontPath = join(process.cwd(), "fonts/NotoSansCJKjp-Regular.otf");
  if (!existsSync(fontPath)) return "";
  const fontUrl = pathToFileURL(fontPath).href;
  receiptFontFaceCss = `
@font-face {
  font-family: "Foundr1ReceiptCJK";
  src: url("${fontUrl}") format("opentype");
  font-weight: 400 900;
  font-style: normal;
  font-display: block;
}
body,
.online-receipt-sheet {
  font-family: "Foundr1ReceiptCJK", "Noto Sans JP", "Noto Sans CJK JP", sans-serif;
}`;
  return receiptFontFaceCss;
}

function getReceiptCss() {
  if (receiptBaseCss) return `${getReceiptFontFaceCss()}\n${receiptBaseCss}`;
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
  const receiptCssEnd = css.indexOf("\nbutton {\n  cursor: pointer;");
  receiptBaseCss = receiptCssEnd > 0 ? css.slice(0, receiptCssEnd) : css;
  return `${getReceiptFontFaceCss()}\n${receiptBaseCss}`;
}

function getPublicDataUrl(src: string) {
  if (!src.startsWith("/")) return src;
  const filePath = join(process.cwd(), "public", src.replace(/^\/+/, ""));
  if (!existsSync(filePath)) return src;
  const ext = filePath.split(".").pop()?.toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY"
  }).format(Number.isFinite(amount) ? amount : 0);
}

function detailList(items: string[]) {
  const visibleItems = items.map((item) => item.trim()).filter(Boolean);
  if (!visibleItems.length) return "";
  return `<div class="online-receipt-detail-list">${visibleItems.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
}

function receiptItem(item: OnlineReceiptItem, index: number) {
  const sections = item.sections.length
    ? `<div class="online-receipt-section-list">${item.sections.map((section) => `
        <div>
          <p>${escapeHtml(section.title)}</p>
          ${detailList(section.items)}
        </div>
      `).join("")}</div>`
    : "";

  return `
    <div class="online-receipt-item">
      <div class="online-receipt-item-main">
        <div>
          <span>${String(index + 1).padStart(2, "0")}</span>
          <h3>${escapeHtml(item.title)}</h3>
          ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
        </div>
        <strong>${escapeHtml(formatCurrency(item.amount))}</strong>
      </div>
      ${detailList(item.details)}
      ${sections}
    </div>
  `;
}

function getReceiptHtml(receipt: OnlineReceiptViewModel) {
  const receiptWithAssets = {
    ...receipt,
    logoSrc: getPublicDataUrl(receipt.logoSrc)
  };
  const brandClass = receiptWithAssets.brand === "maamaa" ? "is-maamaa" : "is-nanacha";
  const sheet = `
    <article class="online-receipt-sheet ${brandClass}" aria-label="領収書">
      <header class="online-receipt-header">
        <div class="online-receipt-brand">
          <img src="${escapeHtml(receiptWithAssets.logoSrc)}" alt="${escapeHtml(receiptWithAssets.brandName)}" />
          <div>
            <p>${escapeHtml(receiptWithAssets.brandName)}</p>
            <span>Online pickup receipt</span>
          </div>
        </div>
        <div class="online-receipt-title-block">
          <h1>領収書</h1>
          <p>Receipt No. ${escapeHtml(receiptWithAssets.receiptNo)}</p>
        </div>
      </header>

      <section class="online-receipt-hero" aria-label="金額">
        <div>
          <p class="online-receipt-recipient${receiptWithAssets.recipientName ? "" : " is-blank"}">
            <span>${escapeHtml(receiptWithAssets.recipientName || "\u00a0")}</span>
            <em>様</em>
          </p>
          <span>但し ${escapeHtml(receiptWithAssets.purposeText)}として</span>
        </div>
        <strong>${escapeHtml(formatCurrency(receiptWithAssets.totalAmount))}</strong>
      </section>

      <section class="online-receipt-info-grid" aria-label="注文と発行者">
        <div>
          <h2>注文情報</h2>
          <dl>
            <div><dt>取餐番号</dt><dd>${escapeHtml(receiptWithAssets.pickupCode)}</dd></div>
            <div><dt>受取日時</dt><dd>${escapeHtml(`${receiptWithAssets.pickupDate} ${receiptWithAssets.pickupTime}`)}</dd></div>
            <div><dt>支払方法</dt><dd>${escapeHtml(receiptWithAssets.paymentProvider || "決済済み")}</dd></div>
            <div><dt>支払日時</dt><dd>${escapeHtml(receiptWithAssets.paidAt)}</dd></div>
          </dl>
        </div>
        <div>
          <h2>発行者</h2>
          <dl>
            <div><dt>会社名</dt><dd>${escapeHtml(receiptWithAssets.issuer.name)}</dd></div>
            ${receiptWithAssets.issuer.invoiceRegistrationNumber ? `<div><dt>登録番号</dt><dd>${escapeHtml(receiptWithAssets.issuer.invoiceRegistrationNumber)}</dd></div>` : ""}
            ${receiptWithAssets.issuer.address ? `<div><dt>住所</dt><dd>${escapeHtml(receiptWithAssets.issuer.address)}</dd></div>` : ""}
            ${receiptWithAssets.issuer.phone ? `<div><dt>TEL</dt><dd>${escapeHtml(receiptWithAssets.issuer.phone)}</dd></div>` : ""}
            <div><dt>発行日</dt><dd>${escapeHtml(receiptWithAssets.issuedAt)}</dd></div>
          </dl>
        </div>
      </section>

      <section class="online-receipt-items" aria-label="明細">
        <div class="online-receipt-section-heading">
          <h2>明細</h2>
          <span>${receiptWithAssets.items.length} item${receiptWithAssets.items.length === 1 ? "" : "s"}</span>
        </div>
        <div class="online-receipt-item-list">
          ${receiptWithAssets.items.map(receiptItem).join("")}
        </div>
      </section>

      <section class="online-receipt-total-panel" aria-label="合計">
        <dl>
          <div><dt>小計</dt><dd>${escapeHtml(formatCurrency(receiptWithAssets.subtotalAmount))}</dd></div>
          ${receiptWithAssets.couponDiscountAmount > 0 ? `<div><dt>クーポン値引き</dt><dd>-${escapeHtml(formatCurrency(receiptWithAssets.couponDiscountAmount))}</dd></div>` : ""}
          <div class="is-total"><dt>合計</dt><dd>${escapeHtml(formatCurrency(receiptWithAssets.totalAmount))}</dd></div>
          <div><dt>内消費税等 ${escapeHtml(receiptWithAssets.taxRate)}%対象</dt><dd>${escapeHtml(formatCurrency(receiptWithAssets.taxIncludedAmount))}</dd></div>
        </dl>
      </section>

      <footer class="online-receipt-footer">
        <p>この領収書は電子的に発行されています。</p>
        <span>${escapeHtml(getFooterBrandText())}</span>
      </footer>
    </article>
  `;
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <style>${getReceiptCss()}</style>
  </head>
  <body>
    <main class="online-receipt-preview-shell">${sheet}</main>
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
      : [
          ...chromium.args,
          "--disable-dev-shm-usage",
          "--no-sandbox",
          "--disable-setuid-sandbox"
        ],
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderId = clean(url.searchParams.get("orderId"));
  const pickupCode = clean(url.searchParams.get("pickupCode"));
  const demo = clean(url.searchParams.get("demo")).toLowerCase();
  const recipientMode = getRecipientMode(clean(url.searchParams.get("recipientMode")));
  const recipientName = clean(url.searchParams.get("recipientName")).slice(0, 80);

  const receipt = demo === "nanacha" || demo === "maamaa"
    ? getDemoOnlineReceiptViewModel(demo)
    : orderId && pickupCode ? await getOnlineReceiptViewModel({ orderId, pickupCode }) : null;

  if (!receipt) {
    return Response.json({ error: "Receipt was not found or payment is not completed." }, { status: 404 });
  }

  const displayReceipt = applyRecipientChoice(receipt, recipientMode, recipientName);

  let page: Page | null = null;
  try {
    const browser = await getSharedBrowser();
    page = await browser.newPage();
    await page.setContent(getReceiptHtml(displayReceipt), { waitUntil: "load", timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector(".online-receipt-sheet", { timeout: 10000 });
    await page.emulateMediaType("print");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true
    });

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDispositionFileName(getReceiptFileName(displayReceipt)),
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    console.error("Failed to render receipt preview PDF", error);
    return Response.json({ error: "Receipt PDF could not be generated." }, { status: 500 });
  } finally {
    await page?.close().catch(() => {});
  }
}
