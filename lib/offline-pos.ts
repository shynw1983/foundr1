import type { PosPrintJob } from "./pos-print-jobs";
export type OfflinePosSnapshot = {
  storeId: string;
  savedAt: string;
  data: Record<string, unknown>;
  reconciliation: Record<string, unknown> | null;
};

export type OfflinePosOrder = {
  clientOrderId: string;
  storeId: string;
  createdAt: string;
  request: Record<string, unknown>;
  localResponse: Record<string, unknown>;
  lastError: string;
};

const databaseName = "foundr1-store-offline";
const databaseVersion = 3;
const printStore = "pos-print-jobs";
const recoveryStore = "pos-checkout-recovery";
const snapshotStore = "pos-snapshots";
const orderStore = "pos-orders";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(recoveryStore)) database.createObjectStore(recoveryStore, { keyPath: "storeId" });
      if (!database.objectStoreNames.contains(printStore)) database.createObjectStore(printStore, { keyPath: "id" });
      if (!database.objectStoreNames.contains(snapshotStore)) database.createObjectStore(snapshotStore, { keyPath: "storeId" });
      if (!database.objectStoreNames.contains(orderStore)) {
        const store = database.createObjectStore(orderStore, { keyPath: "clientOrderId" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runRequest<T>(storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => { database.close(); resolve(result); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error || new Error("Local transaction aborted")); };
  });
}

export function saveOfflinePosSnapshot(snapshot: OfflinePosSnapshot) {
  return runRequest(snapshotStore, "readwrite", (store) => store.put(snapshot));
}

export function getOfflinePosSnapshot(storeId: string) {
  return runRequest<OfflinePosSnapshot | undefined>(snapshotStore, "readonly", (store) => store.get(storeId));
}

export function addOfflinePosOrder(order: OfflinePosOrder) {
  return runRequest(orderStore, "readwrite", (store) => store.put(order));
}

export function listOfflinePosOrders() {
  return runRequest<OfflinePosOrder[]>(orderStore, "readonly", (store) => store.getAll());
}

export function removeOfflinePosOrder(clientOrderId: string) {
  return runRequest(orderStore, "readwrite", (store) => store.delete(clientOrderId));
}

export function updateOfflinePosOrderError(order: OfflinePosOrder, lastError: string) {
  return addOfflinePosOrder({ ...order, lastError });
}

export function savePosPrintJob(job: PosPrintJob) {
  return runRequest(printStore, "readwrite", (store) => store.put(job));
}
// Persist the entire layout together: a reload must never recover half of a new batch.
export async function savePosPrintBatch(jobs: PosPrintJob[]) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(printStore, "readwrite");
    for (const job of jobs) transaction.objectStore(printStore).put(job);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error || new Error("Local print batch aborted")); };
  });
}
export async function listPosPrintJobs() {
  const jobs = await runRequest<PosPrintJob[]>(printStore, "readonly", (store) => store.getAll());
  return jobs.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || (a.sequence || 0) - (b.sequence || 0));
}
export function removePosPrintJob(id: string) {
  return runRequest(printStore, "readwrite", (store) => store.delete(id));
}

export type PosCheckoutRecovery = { storeId: string; request: Record<string, unknown>; cart: unknown[] };
export function savePosCheckoutRecovery(record: PosCheckoutRecovery) {
  return runRequest(recoveryStore, "readwrite", (store) => store.put(record));
}
export function listPosCheckoutRecovery() {
  return runRequest<PosCheckoutRecovery[]>(recoveryStore, "readonly", (store) => store.getAll());
}
export function removePosCheckoutRecovery(storeId: string) {
  return runRequest(recoveryStore, "readwrite", (store) => store.delete(storeId));
}
