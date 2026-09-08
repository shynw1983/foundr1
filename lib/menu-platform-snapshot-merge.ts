// Baselines describe physical merchant records, not just logical OS products.
// Using targetId as the primary key silently loses additional occurrences.
export function mergePlatformSnapshotEntries(oldEntries: unknown, changedEntries: unknown) {
  const merged = new Map<string, Record<string, unknown>>();
  for (const value of [
    ...(Array.isArray(oldEntries) ? oldEntries : []),
    ...(Array.isArray(changedEntries) ? changedEntries : [])
  ]) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    const externalId = String(entry.externalId ?? '').trim();
    const targetId = String(entry.targetId ?? '').trim();
    const key = externalId ? `external:${externalId}` : targetId ? `target:${targetId}` : '';
    if (key) merged.set(key, entry);
  }
  // Replace unidentified placeholders once an actual native record is read.
  for (const entry of merged.values()) {
    if (String(entry.externalId ?? '').trim() && String(entry.targetId ?? '').trim()) {
      merged.delete(`target:${String(entry.targetId).trim()}`);
    }
  }
  return [...merged.values()];
}
