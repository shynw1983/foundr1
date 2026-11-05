import sharp from 'sharp';
import { createHash, timingSafeEqual } from 'node:crypto';
import { STUDIO_AI_PRESETS, STUDIO_AI_MODELS, validAiQuality, aiLongEdge, type AiPresetId, type AiMode } from '../../../../lib/studio-ai-policy.ts';
import { STUDIO_ERASE_MAX_BODY, STUDIO_ERASE_MAX_IMAGE_BYTES, STUDIO_ERASE_REVISION } from '../../../../lib/studio-erase-policy.ts';
import { decodeEraseMask, prepareEraseImage, compositeEraseImage } from './image.ts';
export const MAX_BODY = STUDIO_ERASE_MAX_BODY;
const reply = (error: string, status: number) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
const allowed = new Set(['version', 'kind', 'image', 'mime', 'presetId', 'mode', 'quality', 'inputEdge', 'mask']);

export async function handleErase(request: Request, env: Record<string, string | undefined> = process.env, send: typeof fetch = fetch) {
  const token = env.STUDIO_AI_ACCESS_TOKEN;
  if (!token || token.length < 32 || !env.OPENAI_API_KEY) return reply('ai_not_configured', 503);
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '', digest = (value: string) => createHash('sha256').update(value).digest();
  if (supplied.length > 256 || !timingSafeEqual(digest(supplied), digest(token))) return reply('ai_unauthorized', 401);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply('ai_invalid_input', 415);
  if (Number(request.headers.get('content-length')) > MAX_BODY) return reply('ai_input_large', 413);
  const reader = request.body?.getReader(); if (!reader) return reply('ai_invalid_input', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BODY) { await reader.cancel(); return reply('ai_input_large', 413); } chunks.push(value); } } catch { return reply('ai_invalid_input', 400); }
  let input: Record<string, unknown>;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply('ai_invalid_input', 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.has(key)) || input.version !== 1 || input.kind !== 'photo'
      || typeof input.presetId !== 'string' || !Object.hasOwn(STUDIO_AI_PRESETS, input.presetId) || (input.mode !== 'precise' && input.mode !== 'fast') || !validAiQuality(input.quality)
      || (input.mime !== 'image/png' && input.mime !== 'image/webp') || typeof input.image !== 'string' || input.image.length > 3_333_336 || input.image.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.image)) return reply('ai_invalid_input', 400);
  const bytes = Buffer.from(input.image, 'base64');
  if (bytes.length < 24 || bytes.length > STUDIO_ERASE_MAX_IMAGE_BYTES || bytes.toString('base64') !== input.image) return reply('ai_invalid_input', 400);
  let selected: Buffer;
  try { selected = await decodeEraseMask(input.mask); } catch { return reply('ai_invalid_mask', 400); }
  let prepared: Awaited<ReturnType<typeof prepareEraseImage>>;
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 8_294_400 }).metadata();
    if (!metadata.width || !metadata.height || (metadata.pages || 1) !== 1 || metadata.format !== (input.mime === 'image/png' ? 'png' : 'webp')) return reply('ai_invalid_input', 400);
    let edge = aiLongEdge(input.presetId as AiPresetId, 'photo');
    if (input.inputEdge !== undefined) {
      if (typeof input.inputEdge !== 'number' || ![1920, 1536, 1280, 1024, 768].includes(input.inputEdge) || input.inputEdge >= edge) return reply('ai_invalid_input', 400);
      edge = input.inputEdge;
    }
    if (Math.max(metadata.width, metadata.height) > edge) return reply('ai_invalid_input', 400);
    prepared = await prepareEraseImage(bytes, selected, metadata.width, metadata.height);
    if (prepared.image.length > 8_000_000 || prepared.mask.length >= 4_000_000) return reply('ai_input_large', 413);
  } catch (error) { return reply(error instanceof Error && error.message === 'ai_invalid_mask' ? 'ai_invalid_mask' : 'ai_invalid_input', 400); }
  const form = new FormData();
  form.set('model', STUDIO_AI_MODELS[input.mode as AiMode]); form.set('quality', input.quality); form.set('size', prepared.provider.size); form.set('n', '1'); form.set('background', 'opaque'); form.set('output_format', 'png');
  form.set('image', new Blob([new Uint8Array(prepared.image)], { type: 'image/png' }), 'source.png');
  form.set('mask', new Blob([new Uint8Array(prepared.mask)], { type: 'image/png' }), 'erase-mask.png');
  form.set('prompt', 'Remove the marked unwanted object and its selected shadow. Reconstruct the obscured background from the immediately surrounding visible surface. Match its existing lighting, color, texture and perspective. Keep all other objects, text and composition unchanged. Do not introduce new objects or materials.');
  try {
    const response = await send('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form, signal: AbortSignal.timeout(170_000), redirect: 'error' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { code?: string } };
      return reply(response.status === 429 ? error.error?.code === 'insufficient_quota' ? 'ai_quota' : 'ai_rate_limit' : response.status === 401 ? 'ai_provider_key' : response.status === 403 || response.status === 404 ? 'ai_model_unavailable' : 'ai_failed', 502);
    }
    const result = await response.json() as { data?: { b64_json?: unknown }[] }, data = result.data?.[0]?.b64_json;
    if (typeof data !== 'string' || !data.length || data.length > 48_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return reply('ai_failed', 502);
    const generated = Buffer.from(data, 'base64');
    if (generated.length < 24 || !generated.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return reply('ai_failed', 502);
    let output: Buffer;
    try { output = Buffer.from(await compositeEraseImage(bytes, generated, prepared)); } catch { return reply('ai_failed', 502); }
    let mime = 'image/png';
    // Lossless WebP may discard hidden RGB at alpha=0. Transparent results stay PNG
    // so the promise of exact RGBA outside the selection also holds after transport.
    if (output.length > 4_200_000 && (await sharp(output).stats()).isOpaque) { output = Buffer.from(await sharp(output, { limitInputPixels: 8_294_400 }).webp({ lossless: true, effort: 4 }).toBuffer()); mime = 'image/webp'; }
    if (output.length > 7_800_000) return reply('ai_output_large', 502);
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { if (offset >= output.length) { controller.close(); return; } const end = Math.min(offset + 65536, output.length); controller.enqueue(new Uint8Array(output.subarray(offset, end))); offset = end; } });
    return new Response(body, { headers: { 'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Studio-Erase-Revision': STUDIO_ERASE_REVISION, 'X-Studio-Erase-Pipeline': 'context-v3', 'X-Studio-AI-Quality': input.quality } });
  } catch { return reply('ai_timeout', 504); }
}
