import type {
  UberInventoryItemTarget,
  UberInventoryTarget
} from "./uber-inventory-targets";

type InventoryTarget = UberInventoryItemTarget | UberInventoryTarget;
type InventoryPlatform = "uber_eats" | "rocket_now" | "demae_can";

const EXCLUDED_LABELS: Record<InventoryPlatform, Set<string>> = {
  uber_eats: new Set([
    "夏限定・新定番！クセになる冷やし麻辣拌のピリ辛＆濃厚ハーモニー"
  ]),
  demae_can: new Set([
    "シビレ⚡️⚡️"
  ]),
  rocket_now: new Set([
    "さつまいも板春雨50g",
    "トッポッキ50g",
    "【もっちりつるん】きしめん50g",
    "山芋麺に変更",
    "山芋麺50g",
    "【高たんぱく💪】国産とりむねスライス約50g",
    "【旨味が爆発💥】ぶつ切りたこ🐙（約50g）",
    "【国産】牛センマイ約50g",
    "【旨味溢れる】ホッキ貝1個",
    "【数量限定品】牛赤センマイ（約50g）",
    "🦆合鴨あぶりスモーク"
  ])
};

export function projectInventoryTargetsForPlatform(
  platform: InventoryPlatform,
  targets: InventoryTarget[]
) {
  const excluded = EXCLUDED_LABELS[platform];
  return targets.filter((target) => !excluded.has(target.label.trim()));
}
