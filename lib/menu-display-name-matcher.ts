export type MenuDisplayNameCandidate = {
  id: string;
  name: string;
  displayNames?: Record<string, unknown> | null;
  externalId?: string;
  optionKey?: string;
};

export function normalizeMenuDisplayName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function matchScore(source: string, candidate: string) {
  if (!source || !candidate) return 0;
  if (source === candidate) return 10_000 + candidate.length;
  if (candidate.length >= 4 && source.endsWith(candidate)) return 8_000 + candidate.length;
  if (source.length >= 4 && candidate.endsWith(source)) return 7_000 + source.length;
  if (candidate.length >= 5 && source.includes(candidate)) return 6_000 + candidate.length;
  if (source.length >= 5 && candidate.includes(source)) return 5_000 + source.length;
  return 0;
}

export function findMenuDisplayNameCandidate<T extends MenuDisplayNameCandidate>(
  value: unknown,
  candidates: T[]
) {
  const source = normalizeMenuDisplayName(value);
  let best: { candidate: T; score: number } | null = null;
  for (const candidate of candidates) {
    const aliases = [
      candidate.name,
      ...Object.values(candidate.displayNames && typeof candidate.displayNames === "object"
        ? candidate.displayNames
        : {})
    ];
    const score = Math.max(...aliases.map((alias) => (
      matchScore(source, normalizeMenuDisplayName(alias))
    )));
    if (!score) continue;
    if (!best || score > best.score) best = { candidate, score };
  }
  return best?.candidate ?? null;
}

export function existingMenuDisplayName(
  sourceName: unknown,
  candidate: MenuDisplayNameCandidate | null | undefined,
  language: string
) {
  const localized = candidate?.displayNames && typeof candidate.displayNames === "object"
    ? String(candidate.displayNames[language] ?? "").trim()
    : "";
  return localized || String(sourceName ?? "").trim();
}
