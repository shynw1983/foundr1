import { sql } from './db';
import { normalizePosCounterMenuPolicy } from './pos-counter-menu-policy';
import { posMenuLock } from './pos-menu-settings';
import { dineInMenuGuard, readDineInMenus } from './store-dine-in-menu';

type CounterMenuPolicy = ReturnType<typeof normalizePosCounterMenuPolicy>;
type Brand = { brandId: string; brandName: string };
export type PosCounterMenuCategory = Brand & { id: string; name: string };
export type PosCounterMenuSettings = {
  ready: boolean;
  revision: string;
  menuRevision: string;
  policy: CounterMenuPolicy;
  categories: PosCounterMenuCategory[];
  hasEnabledMenu: boolean;
  priceTaxMode: string;
  dineInTaxRate: number;
  takeoutTaxRate: number;
};

const policySql = "coalesce(to_jsonb(p)->'counter_menu_policy', '{}'::jsonb)";
const priceModeSql = "coalesce(nullif(p.price_tax_mode, ''), 'tax_included')";
const brandsSql = `coalesce((select jsonb_agg(jsonb_build_object('brandId',b.id::text,'brandName',b.name) order by b.id)
  from store_brands sb join brands b on b.id=sb.brand_id and b.status='active' where sb.store_id=s.id),'[]'::jsonb)`;
const revisionSql = `md5(jsonb_build_array(${policySql},${priceModeSql},coalesce(p.dine_in_tax_rate,10),coalesce(p.takeout_tax_rate,8),
  coalesce(p.dine_in_enabled,true),coalesce(p.takeout_enabled,true),${brandsSql})::text)`;
const activeScopeSql = `from stores s left join pos_store_settings p on p.store_id=s.id where s.id::text=$1 and s.status='active'`;
const migrationRequired = 'この設定を保存するには、POS 設定の更新が必要です。';
const stale = '税率・販売設定または店内メニューが変更されました。再読み込みして確認してください。';
export const sharedMenuRequiresTaxIncluded = 'メニューを共用するには「税込価格」を保存してください。';
export const sharedMenuBlocksTaxExcluded = '店内・持ち帰りでメニューを共用しているため、税抜価格に変更できません。先に共用設定を解除してください。';

export class PosCounterMenuSettingsError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function getPosCounterMenuSettings(storeId: string): Promise<PosCounterMenuSettings | null> {
  const [settings, menu] = await Promise.all([
    sql.query(`select ${policySql} as policy, ${revisionSql} as revision,
      ${priceModeSql} as "priceTaxMode",coalesce(p.dine_in_tax_rate,10)::float as "dineInTaxRate",
      coalesce(p.takeout_tax_rate,8)::float as "takeoutTaxRate",${brandsSql} as brands,
      exists(select 1 from pg_attribute where attrelid='pos_store_settings'::regclass and attname='counter_menu_policy' and not attisdropped) as ready
      ${activeScopeSql}`, [storeId]),
    readDineInMenus(storeId)
  ]);
  const row = settings[0];
  if (!row) return null;
  const brands = new Map((row.brands as Brand[]).map(brand => [brand.brandId, brand]));
  const enabledMenus = menu.menus.filter(entry => entry.enabled && brands.has(entry.brandId));
  const categories = enabledMenus.flatMap(entry => entry.catalog.categories
    .filter(category => category.brandId === entry.brandId)
    .map(category => ({ id: category.id, name: category.name, ...brands.get(entry.brandId)! })));
  return {
    ready: row.ready === true,
    revision: String(row.revision),
    menuRevision: menu.revision,
    policy: normalizePosCounterMenuPolicy(row.policy),
    categories,
    hasEnabledMenu: enabledMenus.length > 0,
    priceTaxMode: String(row.priceTaxMode),
    dineInTaxRate: Number(row.dineInTaxRate),
    takeoutTaxRate: Number(row.takeoutTaxRate)
  };
}

function parsePolicy(value: unknown): CounterMenuPolicy {
  const invalid = () => new PosCounterMenuSettingsError('共用メニューと税率の設定を確認してください。', 400);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const input = value as Record<string, unknown>;
  const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= 1000
    && ids.every(id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id));
  if (typeof input.sharedMenuForTakeout !== 'boolean' || !validIds(input.standardTaxCategoryIds) || !validIds(input.takeoutRestrictedCategoryIds)) throw invalid();
  const standard = new Set(input.standardTaxCategoryIds);
  if (input.takeoutRestrictedCategoryIds.some(id => !standard.has(id))) throw invalid();
  return normalizePosCounterMenuPolicy(input);
}

export async function savePosCounterMenuSettings(storeId: string, employeeId: string, value: unknown, revision: unknown, menuRevision: unknown) {
  const policy = parsePolicy(value);
  const current = await getPosCounterMenuSettings(storeId);
  if (!current) throw new PosCounterMenuSettingsError('権限がありません。', 403);
  if (!current.ready) throw new PosCounterMenuSettingsError(migrationRequired, 409);
  if (revision !== current.revision || menuRevision !== current.menuRevision) throw new PosCounterMenuSettingsError(stale, 409);
  if (policy.sharedMenuForTakeout) {
    if (!current.hasEnabledMenu) throw new PosCounterMenuSettingsError('共用する店内メニューを有効にしてください。', 400);
    if (current.priceTaxMode !== 'tax_included') throw new PosCounterMenuSettingsError(sharedMenuRequiresTaxIncluded, 400);
    const allowed = new Set(current.categories.map(category => category.id));
    if (policy.standardTaxCategoryIds.some(id => !allowed.has(id))) {
      throw new PosCounterMenuSettingsError('現在の店内メニューから税率の対象分類を選んでください。', 400);
    }
  }
  if (JSON.stringify(policy) === JSON.stringify(current.policy)) return current;
  try {
    await sql.transaction([
      posMenuLock(storeId),
      sql.query(`select 1 / case when exists(select s.id ${activeScopeSql} and ${revisionSql}=$2 for share of s)
        then 1 else 0 end as counter_menu_settings_current`, [storeId, current.revision]),
      ...(current.menuRevision ? [dineInMenuGuard(storeId, current.menuRevision)] : []),
      sql`insert into pos_store_settings (store_id,counter_menu_policy,updated_by) values(${storeId}::uuid,${JSON.stringify(policy)}::jsonb,${employeeId}::uuid)
        on conflict(store_id) do update set counter_menu_policy=excluded.counter_menu_policy,updated_by=excluded.updated_by,updated_at=now()
        where pos_store_settings.counter_menu_policy is distinct from excluded.counter_menu_policy`
    ]);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '22012') throw new PosCounterMenuSettingsError(stale, 409);
    if (code === '42703') throw new PosCounterMenuSettingsError(migrationRequired, 409);
    throw error;
  }
  return getPosCounterMenuSettings(storeId);
}

/** General/legacy settings cannot make an active shared policy tax excluded. Run after posMenuLock. */
export function posCounterMenuTaxIncludedGuard(storeId: string) {
  return sql`select 1 / case when exists(select 1 from pos_store_settings p where p.store_id::text=${storeId}
    and to_jsonb(p)->'counter_menu_policy'->'sharedMenuForTakeout'='true'::jsonb) then 0 else 1 end as shared_counter_tax_included`;
}
