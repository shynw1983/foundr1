import { getSessionStoreScope, requireOsSession } from "./api-auth";
import { sql } from "./db";
import { roleHasPermission } from "./role-permissions";
export async function getSnsAccess() {
    const session = await requireOsSession();
    if (!session)
        return null;
    const scope = await getSessionStoreScope(session);
    // Exact approved brand names: do not match unrelated malatang brands by category.
    const stores = await sql `
    select distinct stores.id::text, stores.name
    from stores join store_brands on store_brands.store_id = stores.id
    join brands on brands.id = store_brands.brand_id
    where stores.status = 'active' and brands.status = 'active'
      and brands.name in ('まぁ麻', 'maamaa')
      and (${scope.allStores} or stores.id::text = any(${scope.storeIds}))
    order by stores.name
  `;
    return { stores: stores as Array<{
            id: string;
            name: string;
        }>, canManage: await roleHasPermission(session.role, "module.procedures") };
}
