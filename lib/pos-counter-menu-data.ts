import { createHash } from 'node:crypto';
import { sql } from './db';
import { normalizePosCounterMenuPolicy } from './pos-counter-menu-policy';

// Keep the revision projection in the existing menu check; no additional HTTP or DB round trip.
export const counterMenuStateSql = `jsonb_build_object(
  'counterMenuPolicy',coalesce(to_jsonb(p)->'counter_menu_policy','{}'::jsonb),
  'dineInEnabled',coalesce(p.dine_in_enabled,true),'takeoutEnabled',coalesce(p.takeout_enabled,true),
  'dineInTaxRate',coalesce(p.dine_in_tax_rate,10),'takeoutTaxRate',coalesce(p.takeout_tax_rate,8),
  'priceTaxMode',coalesce(nullif(p.price_tax_mode,''),'tax_included'))`;
const defaultState = { counterMenuPolicy: {} as unknown, dineInEnabled: true, takeoutEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, priceTaxMode: 'tax_included' };

export function readCounterMenuState(value?: Partial<typeof defaultState> | null) {
  return {
    counterMenuPolicy: value?.counterMenuPolicy ?? {},
    dineInEnabled: value?.dineInEnabled ?? true,
    takeoutEnabled: value?.takeoutEnabled ?? true,
    dineInTaxRate: Number(value?.dineInTaxRate ?? 10),
    takeoutTaxRate: Number(value?.takeoutTaxRate ?? 8),
    priceTaxMode: value?.priceTaxMode || 'tax_included'
  };
}

export function posCounterMenuPolicyRevision(value?: Partial<typeof defaultState> | null) {
  const state = readCounterMenuState(value);
  return createHash('sha256').update(JSON.stringify({ ...state, counterMenuPolicy: normalizePosCounterMenuPolicy(state.counterMenuPolicy) })).digest('hex');
}

/** Acquired under posMenuLock, the same lock used by policy and sales setting writes. */
export function posCounterMenuGuard(storeId: string, state: ReturnType<typeof readCounterMenuState>) {
  return sql.query(`select 1 / case when coalesce((select ${counterMenuStateSql} from pos_store_settings p where p.store_id::text=$1),$2::jsonb)=$3::jsonb
    then 1 else 0 end as pos_counter_menu_current`, [storeId, JSON.stringify(defaultState), JSON.stringify(state)]);
}
