/** Shared by the standalone client and server. Never accept a provider model or size verbatim. */
export const STUDIO_AI_PRESETS = {
  'photo-landscape': {width:1920,height:1080},
  'sns-story': { width: 1080, height: 1920 },
  'sns-square': { width: 1080, height: 1080 },
  'sns-portrait': { width: 1080, height: 1350 },
  'uber-item': { width: 2880, height: 2304 },
  'uber-item-wide': { width: 2880, height: 1920 },
  'uber-hero': { width: 2880, height: 2304 },
} as const;
export type AiPresetId = keyof typeof STUDIO_AI_PRESETS;
export type AiMode = 'precise' | 'fast';
export const STUDIO_AI_MODELS = { precise: 'gpt-image-2.5-sunburst', fast: 'gpt-image-2.5-flare' } as const;
/** Explicit qualities make comparison repeatable; do not silently fall back to auto. */
export const STUDIO_AI_QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AiQuality = typeof STUDIO_AI_QUALITIES[number];
export const STUDIO_AI_DEFAULT_QUALITY: AiQuality = 'high';
export function validAiQuality(value: unknown): value is AiQuality {
  return typeof value === 'string' && STUDIO_AI_QUALITIES.includes(value as AiQuality);
}
export function aiLongEdge(presetId: AiPresetId, kind: 'photo' | 'logo', logoEdge = 1536) {
  const preset = STUDIO_AI_PRESETS[presetId];
  if (!preset) throw new Error('ai_invalid_input');
  return kind === 'logo' ? Math.min(3840, Math.max(1536, Math.ceil(logoEdge))) : Math.max(preset.width, preset.height);
}
export function aiInputDimensions(width: number, height: number, edge: number) {
  if (![width,height,edge].every(v => Number.isFinite(v) && v > 0)) throw new Error('ai_invalid_input');
  const scale = Math.min(1, edge / Math.max(width,height));
  return { width: Math.max(1,Math.round(width*scale)), height: Math.max(1,Math.round(height*scale)) };
}
/** API canvas constraints; padding preserves the input instead of stretching/cropping it. */
export function aiOutputDimensions(width: number, height: number) {
  let w = Math.max(width, height/3), h = Math.max(height, width/3);
  const scale = Math.max(1, Math.sqrt(655360/(w*h)));
  w *= scale; h *= scale;
  const cap = Math.min(1,3840/Math.max(w,h),Math.sqrt(8294400/(w*h)));
  w = Math.ceil(w*cap/16)*16; h = Math.ceil(h*cap/16)*16;
  while (w*h>8294400 || Math.max(w,h)>3840) { if(w>=h) w-=16; else h-=16; }
  return {width:w,height:h,size:`${w}x${h}`};
}

export type ExpansionSettings={scale:number;x:number;y:number};
export function validExpansion(value:unknown,maxScale=.95):value is ExpansionSettings {
 if(!value||typeof value!=='object')return false;const v=value as ExpansionSettings;
 return [v.scale,v.x,v.y].every(n=>typeof n==='number'&&Number.isFinite(n))&&v.scale>=.4&&v.scale<=maxScale&&v.x>=0&&v.x<=1&&v.y>=0&&v.y<=1;
}
/** Whole source stays inside the new canvas. Position is a fraction of available free space. */
export function expansionPlacement(sw:number,sh:number,tw:number,th:number,settings:ExpansionSettings){
 if(![sw,sh,tw,th].every(v=>Number.isFinite(v)&&v>0)||!validExpansion(settings,1))throw new Error('ai_invalid_input');
 const factor=Math.min(tw/sw,th/sh)*settings.scale,width=Math.max(1,Math.min(tw,Math.round(sw*factor))),height=Math.max(1,Math.min(th,Math.round(sh*factor)));
 return{x:Math.round((tw-width)*settings.x),y:Math.round((th-height)*settings.y),width,height};
}

export type ExpansionMode='general'|'product';
export function validExpansionV4(value:unknown):value is ExpansionSettings{return validExpansion(value,1);}
