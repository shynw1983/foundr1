import { assertSnsLibrarySameOrigin, getSnsTemplate, presentSnsTemplate, requireSnsLibraryAccess, saveSnsTemplate } from "../../../../../lib/sns-library";
import { readSnsLibraryBody, snsLibraryFailure, snsLibraryJson } from "../../../../../lib/sns-library-http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const params = new URL(request.url).searchParams, access = await requireSnsLibraryAccess(params.get("storeId"), params.get("surface"));
    return snsLibraryJson({ template: presentSnsTemplate(access, await getSnsTemplate(access, (await context.params).id), true) });
  } catch (error) { return snsLibraryFailure(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    assertSnsLibrarySameOrigin(request);
    const body = await readSnsLibraryBody(request), access = await requireSnsLibraryAccess(body.storeId, body.surface);
    return snsLibraryJson({ template: presentSnsTemplate(access, await saveSnsTemplate(access, body, (await context.params).id, false), true) });
  } catch (error) { return snsLibraryFailure(error); }
}
