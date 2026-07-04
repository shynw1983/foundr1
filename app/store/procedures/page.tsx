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
  formatMaamaaSetItem,
  type MaamaaProductionReferenceSettings,
  type MaamaaReferenceLanguage,
  type MaamaaSetRule,
  maamaaProductionReferenceSections,
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

function MaamaaProductionReference({ language, settings }: { language: MaamaaReferenceLanguage; settings: MaamaaProductionReferenceSettings }) {
  const sections = maamaaProductionReferenceSections(settings.productionRules);
  const isChinese = language === "zh";
  const t = (value: string | undefined) => translateMaamaaReferenceText(value, language);
  const getSetItems = (rule: MaamaaSetRule) => rule.items?.length ? rule.items.map(formatMaamaaSetItem) : rule.defaultItems;
  const operationRules = settings.setRules.filter((rule) => rule.name === "複数杯注文");
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
        <span>{isChinese ? "套餐不只放追加加料，也必须放入墙上写的套餐基础食材。更换面类时替换默认宽粉50g；追加宽粉则另加50g。" : "套餐は追加トッピングだけでなく、壁のセット具材も必ず入れる。麺変更は基本の板春雨50gの置き換え、板春雨追加は別途50g追加。"}</span>
      </div>

      <div className="maamaa-reference-sections">
        {sections.map((section) => (
          <section className="maamaa-reference-section" key={section.id}>
            <h3>{t(section.title)}</h3>
            <div className="maamaa-reference-rule-grid">
              {section.rules.map((rule) => (
                <article className="maamaa-reference-rule" key={`${rule.section}-${rule.customerName}`}>
                  <strong>{t(rule.customerName)}</strong>
                  <p>{t(rule.kitchenName)}{rule.quantity ? ` / ${rule.quantity}` : ""}</p>
                  <small>
                    {[
                      (rule.cookType ?? (rule.placement === "container" || rule.placement === "finish" ? "no_boil" : "boil")) === "no_boil"
                        ? (isChinese ? "不需要煮" : "煮込まない")
                        : (isChinese ? "需要煮" : "要煮込み"),
                      t(rule.prep),
                      t(rule.action),
                      (rule.cookType ?? (rule.placement === "container" || rule.placement === "finish" ? "no_boil" : "boil")) !== "no_boil" && rule.minimumHeatMinutes ? (isChinese ? `至少加热${rule.minimumHeatMinutes}分钟` : `最低${rule.minimumHeatMinutes}分加熱`) : "",
                      rule.placement === "container" ? (isChinese ? "放入容器" : "容器へ") : "",
                      t(rule.notes)
                    ]
                      .filter(Boolean)
                      .join(" / ") || (isChinese ? "常规处理" : "通常調理")}
                  </small>
                </article>
              ))}
            </div>
          </section>
        ))}
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
        {operationRules.length ? (
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
        ) : null}
      </div>
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
