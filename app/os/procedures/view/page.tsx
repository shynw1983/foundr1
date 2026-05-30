"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  Home,
  Package,
  Search
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
  const [selectedBookId, setSelectedBookId] = useState("");
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    setSelectedBookId((current) => current || nextProcedures[0]?.id || "");
    setLoading(false);
  }

  useEffect(() => {
    void loadProcedures();
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
        <a className="procedure-reader-home" href="/os">
          <Home size={18} />
          Foundr1
        </a>
        <div>
          <p className="eyebrow">店舗オペレーション</p>
          <h1>電子手順書</h1>
        </div>
        <a className="secondary-button" href="/os/procedures">管理</a>
      </header>

      <section className="procedure-reader-layout">
        <aside className="procedure-reader-list" aria-label="手順書一覧">
          <label className="search-box procedure-reader-search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="手順書を検索" />
          </label>

          <div className="procedure-reader-books">
            {filteredProcedures.map((procedure) => (
              <button
                className={`procedure-reader-book ${selectedBook?.id === procedure.id ? "is-active" : ""}`}
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
        </aside>
      </section>
    </main>
  );
}
