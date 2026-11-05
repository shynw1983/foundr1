import { sql } from "./db";

export type StoreDisplayBrand = {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
};

/** Known logo identities, not sampled pixels or the Store operation theme. */
export function resolveStoreDisplayBrand(brandNames: readonly unknown[]): StoreDisplayBrand | null {
  // Do not select the first recognized logo when a store has several brands.
  if (brandNames.length !== 1 || typeof brandNames[0] !== "string") return null;
  const name = brandNames[0].trim();
  const identity = name.toLowerCase();
  if (identity === "まぁ麻" || identity === "maamaa") {
    return { name, logoUrl: "/brands/maamaa-slogan-landscape.png", primaryColor: "#c30d23" };
  }
  if (identity === "nanacha") {
    return { name, logoUrl: "/brands/nanacha-logo.png", primaryColor: "#231916" };
  }
  return null;
}

/** Callers must authorize the store before reading its display identity. */
export async function getStoreDisplayBrand(storeId: string): Promise<StoreDisplayBrand | null> {
  if (!storeId.trim()) return null;
  // Match the existing courier display's active-brand boundary. Reading two
  // rows is enough to reject ambiguity without loading an entire brand list.
  const rows = await sql`
    select brands.name
    from store_brands
    join brands on brands.id = store_brands.brand_id
    where store_brands.store_id::text = ${storeId.trim()}
      and brands.status = 'active'
    order by brands.name
    limit 2
  `;
  return resolveStoreDisplayBrand(rows.map(row => row.name));
}
