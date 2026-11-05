import sharp from 'sharp';
import {decodeProtection,prepareContourExpansion,compositeContourExpansion} from './contour.ts';
import {STUDIO_AI_PRESETS, STUDIO_AI_MODELS, STUDIO_AI_DEFAULT_QUALITY, validAiQuality, aiLongEdge, aiOutputDimensions, expansionPlacement, validExpansion, validExpansionV4, type ExpansionSettings, type AiPresetId, type AiMode} from '../../../../lib/studio-ai-policy.ts';
import { createHash, timingSafeEqual } from 'node:crypto';
export const MAX_BODY = 3_900_000;
const reply = (error: string, status: number) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
export async function handleCutout(request: Request, env: Record<string, string | undefined> = process.env, send: typeof fetch = fetch) {
  const token = env.STUDIO_AI_ACCESS_TOKEN;
  if (!token || token.length < 32 || !env.OPENAI_API_KEY) return reply('ai_not_configured', 503);
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const digest = (s: string) => createHash('sha256').update(s).digest();
  if (supplied.length > 256 || !timingSafeEqual(digest(supplied), digest(token))) return reply('ai_unauthorized', 401);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply('ai_invalid_input', 415);
  if (Number(request.headers.get('content-length')) > MAX_BODY) return reply('ai_input_large', 413);
  const reader = request.body?.getReader(); if (!reader) return reply('ai_invalid_input', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BODY) { await reader.cancel(); return reply('ai_input_large', 413); } chunks.push(value); } } catch { return reply('ai_invalid_input', 400); }
  let input: { image?: unknown; kind?: unknown; version?: unknown; presetId?: unknown; mode?: unknown; quality?: unknown; mime?: unknown; logoEdge?: unknown; inputEdge?:unknown; operation?:unknown; expansion?:unknown; expansionMode?:unknown; protection?:unknown };
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply('ai_invalid_input', 400); }
  if (!input || !['photo', 'logo'].includes(String(input.kind)) || typeof input.image !== 'string' || input.image.length > 3_740_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.image)) return reply('ai_invalid_input', 400);
  if (input.quality !== undefined && !validAiQuality(input.quality)) return reply('ai_invalid_input', 400);
  const quality = input.quality === undefined ? STUDIO_AI_DEFAULT_QUALITY : input.quality;
  const bytes = Buffer.from(input.image, 'base64');
  if (bytes.length < 24 || bytes.length > 2_800_000) return reply('ai_invalid_input',400);
  const advanced=input.version===4;
  const expanding=input.version===3||advanced;
  const modern = input.version === 2 || expanding;
  if(expanding&&(input.kind!=='photo'||input.operation!=='expand'||!(advanced?validExpansionV4(input.expansion):validExpansion(input.expansion))))return reply('ai_invalid_input',400);
  if(!advanced&&(input.expansionMode!==undefined||input.protection!==undefined))return reply('ai_invalid_input',400);
  if(advanced&&(!['general','product'].includes(String(input.expansionMode))||input.expansionMode==='product'&&typeof input.protection!=='string'||input.expansionMode==='general'&&input.protection!==undefined||bytes.length>2_500_000))return reply('ai_invalid_input',400);
  let protection:Buffer|null=null;
  if(advanced&&input.expansionMode==='product'){try{protection=await decodeProtection(input.protection);}catch{return reply('ai_invalid_protection',400);}}
  if(!expanding&&(input.operation!==undefined||input.expansion!==undefined))return reply('ai_invalid_input',400);
  if (input.version !== undefined && !modern) return reply('ai_invalid_input',400);
  let outputSize = 'auto', mime = 'image/png';
  let editBytes:Buffer=bytes, mask:Buffer|undefined;
  let expansionTarget:{width:number;height:number;placement:{x:number;y:number;width:number;height:number};source:Buffer}|undefined;
  let model = env.STUDIO_AI_IMAGE_MODEL || STUDIO_AI_MODELS.precise;
  if (modern) {
    if (typeof input.presetId !== 'string' || !Object.hasOwn(STUDIO_AI_PRESETS,input.presetId) || !['precise','fast'].includes(String(input.mode)) ||
        !['image/png','image/webp'].includes(String(input.mime)) || input.logoEdge !== undefined && (typeof input.logoEdge !== 'number' || !Number.isFinite(input.logoEdge) || input.logoEdge<1536 || input.logoEdge>3840)) return reply('ai_invalid_input',400);
    model=STUDIO_AI_MODELS[input.mode as AiMode]; mime=String(input.mime);
  }
  if (!Object.values(STUDIO_AI_MODELS).includes(model as typeof STUDIO_AI_MODELS.precise)) return reply('ai_not_configured',503);
  try {
    const metadata=await sharp(bytes,{limitInputPixels:14_745_600}).metadata();
    if (!metadata.width || !metadata.height || (metadata.pages || 1)>1 || metadata.format !== (mime==='image/png'?'png':'webp')) return reply('ai_invalid_input',400);
    let edge=modern ? aiLongEdge(input.presetId as AiPresetId,input.kind as 'photo'|'logo',input.logoEdge as number|undefined) : 1536;
    if(modern && input.inputEdge!==undefined) {if(typeof input.inputEdge!=='number' || ![1920,1536,1280,1024,768].includes(input.inputEdge) || input.inputEdge>=edge)return reply('ai_invalid_input',400);edge=input.inputEdge;}
    if(Math.max(metadata.width,metadata.height)>edge || !modern && metadata.width*metadata.height>2_400_000) return reply('ai_invalid_input',400);
    if(modern) outputSize=aiOutputDimensions(metadata.width,metadata.height).size;
    if(expanding){
      const target=STUDIO_AI_PRESETS[input.presetId as AiPresetId],provider=aiOutputDimensions(target.width,target.height),settings=input.expansion as ExpansionSettings;
      const placement=expansionPlacement(metadata.width,metadata.height,provider.width,provider.height,settings);
      const finalPlacement=expansionPlacement(metadata.width,metadata.height,target.width,target.height,settings);
      if(advanced&&finalPlacement.width===target.width&&finalPlacement.height===target.height)return reply('ai_no_expansion',400);
      if(advanced){const prepared=await prepareContourExpansion(bytes,protection,placement,provider.width,provider.height);editBytes=prepared.image;mask=prepared.mask;}
      else{
       const original=await sharp(bytes).resize(placement.width,placement.height,{fit:'fill'}).png().toBuffer();
       editBytes=await sharp({create:{width:provider.width,height:provider.height,channels:4,background:'#ffffff'}}).composite([{input:original,left:placement.x,top:placement.y}]).png().toBuffer();
       mask=await sharp({create:{width:provider.width,height:provider.height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:original,left:placement.x,top:placement.y}]).png().toBuffer();
      }
      if(editBytes.length>8_000_000)return reply('ai_input_large',413);
      expansionTarget={width:target.width,height:target.height,placement:expansionPlacement(metadata.width,metadata.height,target.width,target.height,settings),source:bytes};
      outputSize=provider.size;mime='image/png';
    }
  } catch { return reply('ai_invalid_input',400); }
  const prompt = advanced ? `Create one continuous outpainted photograph by extending the existing scene. The repeated pixels outside the original image are provisional context; replace those stretched pixels with a coherent continuation. Match wood grain, tile spacing, straight table edges, perspective, material texture, light direction, reflections and contact shadows. Do not add a new table, props, food, text, decoration, frames or inset photographs. Do not change the camera angle or redesign the scene. ${protection?'The opaque masked region is the user-confirmed real product. Preserve the exact food, every ingredient, portion, shape, container, packaging print and logo in that region. Continue the original background naturally around it.':'Keep all original subjects and their proportions, position and appearance. Only extend the background and repair necessary background joins.'} No blurry bands, duplicated grain, broken straight lines or rectangular lighting panels.` : expanding ? 'Extend only the surrounding background of this photograph into the masked empty outer area. Continue the existing tabletop or backdrop with consistent perspective, light and natural shadows. The central rectangular photograph must remain unchanged. Do not add food, ingredients, servings, utensils, text, logos or decorative objects. Do not replace the container, change the angle, change portion size, or invent missing food. Fill the entire canvas with a natural continuous background.' : input.kind === 'logo'
    ? 'Remove only the background of this existing logo. Preserve every letter, fine stroke, original brand color, white foreground detail and intentional hole. Do not redesign, retype, stylize or add anything. Keep all separate parts of the logo. Output true alpha transparency with clean edges, no checkerboard and no shadow.'
    : 'Extract the entire food or product together with its bowl, cup or packaging onto a fully transparent background. Preserve the exact original food ingredients, quantity, shape, color, container rim and packaging text. Remove the surrounding table, scene and unrelated props. Do not add ingredients, restyle, relight or beautify the food. Preserve delicate edges and translucency where possible. No added shadow, background or checkerboard.';
  const form = new FormData();
  form.set('model', model);
  if(advanced&&protection){
    form.append('image[]',new Blob([new Uint8Array(editBytes)],{type:'image/png'}),'canvas.png');
    const referenceMime=input.mime==='image/webp'?'image/webp':'image/png';
    form.append('image[]',new Blob([new Uint8Array(bytes)],{type:referenceMime}),referenceMime==='image/png'?'original-reference.png':'original-reference.webp');
  }else form.set('image', new Blob([new Uint8Array(editBytes)], { type: mime }), mime==='image/png'?'input.png':'input.webp');
  if(mask)form.set('mask',new Blob([new Uint8Array(mask)],{type:'image/png'}),'mask.png');
  const productPrompt='Image 1 is the target canvas and exact product placement; its mask marks the protected product. Image 2 is the ORIGINAL PHOTOGRAPH and strict reference for the existing background, surface material, color, texture complexity and lighting. Extend ONLY that same original scene into the outer area of image 1. Never redesign the setting or substitute a different surface material. A plain light or white background MUST stay plain and light, without new texture, patterns, decorative surfaces or artificial reflections. Only continue patterns and structural lines that are actually visible in image 2. Keep the protected food, every ingredient, portion, container and printed label exactly as supplied, at the existing size and location. Match the original background colors immediately around the protected contour so it never looks like a pasted cutout, sticker or outlined object. Do not add objects, food, text, props, borders, a frame or change the camera angle. Return one continuous photograph with the original background and natural contact shadows.';
  form.set('prompt', (advanced&&protection?productPrompt:prompt) + (expanding ? '' : ' Preserve the entire input subject and its proportions. Use transparent padding if the output canvas differs from the input aspect ratio; never crop or stretch the subject.')); form.set('background', expanding?'opaque':'transparent'); form.set('output_format', 'png'); form.set('quality', quality); form.set('size', outputSize); form.set('n', '1');
  try {
    const response = await send('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form, signal: AbortSignal.timeout(170_000), redirect: 'error' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { code?: string } };
      return reply(response.status === 429 ? error.error?.code === 'insufficient_quota' ? 'ai_quota' : 'ai_rate_limit' : response.status === 401 ? 'ai_provider_key' : response.status === 403 || response.status === 404 ? 'ai_model_unavailable' : 'ai_failed', 502);
    }
    const result = await response.json() as { data?: { b64_json?: string }[] };
    const data = result.data?.[0]?.b64_json;
    if (!data || data.length > (advanced?48_000_000:40_000_000)) return reply('ai_output_large', 502);
    let output = Buffer.from(data, 'base64');
    if (output.length < 24 || !output.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return reply('ai_failed', 502);
    if(expansionTarget){
      const t=expansionTarget;const meta=await sharp(output,{limitInputPixels:8_294_400}).metadata();
      const expected=outputSize.split('x').map(Number);if(meta.width!==expected[0]||meta.height!==expected[1])return reply('ai_failed',502);
      if(advanced)output=Buffer.from(await compositeContourExpansion(output,t.source,protection,t.placement,t.width,t.height));
      else{const original=await sharp(t.source).resize(t.placement.width,t.placement.height,{fit:'fill'}).png().toBuffer();output=Buffer.from(await sharp(output).resize(t.width,t.height,{fit:'fill'}).composite([{input:original,left:t.placement.x,top:t.placement.y}]).png().toBuffer());}
    }
    let outputMime='image/png';
    if(!modern && output.length>3_975_000) return reply('ai_output_large',502);
    if(output.length>4_200_000) {
      // Lossless transport compression keeps every alpha and color value at full resolution.
      output=Buffer.from(await sharp(output,{limitInputPixels:8_294_400}).webp({lossless:true,effort:4}).toBuffer()); outputMime='image/webp';
    }
    if(output.length>(advanced?7_800_000:4_200_000)) return reply('ai_output_large',502);
    // V4 native transport accepts up to 8MB. Stream lossless bytes to avoid the
    // platform's buffered-response cap; never lower protected pixels or dimensions.
    let offset=0;
    const body=advanced?new ReadableStream<Uint8Array>({pull(controller){if(offset>=output.length){controller.close();return;}const end=Math.min(offset+65536,output.length);controller.enqueue(new Uint8Array(output.subarray(offset,end)));offset=end;}}):output;
    return new Response(body, { headers: { 'Content-Type': outputMime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Studio-AI-Quality': quality,...(expanding?{'X-Studio-Expansion-Revision':advanced?'contour-v4':'legacy-v3'}:{}) } });
  } catch { return reply('ai_timeout', 504); }
}
