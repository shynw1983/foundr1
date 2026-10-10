import { requireOsSession } from "../../../../lib/api-auth";
import { roleHasPermission } from "../../../../lib/role-permissions";
import { assertPackagingProductAccess, readProductPackagingTemplates, saveProductPackagingTemplate } from "../../../../lib/product-packaging-data";
import { ProductPackagingError } from "../../../../lib/product-packaging-policy";
import { inventoryUuid } from "../../../../lib/inventory-recipe-policy";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store, max-age=0"};
function failure(error:unknown) {
  if(error instanceof ProductPackagingError) return Response.json({error:error.message,code:error.code},{status:error.status,headers});
  return Response.json({error:"包装情報を処理できませんでした。",code:"packaging_failed"},{status:503,headers});
}
export async function GET(request:Request) {
  const session=await requireOsSession();
  if(!session || !await roleHasPermission(session.role,"module.inventory")) return Response.json({error:"権限がありません。"},{status:403,headers});
  const params=new URL(request.url).searchParams,productId=params.get("productId")?.trim()??"",storeId=params.get("storeId")?.trim() || undefined;
  if(!inventoryUuid.test(productId) || (storeId && !inventoryUuid.test(storeId))) return Response.json({error:"商品・店舗を正しく指定してください。"},{status:400,headers});
  try {
    await assertPackagingProductAccess(session,productId,storeId);
    const headquarters=["owner","manager"].includes(session.role);
    return Response.json({templates:await readProductPackagingTemplates([productId],headquarters),canManage:headquarters && await roleHasPermission(session.role,"products.manage")},{headers});
  } catch(error) {return failure(error);}
}
export async function POST(request:Request) {
  const session=await requireOsSession();
  if(!session || !["owner","manager"].includes(session.role) || !await roleHasPermission(session.role,"products.manage")) return Response.json({error:"包装を管理する権限がありません。"},{status:403,headers});
  try {return Response.json({ok:true,...await saveProductPackagingTemplate(session,await request.json().catch(()=>null))},{headers});}
  catch(error) {return failure(error);}
}
