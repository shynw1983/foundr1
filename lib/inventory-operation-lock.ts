import { randomUUID } from "node:crypto";
import { sql } from "./db";

// Serializes local writes and whole-store snapshot commits across API instances.
export async function withInventoryOperationLock<T>(storeId: string, operation: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  const rows = await sql`
    insert into menu_inventory_operation_locks (store_id, token, expires_at)
    values (${storeId}, ${token}, now() + interval '5 minutes')
    on conflict (store_id) do update set token = excluded.token, expires_at = excluded.expires_at
    where menu_inventory_operation_locks.expires_at < now()
    returning token
  `;
  if (!rows.length) throw new Error("販売状態を更新中です。完了後に再実行してください。");
  try { return await operation(); }
  finally { await sql`delete from menu_inventory_operation_locks where store_id=${storeId} and token=${token}`; }
}

export async function assertNoWholeStoreSync(storeId: string) {
  const rows = await sql`select id from local_bridge_commands where store_id=${storeId}
    and payload->>'availabilityAuthority'='uber_eats' and status in ('pending','processing') limit 1`;
  if (rows.length) throw new Error("Uber 基準の全店同期中です。同期履歴で完了を確認してから変更してください。");
}
