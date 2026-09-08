export type InventoryPreviewRow = { label: string; isAvailable: boolean; wasAvailable: boolean | null };

export function groupInventoryPreview(rows: InventoryPreviewRow[]) {
  return {
    restoring: rows.filter(row => row.wasAvailable === false && row.isAvailable),
    stopping: rows.filter(row => row.wasAvailable === true && !row.isAvailable),
    unchanged: rows.filter(row => row.wasAvailable !== null && row.wasAvailable === row.isAvailable),
    unknown: rows.filter(row => row.wasAvailable === null)
  };
}

export function inventoryPreviewExpired(previewAt: string | undefined, now: number) {
  const timestamp = Date.parse(previewAt ?? '');
  return !Number.isFinite(timestamp) || now >= timestamp + 10 * 60 * 1000;
}
