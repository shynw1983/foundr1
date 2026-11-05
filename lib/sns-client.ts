import { upload } from '@vercel/blob/client';
import type { SnsLibraryDocument } from './sns-library-document';
import type { SnsLibraryTemplateSummary } from './sns-library-types';
export type SnsDocument = SnsLibraryDocument;
export type SnsTemplate = SnsLibraryTemplateSummary & { document?: SnsDocument };
export class SnsRequestError extends Error { constructor(public status: number, public code: string) { super(code); } }
export async function snsRequest<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, cache: 'no-store', headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
    let data; try { data = await response.json(); } catch { throw new SnsRequestError(response.status, 'request_failed'); }
    if (!response.ok) throw new SnsRequestError(response.status, typeof data.code === 'string' ? data.code : 'request_failed');
    return data as T;
}
export function snsQuery(storeId: string, surface: 'store' | 'os') { return new URLSearchParams({ storeId, surface }).toString(); }
export async function uploadSnsAsset(blob: Blob, kind: 'photo' | 'preview', storeId: string, surface: 'store' | 'os') {
    const { asset } = await snsRequest<{ asset: { id: string; pathname: string; uploadUrl: string; completeUrl: string; url: string } }>('/api/sns/assets', { method: 'POST', body: JSON.stringify({ storeId, surface, kind, mimeType: blob.type, size: blob.size }) });
    await upload(asset.pathname, blob, { access: 'private', handleUploadUrl: asset.uploadUrl });
    const complete = await snsRequest<{ asset: { id: string; url: string; width: number; height: number } }>(asset.completeUrl, { method: 'POST', body: JSON.stringify({ storeId, surface }) });
    return complete.asset;
}
export function snsCanvasBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = .94): Promise<Blob> {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('encode_failed')), type, quality));
}
