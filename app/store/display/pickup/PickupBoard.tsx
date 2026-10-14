"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { PickupOrder } from "./page";
import styles from "./pickup-display.module.css";

export function PickupBoard({ ready, preparing, menuOpen }: { ready: PickupOrder[]; preparing: PickupOrder[]; menuOpen: boolean }) {
  return <section className={styles.board} aria-label="受取番号">
    <PickupColumn orders={ready} ready menuOpen={menuOpen} />
    <PickupColumn orders={preparing} menuOpen={menuOpen} />
  </section>;
}

function PickupColumn({ orders, ready = false, menuOpen }: { orders: PickupOrder[]; ready?: boolean; menuOpen: boolean }) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [capacity, setCapacity] = useState({ columns: ready ? 1 : 3, count: ready ? 3 : 12 });
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const pages = Math.max(1, Math.ceil(orders.length / capacity.count));
  const currentPage = Math.min(page, pages - 1);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(() => {
      const columns = Math.max(1, Math.min(ready ? 2 : 4, Math.floor((grid.clientWidth + 16) / (ready ? 330 : 220))));
      const rows = Math.max(1, Math.floor((grid.clientHeight + 16) / (ready ? 160 : 112)));
      setCapacity((current) => current.columns === columns && current.count === columns * rows ? current : { columns, count: columns * rows });
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [ready]);
  useEffect(() => {
    setPage((current) => Math.min(current, pages - 1));
    if (pages < 2 || paused || menuOpen) return;
    const timer = window.setInterval(() => setPage((current) => (current + 1) % pages), 8000);
    return () => window.clearInterval(timer);
  }, [pages, paused, menuOpen]);
  const visible = orders.slice(currentPage * capacity.count, (currentPage + 1) * capacity.count);
  const columns = Math.min(capacity.columns, Math.max(1, visible.length));
  const rows = Math.max(1, Math.ceil(visible.length / columns));
  return <div className={`${styles.column} ${ready ? styles.ready : styles.preparing}`}>
    <header className={styles.columnHeader}>
      <div className={styles.headingRow}><h2>{ready ? (orders.length ? "お受け取りできます" : "お呼び出し待ち") : "お作りしているご注文"}</h2><span className={styles.count}>{orders.length}<small>件</small></span></div>
      <p>{ready ? (orders.length ? "受取口までお越しください" : "番号が表示されるまでお待ちください") : "お呼びするまでお待ちください"}</p>
    </header>
    <div ref={gridRef} className={`${styles.codeGrid} ${visible.length === 1 ? styles.single : ""}`} style={{ "--columns": columns, "--rows": rows, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } as CSSProperties}>
      {visible.map((order) => <div className={styles.codeCell} key={`${order.pickupCode}-${order.createdTime}`}><strong style={{ "--code-length": Math.max(5, order.pickupCode.length) } as CSSProperties}>{order.pickupCode}</strong></div>)}
      {!orders.length ? <div className={styles.empty}><span className={styles.emptySymbol} aria-hidden="true">—</span><p>{ready ? "お呼び出しまで\nしばらくお待ちください" : "現在、お待ちの注文はありません"}</p></div> : null}
    </div>
    <footer className={styles.columnFooter}>
      <span className={styles.footerLabel}>{ready ? "READY FOR PICKUP" : "PREPARING"}</span>
      {pages > 1 ? <div className={styles.pages}><button type="button" aria-label="前のページ" onClick={() => setPage((currentPage + pages - 1) % pages)}>‹</button><span>{currentPage + 1} / {pages}</span><button type="button" aria-label="次のページ" onClick={() => setPage((currentPage + 1) % pages)}>›</button>{menuOpen ? <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "自動切替を再開" : "自動切替を停止"}</button> : null}</div> : null}
    </footer>
  </div>;
}
