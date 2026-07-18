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
const databaseVersion = 1;
const snapshotStore = "pos-snapshots";
const orderStore = "pos-orders";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
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
