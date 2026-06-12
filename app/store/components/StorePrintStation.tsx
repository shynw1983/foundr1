"use client";

import { useEffect, useRef, useState } from "react";
import { getKitchenPrinterForBrand, printWithAndroidBridge, type PosPrintPayload, type PosPrinterSettings } from "../../../lib/pos-printer";
import { getStoredStoreSelection } from "./store-selection";

type PrintJob = {
  taskId: string;
  brandId: string;
  brandName: string;
  productionAreaLabel: string;
  itemSummary: string;
  pickupCode: string;
  orderType: string;
  note: string;
  storeName: string;
  createdTime: string;
};

type PrintStationResponse = {
  selectedStoreId: string;
  printerSettings: PosPrinterSettings;
  jobs: PrintJob[];
};

function hasAndroidPrinterBridge() {
  return typeof window !== "undefined" && Boolean(window.Foundr1Printer?.print);
}

function absoluteUrl(value: string) {
  const url = String(value || "").trim();
  if (!url || /^https?:\/\//i.test(url)) return url;
  return new URL(url, window.location.origin).toString();
}

function withAbsoluteTemplateMedia(settings: PosPrinterSettings) {
  return {
    ...settings.receiptTemplate,
    logoUrl: absoluteUrl(settings.receiptTemplate.logoUrl),
    promotionImageUrl: absoluteUrl(settings.receiptTemplate.promotionImageUrl)
  };
}

function splitKitchenItems(summary: string) {
  const items: NonNullable<PosPrintPayload["order"]>["items"] = [];
  const lines = String(summary || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if ((line.startsWith("・") || line.startsWith("- ")) && items.length) {
      const option = line.replace(/^・\s*/, "").replace(/^-\s*/, "").trim();
      if (option) items[items.length - 1].options = [...(items[items.length - 1].options ?? []), option];
      continue;
    }
    const match = line.match(/^(.*?)(?:\s+x(\d+))$/);
    items.push({
      name: (match?.[1] || line).trim(),
      quantity: Number(match?.[2] || 1),
      amount: 0,
      options: []
    });
  }
  return items.length ? items : [{ name: "厨房タスク", quantity: 1, amount: 0, options: lines }];
}

function createKitchenPayload(job: PrintJob, settings: PosPrinterSettings): PosPrintPayload | null {
  const printer = getKitchenPrinterForBrand(settings, job.brandId || null);
  if (!settings.enabled || !settings.kitchenEnabled || !printer.host) return null;
  return {
    version: 1,
    jobType: "kitchen",
    printer,
    storeName: `${job.storeName || "Foundr1 STORE"} / ${job.brandName || job.productionAreaLabel || "厨房"}`,
    printedAt: new Date().toISOString(),
    receiptTemplate: withAbsoluteTemplateMedia(settings),
    order: {
      pickupCode: job.pickupCode,
      orderType: job.orderType || "web",
      paymentMethod: "kitchen",
      paymentLabel: "厨房",
      note: job.note,
      subtotalAmount: 0,
      discountAmount: 0,
      couponDiscountAmount: 0,
      taxAmount: 0,
      taxRate: 0,
      totalAmount: 0,
      items: splitKitchenItems(job.itemSummary)
    }
  };
}

export function StorePrintStation() {
  const [status, setStatus] = useState("");
  const busyRef = useRef(false);

  useEffect(() => {
    let active = true;
    let timer = 0;

    async function updatePrintStatus(storeId: string, taskId: string, printStatus: "printing" | "printed" | "failed") {
      const response = await fetch("/api/store/print-station", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, taskId, printStatus })
      });
      const body = await response.json().catch(() => ({}));
      return response.ok && body.ok === true;
    }

    async function poll() {
      if (!active || busyRef.current || document.visibilityState !== "visible" || !hasAndroidPrinterBridge()) return;
      busyRef.current = true;
      try {
        const storeId = getStoredStoreSelection();
        const params = new URLSearchParams();
        if (storeId) params.set("storeId", storeId);
        const response = await fetch(`/api/store/print-station${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
        if (!response.ok || !active) return;
        const body = await response.json() as PrintStationResponse;
        if (!body.printerSettings?.enabled || !body.printerSettings.kitchenEnabled) {
          setStatus("");
          return;
        }
        for (const job of body.jobs ?? []) {
          if (!active) return;
          const payload = createKitchenPayload(job, body.printerSettings);
          if (!payload) {
            setStatus("");
            return;
          }
          const claimed = await updatePrintStatus(body.selectedStoreId, job.taskId, "printing");
          if (!claimed) continue;
          setStatus(`厨房印刷中 ${job.pickupCode}`);
          const result = await printWithAndroidBridge(payload);
          await updatePrintStatus(body.selectedStoreId, job.taskId, result.ok ? "printed" : "failed");
          setStatus(result.ok ? `厨房印刷済み ${job.pickupCode}` : `厨房印刷失敗 ${job.pickupCode}`);
        }
      } catch {
        setStatus("厨房印刷の確認に失敗しました。");
      } finally {
        busyRef.current = false;
      }
    }

    void poll();
    timer = window.setInterval(poll, 8000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void poll();
    };
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return status ? <div className="store-print-station-status" aria-live="polite">{status}</div> : null;
}
