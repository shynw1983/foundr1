type StoreInventoryStore = { id: string; name: string };
type StoreContext = { selectedStoreId?: string; access?: { stores?: StoreInventoryStore[] }; error?: string };

/** A saved browser selection is a preference; an explicit link is an exact target. */
export async function loadStoreInventoryStore(
  { explicitStoreId, storedStoreId, signal }: { explicitStoreId: string | null; storedStoreId: string; signal: AbortSignal },
  request: typeof fetch = fetch
) {
  if (explicitStoreId !== null && !explicitStoreId) throw new Error("指定した店舗を確認できません。担当者に確認してください。");
  let requested = explicitStoreId ?? storedStoreId;
  const read = async (storeId: string) => {
    signal.throwIfAborted();
    const response = await request(`/api/store/context${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ""}`, { cache: "no-store", signal });
    signal.throwIfAborted();
    return response;
  };
  let response = await read(requested);
  // Only a stale local preference may fall back to the server's current scope.
  // Explicit links and authentication/network/server failures retain their error.
  if (explicitStoreId === null && storedStoreId && response.status === 403) {
    requested = "";
    response = await read("");
  }
  const body = await response.json() as StoreContext | null;
  signal.throwIfAborted();
  if (!response.ok) throw new Error(body?.error || "この店舗の在庫を確認する権限がありません。");
  const storeId = String(body?.selectedStoreId ?? "");
  if (!storeId || (requested && storeId !== requested)) throw new Error("指定した店舗を確認できません。担当者に確認してください。");
  return { storeId, stores: body?.access?.stores ?? [] };
}
