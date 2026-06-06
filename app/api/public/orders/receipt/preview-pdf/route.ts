import chromium from "@sparticuz/chromium";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { getDemoOnlineReceiptViewModel, getOnlineReceiptViewModel } from "../../../../../../lib/receipt-data";
import type { Browser } from "puppeteer-core";
import type { OnlineReceiptViewModel } from "../../../../../../lib/receipt-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function getReceiptFileName(receipt: OnlineReceiptViewModel) {
  return `領収書-${receipt.brandName}-${receipt.pickupCode}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
}

function contentDispositionFileName(filename: string) {
  return `inline; filename="receipt.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`;
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderId = clean(url.searchParams.get("orderId"));
  const pickupCode = clean(url.searchParams.get("pickupCode"));
  const demo = clean(url.searchParams.get("demo")).toLowerCase();

  const receipt = demo === "nanacha" || demo === "maamaa"
    ? getDemoOnlineReceiptViewModel(demo)
    : orderId && pickupCode ? await getOnlineReceiptViewModel({ orderId, pickupCode }) : null;

  if (!receipt) {
    return Response.json({ error: "Receipt was not found or payment is not completed." }, { status: 404 });
  }

  const previewUrl = new URL("/public/orders/receipt/preview", url.origin);
  if (demo) {
    previewUrl.searchParams.set("demo", demo);
  } else {
    previewUrl.searchParams.set("orderId", orderId);
    previewUrl.searchParams.set("pickupCode", pickupCode);
  }
  previewUrl.searchParams.set("pdf", "1");

  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(previewUrl.href, { waitUntil: "domcontentloaded", timeout: 15000 });
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
        "Content-Disposition": contentDispositionFileName(getReceiptFileName(receipt)),
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    console.error("Failed to render receipt preview PDF", error);
    return Response.json({ error: "Receipt PDF could not be generated." }, { status: 500 });
  } finally {
    await browser?.close().catch(() => {});
  }
}
