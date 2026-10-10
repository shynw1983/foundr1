import { requireOsSession, canAccessStore } from "../../../../lib/api-auth";
import { roleHasPermission } from "../../../../lib/role-permissions";
import { getVisibleProductIdsForStore } from "../../../../lib/product-catalog-access";
import { getInventoryUsage } from "../../../../lib/inventory-usage-data";
export const dynamic = "force-dynamic";
const headers={"Cache-Control":"no-store, max-age=0"};
export async function GET(request: Request) {
  const session=await requireOsSession();
  if(!session || !(await roleHasPermission(session.role,"module.inventory"))) return Response.json({error:"権限がありません。"},{status:403,headers});
  const storeId=new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId)) return Response.json({error:"店舗を指定してください。"},{status:400,headers});
  if(!(await canAccessStore(session,storeId))) return Response.json({error:"この店舗の在庫を確認する権限がありません。"},{status:403,headers});
  return Response.json(await getInventoryUsage(storeId,await getVisibleProductIdsForStore(session,storeId)),{headers});
}
