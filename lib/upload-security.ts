const allowedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"]
]);

export function getSafeImageExtension(file: File) {
  return allowedImageTypes.get(file.type.toLowerCase()) ?? null;
}

export function validateImageUpload(file: File, maxSizeBytes: number, label: string) {
  const extension = getSafeImageExtension(file);
  if (!extension) {
    throw new Error(`${label}はjpg/png/webp/heic形式を選択してください。`);
  }

  if (file.size > maxSizeBytes) {
    throw new Error(`${label}は${Math.floor(maxSizeBytes / 1024 / 1024)}MB以下にしてください。`);
  }

  return extension;
}
