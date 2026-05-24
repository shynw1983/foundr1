import sharp from "sharp";

const productPhotoSize = 720;

export async function normalizeProductPhoto(input: Buffer) {
  return sharp(input, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .trim({ background: "#ffffff", threshold: 18 })
    .resize(productPhotoSize, productPhotoSize, {
      fit: "contain",
      background: "#ffffff",
      withoutEnlargement: false
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}
