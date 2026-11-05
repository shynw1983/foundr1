import sharp from 'sharp';
export type ExpansionPlacement={x:number;y:number;width:number;height:number};
/** Only a narrow outer rim is editable. This is geometric protection, not subject segmentation. */
export function expansionBand(width:number,height:number){return Math.min(Math.floor(Math.min(width,height)/4),Math.max(8,Math.min(96,Math.round(Math.min(width,height)*.06))));}
export async function expansionLayers(source:Buffer,placement:ExpansionPlacement,width:number,height:number){
 const {data,info}=await sharp(source).resize(placement.width,placement.height,{fit:'fill'}).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const band=expansionBand(info.width,info.height),blend=Buffer.from(data),protection=Buffer.alloc(data.length);
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
  // A side touching the output boundary has no new background to join.
  const distance=Math.min(placement.x>0?x:Infinity,placement.y>0?y:Infinity,placement.x+placement.width<width?info.width-1-x:Infinity,placement.y+placement.height<height?info.height-1-y:Infinity);
  const t=band?Math.min(1,distance/band):1,weight=t*t*(3-2*t),a=data[(y*info.width+x)*4+3],i=(y*info.width+x)*4;
  blend[i+3]=Math.round(a*weight);protection[i+3]=distance>=band?a:0;
 }
 const raw={width:info.width,height:info.height,channels:4 as const};
 return{original:await sharp(data,{raw}).png().toBuffer(),blend:await sharp(blend,{raw}).png().toBuffer(),protection:await sharp(protection,{raw}).png().toBuffer(),band};
}
export async function prepareExpansion(source:Buffer,placement:ExpansionPlacement,width:number,height:number){
 const layers=await expansionLayers(source,placement,width,height);
 // Replicate edge colors as context. The editable region is regenerated, not exported as stretched pixels.
 const image=await sharp(layers.original).flatten({background:'#ffffff'}).extend({left:placement.x,top:placement.y,right:width-placement.x-placement.width,bottom:height-placement.y-placement.height,extendWith:'copy'}).png().toBuffer();
 const mask=await sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:layers.protection,left:placement.x,top:placement.y}]).png().toBuffer();
 return{image,mask,band:layers.band};
}
export async function compositeExpansion(generated:Buffer,source:Buffer,placement:ExpansionPlacement,width:number,height:number){
 const layers=await expansionLayers(source,placement,width,height);
 return sharp(generated).resize(width,height,{fit:'fill'}).composite([{input:layers.blend,left:placement.x,top:placement.y}]).png().toBuffer();
}
