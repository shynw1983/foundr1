"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { printWithAndroidBridge } from "../../../lib/pos-printer";
import { createStoreRefreshCoordinator } from "../../../lib/store-polling-client";
import { posPrintQueueRefreshInterval } from "../../../lib/pos-print-refresh-policy";
import { createReadError } from "../../../components/useReadRequest";
import type { RelayOwner } from "../../../lib/store-relay-policy";
import type { PosPrintDocument, PosPrintDocumentClaim, PosPrintDocumentMutation, PosPrintDocumentQueue, PosPrintDocumentTransport } from "../../../lib/pos-print-document-contract";

const endpoint = "/api/store/pos/print-documents";
const uncertainMessage = "印刷結果を確認できません。現物を確認してから印刷状況を更新してください。";
const scopeChangedMessage = "店舗が変わったため印刷を停止しました。元の店舗で印刷状況を確認してください。";
const attemptKey = (storeId: string, id: string) => `foundr1-pos-print-attempt:v1:${storeId}:${id}`;

async function requestJson<T>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(abort, 15000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(createReadError(response), { message: body.error || "印刷状況を確認できません。" });
    return body as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("接続を確認できません。印刷状況を確認してから再操作してください。");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function usePosPrintDocuments({ storeId, directAvailable, relayOwner }: { storeId: string; directAvailable: boolean; relayOwner: RelayOwner | null }) {
  const [queue, setQueue] = useState<PosPrintDocumentQueue | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const scopeRef = useRef(storeId); scopeRef.current = storeId;
  const optionsRef = useRef({ directAvailable, relayOwner }); optionsRef.current = { directAvailable, relayOwner };
  const generationRef = useRef(0);
  const coordinatorRef = useRef<ReturnType<typeof createStoreRefreshCoordinator> | null>(null);
  const busyRef = useRef(false);
  const filterRef = useRef("");
  const queueRef = useRef<PosPrintDocumentQueue | null>(null);
  const requestRef = useRef({ version: 0, append: false, cursor: "" });
  const lastSuccessfulRequestRef = useRef(-1);
  const progressRef = useRef({ signature: "", observedAt: 0 });
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; coordinatorRef.current?.stop(); }; }, []);

  const readQueue = useCallback(async (signal: AbortSignal) => {
    if (!storeId) return;
    const generation = generationRef.current;
    const orderId = filterRef.current;
    const request = requestRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ storeId, limit: "100", ...(orderId ? { orderId } : {}) });
      if (request.append && request.cursor) params.set("cursor", request.cursor);
      const body = await requestJson<PosPrintDocumentQueue>(`${endpoint}?${params}`, {}, signal);
      if (signal.aborted || !mountedRef.current || generation !== generationRef.current || scopeRef.current !== storeId
        || request.version !== requestRef.current.version || orderId !== filterRef.current) return;
      if (body.selectedStoreId !== storeId) throw new Error("店舗の印刷状況を再確認してください。");
      const current = queueRef.current;
      const next = request.append && current ? { ...body, documents: [...current.documents, ...body.documents.filter(doc => !current.documents.some(old => old.id === doc.id))] } : body;
      queueRef.current = next;
      setQueue(next);
      requestRef.current = { ...request, append: false, cursor: "" };
      const signature = next.documents.filter(doc => doc.state === "pending" || doc.state === "sending")
        .map(doc => `${doc.id}:${doc.revision}:${doc.state}`).join("|");
      if (signature !== progressRef.current.signature) progressRef.current = { signature, observedAt: Date.now() };
      lastSuccessfulRequestRef.current = request.version;
      setReadError("");
    } catch (error) {
      if (!signal.aborted && mountedRef.current && generation === generationRef.current && scopeRef.current === storeId)
        setReadError(error instanceof Error ? error.message : "印刷状況を確認できません。");
      throw error;
    } finally {
      if (mountedRef.current && generation === generationRef.current && scopeRef.current === storeId) setLoading(false);
    }
  }, [storeId]);
  const readQueueRef = useRef(readQueue); readQueueRef.current = readQueue;

  const refresh = useCallback(async (orderId = filterRef.current, append = false) => {
    if (!storeId || !coordinatorRef.current || scopeRef.current !== storeId) return null;
    filterRef.current = orderId;
    requestRef.current = { version: requestRef.current.version + 1, append, cursor: append ? queueRef.current?.cursor || "" : "" };
    const version = requestRef.current.version;
    await coordinatorRef.current.refresh({ force: true });
    return lastSuccessfulRequestRef.current >= version && scopeRef.current === storeId && filterRef.current === orderId ? queueRef.current : null;
  }, [storeId]);
  const refreshRef = useRef(refresh); refreshRef.current = refresh;

  useEffect(() => {
    generationRef.current += 1; filterRef.current = ""; queueRef.current = null; lastSuccessfulRequestRef.current = -1;
    requestRef.current = { version: requestRef.current.version + 1, append: false, cursor: "" };
    progressRef.current = { signature: "", observedAt: 0 };
    setQueue(null); setReadError(""); setActionError(""); setLoading(false);
    if (!storeId) return;
    // Queue events do not yet cover relay ACKs. Read-only task confirmation is
    // bounded to two minutes of observed progress, then returns to idle cadence.
    const coordinator = createStoreRefreshCoordinator(signal => readQueueRef.current(signal), {
      healthyIntervalMs: 5 * 60_000,
      fallbackIntervalMs: () => posPrintQueueRefreshInterval(queueRef.current, progressRef.current.observedAt),
      maxFailureIntervalMs: 5 * 60_000,
      onUnauthorized: () => { queueRef.current = null; setQueue(null); }
    });
    coordinatorRef.current = coordinator;
    coordinator.start({ immediate: true });
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline); window.addEventListener("offline", updateOnline);
    return () => {
      coordinator.stop();
      if (coordinatorRef.current === coordinator) coordinatorRef.current = null;
      window.removeEventListener("online", updateOnline); window.removeEventListener("offline", updateOnline);
    };
  }, [storeId]);

  const mutate = (body: PosPrintDocumentMutation) => requestJson<PosPrintDocumentClaim & { ok?: boolean }>(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function printDocuments(documents: PosPrintDocument[], options: { reprint?: boolean; physicalConfirmed?: boolean; initialCheckout?: boolean; checkoutRequestId?: string } = {}) {
    if (busyRef.current) return { ok: false, error: "印刷処理中です。状況を確認してください。" };
    if (!navigator.onLine) { setActionError("オフラインです。接続後に印刷状況を確認してください。"); return { ok: false, error: "オフラインです。接続後に印刷状況を確認してください。" }; }
    const requestedStore = storeId;
    const generation = generationRef.current;
    busyRef.current = true; setBusy(true); setActionError("");
    let errorText = "";
    try {
      for (const document of [...documents].sort((a, b) => a.orderCreatedAt.localeCompare(b.orderCreatedAt) || a.sequence - b.sequence)) {
        if (!mountedRef.current || scopeRef.current !== requestedStore || generation !== generationRef.current) throw new Error(scopeChangedMessage);
        const key = attemptKey(requestedStore, document.id);
        let previous = false;
        try { previous = Boolean(window.localStorage.getItem(key)); } catch {}
        if (previous && !options.physicalConfirmed) throw new Error(uncertainMessage);
        if (!document.eligible) throw new Error(document.blockedReason || "現在の注文状態では印刷できません。");
        const transport: PosPrintDocumentTransport = optionsRef.current.directAvailable ? "direct" : "relay";
        if (transport === "relay" && !optionsRef.current.relayOwner) throw new Error("レジ操作権と中継端末の接続を確認してください。");
        const operationId = window.crypto.randomUUID();
        try { window.localStorage.setItem(key, JSON.stringify({ operationId, createdAt: new Date().toISOString() })); } catch {}
        let claim: PosPrintDocumentClaim;
        try {
          claim = await mutate({ action: "claim", storeId: requestedStore, documentId: document.id, operationId,
            expectedRevision: document.revision, transport, ...(transport === "relay" ? { relayOwner: optionsRef.current.relayOwner! } : {}), ...options });
        } catch (error) {
          // A definite rejected claim never invoked the printer; an unknown result stays guarded.
          const status = (error as { status?: number }).status;
          if (status && status < 500) try { window.localStorage.removeItem(key); } catch {}
          throw error;
        }
        if (claim.queued || claim.alreadyDone || !claim.shouldPrint) {
          try { window.localStorage.removeItem(key); } catch {}
          continue;
        }
        if (!claim.payload || !claim.claimToken || claim.transport !== "direct") throw new Error(uncertainMessage);
        if (!mountedRef.current || scopeRef.current !== requestedStore || generation !== generationRef.current) throw new Error(scopeChangedMessage);
        let printed = { ok: false, error: uncertainMessage };
        try {
          const result = await printWithAndroidBridge({ ...claim.payload, printer: { ...claim.payload.printer, openCashDrawer: options.initialCheckout ? claim.payload.printer.openCashDrawer : false } });
          printed = { ok: result.ok, error: result.error || uncertainMessage };
        } catch (error) { printed.error = error instanceof Error ? error.message : uncertainMessage; }
        await mutate({ action: "ack", storeId: requestedStore, documentId: document.id, operationId: window.crypto.randomUUID(),
          claimToken: claim.claimToken, result: printed.ok ? "sent" : "uncertain", ...(printed.ok ? {} : { error: printed.error }) });
        if (!printed.ok) throw new Error(uncertainMessage);
        try { window.localStorage.removeItem(key); } catch {}
      }
    } catch (error) {
      errorText = error instanceof Error ? error.message : uncertainMessage;
      if (mountedRef.current && scopeRef.current === requestedStore && generation === generationRef.current) setActionError(errorText);
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
      if (scopeRef.current === requestedStore && generation === generationRef.current) await refreshRef.current();
    }
    return { ok: !errorText, error: errorText };
  }

  async function sendCurrentOrder(orderId: string, checkoutRequestId: string) {
    const requestedStore = storeId;
    const generation = generationRef.current;
    const documents: PosPrintDocument[] = [];
    let cursor = "";
    try {
      for (let page = 0; page < 50; page += 1) {
        const params = new URLSearchParams({ storeId, orderId, limit: "100", ...(cursor ? { cursor } : {}) });
        const body = await requestJson<PosPrintDocumentQueue>(`${endpoint}?${params}`);
        if (!mountedRef.current || body.selectedStoreId !== requestedStore || scopeRef.current !== requestedStore || generation !== generationRef.current) throw new Error(scopeChangedMessage);
        documents.push(...body.documents.filter(doc => doc.orderId === orderId && doc.state === "pending" && doc.eligible && !documents.some(old => old.id === doc.id)));
        if (!body.hasMore) return printDocuments(documents, { initialCheckout: true, checkoutRequestId });
        if (!body.cursor || body.cursor === cursor) throw new Error("印刷待ちの伝票を確認してください。");
        cursor = body.cursor;
      }
      throw new Error("印刷待ちの伝票を確認してください。");
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "会計済みです。印刷待ちの伝票を確認してください。" }; }
  }

  async function confirmPrinted(document: PosPrintDocument) {
    if (busyRef.current) return;
    const requestedStore = storeId; const generation = generationRef.current;
    busyRef.current = true; setBusy(true); setActionError("");
    try {
      await mutate({ action: "confirmPrinted", storeId, documentId: document.id, operationId: window.crypto.randomUUID(), expectedRevision: document.revision, physicalConfirmed: true });
      try { window.localStorage.removeItem(attemptKey(storeId, document.id)); } catch {}
    } catch (error) {
      if (mountedRef.current && scopeRef.current === requestedStore && generation === generationRef.current) setActionError(error instanceof Error ? error.message : uncertainMessage);
    } finally {
      busyRef.current = false; if (mountedRef.current) setBusy(false);
      if (scopeRef.current === requestedStore && generation === generationRef.current) await refreshRef.current();
    }
  }

  async function voidIneligible(document: PosPrintDocument) {
    if (busyRef.current) return;
    if (document.eligible || document.state !== "uncertain") {
      setActionError("現在の伝票状態では終了できません。最新の状況を確認してください。");
      return;
    }
    if (!navigator.onLine) {
      setActionError("オフラインです。接続後に印刷状況を確認してください。");
      return;
    }
    const requestedStore = storeId; const generation = generationRef.current;
    busyRef.current = true; setBusy(true); setActionError("");
    try {
      await mutate({ action: "voidIneligible", storeId: requestedStore, documentId: document.id, operationId: window.crypto.randomUUID(), expectedRevision: document.revision, physicalConfirmed: true });
      try { window.localStorage.removeItem(attemptKey(requestedStore, document.id)); } catch {}
    } catch (error) {
      if (mountedRef.current && scopeRef.current === requestedStore && generation === generationRef.current) setActionError(error instanceof Error ? error.message : uncertainMessage);
    } finally {
      busyRef.current = false; if (mountedRef.current) setBusy(false);
      if (scopeRef.current === requestedStore && generation === generationRef.current) await refreshRef.current();
    }
  }

  function needsPhysicalReview(document: PosPrintDocument) {
    try { return Boolean(window.localStorage.getItem(attemptKey(storeId, document.id))); } catch { return false; }
  }
  return { queue, loading, readError, actionError, busy, online, refresh, printDocuments, sendCurrentOrder, confirmPrinted, voidIneligible, needsPhysicalReview };
}
export type PosPrintDocumentsController = ReturnType<typeof usePosPrintDocuments>;
