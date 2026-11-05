import { assertSnsLibrarySameOrigin, listSnsTemplates, presentSnsTemplate, requireSnsLibraryAccess, saveSnsTemplate } from "../../../../lib/sns-library";
import { readSnsLibraryBody, snsLibraryFailure, snsLibraryJson } from "../../../../lib/sns-library-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, access = await requireSnsLibraryAccess(params.get("storeId"), params.get("surface"));
    return snsLibraryJson({ ...await listSnsTemplates(access, params.get("cursor")), canCreate: true });
  } catch (error) { return snsLibraryFailure(error); }
}
export async function POST(request: Request) {
  try {
    assertSnsLibrarySameOrigin(request);
    const body = await readSnsLibraryBody(request), access = await requireSnsLibraryAccess(body.storeId, body.surface);
    const saved = await saveSnsTemplate(access, body, typeof body.id === "string" ? body.id : "", true);
    return snsLibraryJson({ template: presentSnsTemplate(access, saved, true) }, 201);
  } catch (error) { return snsLibraryFailure(error); }
}
