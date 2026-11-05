import type { PosPrintDocumentQueue } from "./pos-print-document-contract";

/** This queue has no complete relay-ACK event coverage. Reads never execute printing. */
export function posPrintQueueRefreshInterval(queue: PosPrintDocumentQueue | null, observedProgressAt: number, now = Date.now()) {
  const active = Boolean(queue && (queue.summary.pendingDocuments > 0 || queue.summary.sendingDocuments > 0));
  const age = now - observedProgressAt;
  return active && observedProgressAt > 0 && age >= 0 && age < 2 * 60_000 ? 5_000 : 60_000;
}
