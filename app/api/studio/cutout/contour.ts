import sharp from 'sharp';
import {expansionLayers,type ExpansionPlacement} from './expansion.ts';
/** V4 masks are normalized 512-square alpha maps, independent of upload aspect rounding. */
export async function decodeProtection(value:unknown):Promise<Buffer>{
 if(typeof value!=='string'||value.length>400000||!value.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error('ai_invalid_protection');
 const bytes=Buffer.from(value,'base64');if(bytes.length>300000)throw new Error('ai_invalid_protection');
 const meta=await sharp(bytes,{limitInputPixels:262144}).metadata();
 if(meta.format!=='png'||meta.width!==512||meta.height!==512||!meta.hasAlpha||(meta.pages||1)!==1)throw new Error('ai_invalid_protection');
 const {data,info}=await sharp(bytes).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});let selected=0,opaque=0;
 for(let i=3;i<data.length;i+=info.channels){if(data[i]>0)selected++;if(data[i]===255)opaque++;}
 if(opaque<16||selected>512*512*.98)throw new Error('ai_invalid_protection');
 return bytes;
}
async function contourLayers(source:Buffer,protection:Buffer,p:ExpansionPlacement){
 const {data:sourceData,info}=await sharp(source).resize(p.width,p.height,{fit:'fill'}).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const alpha=await sharp(protection).extractChannel('alpha').resize(p.width,p.height,{fit:'fill',kernel:'nearest'}).raw().toBuffer();
 // Expand a bounded soft join OUTSIDE the selected contour; never erode opaque protected pixels.
 let boundary=0,plainLight=0,sum=0,square=0,selectedEdge=false;
 const sample=(x:number,y:number)=>{const n=y*p.width+x,i=n*4,r=sourceData[i],g=sourceData[i+1],b=sourceData[i+2],v=(r+g+b)/3;boundary++;sum+=v;square+=v*v;if(alpha[n])selectedEdge=true;if(sourceData[i+3]===255&&Math.min(r,g,b)>210&&Math.max(r,g,b)-Math.min(r,g,b)<20)plainLight++;};
 for(let x=0;x<p.width;x++){sample(x,0);sample(x,p.height-1);}for(let y=1;y<p.height-1;y++){sample(0,y);sample(p.width-1,y);}
 // A wider color join is used only on a nearly uniform light source perimeter.
 // Structured/dark materials keep a narrow join, avoiding broad texture mixing.
 const lightBackdrop=!selectedEdge&&boundary>32&&plainLight/boundary>.85&&Math.sqrt(Math.max(0,square/boundary-(sum/boundary)**2))<12;
 const join=lightBackdrop?Math.max(6,Math.min(24,Math.round(Math.min(p.width,p.height)/64))):Math.max(2,Math.min(4,Math.round(Math.min(p.width,p.height)/512)));
 // Sharp morphology treats black as foreground: erode(radius) expands white alpha.
 const rim=await sharp(alpha,{raw:{width:p.width,height:p.height,channels:1}}).erode(join).blur(join/2).greyscale().raw().toBuffer();
 const restore=Buffer.from(sourceData),mask=Buffer.alloc(sourceData.length);
 for(let n=0;n<alpha.length;n++){const a=sourceData[n*4+3];restore[n*4+3]=Math.round(a*Math.max(alpha[n],rim[n])/255);mask[n*4+3]=alpha[n]>0?a:0;}
 const raw={width:info.width,height:info.height,channels:4 as const};
 return{original:await sharp(sourceData,{raw}).png().toBuffer(),restore:await sharp(restore,{raw}).png().toBuffer(),mask:await sharp(mask,{raw}).png().toBuffer()};
}
export async function prepareContourExpansion(source:Buffer,protection:Buffer|null,p:ExpansionPlacement,width:number,height:number){
 const layers=protection?await contourLayers(source,protection,p):await expansionLayers(source,p,width,height);
 const image=await sharp(layers.original).flatten({background:'#ffffff'}).extend({left:p.x,top:p.y,right:width-p.x-p.width,bottom:height-p.y-p.height,extendWith:'copy'}).png().toBuffer();
 const part='mask' in layers?layers.mask:layers.protection;
 const mask=await sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:part,left:p.x,top:p.y}]).png().toBuffer();
 return{image,mask};
}
export async function compositeContourExpansion(output:Buffer,source:Buffer,protection:Buffer|null,p:ExpansionPlacement,width:number,height:number){
 const canvas=sharp(output).resize(width,height,{fit:'fill'});
 // General photography keeps the model's continuous scene, with no rectangular source pasted back.
 if(!protection)return canvas.png().toBuffer();
 const layers=await contourLayers(source,protection,p);
 return canvas.composite([{input:layers.restore,left:p.x,top:p.y}]).png().toBuffer();
}
