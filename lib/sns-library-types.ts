import type { SnsLibraryDocument } from "./sns-library-document";
export type { SnsLibraryDocument, SnsLibraryTextLayer } from "./sns-library-document";
export type SnsLibraryTemplateSummary = {
  id: string; name: string; revision: string; createdBy: string; createdAt: string; updatedAt: string;
  photoAssetId: string; previewAssetId: string | null; photoUrl: string; previewUrl: string | null; canEdit: boolean;
};
export type SnsLibraryTemplate = SnsLibraryTemplateSummary & { document: SnsLibraryDocument };
export type SnsLibraryAllocatedAsset = {
  id: string; kind: "photo" | "preview"; pathname: string; mimeType: "image/png" | "image/jpeg";
  size: number; maxSizeBytes: number; uploadUrl: string; completeUrl: string; url: string;
};
export type SnsLibraryAsset = {
  id: string; kind: "photo" | "preview"; mimeType: "image/png" | "image/jpeg"; size: number;
  width: number; height: number; url: string;
};
