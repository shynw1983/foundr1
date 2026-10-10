import { requireOsSession } from "../../../../lib/api-auth";
import { roleHasPermission } from "../../../../lib/role-permissions";
import { readInventoryRecipes, saveInventoryRecipe } from "../../../../lib/inventory-recipe-data";
import { inventoryUuid, InventoryRecipeError } from "../../../../lib/inventory-recipe-policy";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };
function failure(error: unknown) {
  if (error instanceof InventoryRecipeError) return Response.json({ error:error.message,code:error.code },{status:error.status,headers});
  return Response.json({error:"配合を処理できませんでした。再取得して確認してください。",code:"recipe_failed"},{status:503,headers});
}
export async function GET(request: Request) {
  const session=await requireOsSession();
  if(!session || !await roleHasPermission(session.role,"module.inventory")) return Response.json({error:"権限がありません。"},{status:403,headers});
  const params=new URL(request.url).searchParams;
  const storeId=params.get("storeId")?.trim() || undefined,brandId=params.get("brandId")?.trim() || undefined;
  if((storeId && !inventoryUuid.test(storeId)) || (brandId && !inventoryUuid.test(brandId))) return Response.json({error:"店舗・ブランドを正しく指定してください。"},{status:400,headers});
  try {
    const canManage=(session.role==="owner" || session.role==="manager") && await roleHasPermission(session.role,"menus.edit");
    return Response.json(await readInventoryRecipes(session,canManage,storeId,brandId),{headers});
  } catch(error) {return failure(error);}
}
export async function POST(request: Request) {
  const session=await requireOsSession();
  if(!session || !["owner","manager"].includes(session.role) || !await roleHasPermission(session.role,"menus.edit")) return Response.json({error:"配合を管理する権限がありません。"},{status:403,headers});
  try {return Response.json({ok:true,recipe:await saveInventoryRecipe(session,await request.json().catch(()=>null))},{headers});}
  catch(error) {return failure(error);}
}
