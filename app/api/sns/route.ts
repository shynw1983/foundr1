import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSnsAccess } from "../../../lib/sns-access";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
    const access = await getSnsAccess();
    if (!access)
        return Response.json({ error: "ログインしてください。" }, { status: 401 });
    const url = new URL(request.url);
    if (url.searchParams.get("surface") === "os" && !access.canManage)
        return Response.json({ error: "権限がありません。" }, { status: 403 });
    if (url.searchParams.get("asset") === "logo") {
        if (!access.stores.some(s => s.id === url.searchParams.get("storeId")))
            return Response.json({ error: "権限がありません。" }, { status: 403 });
        const color = url.searchParams.get("color") ?? "black";
        if (color !== "black" && color !== "white")
            return Response.json({ error: "文字色を選択してください。" }, { status: 400 });
        const bytes = await readFile(path.join(process.cwd(), `assets/sns/maamaa-complete-logo-${color}.png`));
        return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
    }
    return Response.json(access, { headers: { "Cache-Control": "private, no-store" } });
}
