import { requireOsSession } from "../../../lib/api-auth";
import { roleHasPermission } from "../../../lib/role-permissions";
import { readInventoryResponse, handleInventoryOperation } from "../../../lib/inventory-execution-data";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session || !(await roleHasPermission(session.role, "module.inventory"))) return Response.json({ error: "権限がありません。" }, { status: 403, headers });
  const response = await readInventoryResponse(session, new URL(request.url).searchParams.get("storeId")?.trim() ?? "");
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  // Shared terminals use the Store endpoint with a separately verified employee.
  if (!session || session.role === "store_terminal" || session.role === "staff"
    || !(await roleHasPermission(session.role, "module.inventory"))) return Response.json({ error: "権限がありません。" }, { status: 403, headers });
  const response = await handleInventoryOperation(session, await request.json().catch(() => ({})));
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
