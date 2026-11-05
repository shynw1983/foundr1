import { assertSnsLibrarySameOrigin, requireSnsLibraryAccess } from "../../../../lib/sns-library";
import { allocateSnsAsset } from "../../../../lib/sns-library-assets";
import { readSnsLibraryBody, snsLibraryFailure, snsLibraryJson } from "../../../../lib/sns-library-http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertSnsLibrarySameOrigin(request);
    const body = await readSnsLibraryBody(request), access = await requireSnsLibraryAccess(body.storeId, body.surface);
    return snsLibraryJson({ asset: await allocateSnsAsset(access, body) }, 201);
  } catch (error) { return snsLibraryFailure(error); }
}
