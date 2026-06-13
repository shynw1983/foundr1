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
  navPaths?: string[];
};

export const rolePermissionDefinitions: RolePermissionDefinition[] = [
  {
    key: "module.storeWorkbench",
    label: "店舗ワークベンチ",
    description: "店舗現場画面を開けます。",
    category: "モジュール",
    defaultRoles: ["owner", "manager", "store_terminal"],
    lockedRoles: ["owner"],
    navPaths: ["/store"]
  },
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
    description: "発注依頼、購入管理、履歴、証憑、現場記録を表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager", "staff"],
    lockedRoles: ["owner"],
    navPaths: ["/os/orders", "/os/procurement", "/os/history", "/os/vouchers", "/os/field-notes", "/os/reports", "/os/feedback"]
  },
  {
    key: "module.analytics",
    label: "経営分析",
    description: "売上、人件費、原価、経費、月次損益を表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager"],
    lockedRoles: ["owner"],
    navPaths: ["/os/analytics", "/os/analytics/sales", "/os/sales", "/os/analytics/labor", "/os/analytics/cost", "/os/analytics/expenses", "/os/analytics/profit"]
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
    description: "スタッフ一覧とアカウント管理を表示します。",
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
    description: "店舗・ブランド、発注先、商品比較などの本部共有データを表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager"],
    lockedRoles: ["owner"],
    navPaths: ["/os/stores", "/os/suppliers", "/os/product-comparisons"]
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
    key: "module.procedures",
    label: "手順書管理",
    description: "店舗運営の手順書管理を表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager"],
    lockedRoles: ["owner"],
    navPaths: ["/os/procedures"]
  },
  {
    key: "module.pos",
    label: "POS",
    description: "POS 管理画面を表示します。",
    category: "モジュール",
    defaultRoles: ["owner", "manager"],
    lockedRoles: ["owner"],
    navPaths: ["/os/pos", "/os/pos/reconciliation"]
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
    description: "許可された範囲のスタッフを作成、編集できます。",
    category: "操作",
    defaultRoles: ["owner", "manager", "store_owner", "store_manager"],
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

export function normalizeConfigurableRole(role: string): ConfigurableRole | null {
  return configurableRoles.includes(role as ConfigurableRole) ? role as ConfigurableRole : null;
}

export function getDefaultPermissionsForRole(role: string) {
  const normalizedRole = normalizeConfigurableRole(role);
  if (!normalizedRole) return new Set<string>();
  return new Set(rolePermissionDefinitions.filter((definition) => definition.defaultRoles.includes(normalizedRole)).map((definition) => definition.key));
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
    if (requestedKeys.has(definition.key)) normalizedKeys.add(definition.key);
    if (normalizedRole && definition.lockedRoles?.includes(normalizedRole)) normalizedKeys.add(definition.key);
  }

  return Array.from(normalizedKeys);
}

export async function getPermissionsForRole(role: string) {
  const normalizedRole = normalizeConfigurableRole(role);
  if (!normalizedRole) return new Set<string>();

  const rows = await sql`
    select permission_key as "permissionKey", is_enabled as "isEnabled"
    from role_permissions
    where role = ${normalizedRole}
  `;
  const saved = new Map(rows.map((row) => [String(row.permissionKey), row.isEnabled === true]));
  const permissions = new Set<string>();

  for (const definition of rolePermissionDefinitions) {
    const enabled = saved.has(definition.key) ? saved.get(definition.key) === true : definition.defaultRoles.includes(normalizedRole);
    if (enabled || definition.lockedRoles?.includes(normalizedRole)) permissions.add(definition.key);
  }

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
      const enabled = saved.has(savedKey) ? saved.get(savedKey) === true : definition.defaultRoles.includes(role);
      return {
        key: definition.key,
        enabled: enabled || Boolean(definition.lockedRoles?.includes(role)),
        locked: Boolean(definition.lockedRoles?.includes(role))
      };
    })
  }));
}

export async function roleHasPermission(role: string, permissionKey: string) {
  return (await getPermissionsForRole(role)).has(permissionKey);
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
