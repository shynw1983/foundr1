export type IdentifiableProduct = { id?: string; name: string };
export type ProductIdentityLookup<T extends IdentifiableProduct> = {
  byId: Map<string, T>;
  byName: Map<string, T>;
};

/** A stored SKU ID never falls back to a different SKU with the same name. */
export function findProductByIdentity<T extends IdentifiableProduct>(
  productId: string | undefined,
  productName: string,
  products: T[]
): T | undefined {
  if (productId) return products.find((product) => product.id === productId);
  const matches = products.filter((product) => product.name === productName);
  return matches.length === 1 ? matches[0] : undefined;
}

export function createProductIdentityLookup<T extends IdentifiableProduct>(products: T[]): ProductIdentityLookup<T> {
  const byId = new Map<string, T>();
  const byName = new Map<string, T>();
  const duplicateNames = new Set<string>();
  for (const product of products) {
    if (product.id) byId.set(product.id, product);
    if (byName.has(product.name)) duplicateNames.add(product.name);
    else byName.set(product.name, product);
  }
  for (const name of duplicateNames) byName.delete(name);
  return { byId, byName };
}

export function findProductByIdentityFromLookup<T extends IdentifiableProduct>(
  productId: string | undefined,
  productName: string,
  lookup: ProductIdentityLookup<T>
) {
  return productId ? lookup.byId.get(productId) : lookup.byName.get(productName);
}

export function productIdentityKey(productId: string | undefined, productName: string) {
  return productId ? `id:${productId}` : `name:${productName}`;
}
