import { osStoreContextCookieName, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { cookies } from "next/headers";

const selectableRoles = new Set(["owner", "manager"]);

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 401 });

  if (!selectableRoles.has(session.role)) {
    return Response.json({ canSelectStore: false, selectedStoreId: "", stores: [] });
  }

  const cookieStore = await cookies();
  const selectedStoreId = String(cookieStore.get(osStoreContextCookieName)?.value ?? "").trim();
  const stores = await sql`
    select id::text, name
    from stores
    order by name
  `;

  return Response.json({
    canSelectStore: true,
    selectedStoreId: stores.some((store) => String(store.id) === selectedStoreId) ? selectedStoreId : "",
    stores: stores.map((store) => ({ id: String(store.id), name: String(store.name) }))
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !selectableRoles.has(session.role)) {
    return Response.json({ error: "店舗を切り替える権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { storeId?: string };
  const storeId = String(body.storeId ?? "").trim();
  if (!storeId) return Response.json({ error: "店舗を選択してください。" }, { status: 400 });

  const rows = await sql`
    select id::text
    from stores
    where id::text = ${storeId}
    limit 1
  `;
  if (!rows[0]?.id) return Response.json({ error: "店舗が見つかりません。" }, { status: 404 });

  const response = Response.json({ ok: true, selectedStoreId: storeId });
  response.headers.append(
    "Set-Cookie",
    `${osStoreContextCookieName}=${encodeURIComponent(storeId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
  return response;
}
