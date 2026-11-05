import { sql } from "./db";

export function lockBridgeExecutionRoute(storeId: string) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${"bridge-execution:" + storeId}, 0))`;
}
