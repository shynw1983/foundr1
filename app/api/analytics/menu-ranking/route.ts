import { getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { roleHasPermission } from "../../../../lib/role-permissions";
import { canReadRankingScope } from "../../../../lib/menu-ranking";
import { readMenuRankingSnapshot } from "../../../../lib/menu-ranking-snapshot";
import { sql } from "../../../../lib/db";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({error: "ログインしてください。"}, {status: 401, headers});
  const permission = await roleHasPermission(session.role, "module.analytics");
  if (!permission) return Response.json({error: "閲覧権限がありません。"}, {status: 403, headers});
  const month = new URL(request.url).searchParams.get("month") || "2026-09";
  if (month !== "2026-09") return Response.json({error: "この月の検証済みスナップショットはありません。"}, {status: 404, headers});
  // Bind the snapshot to the existing authoritative source by three verified Uber identities.
  // Ambiguous/missing bindings fail closed; no store name guesses or caller-selected scope.
  const sources = await sql`
    select s.store_id::text as "storeId", st.name as "storeName"
    from menu_uber_sources s join stores st on st.id = s.store_id
    where s.uber_store_uuid = 'd6205da2-b809-531c-a7b2-d9cf505cf1c0'
      and (select count(distinct o.uber_id) from menu_uber_objects o where o.source_id = s.id
      and o.kind = 'option' and o.uber_id in (
        'f79e142a-3020-4846-946a-e5fbdcd53a48', '44264263-f757-48f4-8822-f0d727a92733', '61c013df-47f4-47d3-97b0-b8af31380987'
      )) = 3
  `;
  if (sources.length !== 1) return Response.json({error: "スナップショットの店舗紐付けを確認できません。"}, {status: 409, headers});
  const scope = await getSessionStoreScope(session);
  const source = sources[0];
  if (!canReadRankingScope(permission, scope.allStores, scope.storeIds, String(source.storeId)))
    return Response.json({error: "この店舗の閲覧権限がありません。"}, {status: 403, headers});
  // Only read the existing private Blob after live session, module and source-store checks.
  const snapshot = await readMenuRankingSnapshot();
  if (!snapshot) return Response.json({error: "検証済みスナップショットを読み込めません。"}, {status: 503, headers});
  return Response.json({...snapshot, store: {id: String(source.storeId), name: String(source.storeName)}}, {headers});
}
