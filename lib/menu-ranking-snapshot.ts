import { createHash } from "node:crypto";
import { get } from "@vercel/blob";
import { menuRankingSnapshotPath, menuRankingSnapshotSha256 } from "./menu-ranking-snapshot-config";
import type { MenuRanking } from "./menu-ranking";

export async function readMenuRankingSnapshot(): Promise<Omit<MenuRanking, "store"> | null> {
  const token = process.env.CAMERA_BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const result = await get(menuRankingSnapshotPath, {access:"private",token,useCache:false,abortSignal:AbortSignal.timeout(15000)});
    if (!result || result.statusCode !== 200) return null;
    const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== menuRankingSnapshotSha256) return null;
    return JSON.parse(bytes.toString("utf8"));
  } catch { return null; }
}
