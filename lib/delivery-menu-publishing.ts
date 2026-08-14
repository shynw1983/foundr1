export type DeliveryMenuPlatformKey = "uber_eats" | "rocket_now" | "demae_can";

export type MenuProjectionItem = {
  id: string;
  externalId: string;
  name: string;
  displayNames?: Record<string, string>;
  basePrice: number | null;
  isActive: boolean;
};

export type MenuProjectionOption = {
  id: string;
  groupKey: string;
  optionKey: string;
  name: string;
  displayNames?: Record<string, string>;
  priceDelta: number | null;
  isActive: boolean;
};

export type UberMenuBaselineItem = {
  websiteId: string;
  name: string;
  uberPrice: number | null;
};

export type UberMenuBaselineOption = {
  groupKey: string;
  optionKey: string;
  name: string;
  uberName: string;
  websitePrice: number | null;
  uberPrice: number | null;
};

export type MenuPublishChangeKind = "create" | "rename" | "reprice" | "update" | "move" | "disable" | "delete";

export type MenuPublishPreviewChange = {
  id: string;
  targetType: "item" | "option" | "category" | "option_group" | "other";
  targetLabel: string;
  kind: MenuPublishChangeKind;
  summary: string;
  currentValue?: string;
  projectedValue?: string;
  confidence: "confirmed" | "provisional";
};

export type MenuPublishPreviewPlatform = {
  platformKey: DeliveryMenuPlatformKey;
  platformName: string;
  ruleVersion: string;
  baselineStatus: "ready" | "missing";
  baselineCapturedAt: string | null;
  changes: MenuPublishPreviewChange[];
  warnings: string[];
  blockers: string[];
};

const multilingualOrder = ["zh", "ko", "en"] as const;

export const deliveryPlatformRules: Record<DeliveryMenuPlatformKey, {
  name: string;
  ruleVersion: string;
  nameMode: "multilingual_join" | "japanese";
  priceMode: "base" | "high_tier";
}> = {
  uber_eats: {
    name: "Uber Eats",
    ruleVersion: "uber-v1",
    nameMode: "multilingual_join",
    priceMode: "high_tier"
  },
  rocket_now: {
    name: "Rocket Now",
    ruleVersion: "rocket-v1",
    nameMode: "japanese",
    priceMode: "high_tier"
  },
  demae_can: {
    name: "出前館",
    ruleVersion: "demae-v1",
    nameMode: "multilingual_join",
    priceMode: "base"
  }
};

export function projectDeliveryName(
  platformKey: DeliveryMenuPlatformKey,
  name: string,
  displayNames: Record<string, string> = {}
) {
  const rule = deliveryPlatformRules[platformKey];
  if (rule.nameMode === "japanese") return name.trim();
  return [name, ...multilingualOrder.map((language) => displayNames[language])]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("｜");
}

export function projectNewHighTierPrice(basePrice: number) {
  return Math.round(basePrice * 1.25);
}

function yen(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "未設定";
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function missingRequiredTranslations(entries: Array<{ isActive: boolean; displayNames?: Record<string, string> }>) {
  return entries.filter((entry) => entry.isActive).reduce((total, entry) => (
    total + multilingualOrder.filter((language) => !String(entry.displayNames?.[language] ?? "").trim()).length
  ), 0);
}

function addPendingTaskChanges(
  platform: MenuPublishPreviewPlatform,
  tasks: Array<{ id: string; targetType: string; targetLabel: string; changeKind: string; changeSummary: string }>
) {
  const existing = new Set(platform.changes.map((change) => `${change.targetType}:${change.targetLabel}:${change.kind}`));
  for (const task of tasks) {
    const kind = (["create", "rename", "reprice", "update", "move", "disable", "delete"].includes(task.changeKind)
      ? task.changeKind
      : "update") as MenuPublishChangeKind;
    const targetType = (["item", "option", "category", "option_group"].includes(task.targetType)
      ? task.targetType
      : "other") as MenuPublishPreviewChange["targetType"];
    const key = `${targetType}:${task.targetLabel}:${kind}`;
    if (existing.has(key)) continue;
    platform.changes.push({
      id: `task:${task.id}`,
      targetType,
      targetLabel: task.targetLabel,
      kind,
      summary: task.changeSummary,
      confidence: platform.baselineStatus === "ready" ? "confirmed" : "provisional"
    });
    existing.add(key);
  }
}

export function buildDeliveryMenuPublishPreview(input: {
  items: MenuProjectionItem[];
  options: MenuProjectionOption[];
  uberBaselineItems: UberMenuBaselineItem[];
  uberBaselineOptions: UberMenuBaselineOption[];
  uberBaselineCapturedAt: string | null;
  pendingTasksByPlatform: Partial<Record<DeliveryMenuPlatformKey, Array<{
    id: string;
    targetType: string;
    targetLabel: string;
    changeKind: string;
    changeSummary: string;
  }>>>;
}) {
  const activeItems = input.items.filter((item) => item.isActive);
  const activeOptions = input.options.filter((option) => option.isActive);
  const missingTranslations = missingRequiredTranslations([...activeItems, ...activeOptions]);
  const platforms = (Object.keys(deliveryPlatformRules) as DeliveryMenuPlatformKey[]).map((platformKey) => {
    const rule = deliveryPlatformRules[platformKey];
    const baselineReady = platformKey === "uber_eats" && input.uberBaselineItems.length > 0;
    const platform: MenuPublishPreviewPlatform = {
      platformKey,
      platformName: rule.name,
      ruleVersion: rule.ruleVersion,
      baselineStatus: baselineReady ? "ready" : "missing",
      baselineCapturedAt: baselineReady ? input.uberBaselineCapturedAt : null,
      changes: [],
      warnings: [],
      blockers: []
    };

    if (rule.nameMode === "multilingual_join" && missingTranslations > 0) {
      platform.blockers.push(`商品・選択肢に必須翻訳の未入力が ${missingTranslations} 欄あります。`);
    }
    if (!baselineReady) {
      platform.blockers.push("現在の平台メニュー基準が未取込のため、正確な差分を確定できません。");
    }
    return platform;
  });

  const uber = platforms.find((platform) => platform.platformKey === "uber_eats")!;
  const itemByExternalId = new Map(input.items.map((item) => [item.externalId, item]));
  const baselineItemByWebsiteId = new Map(input.uberBaselineItems.map((item) => [item.websiteId, item]));

  for (const item of activeItems) {
    const baseline = baselineItemByWebsiteId.get(item.externalId);
    if (!baseline) {
      uber.changes.push({
        id: `item:${item.id}:create`,
        targetType: "item",
        targetLabel: item.name,
        kind: "create",
        summary: "Uber の基準データに対応商品がありません。新規追加候補です。",
        projectedValue: projectDeliveryName("uber_eats", item.name, item.displayNames),
        confidence: "provisional"
      });
      continue;
    }

    const projectedName = projectDeliveryName("uber_eats", item.name, item.displayNames);
    if (projectedName && projectedName !== baseline.name) {
      uber.changes.push({
        id: `item:${item.id}:rename`,
        targetType: "item",
        targetLabel: item.name,
        kind: "rename",
        summary: "商品名が現在の Uber 基準と異なります。",
        currentValue: baseline.name,
        projectedValue: projectedName,
        confidence: "confirmed"
      });
    }

    if (item.basePrice !== null && baseline.uberPrice !== null) {
      const inferredOldBase = Math.round((baseline.uberPrice * 0.8) / 10) * 10;
      if (item.basePrice !== inferredOldBase) {
        const projectedPrice = projectNewHighTierPrice(item.basePrice);
        if (projectedPrice !== baseline.uberPrice) {
          uber.changes.push({
            id: `item:${item.id}:reprice`,
            targetType: "item",
            targetLabel: item.name,
            kind: "reprice",
            summary: "基礎価格の変更から 1.25 倍で算出した暫定価格です。公開前の確認が必要です。",
            currentValue: yen(baseline.uberPrice),
            projectedValue: yen(projectedPrice),
            confidence: "provisional"
          });
        }
      }
    }
  }

  for (const baseline of input.uberBaselineItems) {
    if (!itemByExternalId.has(baseline.websiteId)) {
      uber.changes.push({
        id: `uber-orphan:${baseline.websiteId}`,
        targetType: "item",
        targetLabel: baseline.name,
        kind: "delete",
        summary: "OS に対応商品がない Uber 既存商品です。初回公開では自動削除しません。",
        confidence: "confirmed"
      });
    }
  }

  const baselineOptionByKey = new Map(input.uberBaselineOptions.map((option) => [`${option.groupKey}:${option.optionKey}`, option]));
  for (const option of activeOptions) {
    const baseline = baselineOptionByKey.get(`${option.groupKey}:${option.optionKey}`);
    if (!baseline) {
      uber.changes.push({
        id: `option:${option.id}:create`,
        targetType: "option",
        targetLabel: option.name,
        kind: "create",
        summary: "Uber の基準データに対応選択肢がありません。新規追加候補です。",
        projectedValue: projectDeliveryName("uber_eats", option.name, option.displayNames),
        confidence: "provisional"
      });
      continue;
    }
    const projectedName = projectDeliveryName("uber_eats", option.name, option.displayNames);
    if (projectedName && projectedName !== baseline.uberName) {
      uber.changes.push({
        id: `option:${option.id}:rename`,
        targetType: "option",
        targetLabel: option.name,
        kind: "rename",
        summary: "選択肢名が現在の Uber 基準と異なります。",
        currentValue: baseline.uberName,
        projectedValue: projectedName,
        confidence: "confirmed"
      });
    }
    if (option.priceDelta !== null && baseline.websitePrice !== null && option.priceDelta !== baseline.websitePrice) {
      const projectedPrice = projectNewHighTierPrice(option.priceDelta);
      if (projectedPrice !== baseline.uberPrice) {
        uber.changes.push({
          id: `option:${option.id}:reprice`,
          targetType: "option",
          targetLabel: option.name,
          kind: "reprice",
          summary: "基礎価格の変更から 1.25 倍で算出した暫定価格です。",
          currentValue: yen(baseline.uberPrice),
          projectedValue: yen(projectedPrice),
          confidence: "provisional"
        });
      }
    }
  }

  const rocket = platforms.find((platform) => platform.platformKey === "rocket_now")!;
  const standardCount = activeOptions.filter((option) => option.groupKey === "standard").length;
  if (standardCount > 35) {
    rocket.warnings.push(`Standard Topping は Rocket で 35件＋${standardCount - 35}件の2グループに分割されます。`);
  }

  for (const platform of platforms) {
    addPendingTaskChanges(platform, input.pendingTasksByPlatform[platform.platformKey] ?? []);
    platform.changes.sort((left, right) => left.kind.localeCompare(right.kind) || left.targetLabel.localeCompare(right.targetLabel, "ja"));
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: "read_only" as const,
    platforms
  };
}
