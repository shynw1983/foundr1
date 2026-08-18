export type DeliveryMenuPlatformKey = "uber_eats" | "rocket_now" | "demae_can";

export type MenuPlatformTargetSetting = {
  isEnabled?: boolean;
  nameOverride?: string;
  descriptionOverride?: string;
  priceOverride?: number | null;
  emojiMode?: "follow" | "show" | "hide";
  placementConfig?: Record<string, unknown>;
};

export type MenuProjectionItem = {
  id: string;
  externalId: string;
  name: string;
  displayNames?: Record<string, string>;
  basePrice: number | null;
  isActive: boolean;
  platformSettings?: Partial<Record<DeliveryMenuPlatformKey, MenuPlatformTargetSetting>>;
};

export type MenuProjectionOption = {
  id: string;
  groupKey: string;
  optionKey: string;
  name: string;
  displayNames?: Record<string, string>;
  priceDelta: number | null;
  isActive: boolean;
  platformSettings?: Partial<Record<DeliveryMenuPlatformKey, MenuPlatformTargetSetting>>;
};

export type UberMenuBaselineItem = {
  websiteId: string;
  name: string;
  uberPrice: number | null;
  websitePrice?: number | null;
};

export type UberMenuBaselineOption = {
  groupKey: string;
  optionKey: string;
  name: string;
  uberName: string;
  websitePrice: number | null;
  uberPrice: number | null;
};

export type MenuPlatformBaselineEntry = {
  targetId?: string;
  externalId?: string;
  externalParentId?: string;
  groupKey?: string;
  optionKey?: string;
  name: string;
  price: number | null;
  sourceBasePrice?: number | null;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
};

export type MenuPlatformBaseline = {
  capturedAt: string | null;
  items: MenuPlatformBaselineEntry[];
  options: MenuPlatformBaselineEntry[];
  complete?: boolean;
  missingTargets?: string[];
};

export type DeliveryPlatformRule = {
  name: string;
  ruleVersion: string;
  nameMode: "multilingual_join" | "japanese";
  emojiMode: "preserve" | "strip";
  priceMode: "base" | "high_tier";
  priceMultiplier: number;
  roundingMode: "nearest" | "ceil" | "floor";
  roundingUnit: number;
  requiredLanguages: readonly string[];
  groupLimits: Record<string, number>;
};

export type MenuPublishChangeKind = "create" | "rename" | "reprice" | "update" | "move" | "disable" | "delete";

export type MenuPublishPreviewChange = {
  id: string;
  targetType: "item" | "option" | "category" | "option_group" | "other";
  targetId?: string;
  targetLabel: string;
  kind: MenuPublishChangeKind;
  summary: string;
  currentValue?: string;
  projectedValue?: string;
  currentState?: Record<string, unknown>;
  projectedState?: Record<string, unknown>;
  confidence: "confirmed" | "provisional";
  requiresExplicitConfirmation?: boolean;
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
const emojiPattern = /[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu;

export const deliveryPlatformRules: Record<DeliveryMenuPlatformKey, DeliveryPlatformRule> = {
  uber_eats: {
    name: "Uber Eats",
    ruleVersion: "uber-v2",
    nameMode: "multilingual_join",
    emojiMode: "preserve",
    priceMode: "high_tier",
    priceMultiplier: 1.25,
    roundingMode: "nearest",
    roundingUnit: 1,
    requiredLanguages: multilingualOrder,
    groupLimits: {}
  },
  rocket_now: {
    name: "Rocket Now",
    ruleVersion: "rocket-v2",
    nameMode: "japanese",
    emojiMode: "strip",
    priceMode: "high_tier",
    priceMultiplier: 1.25,
    roundingMode: "nearest",
    roundingUnit: 1,
    requiredLanguages: [],
    groupLimits: { standard: 35, basic: 24, premium: 20, vip: 3, noodles: 2, "noodle-replacement": 2, "cold-noodles": 1 }
  },
  demae_can: {
    name: "出前館",
    ruleVersion: "demae-v2",
    nameMode: "multilingual_join",
    emojiMode: "strip",
    priceMode: "base",
    priceMultiplier: 1,
    roundingMode: "nearest",
    roundingUnit: 1,
    requiredLanguages: multilingualOrder,
    groupLimits: {}
  }
};

function stripEmoji(value: string) {
  return value.replace(emojiPattern, "").replace(/\s{2,}/g, " ").trim();
}

function applyEmojiRule(value: string, rule: DeliveryPlatformRule, setting?: MenuPlatformTargetSetting) {
  const mode = setting?.emojiMode === "show"
    ? "preserve"
    : setting?.emojiMode === "hide"
      ? "strip"
      : rule.emojiMode;
  return mode === "strip" ? stripEmoji(value) : value.trim();
}

export function projectDeliveryName(
  platformKey: DeliveryMenuPlatformKey,
  name: string,
  displayNames: Record<string, string> = {},
  setting?: MenuPlatformTargetSetting,
  rule: DeliveryPlatformRule = deliveryPlatformRules[platformKey]
) {
  const sourceName = String(setting?.nameOverride ?? "").trim() || name.trim();
  if (rule.nameMode === "japanese") return applyEmojiRule(sourceName, rule, setting);
  return [sourceName, ...multilingualOrder.map((language) => displayNames[language])]
    .map((value) => applyEmojiRule(String(value ?? ""), rule, setting))
    .filter(Boolean)
    .join("｜");
}

export function projectNewHighTierPrice(basePrice: number) {
  return Math.round(basePrice * 1.25);
}

export function projectDeliveryPrice(
  platformKey: DeliveryMenuPlatformKey,
  basePrice: number | null,
  setting?: MenuPlatformTargetSetting,
  rule: DeliveryPlatformRule = deliveryPlatformRules[platformKey]
) {
  if (setting?.priceOverride !== undefined && setting.priceOverride !== null) return Number(setting.priceOverride);
  if (basePrice === null || !Number.isFinite(basePrice)) return null;
  const raw = Number(basePrice) * Number(rule.priceMultiplier || 1);
  const unit = Math.max(1, Number(rule.roundingUnit || 1));
  const scaled = raw / unit;
  const rounded = rule.roundingMode === "ceil" ? Math.ceil(scaled) : rule.roundingMode === "floor" ? Math.floor(scaled) : Math.round(scaled);
  return rounded * unit;
}

function yen(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "未設定";
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function missingRequiredTranslations(
  entries: Array<{ isActive: boolean; displayNames?: Record<string, string> }>,
  requiredLanguages: readonly string[]
) {
  return entries.filter((entry) => entry.isActive).reduce((total, entry) => (
    total + requiredLanguages.filter((language) => !String(entry.displayNames?.[language] ?? "").trim()).length
  ), 0);
}

type BuildPreviewInput = {
  items: MenuProjectionItem[];
  options: MenuProjectionOption[];
  platformBaselines?: Partial<Record<DeliveryMenuPlatformKey, MenuPlatformBaseline>>;
  platformRules?: Partial<Record<DeliveryMenuPlatformKey, DeliveryPlatformRule>>;
  uberBaselineItems?: UberMenuBaselineItem[];
  uberBaselineOptions?: UberMenuBaselineOption[];
  uberBaselineCapturedAt?: string | null;
  pendingTasksByPlatform: Partial<Record<DeliveryMenuPlatformKey, Array<{
    id: string;
    targetType: string;
    targetLabel: string;
    changeKind: string;
    changeSummary: string;
  }>>>;
};

function normalizedBaseline(input: BuildPreviewInput): Partial<Record<DeliveryMenuPlatformKey, MenuPlatformBaseline>> {
  const supplied = input.platformBaselines ?? {};
  if (supplied.uber_eats) return supplied;
  const legacyItems = input.uberBaselineItems ?? [];
  const legacyOptions = input.uberBaselineOptions ?? [];
  if (!legacyItems.length && !legacyOptions.length) return supplied;
  return {
    ...supplied,
    uber_eats: {
      capturedAt: input.uberBaselineCapturedAt ?? null,
      items: legacyItems.map((item): MenuPlatformBaselineEntry => ({
        externalId: item.websiteId,
        name: item.name,
        price: item.uberPrice,
        sourceBasePrice: item.websitePrice ?? (
          item.uberPrice === null ? null : Math.round((item.uberPrice * 0.8) / 10) * 10
        ),
        isActive: true
      })),
      options: legacyOptions.map((option): MenuPlatformBaselineEntry => ({
        groupKey: option.groupKey,
        optionKey: option.optionKey,
        name: option.uberName,
        price: option.uberPrice,
        sourceBasePrice: option.websitePrice,
        isActive: true
      }))
    }
  };
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

function findItemBaseline(item: MenuProjectionItem, entries: MenuPlatformBaselineEntry[]) {
  return entries.find((entry) => entry.targetId === item.id)
    ?? entries.find((entry) => entry.externalId && entry.externalId === item.externalId);
}

function findOptionBaseline(option: MenuProjectionOption, entries: MenuPlatformBaselineEntry[]) {
  return entries.find((entry) => entry.targetId === option.id)
    ?? entries.find((entry) => entry.groupKey === option.groupKey && entry.optionKey === option.optionKey);
}

function compareTarget(input: {
  platform: MenuPublishPreviewPlatform;
  platformKey: DeliveryMenuPlatformKey;
  rule: DeliveryPlatformRule;
  targetType: "item" | "option";
  target: MenuProjectionItem | MenuProjectionOption;
  baseline?: MenuPlatformBaselineEntry;
  basePrice: number | null;
  setting?: MenuPlatformTargetSetting;
}) {
  const { platform, platformKey, rule, targetType, target, baseline, basePrice, setting } = input;
  const enabled = target.isActive && setting?.isEnabled !== false;
  const projectedName = projectDeliveryName(platformKey, target.name, target.displayNames, setting, rule);
  const projectedPrice = projectDeliveryPrice(platformKey, basePrice, setting, rule);
  const projectedState = { name: projectedName, price: projectedPrice, sourceBasePrice: basePrice, isActive: enabled };
  if (!baseline) {
    if (!enabled) return;
    platform.changes.push({
      id: `${platformKey}:${targetType}:${target.id}:create`,
      targetType,
      targetId: target.id,
      targetLabel: target.name,
      kind: "create",
      summary: `${platform.platformName} に対応する${targetType === "item" ? "商品" : "選択肢"}がありません。`,
      projectedValue: `${projectedName} / ${yen(projectedPrice)}`,
      projectedState,
      confidence: platform.baselineStatus === "ready" ? "confirmed" : "provisional"
    });
    return;
  }
  const currentState = { name: baseline.name, price: baseline.price, isActive: baseline.isActive !== false, externalId: baseline.externalId ?? "" };
  if (!enabled && baseline.isActive !== false) {
    platform.changes.push({
      id: `${platformKey}:${targetType}:${target.id}:disable`,
      targetType,
      targetId: target.id,
      targetLabel: target.name,
      kind: "disable",
      summary: `${platform.platformName} では販売停止にします。`,
      currentValue: baseline.name,
      projectedValue: "販売停止",
      currentState,
      projectedState,
      confidence: "confirmed",
      requiresExplicitConfirmation: true
    });
    return;
  }
  if (!enabled) return;
  if (baseline.isActive === false) {
    platform.changes.push({
      id: `${platformKey}:${targetType}:${target.id}:update`,
      targetType,
      targetId: target.id,
      targetLabel: target.name,
      kind: "update",
      summary: `${platform.platformName} で販売を再開します。`,
      currentValue: "販売停止",
      projectedValue: projectedName,
      currentState,
      projectedState,
      confidence: "confirmed"
    });
  }
  if (projectedName !== baseline.name) {
    platform.changes.push({
      id: `${platformKey}:${targetType}:${target.id}:rename`,
      targetType,
      targetId: target.id,
      targetLabel: target.name,
      kind: "rename",
      summary: `${platform.platformName} の名称を更新します。`,
      currentValue: baseline.name,
      projectedValue: projectedName,
      currentState,
      projectedState,
      confidence: "confirmed"
    });
  }
  const sourceBaseChanged = baseline.sourceBasePrice === undefined
    || baseline.sourceBasePrice === null
    || Number(baseline.sourceBasePrice) !== Number(basePrice);
  if (sourceBaseChanged && projectedPrice !== null && Number(projectedPrice) !== Number(baseline.price)) {
    platform.changes.push({
      id: `${platformKey}:${targetType}:${target.id}:reprice`,
      targetType,
      targetId: target.id,
      targetLabel: target.name,
      kind: "reprice",
      summary: setting?.priceOverride !== undefined && setting.priceOverride !== null
        ? "プラットフォーム個別価格を反映します。"
        : `基礎価格から ${rule.priceMultiplier} 倍で算出した価格です。`,
      currentValue: yen(baseline.price),
      projectedValue: yen(projectedPrice),
      currentState,
      projectedState,
      confidence: setting?.priceOverride !== undefined && setting.priceOverride !== null ? "confirmed" : "provisional"
    });
  }
}

export function buildDeliveryMenuPublishPreview(input: BuildPreviewInput) {
  const baselines = normalizedBaseline(input);
  const rules = { ...deliveryPlatformRules, ...(input.platformRules ?? {}) };
  const activeEntries = [...input.items, ...input.options].filter((entry) => entry.isActive);
  const platforms = (Object.keys(deliveryPlatformRules) as DeliveryMenuPlatformKey[]).map((platformKey) => {
    const rule = rules[platformKey];
    const baseline = baselines[platformKey];
    const platform: MenuPublishPreviewPlatform = {
      platformKey,
      platformName: rule.name,
      ruleVersion: rule.ruleVersion,
      baselineStatus: baseline && baseline.complete !== false ? "ready" : "missing",
      baselineCapturedAt: baseline?.capturedAt ?? null,
      changes: [],
      warnings: [],
      blockers: []
    };
    const missingTranslations = missingRequiredTranslations(activeEntries, rule.requiredLanguages);
    if (missingTranslations > 0) platform.blockers.push(`商品・選択肢に必須翻訳の未入力が ${missingTranslations} 欄あります。`);
    if (!baseline) platform.blockers.push("現在のプラットフォームメニュー基準が未取込のため、正確な差分を確定できません。");
    else if (baseline.complete === false) platform.blockers.push(`基準取込で一致しない対象が ${baseline.missingTargets?.length ?? 0}件あるため、誤操作防止のため配信を停止しています。`);

    for (const item of input.items) {
      compareTarget({
        platform,
        platformKey,
        rule,
        targetType: "item",
        target: item,
        baseline: findItemBaseline(item, baseline?.items ?? []),
        basePrice: item.basePrice,
        setting: item.platformSettings?.[platformKey]
      });
    }
    for (const option of input.options) {
      compareTarget({
        platform,
        platformKey,
        rule,
        targetType: "option",
        target: option,
        baseline: findOptionBaseline(option, baseline?.options ?? []),
        basePrice: option.priceDelta,
        setting: option.platformSettings?.[platformKey]
      });
    }

    if (baseline) {
      for (const entry of baseline.items) {
        if (!input.items.some((item) => entry.targetId === item.id || (entry.externalId && entry.externalId === item.externalId))) {
          platform.changes.push({
            id: `${platformKey}:orphan:item:${entry.externalId ?? entry.name}`,
            targetType: "item",
            targetLabel: entry.name,
            kind: "delete",
            summary: "OS に対応商品がないプラットフォーム既存商品です。自動削除しません。",
            currentValue: entry.name,
            confidence: "confirmed",
            requiresExplicitConfirmation: true
          });
        }
      }
      for (const entry of baseline.options) {
        if (!input.options.some((option) => entry.targetId === option.id || (entry.groupKey === option.groupKey && entry.optionKey === option.optionKey))) {
          platform.changes.push({
            id: `${platformKey}:orphan:option:${entry.externalId ?? `${entry.groupKey}:${entry.optionKey}`}`,
            targetType: "option",
            targetLabel: entry.name,
            kind: "delete",
            summary: "OS に対応選択肢がないプラットフォーム既存データです。自動削除しません。",
            currentValue: entry.name,
            confidence: "confirmed",
            requiresExplicitConfirmation: true
          });
        }
      }
    }

    if (platformKey === "rocket_now") {
      const standardCount = input.options.filter((option) => option.isActive && option.groupKey === "standard").length;
      if (standardCount > rule.groupLimits.standard) {
        platform.warnings.push(`Standard Topping は Rocket で ${rule.groupLimits.standard}件＋${standardCount - rule.groupLimits.standard}件に自動分割されます。`);
      }
    }
    if (platformKey === "demae_can") {
      platform.warnings.push("商品種別に応じて「選択面・変更面・選択冷面」を変換し、調味の直後に配置します。");
    }
    addPendingTaskChanges(platform, input.pendingTasksByPlatform[platformKey] ?? []);
    platform.changes.sort((left, right) => left.kind.localeCompare(right.kind) || left.targetLabel.localeCompare(right.targetLabel, "ja"));
    return platform;
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: "read_only" as const,
    platforms
  };
}
