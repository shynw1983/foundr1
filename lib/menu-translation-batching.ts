export function chunkMenuTranslationEntries<T extends { sourceText: string }>(
  entries: T[],
  maxEntries = 16,
  maxSourceCharacters = 3500
) {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentCharacters = 0;
  for (const entry of entries) {
    const entryCharacters = entry.sourceText.length;
    if (current.length && (current.length >= maxEntries || currentCharacters + entryCharacters > maxSourceCharacters)) {
      chunks.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(entry);
    currentCharacters += entryCharacters;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
