import type {
  UberInventoryItemTarget,
  UberInventoryTarget
} from "./uber-inventory-targets";

type InventoryTarget = UberInventoryItemTarget | UberInventoryTarget;
type InventoryPlatform = "uber_eats" | "rocket_now" | "demae_can";

const EXCLUDED_LABELS: Record<InventoryPlatform, Set<string>> = {
  uber_eats: new Set([
    "夏限定・新定番！クセになる冷やし麻辣拌のピリ辛＆濃厚ハーモニー",
    "🦆合鴨あぶりスモーク",
    "さつまいも板春雨50g"
  ]),
  demae_can: new Set([
    "シビレ⚡️⚡️",
    "🥇山盛りうずら×🔟"
  ]),
  rocket_now: new Set([
    "🥇山盛りうずら×🔟",
    "大海老1匹"
  ])
};

export function projectInventoryTargetsForPlatform(
  platform: InventoryPlatform,
  targets: InventoryTarget[]
) {
  const excluded = EXCLUDED_LABELS[platform];
  return targets.filter((target) => !excluded.has(target.label.trim()));
}
