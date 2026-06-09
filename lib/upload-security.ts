const allowedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"]
]);

const allowedPdfTypes = new Map([
  ["application/pdf", "pdf"]
]);

export function getSafeImageExtension(file: File) {
  return allowedImageTypes.get(file.type.toLowerCase()) ?? null;
}

export function getSafeReceiptExtension(file: File) {
  const type = file.type.toLowerCase();
  if (allowedPdfTypes.has(type) || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return getSafeImageExtension(file);
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

export function validateReceiptUpload(file: File, maxImageSizeBytes: number, maxPdfSizeBytes: number, label: string) {
  const extension = getSafeReceiptExtension(file);
  if (!extension) {
    throw new Error(`${label}はjpg/png/webp/heic/pdf形式を選択してください。`);
  }

  const maxSizeBytes = extension === "pdf" ? maxPdfSizeBytes : maxImageSizeBytes;
  if (file.size > maxSizeBytes) {
    throw new Error(`${label}は${Math.floor(maxSizeBytes / 1024 / 1024)}MB以下にしてください。`);
  }

  return extension;
}
