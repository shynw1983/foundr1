import { requireSnsLibraryAccess } from "../../../../../lib/sns-library";
import { readSnsAsset } from "../../../../../lib/sns-library-assets";
import { snsLibraryFailure } from "../../../../../lib/sns-library-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const params = new URL(request.url).searchParams, access = await requireSnsLibraryAccess(params.get("storeId"), params.get("surface"));
    return await readSnsAsset(access, (await context.params).id);
  } catch (error) { return snsLibraryFailure(error); }
}
