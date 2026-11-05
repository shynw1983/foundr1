import { assertSnsLibrarySameOrigin, requireSnsLibraryAccess } from "../../../../../../lib/sns-library";
import { completeSnsAsset } from "../../../../../../lib/sns-library-assets";
import { readSnsLibraryBody, snsLibraryFailure, snsLibraryJson } from "../../../../../../lib/sns-library-http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSnsLibrarySameOrigin(request);
    const body = await readSnsLibraryBody(request), access = await requireSnsLibraryAccess(body.storeId, body.surface);
    return snsLibraryJson({ asset: await completeSnsAsset(access, (await context.params).id) });
  } catch (error) { return snsLibraryFailure(error); }
}
