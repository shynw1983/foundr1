// Offline deterministic extraction; the official source is supplied locally, never generated.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
const input = process.argv[2];
if (!input) throw Error('Usage: node scripts/extract-sns-logo.mjs /private/path/10418.png');
const metadata = await sharp(input).metadata();
if (metadata.width !== 1080 || metadata.height !== 1920) throw Error('Expected the official 1080x1920 template');
const { data, info } = await sharp(input).extract({ left:345, top:1658, width:390, height:130 }).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for (let y=0;y<130;y++) for (let x=0;x<390;x++) {
 const offset=(y*390+x)*4;
 // Preserve the complete seal interior, including white strokes. Remove white matte elsewhere.
 if ((x-64.5)**2+(y-64.5)**2 < 64.6**2) continue;
 const minimum=Math.min(data[offset],data[offset+1],data[offset+2]);
 if (minimum>=250) { data[offset+3]=0; continue; }
 // Unmatte pale antialias pixels using the original color, without redrawing any glyph.
 if (minimum>100) {
  const alpha=(255-minimum)/(255-20);
  for(let channel=0;channel<3;channel++) data[offset+channel]=Math.max(0,Math.round((data[offset+channel]-255*(1-alpha))/alpha));
  data[offset+3]=Math.round(255*alpha);
 }
}
await mkdir('assets/sns',{recursive:true});
await sharp(data,{raw:info}).png().toFile('assets/sns/maamaa-complete-logo.png');
console.log('Extracted complete official logo: 390x130');
