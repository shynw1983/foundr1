"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, LogOut, MessageSquareWarning, PackageCheck, Search, Store, Truck, UserCog } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { products as initialProducts } from "../../../lib/mock-data";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OpsNavList } from "../components/OpsNavList";
import { UserBadge } from "../components/UserBadge";

type Product = typeof initialProducts[number] & {
  id?: string;
  packageQuantity?: number | string;
  packageQuantityUnit?: string;
  packageSpec?: string;
  referencePrice?: number;
  subcategory?: string;
};
type ProductComparison = {
  id: string;
  baseProductId: string;
  baseProductName: string;
  basePackageSpec: string;
  candidateProductName: string;
  candidateSupplierName: string;
  candidateOrigin: string;
  candidatePrice: number;
  candidateOriginalPrice: number;
  candidateCurrency: string;
  exchangeRate: number;
  candidateQuantity: number;
  candidateUnit: string;
  candidateWeightKg: number;
  importQuantity: number;
  freightRatePerKg: number;
  freightRateOriginalPerKg: number;
  basePrice: number;
  baseQuantity: number;
  baseUnit: string;
  isImported: boolean;
  freightCost: number;
  taxCost: number;
  otherCost: number;
  photoUrl: string;
  note: string;
  createdBy: string;
  createdById: string;
  createdLabel: string;
  canEdit: boolean;
  canDelete: boolean;
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "発注依頼", href: "/ops/orders", icon: PackageCheck },
  { label: "発注管理", href: "/ops/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/ops/history", icon: FileText },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes },
  { label: "店舗・ブランド", href: "/ops/stores", icon: Store },
  { label: "スタッフ管理", href: "/ops/staff", icon: UserCog },
  { label: "発注先管理", href: "/ops/suppliers", icon: Truck },
  { label: "現場記録", href: "/ops/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/ops/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/ops/reports", icon: MessageSquareWarning },
  { label: "ログアウト", href: "/ops/logout", icon: LogOut }
];

const comparisonUnits = ["g", "kg", "ml", "L", "個", "袋", "箱"];

export default function ProductComparisonsPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const formRef = useRef<HTMLFormElement>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [comparisons, setComparisons] = useState<ProductComparison[]>([]);
  const [query, setQuery] = useState("");
  const [baseCategory, setBaseCategory] = useState("");
  const [baseSubcategory, setBaseSubcategory] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [baseQuantity, setBaseQuantity] = useState("1");
  const [baseUnit, setBaseUnit] = useState("g");
  const [isImported, setIsImported] = useState(false);
  const [candidateCurrency, setCandidateCurrency] = useState("JPY");
  const [exchangeRate, setExchangeRate] = useState("1");
  const [exchangeRateLabel, setExchangeRateLabel] = useState("");
  const [candidatePrice, setCandidatePrice] = useState("");
  const [candidateQuantity, setCandidateQuantity] = useState("1");
  const [candidateUnit, setCandidateUnit] = useState("g");
  const [candidateWeightKg, setCandidateWeightKg] = useState("");
  const [importQuantity, setImportQuantity] = useState("1");
  const [freightRatePerKg, setFreightRatePerKg] = useState("");
  const [taxCost, setTaxCost] = useState("");
  const [otherCost, setOtherCost] = useState("");
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");
  const [photoFileName, setPhotoFileName] = useState("");
  const [editingComparisonId, setEditingComparisonId] = useState("");

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!isImported) {
    setCandidateCurrency("JPY");
    setExchangeRate("1");
    setExchangeRateLabel("");
    return;
  }

    if (candidateCurrency === "JPY") {
      setCandidateCurrency("CNY");
      void loadExchangeRate("CNY");
    }
  }, [candidateCurrency, isImported]);

  const selectedProduct = products.find((product) => product.id === selectedProductId);
  const baseCategories = useMemo(
    () => uniqueSorted(products.map((product) => product.category || "未分類")),
    [products]
  );
  const baseSubcategories = useMemo(() => {
    const scopedProducts = products.filter((product) => !baseCategory || (product.category || "未分類") === baseCategory);
    return uniqueSorted(scopedProducts.map((product) => product.subcategory || "未分類"));
  }, [baseCategory, products]);
  const baseProductOptions = useMemo(
    () => [...products]
      .filter((product) => !baseCategory || (product.category || "未分類") === baseCategory)
      .filter((product) => !baseSubcategory || (product.subcategory || "未分類") === baseSubcategory)
      .sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [baseCategory, baseSubcategory, products]
  );
  const importCount = Math.max(1, normalizeNumber(importQuantity));
  const activeExchangeRate = candidateCurrency === "JPY" ? 1 : Math.max(0, normalizeNumber(exchangeRate));
  const candidatePriceJpy = normalizeNumber(candidatePrice) * activeExchangeRate;
  const freightRatePerKgJpy = normalizeNumber(freightRatePerKg) * activeExchangeRate;
  const requiresCandidateWeight = isImported && candidateUnit === "箱";
  const candidateTotalWeightKg = inferCandidateTotalWeightKg(candidateUnit, candidateQuantity, candidateWeightKg, importCount);
  const candidateFreight = freightRatePerKgJpy * candidateTotalWeightKg;
  const candidateTotal = (candidatePriceJpy * importCount) + candidateFreight + normalizeNumber(taxCost) + normalizeNumber(otherCost);
  const candidateUnitCost = candidateTotal / Math.max(1, normalizeNumber(candidateQuantity) * importCount);
  const baseUnitCost = normalizeNumber(basePrice) / Math.max(1, normalizeNumber(baseQuantity));
  const savingRate = baseUnitCost > 0 ? ((candidateUnitCost - baseUnitCost) / baseUnitCost) * 100 : 0;

  async function loadData() {
    const [dashboardResponse, comparisonResponse] = await Promise.all([
      fetch("/api/dashboard"),
      fetch("/api/product-comparisons")
    ]);

    if (dashboardResponse.ok) {
      const data = await dashboardResponse.json() as { products?: Product[] };
      setProducts(data.products ?? []);
    }

    if (comparisonResponse.ok) {
      const data = await comparisonResponse.json() as { comparisons?: ProductComparison[] };
      setComparisons(data.comparisons ?? []);
    }

    setDataSource("neon");
  }

  async function loadExchangeRate(currency: string) {
    if (currency === "JPY") {
      setExchangeRate("1");
      setExchangeRateLabel("");
      return;
    }

    try {
      const response = await fetch(`/api/exchange-rates?base=${currency}&target=JPY`);
      if (!response.ok) throw new Error("rate fetch failed");
      const data = await response.json() as { rate?: number; date?: string };
      if (!Number.isFinite(data.rate) || !data.rate) throw new Error("invalid rate");
      setExchangeRate(String(data.rate));
      setExchangeRateLabel(data.date ? `取得日 ${data.date}` : "最新レート");
    } catch {
      setExchangeRateLabel("為替レートを取得できませんでした。手入力してください。");
    }
  }

  const filteredComparisons = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return comparisons;

    return comparisons.filter((comparison) =>
      [
        comparison.baseProductName,
        comparison.candidateProductName,
        comparison.candidateSupplierName,
        comparison.candidateOrigin,
        comparison.note,
        comparison.createdBy
      ].join(" ").toLowerCase().includes(keyword)
    );
  }, [comparisons, query]);

  function selectBaseCategory(category: string) {
    setBaseCategory(category);
    setBaseSubcategory("");
    selectBaseProduct("");
  }

  function selectBaseSubcategory(subcategory: string) {
    setBaseSubcategory(subcategory);
    selectBaseProduct("");
  }

  function selectBaseProduct(productId: string) {
    setSelectedProductId(productId);
    const product = products.find((item) => item.id === productId);
    if (!product) {
      setBasePrice("");
      setBaseQuantity("1");
      setBaseUnit("g");
      setCandidateUnit("g");
      return;
    }

    setBasePrice(String(product.referencePrice ?? 0));
    const inferred = getProductSpecQuantity(product);
    setBaseQuantity(String(inferred.quantity));
    setBaseUnit(inferred.unit);
    setCandidateUnit(inferred.unit);
  }

  async function createComparison(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("basePrice", basePrice);
    formData.set("baseQuantity", baseQuantity);
    formData.set("baseUnit", baseUnit);
    formData.set("isImported", String(isImported));
    formData.set("candidateCurrency", candidateCurrency);
    formData.set("exchangeRate", exchangeRate);
    formData.set("candidatePrice", candidatePrice);
    formData.set("candidateQuantity", candidateQuantity);
    formData.set("candidateUnit", candidateUnit);
    formData.set("candidateWeightKg", candidateWeightKg);
    formData.set("importQuantity", importQuantity);
    formData.set("freightRatePerKg", freightRatePerKg);
    formData.set("taxCost", taxCost);
    formData.set("otherCost", otherCost);

    if (editingComparisonId) formData.set("id", editingComparisonId);

    const response = await fetch("/api/product-comparisons", {
      method: editingComparisonId ? "PATCH" : "POST",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "商品比較を保存できませんでした。");
      return;
    }

    resetComparisonForm();
    showNotice(editingComparisonId ? "商品比較を更新しました。" : "商品比較を保存しました。");
    await loadData();
  }

  function resetComparisonForm() {
    formRef.current?.reset();
    setEditingComparisonId("");
    setBaseCategory("");
    setBaseSubcategory("");
    setSelectedProductId("");
    setBasePrice("");
    setBaseQuantity("1");
    setBaseUnit("g");
    setIsImported(false);
    setCandidateCurrency("JPY");
    setExchangeRate("1");
    setExchangeRateLabel("");
    setCandidatePrice("");
    setCandidateQuantity("1");
    setCandidateUnit("g");
    setCandidateWeightKg("");
    setImportQuantity("1");
    setFreightRatePerKg("");
    setTaxCost("");
    setOtherCost("");
    setPhotoFileName("");
    setFormField("candidateProductName", "");
    setFormField("candidateSupplierName", "");
    setFormField("candidateOrigin", "");
    setFormField("note", "");
  }

  function setFormField(name: string, value: string) {
    const field = formRef.current?.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      field.value = value;
    }
  }

  function populateComparisonForm(comparison: ProductComparison, mode: "edit" | "copy") {
    const product = products.find((item) => item.id === comparison.baseProductId);
    setEditingComparisonId(mode === "edit" ? comparison.id : "");
    setBaseCategory(product?.category || "");
    setBaseSubcategory(product?.subcategory || "");
    setSelectedProductId(comparison.baseProductId);
    setBasePrice(String(comparison.basePrice ?? ""));
    setBaseQuantity(String(comparison.baseQuantity ?? "1"));
    setBaseUnit(comparison.baseUnit || "g");
    setIsImported(comparison.isImported);
    setCandidateCurrency(comparison.candidateCurrency || "JPY");
    setExchangeRate(String(comparison.exchangeRate || 1));
    setExchangeRateLabel(comparison.candidateCurrency !== "JPY" ? "保存済みレート" : "");
    setCandidatePrice(String(comparison.candidateOriginalPrice || comparison.candidatePrice || ""));
    setCandidateQuantity(String(comparison.candidateQuantity || "1"));
    setCandidateUnit(comparison.candidateUnit || "g");
    setCandidateWeightKg(String(comparison.candidateWeightKg || ""));
    setImportQuantity(String(comparison.importQuantity || "1"));
    setFreightRatePerKg(String(comparison.freightRateOriginalPerKg || comparison.freightRatePerKg || ""));
    setTaxCost(String(comparison.taxCost || ""));
    setOtherCost(String(comparison.otherCost || ""));
    setPhotoFileName("");
    setFormField("candidateProductName", comparison.candidateProductName);
    setFormField("candidateSupplierName", comparison.candidateSupplierName);
    setFormField("candidateOrigin", comparison.candidateOrigin);
    setFormField("note", comparison.note);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteComparison(comparison: ProductComparison) {
    if (!window.confirm(`${comparison.baseProductName} ⇔ ${comparison.candidateProductName} を削除しますか？`)) return;

    const response = await fetch("/api/product-comparisons", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: comparison.id })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "商品比較を削除できませんでした。");
      return;
    }

    showNotice("商品比較を削除しました。");
    await loadData();
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/ops" aria-label="ダッシュボードへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Ops</p>
            <h1>発注管理</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OpsNavList navItems={navItems} />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">現行品と候補品の単位コスト比較</p>
            <h2>商品比較</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "読み込み中"}</span>
          </div>
          <label className="search-box">
            <Search size={17} />
            <input value={query} placeholder="商品・発注先を検索" onChange={(event) => setQuery(event.target.value)} />
          </label>
        </header>

        <section className="workspace-grid recommendations-grid">
          <form ref={formRef} className="panel recommendation-form" onSubmit={createComparison}>
            <div className="panel-title">
              <div>
                <h3>{editingComparisonId ? "比較を編集" : "比較を追加"}</h3>
                <p>価格 ÷ 規格数量で単位コストを比較。輸入品は運賃・税費も加算</p>
              </div>
              {editingComparisonId ? <button type="button" className="secondary-button" onClick={resetComparisonForm}>新規に戻す</button> : null}
            </div>
            <div className="edit-fields">
              <div className="comparison-category-picker">
                <label>
                  <span>大分類</span>
                  <select value={baseCategory} onChange={(event) => selectBaseCategory(event.target.value)} required>
                    <option value="">選択してください</option>
                    {baseCategories.map((category) => (
                      <option value={category} key={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>小分類</span>
                  <select value={baseSubcategory} onChange={(event) => selectBaseSubcategory(event.target.value)} disabled={!baseCategory}>
                    <option value="">すべての小分類</option>
                    {baseSubcategories.map((subcategory) => (
                      <option value={subcategory} key={subcategory}>{subcategory}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>現行商品</span>
                  <select
                    name="baseProductId"
                    value={selectedProductId}
                    onChange={(event) => selectBaseProduct(event.target.value)}
                    disabled={!baseCategory}
                    required
                  >
                    <option value="">商品を選択</option>
                    {baseProductOptions.map((product) => (
                      <option value={product.id ?? ""} key={product.id ?? product.name}>{product.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedProduct ? <small className="form-hint">規格: {formatProductSpecSummary(selectedProduct)}</small> : null}
              <div className="comparison-inline-fields">
                <label>
                  <span>現行価格</span>
                  <input value={basePrice} inputMode="decimal" onChange={(event) => setBasePrice(event.target.value)} placeholder="例: 350" />
                </label>
                <label>
                  <span>現行規格数量</span>
                  <input value={baseQuantity} inputMode="decimal" onChange={(event) => setBaseQuantity(event.target.value)} placeholder="例: 500" />
                </label>
                <label>
                  <span>単位</span>
                  <select value={baseUnit} onChange={(event) => setBaseUnit(event.target.value)}>
                    {comparisonUnits.map((unit) => <option value={unit} key={unit}>{unit}</option>)}
                  </select>
                </label>
              </div>
              <label>
                <span>候補商品名</span>
                <input name="candidateProductName" placeholder="例: 緑豆春雨 500g" required />
              </label>
              <label>
                <span>候補購入先名</span>
                <input name="candidateSupplierName" placeholder="例: 輸入食品 A / 新しい卸業者名" />
              </label>
              <div className="comparison-inline-fields">
                <label>
                  <span>{isImported ? "候補金額" : "候補価格"}</span>
                  <input value={candidatePrice} inputMode="decimal" onChange={(event) => setCandidatePrice(event.target.value)} placeholder="例: 298" />
                </label>
                {isImported ? (
                  <label>
                    <span>通貨</span>
                    <select value={candidateCurrency} onChange={(event) => {
                      setCandidateCurrency(event.target.value);
                      void loadExchangeRate(event.target.value);
                    }}>
                      <option value="CNY">人民元</option>
                    </select>
                  </label>
                ) : null}
                {isImported ? (
                  <label>
                    <span>為替レート</span>
                    <input value={exchangeRate} inputMode="decimal" onChange={(event) => setExchangeRate(event.target.value)} placeholder="例: 21.5" />
                  </label>
                ) : null}
                <label>
                  <span>候補規格数量</span>
                  <input value={candidateQuantity} inputMode="decimal" onChange={(event) => setCandidateQuantity(event.target.value)} placeholder="例: 500" />
                </label>
                <label>
                  <span>単位</span>
                  <select value={candidateUnit} onChange={(event) => setCandidateUnit(event.target.value)}>
                    {comparisonUnits.map((unit) => <option value={unit} key={unit}>{unit}</option>)}
                  </select>
                </label>
              </div>
              {isImported ? <small className="form-hint">{exchangeRateLabel || `1 ${candidateCurrency} = ${formatCurrency(activeExchangeRate)}`}</small> : null}
              <label className="exception-toggle">
                <input type="checkbox" name="isImported" checked={isImported} onChange={(event) => setIsImported(event.target.checked)} />
                <span>海外輸入品として計算</span>
              </label>
              {isImported ? <small className="form-hint">海外費用は選択した通貨で入力し、システムが円換算して比較します。税費とその他費用は円で入力してください。</small> : null}
              <label>
                <span>原産国・輸入元</span>
                <input name="candidateOrigin" placeholder="例: 中国 / 台湾 / タイ" />
              </label>
              <div className="comparison-inline-fields">
                <label>
                  <span>{requiresCandidateWeight ? "候補1箱重量 kg" : "候補1単位重量 kg"}</span>
                  <input
                    value={candidateWeightKg}
                    inputMode="decimal"
                    onChange={(event) => setCandidateWeightKg(event.target.value)}
                    placeholder={requiresCandidateWeight ? "例: 8" : "g/kgは自動計算"}
                    required={requiresCandidateWeight}
                  />
                </label>
                <label>
                  <span>輸入単位数</span>
                  <input value={importQuantity} inputMode="decimal" onChange={(event) => setImportQuantity(event.target.value)} placeholder="例: 20" />
                </label>
                <label>
                  <span>{isImported && candidateCurrency !== "JPY" ? "1kg運賃（選択通貨）" : "1kg運賃"}</span>
                  <input value={freightRatePerKg} inputMode="decimal" onChange={(event) => setFreightRatePerKg(event.target.value)} placeholder="例: 120" />
                </label>
              </div>
              <div className="comparison-inline-fields">
                <label>
                  <span>今回の輸入総重量</span>
                  <input value={`${formatNumber(candidateTotalWeightKg)} kg`} readOnly />
                </label>
                <label>
                  <span>運賃合計（円換算）</span>
                  <input value={formatCurrency(candidateFreight)} readOnly />
                </label>
                {isImported ? (
                  <label>
                    <span>候補単価（円換算）</span>
                    <input value={formatCurrency(candidatePriceJpy)} readOnly />
                  </label>
                ) : null}
                <label>
                  <span>税費（円）</span>
                  <input value={taxCost} inputMode="decimal" onChange={(event) => setTaxCost(event.target.value)} placeholder="0" />
                </label>
                <label>
                  <span>その他費用（円）</span>
                  <input value={otherCost} inputMode="decimal" onChange={(event) => setOtherCost(event.target.value)} placeholder="0" />
                </label>
              </div>
              <div className="comparison-preview">
                <span>現行 {formatCurrency(baseUnitCost)} / {baseUnit}</span>
                <span>候補 {formatCurrency(candidateUnitCost)} / {candidateUnit}</span>
                <span>候補総額 {formatCurrency(candidateTotal)}</span>
                <strong className={savingRate <= 0 ? "rate-down" : "rate-up"}>
                  {baseUnitCost > 0 ? `${savingRate > 0 ? "+" : ""}${savingRate.toFixed(1)}%` : "比較待ち"}
                </strong>
              </div>
              <div className="modern-file-field">
                <span>写真</span>
                <label className="modern-file-button">
                  <input
                    name="photo"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => setPhotoFileName(event.target.files?.[0]?.name ?? "")}
                  />
                  <strong>写真を選択</strong>
                  <small>{photoFileName || "カメラまたは写真ライブラリから追加"}</small>
                </label>
              </div>
              <label>
                <span>メモ</span>
                <textarea name="note" placeholder="味、品質、切替時の注意点など" />
              </label>
              <button className="primary-button" type="submit">{editingComparisonId ? "比較を更新" : "比較を保存"}</button>
            </div>
          </form>

          <section className="panel">
            <div className="panel-title">
              <div>
                <h3>比較履歴</h3>
                <p>現行品と候補品の単位コスト差を確認</p>
              </div>
            </div>
            <div className="recommendation-list">
              {filteredComparisons.length === 0 ? <div className="empty-state">商品比較はありません</div> : null}
              {filteredComparisons.map((comparison) => (
                <ComparisonCard
                  comparison={comparison}
                  key={comparison.id}
                  onCopy={() => populateComparisonForm(comparison, "copy")}
                  onDelete={() => deleteComparison(comparison)}
                  onEdit={() => populateComparisonForm(comparison, "edit")}
                />
              ))}
            </div>
          </section>
        </section>
      </section>
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

function ComparisonCard({
  comparison,
  onCopy,
  onDelete,
  onEdit
}: {
  comparison: ProductComparison;
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const importCount = Math.max(1, comparison.importQuantity ?? 1);
  const candidateTotal = (comparison.candidatePrice * importCount) + comparison.freightCost + comparison.taxCost + comparison.otherCost;
  const candidateUnitCost = candidateTotal / Math.max(1, comparison.candidateQuantity * importCount);
  const baseUnitCost = comparison.basePrice / Math.max(1, comparison.baseQuantity);
  const rate = baseUnitCost > 0 ? ((candidateUnitCost - baseUnitCost) / baseUnitCost) * 100 : 0;

  return (
    <article className="recommendation-card comparison-card">
      {comparison.photoUrl ? (
        <span className="recommendation-photo"><img src={comparison.photoUrl} alt={`${comparison.candidateProductName} の写真`} /></span>
      ) : null}
      <div className="comparison-card-body">
        <div className="recommendation-title">
          <strong>{comparison.baseProductName} ⇔ {comparison.candidateProductName}</strong>
          <span className={rate <= 0 ? "rate-down" : "rate-up"}>{rate > 0 ? "+" : ""}{rate.toFixed(1)}%</span>
        </div>
        <div className="comparison-card-actions">
          {comparison.canEdit ? <button type="button" className="secondary-button" onClick={onEdit}>編集</button> : null}
          <button type="button" className="secondary-button" onClick={onCopy}>コピーして再比較</button>
          {comparison.canDelete ? <button type="button" className="danger-button" onClick={onDelete}>削除</button> : null}
        </div>
        <p>{comparison.candidateSupplierName || "購入先未設定"}{comparison.candidateOrigin ? ` · ${comparison.candidateOrigin}` : ""}</p>
        <div className="comparison-result-grid">
          <span><small>現行</small><strong>{formatCurrency(baseUnitCost)} / {comparison.baseUnit}</strong></span>
          <span><small>候補</small><strong>{formatCurrency(candidateUnitCost)} / {comparison.candidateUnit}</strong></span>
          <span><small>候補総額</small><strong>{formatCurrency(candidateTotal)}</strong></span>
        </div>
        {comparison.isImported ? (
          <div className="comparison-import-details">
            {comparison.candidateCurrency !== "JPY" ? (
              <dl>
                <dt>入力額</dt>
                <dd>{formatForeignCurrency(comparison.candidateOriginalPrice, comparison.candidateCurrency)}</dd>
                <dt>為替</dt>
                <dd>1 {comparison.candidateCurrency} = {formatCurrency(comparison.exchangeRate)}</dd>
              </dl>
            ) : null}
            <dl>
              <dt>輸入費用</dt>
              <dd>運賃 {formatCurrency(comparison.freightCost)}</dd>
              <dt>税費</dt>
              <dd>{formatCurrency(comparison.taxCost)}</dd>
              <dt>その他</dt>
              <dd>{formatCurrency(comparison.otherCost)}</dd>
            </dl>
            <dl>
              <dt>輸入重量</dt>
              <dd>{formatNumber(comparison.candidateWeightKg * importCount)} kg</dd>
              <dt>運賃単価</dt>
              <dd>{formatCurrency(comparison.freightRatePerKg)} / kg{comparison.candidateCurrency !== "JPY" ? ` (${formatForeignCurrency(comparison.freightRateOriginalPerKg, comparison.candidateCurrency)} / kg)` : ""}</dd>
            </dl>
          </div>
        ) : null}
        {comparison.note ? <small>{comparison.note}</small> : null}
        <em>{comparison.createdLabel}{comparison.createdBy ? ` · ${comparison.createdBy}` : ""}</em>
      </div>
    </article>
  );
}

function normalizeNumber(value: string) {
  const numberValue = Number(String(value).replace(/[¥￥,\s]/g, ""));
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function inferCandidateTotalWeightKg(unit: string, quantityValue: string | number, weightKgValue: string | number, importCount: number) {
  const quantity = normalizeNumber(String(quantityValue));
  const manualWeightKg = normalizeNumber(String(weightKgValue));

  if (unit === "kg") return quantity * importCount;
  if (unit === "g") return (quantity / 1000) * importCount;
  return manualWeightKg * importCount;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "ja"));
}

function formatNumber(value: number) {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 3 });
}

function inferSpecQuantity(value: string) {
  const normalized = value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  const matches = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|ml|L|個|袋|本|枚|箱)/gi)]
    .map((match) => ({ quantity: Number(match[1]), unit: match[2] }))
    .filter((match) => Number.isFinite(match.quantity) && match.quantity > 0);
  const countMatch = matches.find((match) => ["個", "本", "枚", "袋"].includes(match.unit));
  const metricMatch = matches.find((match) => ["kg", "g", "ml", "L"].includes(match.unit));
  const boxMatch = matches.find((match) => match.unit === "箱");
  const selected = countMatch ?? metricMatch ?? boxMatch;
  if (!selected) return { quantity: 1, unit: "g" };

  const rawQuantity = selected.quantity;
  const unit = selected.unit;
  if (unit.toLowerCase() === "kg") return { quantity: rawQuantity * 1000, unit: "g" };
  if (unit === "L") return { quantity: rawQuantity * 1000, unit: "ml" };
  return { quantity: rawQuantity, unit };
}

function getProductSpecQuantity(product: Product) {
  const packageQuantity = Number(product.packageQuantity ?? 0);
  if (Number.isFinite(packageQuantity) && packageQuantity > 0) {
    return { quantity: packageQuantity, unit: product.packageQuantityUnit || product.unit || "個" };
  }

  return inferSpecQuantity([product.packageSpec, product.specNote].filter(Boolean).join(" "));
}

function formatProductSpecSummary(product: Product) {
  const packageQuantity = Number(product.packageQuantity ?? 0);
  const quantityLabel = Number.isFinite(packageQuantity) && packageQuantity > 0
    ? `${packageQuantity.toLocaleString("ja-JP", { maximumFractionDigits: 3 })}${product.packageQuantityUnit || product.unit || "個"}`
    : "";
  return [quantityLabel, product.packageSpec || "", product.specNote || ""].filter(Boolean).join(" / ") || "未設定";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

function formatForeignCurrency(value: number, currency: string) {
  return new Intl.NumberFormat(currency === "CNY" ? "zh-CN" : "ja-JP", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}
