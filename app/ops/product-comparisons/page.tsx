"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, LogOut, MessageSquareWarning, PackageCheck, Search, Store, Truck, UserCog } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { products as initialProducts, suppliers as initialSuppliers } from "../../../lib/mock-data";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OpsNavList } from "../components/OpsNavList";
import { UserBadge } from "../components/UserBadge";

type Product = typeof initialProducts[number] & { id?: string; packageSpec?: string; referencePrice?: number };
type Supplier = typeof initialSuppliers[number] & { id?: string };
type ProductComparison = {
  id: string;
  baseProductId: string;
  baseProductName: string;
  basePackageSpec: string;
  candidateProductName: string;
  candidateSupplierName: string;
  candidateOrigin: string;
  candidatePrice: number;
  candidateQuantity: number;
  candidateUnit: string;
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
  createdLabel: string;
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

export default function ProductComparisonsPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [comparisons, setComparisons] = useState<ProductComparison[]>([]);
  const [query, setQuery] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [baseQuantity, setBaseQuantity] = useState("1");
  const [baseUnit, setBaseUnit] = useState("g");
  const [candidatePrice, setCandidatePrice] = useState("");
  const [candidateQuantity, setCandidateQuantity] = useState("1");
  const [candidateUnit, setCandidateUnit] = useState("g");
  const [freightCost, setFreightCost] = useState("");
  const [taxCost, setTaxCost] = useState("");
  const [otherCost, setOtherCost] = useState("");
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");

  useEffect(() => {
    void loadData();
  }, []);

  const selectedProduct = products.find((product) => product.id === selectedProductId);
  const candidateTotal = normalizeNumber(candidatePrice) + normalizeNumber(freightCost) + normalizeNumber(taxCost) + normalizeNumber(otherCost);
  const candidateUnitCost = candidateTotal / Math.max(1, normalizeNumber(candidateQuantity));
  const baseUnitCost = normalizeNumber(basePrice) / Math.max(1, normalizeNumber(baseQuantity));
  const savingRate = baseUnitCost > 0 ? ((candidateUnitCost - baseUnitCost) / baseUnitCost) * 100 : 0;

  async function loadData() {
    const [dashboardResponse, comparisonResponse] = await Promise.all([
      fetch("/api/dashboard"),
      fetch("/api/product-comparisons")
    ]);

    if (dashboardResponse.ok) {
      const data = await dashboardResponse.json() as { products?: Product[]; suppliers?: Supplier[] };
      setProducts(data.products ?? []);
      setSuppliers(data.suppliers ?? []);
    }

    if (comparisonResponse.ok) {
      const data = await comparisonResponse.json() as { comparisons?: ProductComparison[] };
      setComparisons(data.comparisons ?? []);
    }

    setDataSource("neon");
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

  function selectBaseProduct(productId: string) {
    setSelectedProductId(productId);
    const product = products.find((item) => item.id === productId);
    if (!product) return;

    setBasePrice(String(product.referencePrice ?? 0));
    const inferred = inferSpecQuantity([product.packageSpec, product.specNote].filter(Boolean).join(" "));
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
    formData.set("candidatePrice", candidatePrice);
    formData.set("candidateQuantity", candidateQuantity);
    formData.set("candidateUnit", candidateUnit);
    formData.set("freightCost", freightCost);
    formData.set("taxCost", taxCost);
    formData.set("otherCost", otherCost);

    const response = await fetch("/api/product-comparisons", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "商品比較を保存できませんでした。");
      return;
    }

    form.reset();
    setSelectedProductId("");
    setBasePrice("");
    setBaseQuantity("1");
    setBaseUnit("g");
    setCandidatePrice("");
    setCandidateQuantity("1");
    setCandidateUnit("g");
    setFreightCost("");
    setTaxCost("");
    setOtherCost("");
    showNotice("商品比較を保存しました。");
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
          <form className="panel recommendation-form" onSubmit={createComparison}>
            <div className="panel-title">
              <div>
                <h3>比較を追加</h3>
                <p>価格 ÷ 規格数量で単位コストを比較。輸入品は運賃・税費も加算</p>
              </div>
            </div>
            <div className="edit-fields">
              <label>
                <span>現行商品</span>
                <select name="baseProductId" value={selectedProductId} onChange={(event) => selectBaseProduct(event.target.value)} required>
                  <option value="">選択してください</option>
                  {products.map((product) => (
                    <option value={product.id ?? ""} key={product.id ?? product.name}>{product.name}</option>
                  ))}
                </select>
              </label>
              {selectedProduct ? <small className="form-hint">規格: {selectedProduct.packageSpec || selectedProduct.specNote || "未設定"}</small> : null}
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
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                    <option value="ml">ml</option>
                    <option value="L">L</option>
                    <option value="個">個</option>
                    <option value="袋">袋</option>
                  </select>
                </label>
              </div>
              <label>
                <span>候補商品名</span>
                <input name="candidateProductName" placeholder="例: 緑豆春雨 500g" required />
              </label>
              <label>
                <span>候補発注先</span>
                <select name="candidateSupplierId" defaultValue="">
                  <option value="">新規または未選択</option>
                  {suppliers.map((supplier) => (
                    <option value={supplier.id ?? ""} key={supplier.name}>{supplier.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>新規発注先名</span>
                <input name="candidateSupplierName" placeholder="例: 輸入食品 A" />
              </label>
              <div className="comparison-inline-fields">
                <label>
                  <span>候補価格</span>
                  <input value={candidatePrice} inputMode="decimal" onChange={(event) => setCandidatePrice(event.target.value)} placeholder="例: 298" />
                </label>
                <label>
                  <span>候補規格数量</span>
                  <input value={candidateQuantity} inputMode="decimal" onChange={(event) => setCandidateQuantity(event.target.value)} placeholder="例: 500" />
                </label>
                <label>
                  <span>単位</span>
                  <select value={candidateUnit} onChange={(event) => setCandidateUnit(event.target.value)}>
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                    <option value="ml">ml</option>
                    <option value="L">L</option>
                    <option value="個">個</option>
                    <option value="袋">袋</option>
                  </select>
                </label>
              </div>
              <label className="exception-toggle">
                <input type="checkbox" name="isImported" />
                <span>海外輸入品として計算</span>
              </label>
              <label>
                <span>原産国・輸入元</span>
                <input name="candidateOrigin" placeholder="例: 中国 / 台湾 / タイ" />
              </label>
              <div className="comparison-inline-fields">
                <label>
                  <span>運賃</span>
                  <input value={freightCost} inputMode="decimal" onChange={(event) => setFreightCost(event.target.value)} placeholder="0" />
                </label>
                <label>
                  <span>税費</span>
                  <input value={taxCost} inputMode="decimal" onChange={(event) => setTaxCost(event.target.value)} placeholder="0" />
                </label>
                <label>
                  <span>その他費用</span>
                  <input value={otherCost} inputMode="decimal" onChange={(event) => setOtherCost(event.target.value)} placeholder="0" />
                </label>
              </div>
              <div className="comparison-preview">
                <span>現行 {formatCurrency(baseUnitCost)} / {baseUnit}</span>
                <span>候補 {formatCurrency(candidateUnitCost)} / {candidateUnit}</span>
                <strong className={savingRate <= 0 ? "rate-down" : "rate-up"}>
                  {baseUnitCost > 0 ? `${savingRate > 0 ? "+" : ""}${savingRate.toFixed(1)}%` : "比較待ち"}
                </strong>
              </div>
              <label>
                <span>写真</span>
                <input name="photo" type="file" accept="image/*" capture="environment" />
              </label>
              <label>
                <span>メモ</span>
                <textarea name="note" placeholder="味、品質、切替時の注意点など" />
              </label>
              <button className="primary-button" type="submit">比較を保存</button>
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
                <ComparisonCard comparison={comparison} key={comparison.id} />
              ))}
            </div>
          </section>
        </section>
      </section>
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

function ComparisonCard({ comparison }: { comparison: ProductComparison }) {
  const candidateTotal = comparison.candidatePrice + comparison.freightCost + comparison.taxCost + comparison.otherCost;
  const candidateUnitCost = candidateTotal / Math.max(1, comparison.candidateQuantity);
  const baseUnitCost = comparison.basePrice / Math.max(1, comparison.baseQuantity);
  const rate = baseUnitCost > 0 ? ((candidateUnitCost - baseUnitCost) / baseUnitCost) * 100 : 0;

  return (
    <article className="recommendation-card comparison-card">
      {comparison.photoUrl ? (
        <span className="recommendation-photo"><img src={comparison.photoUrl} alt={`${comparison.candidateProductName} の写真`} /></span>
      ) : null}
      <div>
        <div className="recommendation-title">
          <strong>{comparison.baseProductName} ⇔ {comparison.candidateProductName}</strong>
          <span className={rate <= 0 ? "rate-down" : "rate-up"}>{rate > 0 ? "+" : ""}{rate.toFixed(1)}%</span>
        </div>
        <p>{comparison.candidateSupplierName || "発注先未設定"}{comparison.candidateOrigin ? ` · ${comparison.candidateOrigin}` : ""}</p>
        <div className="comparison-result-grid">
          <span>現行 {formatCurrency(baseUnitCost)} / {comparison.baseUnit}</span>
          <span>候補 {formatCurrency(candidateUnitCost)} / {comparison.candidateUnit}</span>
          <span>候補総額 {formatCurrency(candidateTotal)}</span>
        </div>
        {comparison.isImported ? <small>輸入費用: 運賃 {formatCurrency(comparison.freightCost)} / 税費 {formatCurrency(comparison.taxCost)} / その他 {formatCurrency(comparison.otherCost)}</small> : null}
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

function inferSpecQuantity(value: string) {
  const normalized = value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|L|個|袋|本|枚)/i);
  if (!match) return { quantity: 1, unit: "g" };

  const rawQuantity = Number(match[1]);
  const unit = match[2];
  if (unit.toLowerCase() === "kg") return { quantity: rawQuantity * 1000, unit: "g" };
  if (unit === "L") return { quantity: rawQuantity * 1000, unit: "ml" };
  return { quantity: rawQuantity, unit };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}
