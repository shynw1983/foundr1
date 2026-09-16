export type StoreOrderCursor = { createdAt: string; id: string };
export function parseStoreOrderCursor(value: string): StoreOrderCursor | null {
  if (!value) return null;
  try {
    if (value.length > 512) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!cursor || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)
      || typeof cursor.createdAt !== "string" || !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error();
    return cursor;
  } catch { throw new Error("Invalid order cursor"); }
}
export function encodeStoreOrderCursor(cursor: StoreOrderCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
