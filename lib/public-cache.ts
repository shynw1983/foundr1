export function publicMenuCacheHeaders(hasStoreScope: boolean) {
  const edgeCache = hasStoreScope
    ? "s-maxage=15, stale-while-revalidate=60"
    : "s-maxage=300, stale-while-revalidate=3600";

  return {
    "Cache-Control": edgeCache,
    "CDN-Cache-Control": edgeCache,
    "Vercel-CDN-Cache-Control": edgeCache
  };
}
