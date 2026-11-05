import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { assertSnsLibrarySameOrigin, requireSnsLibraryAccess, SnsLibraryError } from "../../../../../../lib/sns-library";
import { assertPendingSnsAsset, assertSnsBlobConfigured, getOwnedSnsAsset } from "../../../../../../lib/sns-library-assets";
import { readSnsLibraryBody, snsLibraryFailure, snsLibraryJson } from "../../../../../../lib/sns-library-http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSnsLibrarySameOrigin(request);
    const params = new URL(request.url).searchParams, access = await requireSnsLibraryAccess(params.get("storeId"), params.get("surface"));
    const asset = await getOwnedSnsAsset(access, (await context.params).id);
    assertPendingSnsAsset(asset); assertSnsBlobConfigured();
    const body = await readSnsLibraryBody(request);
    // No completion callback is configured: the signed uploader must explicitly
    // call /complete, which checks the real stored image before making it usable.
    const payload = body.payload;
    if (body.type !== "blob.generate-client-token" || !payload || typeof payload !== "object" || Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).pathname !== "string")
      throw new SnsLibraryError("アップロード操作を確認してください。", 400, "invalid_upload");
    const result = await handleUpload({ request, body: body as unknown as HandleUploadBody,
      onBeforeGenerateToken: async pathname => {
        if (pathname !== asset.pathname) throw new SnsLibraryError("アップロード先が一致しません。", 403, "upload_path");
        return { allowedContentTypes: [asset.mimeType], maximumSizeInBytes: asset.size,
          validUntil: Math.min(Date.parse(asset.expiresAt), Date.now() + 5 * 60000), addRandomSuffix: false, allowOverwrite: false };
      }
    });
    return snsLibraryJson(result);
  } catch (error) { return snsLibraryFailure(error); }
}
