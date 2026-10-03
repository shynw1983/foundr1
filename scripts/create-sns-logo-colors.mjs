// Deterministic color variants from the already-extracted official logo, never redraw glyphs.
import sharp from 'sharp';
import fs from 'node:fs/promises';
const source = await fs.readFile('assets/sns/maamaa-complete-logo.png');
const {data, info} = await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
if(info.width!==390||info.height!==130||info.channels!==4) throw Error('Unexpected official logo dimensions');
// Verified original-pixel bounds: red seal ends at x130, right-side lettering begins at x151.
for(const color of ['black','white']) {
 const pixels=Buffer.from(data), value=color==='white'?255:0;
 for(let y=0;y<info.height;y++)for(let x=151;x<info.width;x++) {
  const p=(y*info.width+x)*4;
  if(pixels[p+3]>0) pixels[p]=pixels[p+1]=pixels[p+2]=value;
 }
 await sharp(pixels,{raw:info}).png().toFile(`assets/sns/maamaa-complete-logo-${color}.png`);
}
console.log('Created black/white lettering; original seal and every alpha byte retained');
