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

type MaamaaReferenceMode = "basic" | "set";

type MaamaaPlanLine = {
  id: string;
  title: string;
  detail: string;
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
  if (source === "base") return isChinese ? "基础款" : "基本";
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
    source: "set",
    categoryKey: skuCategoryKey(item.productCategory, item.productSubcategory),
    categoryLabel: skuCategoryLabel(item.productCategory, item.productSubcategory, false),
    notes: item.note
  };
}

function buildAddPlanLine(rule: MaamaaProductionRule, key: string): MaamaaPlanLine {
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

function MaamaaProductionReference({ language, settings }: { language: MaamaaReferenceLanguage; settings: MaamaaProductionReferenceSettings }) {
  const isChinese = language === "zh";
  const [mode, setMode] = useState<MaamaaReferenceMode>("basic");
  const setMenuRules = settings.setRules.filter((rule) => rule.name !== "セットメニュー共通" && rule.name !== "複数杯注文");
  const [selectedSetName, setSelectedSetName] = useState(setMenuRules[0]?.name ?? "");
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const t = (value: string | undefined) => translateMaamaaReferenceText(value, language);
  const getSetItems = (rule: MaamaaSetRule) => rule.items?.length ? rule.items.map(formatMaamaaSetItem) : rule.defaultItems;
  const operationRules = settings.setRules.filter((rule) => rule.name === "複数杯注文");
  const selectableRules = settings.productionRules.filter((rule) => maamaaSelectableSections.includes(rule.section));
  const selectedSet = setMenuRules.find((rule) => rule.name === selectedSetName) ?? setMenuRules[0];
  useEffect(() => {
    if (setMenuRules.length && !setMenuRules.some((rule) => rule.name === selectedSetName)) {
      setSelectedSetName(setMenuRules[0].name);
    }
  }, [selectedSetName, setMenuRules]);
  const selectedAddOnRules = selectableRules
    .map((rule, index) => ({ rule, key: maamaaReferenceItemKey(rule, index) }))
    .filter((entry) => selectedAddOns.includes(entry.key));
  const setLines = mode === "set" && selectedSet
    ? selectedSet.items?.length
      ? selectedSet.items.map((item, index) => buildStructuredSetPlanLine(item, index))
      : getSetItems(selectedSet).map((item, index) => buildSetPlanLine(item, index, settings.productionRules))
    : [];
  const addLines = selectedAddOnRules.map(({ rule, key }) => buildAddPlanLine(rule, key));
  const planLines = groupPlanLines([...setLines, ...addLines]);
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

  function toggleAddOn(key: string) {
    setSelectedAddOns((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
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
        <span>{isChinese ? "基础款不含任何食材。套餐内食材按套餐用量，额外追加食材按单点追加用量。更换面类时替换默认宽粉50g；追加宽粉则另加50g。" : "基本は具材なし。セット内具材はセット用量、追加具材は単品追加用量で作る。麺変更は基本の板春雨50gの置き換え、板春雨追加は別途50g追加。"}</span>
      </div>

      <div className="maamaa-reference-workbench">
        <section className="maamaa-reference-builder">
          <div className="maamaa-reference-mode-tabs" role="tablist" aria-label={isChinese ? "选择制作类型" : "制作タイプ"}>
            <button className={mode === "basic" ? "is-active" : ""} type="button" onClick={() => setMode("basic")}>
              <strong>{isChinese ? "基础款" : "基本"}</strong>
              <span>{isChinese ? "只有汤底，食材全是追加" : "具材なし、追加のみ"}</span>
            </button>
            <button className={mode === "set" ? "is-active" : ""} type="button" onClick={() => setMode("set")}>
              <strong>{isChinese ? "套餐" : "セット"}</strong>
              <span>{isChinese ? "先带套餐固定食材" : "セット具材あり"}</span>
            </button>
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
              <strong>{isChinese ? "基础款" : "基本"}</strong>
              <span>{isChinese ? "不自动包含任何食材。下面选择的产品都会按单点追加用量显示。" : "自動で入る具材はありません。下で選んだ商品は単品追加用量で表示します。"}</span>
            </div>
          )}

          <div className="maamaa-reference-product-picker">
            <div className="maamaa-reference-editor-heading">
              <h4>{isChinese ? "选择追加产品" : "追加商品を選択"}</h4>
              {selectedAddOns.length ? (
                <button className="text-button" type="button" onClick={() => setSelectedAddOns([])}>{isChinese ? "清空" : "クリア"}</button>
              ) : null}
            </div>
            {groupedSelectableRules.map((category) => (
              <section className="maamaa-reference-picker-group" key={category.key}>
                <h5>{category.label}</h5>
                <div>
                  {category.rules.map(({ rule, key }) => (
                    <button className={selectedAddOns.includes(key) ? "is-selected" : ""} type="button" key={key} onClick={() => toggleAddOn(key)}>
                      <strong>{t(rule.customerName)}</strong>
                      <span>{t(rule.kitchenName)}{rule.quantity ? ` / ${rule.quantity}` : ""}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>

        <section className="maamaa-reference-plan">
          <div className="maamaa-reference-plan-heading">
            <div>
              <p>{mode === "basic" ? (isChinese ? "基础款制作清单" : "基本の制作リスト") : t(selectedSet?.name)}</p>
              <h3>{isChinese ? "按厨房分类排列" : "厨房分類順"}</h3>
            </div>
            <span>{isChinese ? `${setLines.length}个套餐内 / ${addLines.length}个追加` : `セット内 ${setLines.length} / 追加 ${addLines.length}`}</span>
          </div>

          <section className="maamaa-reference-section">
            <h3>{t("辛さ・味変")}</h3>
            <div className="maamaa-reference-rule-grid">
              {settings.seasoningRules.map((rule) => (
                <article className="maamaa-reference-rule" key={rule.name}>
                  <strong>{t(rule.name)}</strong>
                  <p>{rule.lines.map((line) => t(line)).join(" / ")}</p>
                  <small>{isChinese ? "调味 / 汤底选项" : "味付け / スープオプション"}</small>
                </article>
              ))}
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
                      <p>{t(line.detail)}</p>
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
