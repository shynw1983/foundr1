import { assertSnsLibrarySameOrigin, requireSnsLibraryAccess } from "../../../../lib/sns-library";
import { readSnsLibraryBody, snsLibraryFailure, snsLibraryJson } from "../../../../lib/sns-library-http";
import { changeSnsFavoriteColor, getSnsFavoriteColors } from "../../../../lib/sns-library-preferences";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, access = await requireSnsLibraryAccess(params.get("storeId"), params.get("surface"));
    return snsLibraryJson({ colors: await getSnsFavoriteColors(access) });
  } catch (error) { return snsLibraryFailure(error); }
}
export async function PATCH(request: Request) {
  try {
    assertSnsLibrarySameOrigin(request);
    const body = await readSnsLibraryBody(request), access = await requireSnsLibraryAccess(body.storeId, body.surface);
    return snsLibraryJson({ colors: await changeSnsFavoriteColor(access, body.action, body.color) });
  } catch (error) { return snsLibraryFailure(error); }
}
