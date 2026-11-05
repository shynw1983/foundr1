import { resolveDineInItemFulfillmentMode } from './store-dine-in-menu-policy';
import type { StoreDineInMenus } from './store-dine-in-menu';
import type { PosItemFulfillmentMode } from './pos-item-fulfillment';

/** Physical POS takeout uses brand items. Apply this store's explicit service
 * policy by canonical identity too, without changing a shared/public catalog.
 * Conflicting independent variants conservatively keep preparation. */
export function dineInSourceFulfillmentModes(state: StoreDineInMenus): Map<string, PosItemFulfillmentMode> {
  const values = new Map<string, PosItemFulfillmentMode[]>();
  for (const menu of state.menus.filter(menu => menu.enabled)) for (const item of menu.catalog.items) {
    const key = item.sourceItemId;
    if (!key) continue;
    const modes = values.get(key) ?? [];
    modes.push(resolveDineInItemFulfillmentMode(menu.catalog, item));
    values.set(key, modes);
  }
  return new Map([...values].map(([id, modes]) => [id, modes.every(mode => mode === 'immediate') ? 'immediate' : 'prepare']));
}
