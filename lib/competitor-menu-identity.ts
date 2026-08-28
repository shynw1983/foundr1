export function canonicalCompetitorProductIdentity(externalKey: string) {
  const key = String(externalKey ?? "").replace(/\s+/g, " ").trim();
  return key.startsWith("id:") ? key.slice(3) : key;
}
