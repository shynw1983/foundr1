import { sql } from "./db";

export const configurableRoles = ["owner", "manager", "store_owner", "store_manager", "staff", "store_terminal"] as const;

export type ConfigurableRole = typeof configurableRoles[number];

export type RolePermissionDefinition = {
  key: string;
  label: string;
  description: string;
  category: string;
  defaultRoles: ConfigurableRole[];
  lockedRoles?: ConfigurableRole[];
  availableRoles?: ConfigurableRole[];
  navPaths?: string[];
};

export const rolePermissionDefinitions: RolePermissionDefinition[] = [
  {
    key: "module.staffPortal",
    label: "スタッフ個人アプリ",
    description: "スタッフ本人の打刻、シフト、給与確認画面を開けます。",
    category: "モジュール",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager", "staff"],
    lockedRoles: ["owner"],
    navPaths: ["/staff"]
  },
  {
    key: "module.orders",
    label: "発注・購入管理",
    description: "補充依頼の確認、発注依頼、購入管理、履歴、証憑、現場記録を表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager"],
    lockedRoles: ["owner"],
    navPaths: ["/os/replenishment", "/os/orders", "/os/procurement", "/os/history", "/os/vouchers", "/os/field-notes", "/os/reports", "/os/feedback"]
  },
  {
    key: "module.analytics",
    label: "経営分析",
    description: "売上、人件費、原価、経費、月次損益を表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager", "store_owner"],
    lockedRoles: ["owner"],
    navPaths: ["/os/analytics", "/os/analytics/sales", "/os/analytics/menu-ranking", "/os/sales", "/os/analytics/labor", "/os/analytics/cost", "/os/analytics/expenses", "/os/analytics/profit"]
  },
  {
    key: "module.competitors",
    label: "競合メニュー監視",
    description: "本部共有の競合調査と監視設定を表示します。",
    category: "本部管理",
    defaultRoles: ["owner", "manager"],
    availableRoles: ["owner", "manager"],
    lockedRoles: ["owner"],
    navPaths: ["/os/analytics/competitors"]
  },
  {
    key: "module.timecard",
    label: "タイムカード",
    description: "勤怠、シフト、負荷分析、給与画面を表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager"],
    lockedRoles: ["owner"],
    navPaths: ["/os/timecard", "/os/timecard/schedule", "/os/timecard/requests", "/os/timecard/workload", "/os/timecard/payroll"]
  },
  {
    key: "module.staff",
    label: "スタッフ管理",
    description: "スタッフ一覧とスタッフ詳細を表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager"],
    lockedRoles: ["owner"],
    navPaths: ["/os/staff"]
  },
  {
    key: "module.products",
    label: "商品マスタ",
    description: "商品マスタを表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager"],
    lockedRoles: ["owner"],
    navPaths: ["/os/products"]
  },
  {
    key: "module.masterData",
    label: "本部共有データ",
    description: "ブランド、発注先、商品比較などの本部共有データを表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager"],
    lockedRoles: ["owner"],
    availableRoles: ["owner", "manager"],
    navPaths: ["/os/suppliers", "/os/product-comparisons"]
  },
  {
    key: "module.storeSettings",
    label: "所属店舗の設定",
    description: "管理範囲内の店舗設定を表示します。本部のブランド・発注先管理は含みません。",
    category: "店舗運営",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager"],
    availableRoles: ["owner", "manager", "store_owner", "store_manager"],
    lockedRoles: ["owner"],
    navPaths: ["/os/stores"]
  },
  {
    key: "stores.manageSettings",
    label: "所属店舗の運営設定変更",
    description: "所属店舗の営業時間、予約メモ、打刻地点、給与計算・シフト提出期限を変更できます。決済・会社・ブランド設定は含みません。",
    category: "店舗運営",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager"],
    availableRoles: ["owner", "manager", "store_owner", "store_manager"],
    lockedRoles: ["owner"]
  },
  {
    key: "stores.manageMasterData",
    label: "店舗・ブランドの本部設定変更",
    description: "店舗・ブランドの作成・削除、会社情報、決済連携などの本部設定を変更できます。",
    category: "本部管理",
    defaultRoles: ["owner", "manager"],
    availableRoles: ["owner", "manager"],
    lockedRoles: ["owner"]
  },
  {
    key: "module.menu",
    label: "メニュー・ブランドサイト",
    description: "メニュー管理、ブランドサイト、会員・ポイントを表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager"],
    lockedRoles: ["owner"],
    navPaths: ["/os/menus", "/os/brand-sites", "/os/loyalty"]
  },
  {
    key: "store.inventory",
    label: "店舗の在庫確認・補充依頼・入庫",
    description: "所属店舗で在庫巡回、実数棚卸、異常報告、補充依頼、入庫を実行できます。購入管理や商品・配合・設定の管理権限は含みません。",
    category: "店舗運営",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager", "staff", "store_terminal"],
    lockedRoles: ["owner"],
    navPaths: ["/store/inventory", "/store/replenishment", "/store/receiving"]
  },
  {
    key: "store.theme.manage",
    label: "Store テーマカラーの変更",
    description: "権限のある店舗で Store の共有テーマカラーを変更できます。スタッフ・店舗端末には付与できません。",
    category: "店舗運営",
    defaultRoles: ["owner"],
    lockedRoles: ["owner"],
    navPaths: ["/store/settings/appearance"]
  },
  {
    key: "module.inventory",
    label: "在庫確認",
    description: "店舗ごとの粗い在庫確認、保管場所、安全在庫、異常記録を表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager", "store_terminal"],
    lockedRoles: ["owner"],
    navPaths: ["/os/inventory"]
  },
  {
    key: "module.procedures",
    label: "手順書管理",
    description: "店舗運営の手順書管理を表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager"],
    lockedRoles: ["owner"],
    navPaths: ["/os/procedures", "/os/sns"]
  },
  {
    key: "module.pos",
    label: "POS",
    description: "POS 管理画面を表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager", "store_owner"],
    lockedRoles: ["owner"],
    navPaths: ["/os/pos", "/os/pos/reconciliation", "/os/pos/table-order"]
  },
  {
    key: "module.settings",
    label: "システム設定",
    description: "システム設定と外部サービス利用量を表示します。",
    category: "モジュール",
    defaultRoles: ["owner"],
    lockedRoles: ["owner"],
    navPaths: ["/os/settings", "/os/system-usage"]
  },
  {
    key: "staff.manage",
    label: "スタッフ作成・編集",
    description: "許可された範囲のスタッフを作成、編集、削除できます。未許可の場合は閲覧のみです。",
    category: "操作",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager"],
    availableRoles: ["owner", "manager", "store_owner", "store_manager"],
    lockedRoles: ["owner"]
  },
  {
    key: "products.manage",
    label: "商品マスタ編集",
    description: "商品、カテゴリ、価格、発注先候補を作成・編集できます。未許可の場合は閲覧のみです。",
    category: "商品マスタ",
    defaultRoles: ["owner", "manager"],
    lockedRoles: ["owner"]
  },
  {
    key: "procedures.edit",
    label: "手順書編集",
    description: "手順書と手順書用のアクション・材料・設備マスタを編集できます。",
    category: "店舗運営",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager"],
    lockedRoles: ["owner"]
  },
  {
    key: "pos.manageSettings",
    label: "POS 設定編集",
    description: "POS 税率、レシート、プリンタ、値引き、客面表示を編集できます。",
    category: "POS",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager"],
    lockedRoles: ["owner"]
  },
  {
    key: "pos.operate",
    label: "店舗 POS 会計",
    description: "所属店舗で POS の会計担当者として操作できます。OS の POS 管理画面への権限は含みません。",
    category: "POS",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager", "staff", "store_terminal"],
    lockedRoles: ["owner"]
  },
  {
    key: "pos.refund",
    label: "POS 返金・訂正",
    description: "POS 取引の返金、取消、現金差異の訂正を操作できます。",
    category: "POS",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager"],
    lockedRoles: ["owner"]
  },
  {
    key: "menus.edit",
    label: "メニュー編集",
    description: "メニュー商品、選択肢、多言語表示、AI 翻訳を編集できます。",
    category: "メニュー",
    defaultRoles: ["owner", "manager"],
    lockedRoles: ["owner"]
  },
  {
    key: "brandSites.publish",
    label: "ブランドサイト公開",
    description: "ブランドサイトの変更を承認し、公開 API に反映できます。",
    category: "メニュー",
    defaultRoles: ["owner"],
    lockedRoles: ["owner"]
  },
  {
    key: "analytics.manageExpenses",
    label: "経費編集",
    description: "月次経費と経費レシートを登録、編集、削除、確認できます。",
    category: "経営分析",
    defaultRoles: ["owner", "manager", "store_owner"],
    lockedRoles: ["owner"]
  },
  {
    key: "history.correct",
    label: "履歴訂正",
    description: "発注・購入履歴の数量、状態、レシート確認などを訂正できます。",
    category: "発注・購入管理",
    defaultRoles: ["owner", "manager"],
    lockedRoles: ["owner"]
  },
  {
    key: "history.delete",
    label: "履歴削除",
    description: "発注履歴、商品、連絡報告などの削除操作を実行できます。",
    category: "発注・購入管理",
    defaultRoles: ["owner"],
    lockedRoles: ["owner"]
  },
  {
    key: "settings.managePermissions",
    label: "権限設定編集",
    description: "ユーザーグループ権限を変更できます。",
    category: "システム設定",
    defaultRoles: ["owner"],
    lockedRoles: ["owner"]
  },
  {
    key: "staff.assignHeadquarterRoles",
    label: "本部権限の付与",
    description: "manager 以上の本部権限をスタッフに付与できます。",
    category: "操作",
    defaultRoles: ["owner"],
    lockedRoles: ["owner"]
  }
];

const permissionByKey = new Map(rolePermissionDefinitions.map((definition) => [definition.key, definition]));

function isPermissionAvailableForRole(role: ConfigurableRole, permissionKey: string) {
  const definition = permissionByKey.get(permissionKey);
  if (definition?.availableRoles && !definition.availableRoles.includes(role)) return false;
  if (permissionKey === "store.theme.manage") return ["owner", "manager", "store_owner", "store_manager"].includes(role);
  if (role === "staff") return permissionKey === "module.staffPortal" || permissionKey === "store.inventory" || permissionKey === "pos.operate";
  return true;
}

export function normalizeConfigurableRole(role: string): ConfigurableRole | null {
  return configurableRoles.includes(role as ConfigurableRole) ? role as ConfigurableRole : null;
}

export function getDefaultPermissionsForRole(role: string) {
  const normalizedRole = normalizeConfigurableRole(role);
  if (!normalizedRole) return new Set<string>();
  return new Set(rolePermissionDefinitions
    .filter((definition) => definition.defaultRoles.includes(normalizedRole) && isPermissionAvailableForRole(normalizedRole, definition.key))
    .map((definition) => definition.key));
}

export function isLockedRolePermission(role: string, permissionKey: string) {
  const normalizedRole = normalizeConfigurableRole(role);
  const definition = permissionByKey.get(permissionKey);
  return Boolean(normalizedRole && definition?.lockedRoles?.includes(normalizedRole));
}

export function normalizePermissionKeys(role: string, permissionKeys: unknown) {
  const normalizedRole = normalizeConfigurableRole(role);
  const requestedKeys = new Set(Array.isArray(permissionKeys) ? permissionKeys.map(String) : []);
  const normalizedKeys = new Set<string>();

  for (const definition of rolePermissionDefinitions) {
    if (!normalizedRole || !isPermissionAvailableForRole(normalizedRole, definition.key)) continue;
    if (requestedKeys.has(definition.key)) normalizedKeys.add(definition.key);
    if (definition.lockedRoles?.includes(normalizedRole)) normalizedKeys.add(definition.key);
  }

  return Array.from(normalizedKeys);
}

const permissionCacheTtlMs = 60_000;
const permissionCache = new Map<string, { permissions: Set<string>; expiresAt: number }>();

export function clearRolePermissionCache(role?: string) {
  const normalizedRole = role ? normalizeConfigurableRole(role) : null;
  if (normalizedRole) {
    permissionCache.delete(normalizedRole);
    return;
  }
  permissionCache.clear();
}

export async function getPermissionsForRole(role: string, options: { fresh?: boolean } = {}) {
  const normalizedRole = normalizeConfigurableRole(role);
  if (!normalizedRole) return new Set<string>();

  const cached = permissionCache.get(normalizedRole);
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return new Set(cached.permissions);

  const rows = await sql`
    select permission_key as "permissionKey", is_enabled as "isEnabled"
    from role_permissions
    where role = ${normalizedRole}
  `;
  const saved = new Map(rows.map((row) => [String(row.permissionKey), row.isEnabled === true]));
  const permissions = new Set<string>();

  for (const definition of rolePermissionDefinitions) {
    if (!isPermissionAvailableForRole(normalizedRole, definition.key)) continue;
    const fallbackKey = definition.key === "module.competitors" ? "module.analytics" : definition.key;
    const enabled = saved.has(definition.key) ? saved.get(definition.key) === true
      : saved.has(fallbackKey) ? saved.get(fallbackKey) === true : definition.defaultRoles.includes(normalizedRole);
    if (enabled || definition.lockedRoles?.includes(normalizedRole)) permissions.add(definition.key);
  }

  permissionCache.set(normalizedRole, {
    permissions: new Set(permissions),
    expiresAt: Date.now() + permissionCacheTtlMs
  });
  return permissions;
}

export async function getAllRolePermissions() {
  const rows = await sql`
    select role, permission_key as "permissionKey", is_enabled as "isEnabled"
    from role_permissions
    where role = any(${[...configurableRoles]})
  `;
  const saved = new Map(rows.map((row) => [`${row.role}:${row.permissionKey}`, row.isEnabled === true]));

  return configurableRoles.map((role) => ({
    role,
    permissions: rolePermissionDefinitions.map((definition) => {
      const savedKey = `${role}:${definition.key}`;
      const available = isPermissionAvailableForRole(role, definition.key);
      const fallbackKey = `${role}:${definition.key === "module.competitors" ? "module.analytics" : definition.key}`;
      const enabled = available && (saved.has(savedKey) ? saved.get(savedKey) === true
        : saved.has(fallbackKey) ? saved.get(fallbackKey) === true : definition.defaultRoles.includes(role));
      return {
        key: definition.key,
        available,
        enabled: enabled || (available && Boolean(definition.lockedRoles?.includes(role))),
        locked: Boolean(definition.lockedRoles?.includes(role)) || !available
      };
    })
  }));
}

export async function roleHasPermission(role: string, permissionKey: string, options: { fresh?: boolean } = {}) {
  return (await getPermissionsForRole(role, options)).has(permissionKey);
}

export function getNavPathsForPermissions(permissionKeys: Iterable<string>) {
  const paths = new Set<string>();
  for (const key of permissionKeys) {
    const definition = permissionByKey.get(key);
    for (const path of definition?.navPaths ?? []) paths.add(path);
  }
  if (Array.from(paths).some((path) => path.startsWith("/os/"))) paths.add("/os");
  return Array.from(paths);
}

export function isPermittedOsPagePath(pathname: string, permittedPaths: Set<string>) {
  const matches = rolePermissionDefinitions.flatMap(definition => definition.navPaths ?? [])
    .filter(path => path !== "/os" && (pathname === path || pathname.startsWith(`${path}/`)))
    .sort((a, b) => b.length - a.length);
  if (matches.length) return permittedPaths.has(matches[0]);
  return false;
}
