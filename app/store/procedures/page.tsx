"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChefHat,
  CheckCircle2,
  Clock3,
  Package,
  Minus,
  Plus,
  Search
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  defaultMaamaaProductionReferenceSettings,
  findMaamaaProductionRule,
  formatMaamaaSetItem,
  type MaamaaProductionRule,
  type MaamaaProductionReferenceSettings,
  type MaamaaReferenceLanguage,
  type MaamaaSetItem,
  type MaamaaSetRule,
  translateMaamaaReferenceText
} from "../../../lib/maamaa-production-rules";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { StoreNavTabs } from "../components/StoreNavTabs";

type ProcedureProduct = {
  id: string;
  productId: string;
  productName: string;
  japaneseNote: string;
  category: string;
  subcategory: string;
  photoUrl: string;
  quantity: number | null;
  unit: string;
  note: string;
};

type ProcedureStep = {
  id: string;
  sortOrder: number;
  title: string;
  instruction: string;
  caution: string;
  estimatedMinutes: number | null;
  mediaUrl: string;
  products: ProcedureProduct[];
};

type ProcedureBook = {
  id: string;
  title: string;
  category: string;
  summary: string;
  brand: string;
  status: string;
  stores: Array<{ id: string; name: string }>;
  steps: ProcedureStep[];
  versionNumber: number;
};

function formatQuantity(value: number | null, unit: string) {
  if (value === null || value === undefined) return unit || "";
  return `${value.toLocaleString("ja-JP", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`;
}

export default function ProcedureReaderPage() {
  const [procedures, setProcedures] = useState<ProcedureBook[]>([]);
  const [selectedBookId, setSelectedBookId] = useState("maamaa-production-reference");
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [maamaaReferenceSettings, setMaamaaReferenceSettings] = useState<MaamaaProductionReferenceSettings>(defaultMaamaaProductionReferenceSettings);
  const { language: osLanguage } = useOsTranslation();
  const maamaaReferenceLanguage: MaamaaReferenceLanguage = osLanguage === "ja" ? "ja" : "zh";

  async function loadProcedures() {
    setLoading(true);
    const response = await fetch("/api/procedures");
    if (!response.ok) {
      setError("手順書を読み込めませんでした。");
      setLoading(false);
      return;
    }

    const data = await response.json() as { procedures?: ProcedureBook[] };
    const nextProcedures = data.procedures ?? [];
    setProcedures(nextProcedures);
    setSelectedBookId((current) => current || "maamaa-production-reference");
    setLoading(false);
  }

  async function loadMaamaaReference() {
    try {
      const response = await fetch("/api/procedures/maamaa-reference", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { settings?: MaamaaProductionReferenceSettings };
      if (data.settings) setMaamaaReferenceSettings(data.settings);
    } catch {
      // Keep the bundled default reference if custom settings cannot be loaded.
    }
  }

  useEffect(() => {
    void loadProcedures();
    void loadMaamaaReference();
  }, []);

  const filteredProcedures = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return procedures;
    return procedures.filter((procedure) => [
      procedure.title,
      procedure.category,
      procedure.summary,
      procedure.brand
    ].join(" ").toLowerCase().includes(normalizedQuery));
  }, [procedures, query]);

  const selectedBook = procedures.find((procedure) => procedure.id === selectedBookId) ?? filteredProcedures[0] ?? procedures[0];
  const showMaamaaReference = selectedBookId === "maamaa-production-reference";
  const selectedStep = selectedBook?.steps[selectedStepIndex] ?? selectedBook?.steps[0];
  const stepCount = selectedBook?.steps.length ?? 0;
  const progress = stepCount ? ((Math.min(selectedStepIndex + 1, stepCount) / stepCount) * 100) : 0;

  function selectBook(id: string) {
    setSelectedBookId(id);
    setSelectedStepIndex(0);
  }

  return (
    <main className="procedure-reader-shell">
      <header className="procedure-reader-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 STORE</p>
            <h1>手順書</h1>
          </div>
        </a>
        <StoreNavTabs active="procedures" />
      </header>

      <section className="procedure-reader-layout">
        <aside className="procedure-reader-list" aria-label="手順書一覧">
          <label className="search-box procedure-reader-search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="手順書を検索" />
          </label>

          <div className="procedure-reader-books">
            <button
              className={`procedure-reader-book ${showMaamaaReference ? "is-active" : ""}`}
              type="button"
              onClick={() => {
                setSelectedBookId("maamaa-production-reference");
                setSelectedStepIndex(0);
              }}
            >
              <span>マーラータン</span>
              <strong>まぁ麻 制作早見表</strong>
              <small>厨房ルール / 全店</small>
            </button>
            {filteredProcedures.map((procedure) => (
              <button
                className={`procedure-reader-book ${!showMaamaaReference && selectedBook?.id === procedure.id ? "is-active" : ""}`}
                type="button"
                key={procedure.id}
                onClick={() => selectBook(procedure.id)}
              >
                <span>{procedure.category}</span>
                <strong>{procedure.title}</strong>
                <small>{procedure.brand || "共通"} / {procedure.stores?.length ? `${procedure.stores.length}店舗` : "全店"}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="procedure-reader-main">
          {loading ? (
            <div className="procedure-reader-empty">読み込み中</div>
          ) : showMaamaaReference ? (
            <MaamaaProductionReference language={maamaaReferenceLanguage} settings={maamaaReferenceSettings} />
          ) : error ? (
            <div className="procedure-reader-empty">{error}</div>
          ) : !selectedBook ? (
            <div className="procedure-reader-empty">公開中の手順書はまだありません。</div>
          ) : (
            <>
              <div className="procedure-reader-heading">
                <div>
                  <p className="eyebrow">{selectedBook.category} / v{selectedBook.versionNumber}</p>
                  <h2>{selectedBook.title}</h2>
                  <p>{selectedBook.summary || "概要未設定"}</p>
                </div>
                <div className="procedure-reader-progress">
                  <span>{Math.min(selectedStepIndex + 1, stepCount)} / {stepCount}</span>
                  <div><i style={{ width: `${progress}%` }} /></div>
                </div>
              </div>

              <div className="procedure-step-tabs">
                {selectedBook.steps.map((step, index) => (
                  <button
                    className={index === selectedStepIndex ? "is-active" : ""}
                    type="button"
                    key={step.id}
                    onClick={() => setSelectedStepIndex(index)}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>

              {selectedStep ? (
                <article className="procedure-reader-step">
                  <div className="procedure-reader-step-copy">
                    <div className="procedure-reader-step-title">
                      <BookOpen size={24} />
                      <div>
                        <p>Step {selectedStepIndex + 1}</p>
                        <h3>{selectedStep.title}</h3>
                      </div>
                    </div>
                    <p className="procedure-reader-instruction">{selectedStep.instruction || "作業内容未設定"}</p>
                    {selectedStep.caution ? (
                      <div className="procedure-reader-caution">
                        <AlertTriangle size={18} />
                        <span>{selectedStep.caution}</span>
                      </div>
                    ) : null}
                    {selectedStep.estimatedMinutes ? (
                      <div className="procedure-reader-time">
                        <Clock3 size={18} />
                        目安 {selectedStep.estimatedMinutes}分
                      </div>
                    ) : null}
                  </div>

                  <div className="procedure-reader-media">
                    {selectedStep.mediaUrl ? (
                      <img src={selectedStep.mediaUrl} alt="" />
                    ) : (
                      <div>
                        <CheckCircle2 size={42} />
                        <span>作業内容を確認</span>
                      </div>
                    )}
                  </div>
                </article>
              ) : null}

              <div className="procedure-reader-controls">
                <button className="secondary-button" type="button" onClick={() => setSelectedStepIndex(Math.max(0, selectedStepIndex - 1))} disabled={selectedStepIndex <= 0}>
                  <ArrowLeft size={18} />
                  前へ
                </button>
                <button className="primary-button" type="button" onClick={() => setSelectedStepIndex(Math.min(stepCount - 1, selectedStepIndex + 1))} disabled={selectedStepIndex >= stepCount - 1}>
                  次へ
                  <ArrowRight size={18} />
                </button>
              </div>
            </>
          )}
        </section>

        <aside className="procedure-reader-products" aria-label="関連商品">
          {showMaamaaReference ? (
            <MaamaaProductionSideReference language={maamaaReferenceLanguage} settings={maamaaReferenceSettings} />
          ) : (
            <>
              <div className="procedure-reader-side-title">
                <Package size={18} />
                <strong>関連商品</strong>
              </div>
              {selectedStep?.products.length ? selectedStep.products.map((product) => (
                <article className="procedure-reader-product" key={product.id}>
                  {product.photoUrl ? <img src={product.photoUrl} alt="" /> : <div className="procedure-reader-product-fallback"><Package size={18} /></div>}
                  <div>
                    <strong>{product.productName}</strong>
                    <p>{product.japaneseNote || `${product.category} / ${product.subcategory}`}</p>
                    <small>{formatQuantity(product.quantity, product.unit)} {product.note}</small>
                  </div>
                </article>
              )) : (
                <p className="empty-state">このステップの関連商品はありません。</p>
              )}
            </>
          )}
        </aside>
      </section>
    </main>
  );
}

type MaamaaReferenceMode = "soup" | "set";

type MaamaaPlanLine = {
  id: string;
  title: string;
  detail: string;
  quantity: number;
  source: "base" | "set" | "add";
  categoryKey: string;
  categoryLabel: string;
  notes?: string;
};

const maamaaSelectableSections: MaamaaProductionRule["section"][] = ["noodles", "base", "standard", "premium", "vip", "request"];

function maamaaReferenceItemKey(rule: MaamaaProductionRule, index: number) {
  return rule.id || `${rule.section}-${rule.customerName}-${index}`;
}

function sourceLabel(source: MaamaaPlanLine["source"], isChinese: boolean) {
  if (source === "base") return isChinese ? "汤底" : "スープ";
  if (source === "set") return isChinese ? "套餐内" : "セット内";
  return isChinese ? "追加" : "追加";
}

function skuCategoryLabel(category: string | undefined, subcategory: string | undefined, isChinese: boolean) {
  const main = category?.trim();
  const sub = subcategory?.trim();
  if (!main && !sub) return isChinese ? "未关联SKU" : "SKU未連携";
  if (main && sub && sub !== "未分類") return `${main} / ${sub}`;
  return main || sub || (isChinese ? "未关联SKU" : "SKU未連携");
}

function skuCategoryKey(category: string | undefined, subcategory: string | undefined) {
  return `${category?.trim() || "__unlinked__"}::${subcategory?.trim() || ""}`;
}

function buildSetPlanLine(item: string, index: number, rules: MaamaaProductionRule[]): MaamaaPlanLine {
  const rule = findMaamaaProductionRule(item, rules);
  const category = rule ? skuCategoryLabel(rule.productCategory, rule.productSubcategory, false) : skuCategoryLabel(undefined, undefined, false);
  return {
    id: `set-${index}-${item}`,
    title: rule?.kitchenName || item,
    detail: item,
    quantity: 1,
    source: "set",
    categoryKey: rule ? skuCategoryKey(rule.productCategory, rule.productSubcategory) : skuCategoryKey(undefined, undefined),
    categoryLabel: category,
    notes: rule?.notes
  };
}

function buildStructuredSetPlanLine(item: MaamaaSetItem, index: number): MaamaaPlanLine {
  return {
    id: `set-${index}-${item.productId ?? item.productName}`,
    title: item.productName,
    detail: formatMaamaaSetItem(item),
    quantity: 1,
    source: "set",
    categoryKey: skuCategoryKey(item.productCategory, item.productSubcategory),
    categoryLabel: skuCategoryLabel(item.productCategory, item.productSubcategory, false),
    notes: item.note
  };
}

function buildAddPlanLine(rule: MaamaaProductionRule, key: string, quantity: number): MaamaaPlanLine {
  const cookType = rule.cookType ?? (rule.placement === "container" || rule.placement === "finish" ? "no_boil" : "boil");
  const category = skuCategoryLabel(rule.productCategory, rule.productSubcategory, false);
  return {
    id: `add-${key}`,
    title: rule.kitchenName,
    detail: [
      rule.quantity || "",
      rule.prep || "",
      rule.action || "",
      cookType === "no_boil" ? "加熱不要" : "",
      cookType !== "no_boil" && rule.minimumHeatMinutes ? `最低${rule.minimumHeatMinutes}分加熱` : "",
      rule.placement === "container" ? "容器へ" : "",
      rule.placement === "finish" ? "仕上げ" : ""
    ].filter(Boolean).join(" / ") || "分量要確認",
    quantity,
    source: "add",
    categoryKey: skuCategoryKey(rule.productCategory, rule.productSubcategory),
    categoryLabel: category,
    notes: rule.notes
  };
}

function groupPlanLines(lines: MaamaaPlanLine[]) {
  const groups = new Map<string, { key: string; label: string; lines: MaamaaPlanLine[] }>();
  for (const line of lines) {
    const current = groups.get(line.categoryKey) ?? { key: line.categoryKey, label: line.categoryLabel, lines: [] };
    current.lines.push(line);
    groups.set(line.categoryKey, current);
  }
  return Array.from(groups.values());
}

function seasoningDetail(rule: { lines: string[] } | undefined, translate: (value: string | undefined) => string) {
  if (!rule) return "";
  return rule.lines.map((line) => translate(line)).join(" / ");
}

function isFlavorRuleName(name: string) {
  return ["香酢", "サーチャージャン / 沙茶醤", "発酵豆腐タレ", "薬膳スパイス追加", "にんにくマシマシ"].includes(name);
}

function MaamaaProductionReference({ language, settings }: { language: MaamaaReferenceLanguage; settings: MaamaaProductionReferenceSettings }) {
  const isChinese = language === "zh";
  const [mode, setMode] = useState<MaamaaReferenceMode>("soup");
  const setMenuRules = useMemo(() => settings.setRules.filter((rule) => rule.name !== "セットメニュー共通" && rule.name !== "複数杯注文"), [settings.setRules]);
  const [selectedSetName, setSelectedSetName] = useState(setMenuRules[0]?.name ?? "");
  const soupRules = useMemo(() => settings.seasoningRules.filter((rule) => rule.name.includes("スープ")), [settings.seasoningRules]);
  const [selectedSoupName, setSelectedSoupName] = useState(soupRules[0]?.name ?? "旨味マーラータンスープ");
  const medicinalRules = useMemo(() => settings.seasoningRules.filter((rule) => rule.name.includes("薬膳スパイス") && !rule.name.includes("追加")), [settings.seasoningRules]);
  const heatRules = useMemo(() => settings.seasoningRules.filter((rule) => ["普通辛", "中辛", "大辛", "激辛", "鬼の一歩手前", "修羅の道", "地獄の業火"].includes(rule.name)), [settings.seasoningRules]);
  const numbRules = useMemo(() => settings.seasoningRules.filter((rule) => ["微シビ", "ちょいシビ", "シビレ", "ビリリ", "ビリビリ"].includes(rule.name)), [settings.seasoningRules]);
  const flavorRules = useMemo(() => settings.seasoningRules.filter((rule) => isFlavorRuleName(rule.name)), [settings.seasoningRules]);
  const [selectedMedicinalName, setSelectedMedicinalName] = useState(medicinalRules.find((rule) => rule.name.includes("なし"))?.name ?? medicinalRules[0]?.name ?? "");
  const [selectedHeatName, setSelectedHeatName] = useState("普通辛");
  const [selectedNumbName, setSelectedNumbName] = useState("");
  const [selectedFlavorNames, setSelectedFlavorNames] = useState<string[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, number>>({});
  const t = (value: string | undefined) => translateMaamaaReferenceText(value, language);
  const getSetItems = (rule: MaamaaSetRule) => rule.items?.length ? rule.items.map(formatMaamaaSetItem) : rule.defaultItems;
  const operationRules = useMemo(() => settings.setRules.filter((rule) => rule.name === "複数杯注文"), [settings.setRules]);
  const selectableRules = useMemo(() => settings.productionRules.filter((rule) => maamaaSelectableSections.includes(rule.section)), [settings.productionRules]);
  const selectedSet = setMenuRules.find((rule) => rule.name === selectedSetName) ?? setMenuRules[0];
  useEffect(() => {
    if (setMenuRules.length && !setMenuRules.some((rule) => rule.name === selectedSetName)) {
      setSelectedSetName(setMenuRules[0].name);
    }
  }, [selectedSetName, setMenuRules]);
  useEffect(() => {
    if (soupRules.length && !soupRules.some((rule) => rule.name === selectedSoupName)) {
      setSelectedSoupName(soupRules[0].name);
    }
    if (medicinalRules.length && selectedMedicinalName && !medicinalRules.some((rule) => rule.name === selectedMedicinalName)) {
      setSelectedMedicinalName(medicinalRules.find((rule) => rule.name.includes("なし"))?.name ?? medicinalRules[0].name);
    }
    if (heatRules.length && selectedHeatName && !heatRules.some((rule) => rule.name === selectedHeatName)) {
      setSelectedHeatName(heatRules[0].name);
    }
    if (numbRules.length && selectedNumbName && !numbRules.some((rule) => rule.name === selectedNumbName)) {
      setSelectedNumbName("");
    }
    setSelectedFlavorNames((current) => {
      const next = current.filter((name) => flavorRules.some((rule) => rule.name === name));
      return next.length === current.length ? current : next;
    });
  }, [flavorRules, heatRules, medicinalRules, numbRules, selectedHeatName, selectedMedicinalName, selectedNumbName, selectedSoupName, soupRules]);
  const selectedAddOnRules = selectableRules
    .map((rule, index) => ({ rule, key: maamaaReferenceItemKey(rule, index) }))
    .filter((entry) => (selectedAddOns[entry.key] ?? 0) > 0);
  const setLines = mode === "set" && selectedSet
    ? selectedSet.items?.length
      ? selectedSet.items.map((item, index) => buildStructuredSetPlanLine(item, index))
      : getSetItems(selectedSet).map((item, index) => buildSetPlanLine(item, index, settings.productionRules))
    : [];
  const addLines = selectedAddOnRules.map(({ rule, key }) => buildAddPlanLine(rule, key, selectedAddOns[key] ?? 1));
  const planLines = groupPlanLines([...setLines, ...addLines]);
  const selectedSoupRule = settings.seasoningRules.find((rule) => rule.name === selectedSoupName) ?? soupRules[0];
  const selectedMedicinalRule = settings.seasoningRules.find((rule) => rule.name === selectedMedicinalName);
  const selectedHeatRule = settings.seasoningRules.find((rule) => rule.name === selectedHeatName);
  const selectedNumbRule = settings.seasoningRules.find((rule) => rule.name === selectedNumbName);
  const selectedFlavorRules = selectedFlavorNames
    .map((name) => settings.seasoningRules.find((rule) => rule.name === name))
    .filter((rule): rule is typeof settings.seasoningRules[number] => Boolean(rule));
  const seasoningSelections = [
    selectedMedicinalRule,
    selectedHeatRule,
    selectedNumbRule,
    ...selectedFlavorRules
  ].filter((rule): rule is typeof settings.seasoningRules[number] => Boolean(rule));
  const groupedSelectableRules = Array.from(selectableRules
    .map((rule, index) => ({ rule, key: maamaaReferenceItemKey(rule, index) }))
    .reduce((groups, entry) => {
      const key = skuCategoryKey(entry.rule.productCategory, entry.rule.productSubcategory);
      const label = skuCategoryLabel(entry.rule.productCategory, entry.rule.productSubcategory, isChinese);
      const current = groups.get(key) ?? { key, label, rules: [] as Array<{ rule: MaamaaProductionRule; key: string }> };
      current.rules.push(entry);
      groups.set(key, current);
      return groups;
    }, new Map<string, { key: string; label: string; rules: Array<{ rule: MaamaaProductionRule; key: string }> }>()).values());

  function setAddOnQuantity(key: string, quantity: number) {
    const nextQuantity = Math.max(0, Math.min(99, Math.round(quantity)));
    setSelectedAddOns((current) => {
      const next = { ...current };
      if (nextQuantity <= 0) {
        delete next[key];
      } else {
        next[key] = nextQuantity;
      }
      return next;
    });
  }

  function toggleFlavor(name: string) {
    setSelectedFlavorNames((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }

  return (
    <div className="maamaa-production-reference" data-i18n-ignore>
      <div className="procedure-reader-heading">
        <div>
          <p className="eyebrow">{isChinese ? "麻辣烫 / 厨房规则" : "マーラータン / 厨房ルール"}</p>
          <h2>{isChinese ? "まぁ麻 制作速查表" : "まぁ麻 制作早見表"}</h2>
          <p>{isChinese ? "以菜单上架项目为基准，反映 SOP 和墙上照片里的制作内容。制作依据未确认的项目会保留并标记为需确认。" : "メニュー掲載項目を基準に、SOP・壁写真の制作内容を反映した一覧です。制作根拠が未確認の項目は要確認として残します。"}</p>
        </div>
        <div className="procedure-reader-progress">
          <span>初版</span>
          <div><i style={{ width: "45%" }} /></div>
        </div>
      </div>

      <div className="maamaa-reference-alert">
        <ChefHat size={20} />
        <span>{isChinese ? "汤底产品只有汤，不含任何食材。小锅煮食材时加入自制高汤，煮好后连高汤和食材一起倒入容器，与基础底料和辅助料轻轻搅拌后打包。" : "スープ商品は具材なし。小鍋では自家製高湯で具材を煮て、煮上がったら高湯ごと容器に注ぎ、ベース調味料・補助調味料と軽く混ぜて包装します。"}</span>
      </div>

      <div className="maamaa-reference-workbench">
        <section className="maamaa-reference-builder">
          <div className="maamaa-reference-mode-tabs" role="tablist" aria-label={isChinese ? "选择制作类型" : "制作タイプ"}>
            <button className={mode === "soup" ? "is-active" : ""} type="button" onClick={() => setMode("soup")}>
              <strong>{isChinese ? "汤底" : "スープ"}</strong>
              <span>{isChinese ? "不含食材，食材全是追加" : "具材なし、追加のみ"}</span>
            </button>
            <button className={mode === "set" ? "is-active" : ""} type="button" onClick={() => setMode("set")}>
              <strong>{isChinese ? "套餐" : "セット"}</strong>
              <span>{isChinese ? "先带套餐固定食材" : "セット具材あり"}</span>
            </button>
          </div>

          <div className="maamaa-reference-seasoning-picker">
            <label>
              <span>{isChinese ? "汤底" : "スープ"}</span>
              <select value={selectedSoupRule?.name ?? selectedSoupName} onChange={(event) => setSelectedSoupName(event.target.value)}>
                {(soupRules.length ? soupRules : [{ name: "旨味マーラータンスープ", lines: [] }]).map((rule) => (
                  <option value={rule.name} key={rule.name}>{t(rule.name)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{isChinese ? "药膳" : "薬膳"}</span>
              <select value={selectedMedicinalName} onChange={(event) => setSelectedMedicinalName(event.target.value)}>
                <option value="">{isChinese ? "未选择" : "未選択"}</option>
                {medicinalRules.map((rule) => <option value={rule.name} key={rule.name}>{t(rule.name)}</option>)}
              </select>
            </label>
            <label>
              <span>{isChinese ? "辣度" : "辛さ"}</span>
              <select value={selectedHeatName} onChange={(event) => setSelectedHeatName(event.target.value)}>
                <option value="">{isChinese ? "未选择" : "未選択"}</option>
                {heatRules.map((rule) => <option value={rule.name} key={rule.name}>{t(rule.name)}</option>)}
              </select>
            </label>
            <label>
              <span>{isChinese ? "麻度" : "痺れ"}</span>
              <select value={selectedNumbName} onChange={(event) => setSelectedNumbName(event.target.value)}>
                <option value="">{isChinese ? "未选择" : "未選択"}</option>
                {numbRules.map((rule) => <option value={rule.name} key={rule.name}>{t(rule.name)}</option>)}
              </select>
            </label>
            {flavorRules.length ? (
              <div className="maamaa-reference-flavor-options">
                <span>{isChinese ? "加其他料 / 味变" : "追加調味 / 味変"}</span>
                <div>
                  {flavorRules.map((rule) => (
                    <button className={selectedFlavorNames.includes(rule.name) ? "is-selected" : ""} type="button" key={rule.name} onClick={() => toggleFlavor(rule.name)}>
                      {t(rule.name)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {mode === "set" ? (
            <div className="maamaa-reference-set-picker">
              <label>
                <span>{isChinese ? "套餐名" : "セット名"}</span>
                <select value={selectedSet?.name ?? ""} onChange={(event) => setSelectedSetName(event.target.value)}>
                  {setMenuRules.map((rule) => <option value={rule.name} key={rule.name}>{t(rule.name)}</option>)}
                </select>
              </label>
              {selectedSet?.notes ? <p>{t(selectedSet.notes)}</p> : null}
            </div>
          ) : (
            <div className="maamaa-reference-basic-note">
              <strong>{isChinese ? "汤底产品" : "スープ商品"}</strong>
              <span>{isChinese ? "不自动包含任何食材。下面选择的产品都会按单点追加用量显示。" : "自動で入る具材はありません。下で選んだ商品は単品追加用量で表示します。"}</span>
            </div>
          )}

          <div className="maamaa-reference-product-picker">
            <div className="maamaa-reference-editor-heading">
              <h4>{isChinese ? "选择追加产品" : "追加商品を選択"}</h4>
              {Object.keys(selectedAddOns).length ? (
                <button className="text-button" type="button" onClick={() => setSelectedAddOns({})}>{isChinese ? "清空" : "クリア"}</button>
              ) : null}
            </div>
            {groupedSelectableRules.map((category) => (
              <section className="maamaa-reference-picker-group" key={category.key}>
                <h5>{category.label}</h5>
                <div>
                  {category.rules.map(({ rule, key }) => (
                    <article className={`maamaa-reference-picker-item ${(selectedAddOns[key] ?? 0) > 0 ? "is-selected" : ""}`} key={key}>
                      <button type="button" onClick={() => setAddOnQuantity(key, (selectedAddOns[key] ?? 0) + 1)}>
                        <strong>{t(rule.customerName)}</strong>
                        <span>{t(rule.kitchenName)}{rule.quantity ? ` / ${rule.quantity}` : ""}</span>
                      </button>
                      <div className="maamaa-reference-quantity-stepper" aria-label={t(rule.customerName)}>
                        <button type="button" onClick={() => setAddOnQuantity(key, (selectedAddOns[key] ?? 0) - 1)} disabled={(selectedAddOns[key] ?? 0) <= 0} aria-label={isChinese ? "减少" : "減らす"}>
                          <Minus size={14} />
                        </button>
                        <strong>{selectedAddOns[key] ?? 0}</strong>
                        <button type="button" onClick={() => setAddOnQuantity(key, (selectedAddOns[key] ?? 0) + 1)} aria-label={isChinese ? "增加" : "増やす"}>
                          <Plus size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>

        <section className="maamaa-reference-plan">
          <div className="maamaa-reference-plan-heading">
            <div>
              <p>{mode === "soup" ? t(selectedSoupRule?.name ?? selectedSoupName) : t(selectedSet?.name)}</p>
              <h3>{isChinese ? "制作流程" : "制作フロー"}</h3>
            </div>
            <span>{isChinese ? `${setLines.length}个套餐内 / ${addLines.reduce((sum, line) => sum + line.quantity, 0)}个追加` : `セット内 ${setLines.length} / 追加 ${addLines.reduce((sum, line) => sum + line.quantity, 0)}`}</span>
          </div>

          <section className="maamaa-reference-flow">
            <article>
              <span>1</span>
              <div>
                <strong>{isChinese ? "容器：放基础底料" : "容器：ベース調味料を入れる"}</strong>
                <p>{isChinese ? "先把基础底料放入出餐容器。" : "先にベース調味料を提供容器に入れます。"}</p>
              </div>
            </article>
            <article>
              <span>2</span>
              <div>
                <strong>{isChinese ? "容器：加入客人选择的辅助料" : "容器：選択された補助調味料を入れる"}</strong>
                {seasoningSelections.length ? (
                  <div className="maamaa-reference-seasoning-lines">
                    {seasoningSelections.map((rule) => (
                      <p key={rule.name}><b>{t(rule.name)}</b>{seasoningDetail(rule, t) ? ` / ${seasoningDetail(rule, t)}` : ""}</p>
                    ))}
                  </div>
                ) : (
                  <p>{isChinese ? "未选择辅助料。" : "補助調味料は未選択です。"}</p>
                )}
              </div>
            </article>
            <article>
              <span>3</span>
              <div>
                <strong>{isChinese ? "小锅：加入自制高汤" : "小鍋：自家製高湯を入れる"}</strong>
                <p>{isChinese ? "煮食材时使用我们的自制高汤。" : "具材を煮る時は自家製高湯を使います。"}</p>
              </div>
            </article>
            <article>
              <span>4</span>
              <div>
                <strong>{isChinese ? "小锅：煮食材" : "小鍋：具材を煮る"}</strong>
                <p>{mode === "soup" ? (isChinese ? "汤底产品只煮客人追加食材。" : "スープ商品は追加具材だけを煮ます。") : (isChinese ? "套餐基础食材和客人追加食材一起煮。" : "セット具材と追加具材を一緒に煮ます。")}</p>
              </div>
            </article>
            <article>
              <span>5</span>
              <div>
                <strong>{isChinese ? "倒入容器，轻轻搅拌后打包" : "容器へ注ぎ、軽く混ぜて包装"}</strong>
                <p>{isChinese ? "煮好后把食材和高汤一起倒入容器，微微搅拌，让底料和高汤融合后打包。" : "煮上がった具材と高湯を容器に注ぎ、軽く混ぜてから包装します。"}</p>
              </div>
            </article>
          </section>

          <section className="maamaa-reference-section">
            <h3>{isChinese ? "食材清单（按SKU分类）" : "具材リスト（SKU分類順）"}</h3>
            <div className="maamaa-reference-stock-note">
              {mode === "soup"
                ? (isChinese ? "汤底产品没有套餐内食材，只显示追加食材。" : "スープ商品にはセット内具材はなく、追加具材だけを表示します。")
                : (isChinese ? "套餐内食材按套餐用量，追加食材按单点追加用量。" : "セット内具材はセット用量、追加具材は単品追加用量です。")}
            </div>
          </section>

          {planLines.length ? planLines.map((category) => (
            <section className="maamaa-reference-section" key={category.key}>
              <h3>{category.key.startsWith("__unlinked__") ? (isChinese ? "未关联SKU" : "SKU未連携") : category.label}</h3>
              <div className="maamaa-reference-plan-list">
                {category.lines.map((line) => (
                  <article className="maamaa-reference-plan-row" key={line.id}>
                    <span>{sourceLabel(line.source, isChinese)}</span>
                    <div>
                      <strong>{t(line.title)}</strong>
                      <p>{line.quantity > 1 ? `${t(line.detail)} / x${line.quantity}` : t(line.detail)}</p>
                      {line.notes ? <small>{t(line.notes)}</small> : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )) : (
            <div className="procedure-reader-empty">{isChinese ? "请选择追加产品，或切换到套餐。" : "追加商品を選択するか、セットに切り替えてください。"}</div>
          )}
        </section>
      </div>

      {operationRules.length ? (
        <div className="maamaa-reference-sections">
          <section className="maamaa-reference-section">
            <h3>{t("オペレーション")}</h3>
            <div className="maamaa-reference-rule-grid">
              {operationRules.map((rule) => (
                <article className="maamaa-reference-rule" key={rule.name}>
                  <strong>{t(rule.name)}</strong>
                  <p>{getSetItems(rule).map((item) => t(item)).join(" / ")}</p>
                  {rule.notes ? <small>{t(rule.notes)}</small> : null}
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function MaamaaProductionSideReference({ language, settings }: { language: MaamaaReferenceLanguage; settings: MaamaaProductionReferenceSettings }) {
  const isChinese = language === "zh";
  const t = (value: string | undefined) => translateMaamaaReferenceText(value, language);
  const getSetItems = (rule: MaamaaSetRule) => rule.items?.length ? rule.items.map(formatMaamaaSetItem) : rule.defaultItems;
  const setMenuRules = settings.setRules.filter((rule) => rule.name !== "セットメニュー共通" && rule.name !== "複数杯注文");
  return (
    <div data-i18n-ignore>
      <div className="procedure-reader-side-title">
        <ChefHat size={18} />
        <strong>{isChinese ? "套餐" : "セットメニュー"}</strong>
      </div>
      <div className="maamaa-side-reference">
        {setMenuRules.map((rule) => (
          <article key={rule.name}>
            <strong>{t(rule.name)}</strong>
            <p>{getSetItems(rule).map((item) => t(item)).join(" / ")}</p>
            {rule.notes ? <small>{t(rule.notes)}</small> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
