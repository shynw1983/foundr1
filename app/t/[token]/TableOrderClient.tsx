"use client";

import { CreditCard, Minus, Plus, ShoppingBag, UserRound, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ResolvedTable = {
  tableId: string;
  tableToken: string;
  tableLabel: string;
  tableDisplayName: string;
  storeId: string;
  storeName: string;
  customerStoreName?: string;
  customerDisplayName?: string;
  brandId: string;
  brandName: string;
  tableOrderingEnabled: boolean;
  dineInEnabled: boolean;
};

type MenuOption = {
  id: string;
  optionGroupId: string;
  optionKey: string;
  name: string;
  displayNames?: Record<string, string>;
  priceDelta: number | null;
};

type MenuOptionGroup = {
  id: string;
  groupKey: string;
  name: string;
  displayNames?: Record<string, string>;
  selectionType: string;
  options: MenuOption[];
};

type MenuItem = {
  id: string;
  name: string;
  displayNames?: Record<string, string>;
  itemKind: string;
  category: string;
  imageUrl: string;
  basePrice: number;
  storeSetting?: {
    websiteEnabled: boolean;
    posEnabled: boolean;
    tableOrderEnabled?: boolean;
    isAvailable: boolean;
    statusNote: string;
  };
  optionGroups: MenuOptionGroup[];
};

type CartItem = {
  uid: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  selectedOptions: Array<{
    groupId: string;
    optionIds: string[];
  }>;
  optionLabels: string[];
  amount: number;
};

type CheckoutType = "pay_at_counter" | "online_payment" | "staff_to_table";

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("ja-JP")}`;
}

function displayName(source: { name: string; displayNames?: Record<string, string> }) {
  return source.displayNames?.ja || source.name;
}

function effectiveSelectionType(group: MenuOptionGroup) {
  if (["size", "temperature", "sweetness", "ice", "option"].includes(group.groupKey)) return "single";
  if (group.groupKey === "topping") return "multiple";
  return group.selectionType || "single";
}

export function TableOrderClient({ token }: { token: string }) {
  const [table, setTable] = useState<ResolvedTable | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutSubmitting, setCheckoutSubmitting] = useState<CheckoutType | "">("");
  const [message, setMessage] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [lastOrder, setLastOrder] = useState<{ pickupCode: string; amount: number } | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<{ type: CheckoutType; message: string; totalAmount: number } | null>(null);

  const categories = useMemo(() => Array.from(new Set(items.map((item) => item.category || "未分類"))), [items]);
  const visibleItems = useMemo(() => items.filter((item) => !selectedCategory || (item.category || "未分類") === selectedCategory), [items, selectedCategory]);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + item.amount, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setMessage("");
      try {
        const tableResponse = await fetch(`/api/public/table-order/resolve?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const tableBody = await tableResponse.json().catch(() => ({})) as { table?: ResolvedTable; orderingEnabled?: boolean; error?: string };
        if (!tableResponse.ok || !tableBody.table) throw new Error(tableBody.error || "テーブルを確認できませんでした。");
        setTable(tableBody.table);
        if (!tableBody.orderingEnabled || !tableBody.table.brandId) {
          setItems([]);
          return;
        }
        const menuParams = new URLSearchParams({ brand: tableBody.table.brandId, store: tableBody.table.storeId });
        const menuResponse = await fetch(`/api/public/menus?${menuParams.toString()}`, { cache: "no-store" });
        const menuBody = await menuResponse.json().catch(() => ({})) as { items?: MenuItem[]; error?: string };
        if (!menuResponse.ok) throw new Error(menuBody.error || "メニューを読み込めませんでした。");
        const availableItems = (menuBody.items ?? []).filter((item) => (
          item.itemKind === "fixed_product" &&
          item.storeSetting?.posEnabled !== false &&
          item.storeSetting?.tableOrderEnabled !== false &&
          item.storeSetting?.isAvailable !== false
        ));
        setItems(availableItems);
        setSelectedCategory(availableItems[0]?.category || "未分類");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "メニューを読み込めませんでした。");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [token]);

  function openItem(item: MenuItem) {
    const defaults: Record<string, string[]> = {};
    for (const group of item.optionGroups) {
      const availableOptions = group.options ?? [];
      if (effectiveSelectionType(group) === "single" && availableOptions[0]) {
        defaults[group.id] = [availableOptions[0].id];
      }
    }
    setActiveItem(item);
    setSelectedOptions(defaults);
    setQuantity(1);
  }

  function toggleOption(group: MenuOptionGroup, option: MenuOption) {
    const current = selectedOptions[group.id] ?? [];
    if (effectiveSelectionType(group) === "single") {
      setSelectedOptions({ ...selectedOptions, [group.id]: [option.id] });
      return;
    }
    setSelectedOptions({
      ...selectedOptions,
      [group.id]: current.includes(option.id)
        ? current.filter((id) => id !== option.id)
        : [...current, option.id]
    });
  }

  function addToCart() {
    if (!activeItem) return;
    const optionLabels: string[] = [];
    let optionTotal = 0;
    const selectedPayload = activeItem.optionGroups.map((group) => {
      const optionIds = selectedOptions[group.id] ?? [];
      for (const optionId of optionIds) {
        const option = group.options.find((candidate) => candidate.id === optionId);
        if (!option) continue;
        optionLabels.push(displayName(option));
        optionTotal += Number(option.priceDelta ?? 0);
      }
      return { groupId: group.id, optionIds };
    }).filter((group) => group.optionIds.length > 0);
    const unitPrice = Number(activeItem.basePrice ?? 0) + optionTotal;
    setCart((current) => [...current, {
      uid: `${activeItem.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      menuItemId: activeItem.id,
      name: displayName(activeItem),
      quantity,
      unitPrice,
      selectedOptions: selectedPayload,
      optionLabels,
      amount: unitPrice * quantity
    }]);
    setActiveItem(null);
    setMessage("");
  }

  async function submitOrder() {
    if (!cart.length) return;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/public/table-order/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          items: cart.map((item) => ({
            menuCatalogItemId: item.menuItemId,
            quantity: item.quantity,
            selectedOptions: item.selectedOptions
          }))
        })
      });
      const body = await response.json().catch(() => ({})) as { pickupCode?: string; amount?: number; error?: string };
      if (!response.ok) throw new Error(body.error || "注文を送信できませんでした。");
      setLastOrder({ pickupCode: body.pickupCode || "", amount: Number(body.amount ?? cartTotal) });
      setCart([]);
      setCheckoutResult(null);
      setMessage("追加注文を送信しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "注文を送信できませんでした。");
    } finally {
      setSubmitting(false);
    }
  }

  async function requestCheckout(checkoutType: CheckoutType) {
    setCheckoutSubmitting(checkoutType);
    setMessage("");
    setCheckoutError("");
    try {
      const response = await fetch("/api/public/table-order/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, checkoutType })
      });
      const body = await response.json().catch(() => ({})) as { message?: string; totalAmount?: number; error?: string };
      if (!response.ok) throw new Error(body.error || "会計リクエストを送信できませんでした。");
      setCheckoutResult({
        type: checkoutType,
        message: body.message || "",
        totalAmount: Number(body.totalAmount ?? 0)
      });
      setMessage("会計リクエストを送信しました。");
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "会計リクエストを送信できませんでした。");
    } finally {
      setCheckoutSubmitting("");
    }
  }

  const orderingEnabled = table?.tableOrderingEnabled === true && table?.dineInEnabled === true;

  return (
    <main className="table-order-menu-shell">
      <header className="table-order-menu-header">
        <div>
          <span>{table?.customerStoreName || table?.customerDisplayName || table?.storeName || "Foundr1 OS"}</span>
          <h1>テーブル注文</h1>
          <p>テーブル {table?.tableDisplayName || table?.tableLabel || "-"}</p>
        </div>
        <div className="table-order-header-actions">
          <button className="table-order-header-checkout" type="button" onClick={() => {
            setCheckoutError("");
            setCheckoutOpen(true);
          }} disabled={!orderingEnabled}>
            会計
          </button>
          <div className="table-order-cart-chip"><ShoppingBag size={16} />{cartCount}</div>
        </div>
      </header>

      {message ? <div className="table-order-message">{message}</div> : null}
      {lastOrder ? <div className="table-order-message is-success">受付番号 {lastOrder.pickupCode} / {formatYen(lastOrder.amount)}</div> : null}
      {checkoutResult ? <div className="table-order-message is-success">{checkoutResult.message} / 合計 {formatYen(checkoutResult.totalAmount)}</div> : null}

      {loading ? <section className="table-order-empty">メニューを読み込み中...</section> : null}
      {!loading && !orderingEnabled ? <section className="table-order-empty">このテーブルでは現在注文できません。</section> : null}
      {!loading && orderingEnabled && !items.length ? <section className="table-order-empty">現在注文できる商品がありません。</section> : null}

      {orderingEnabled && items.length ? (
        <>
          <nav className="table-order-category-tabs">
            {categories.map((category) => (
              <button key={category} type="button" className={selectedCategory === category ? "is-active" : ""} onClick={() => setSelectedCategory(category)}>
                {category}
              </button>
            ))}
          </nav>
          <section className="table-order-menu-grid">
            {visibleItems.map((item) => (
              <button className="table-order-menu-item" key={item.id} type="button" onClick={() => openItem(item)}>
                {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <div className="table-order-menu-image-placeholder" />}
                <span>{item.category || "未分類"}</span>
                <strong>{displayName(item)}</strong>
                <small>{formatYen(Number(item.basePrice ?? 0))}</small>
              </button>
            ))}
          </section>
        </>
      ) : null}

      {cart.length ? (
        <footer className="table-order-cart-bar">
          <div>
            <span>{cartCount}点</span>
            <strong>{formatYen(cartTotal)}</strong>
          </div>
          <div className="table-order-cart-actions">
            <button type="button" onClick={() => {
              setCheckoutError("");
              setCheckoutOpen(true);
            }} className="is-secondary">
              会計
            </button>
            <button type="button" onClick={() => void submitOrder()} disabled={submitting}>
              {submitting ? "送信中..." : "追加注文"}
            </button>
          </div>
        </footer>
      ) : null}

      {orderingEnabled && !cart.length ? (
        <footer className="table-order-checkout-bar">
          <div>
            <span>ご注文後はこちら</span>
            <strong>お会計</strong>
          </div>
          <button type="button" onClick={() => {
            setCheckoutError("");
            setCheckoutOpen(true);
          }}>会計する</button>
        </footer>
      ) : null}

      {activeItem ? (
        <div className="table-order-modal" role="dialog" aria-modal="true">
          <div className="table-order-modal-panel">
            <button className="table-order-modal-close" type="button" onClick={() => setActiveItem(null)}><X size={18} /></button>
            <h2>{displayName(activeItem)}</h2>
            <p>{formatYen(Number(activeItem.basePrice ?? 0))}</p>
            <div className="table-order-option-stack">
              {activeItem.optionGroups.filter((group) => group.options.length > 0).map((group) => (
                <section key={group.id}>
                  <h3>{displayName(group)}</h3>
                  <div className="table-order-option-grid">
                    {group.options.map((option) => {
                      const checked = (selectedOptions[group.id] ?? []).includes(option.id);
                      return (
                        <button className={checked ? "is-selected" : ""} key={option.id} type="button" onClick={() => toggleOption(group, option)}>
                          <span>{displayName(option)}</span>
                          {Number(option.priceDelta ?? 0) !== 0 ? <small>{formatYen(Number(option.priceDelta ?? 0))}</small> : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
            <div className="table-order-quantity-row">
              <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))}><Minus size={16} /></button>
              <strong>{quantity}</strong>
              <button type="button" onClick={() => setQuantity(Math.min(99, quantity + 1))}><Plus size={16} /></button>
            </div>
            <button className="table-order-add-button" type="button" onClick={addToCart}>カートに追加</button>
          </div>
        </div>
      ) : null}

      {checkoutOpen ? (
        <div className="table-order-modal" role="dialog" aria-modal="true">
          <div className="table-order-modal-panel">
            <button className="table-order-modal-close" type="button" onClick={() => setCheckoutOpen(false)}><X size={18} /></button>
            {checkoutResult ? (
              <div className="table-order-checkout-result">
                <h2>{checkoutResult.type === "online_payment" ? "オンライン決済は準備中です" : "会計リクエストを送信しました"}</h2>
                <p>{checkoutResult.message}</p>
                <strong>合計 {formatYen(checkoutResult.totalAmount)}</strong>
                <button type="button" onClick={() => setCheckoutOpen(false)}>閉じる</button>
              </div>
            ) : (
              <>
                <h2>会計方法を選択</h2>
                <p>テーブル {table?.tableDisplayName || table?.tableLabel || "-"}</p>
                {checkoutError ? <div className="table-order-checkout-error">{checkoutError}</div> : null}
                <div className="table-order-checkout-options">
                  <button type="button" onClick={() => void requestCheckout("pay_at_counter")} disabled={Boolean(checkoutSubmitting)}>
                    <Wallet size={18} />
                    <span>
                      <strong>{checkoutSubmitting === "pay_at_counter" ? "送信中..." : "レジで支払う"}</strong>
                      <small>レジまでお越しください</small>
                    </span>
                  </button>
                  <button type="button" onClick={() => void requestCheckout("online_payment")} disabled={Boolean(checkoutSubmitting)}>
                    <CreditCard size={18} />
                    <span>
                      <strong>{checkoutSubmitting === "online_payment" ? "確認中..." : "オンラインで支払う"}</strong>
                      <small>現在は準備中です</small>
                    </span>
                  </button>
                  <button type="button" onClick={() => void requestCheckout("staff_to_table")} disabled={Boolean(checkoutSubmitting)}>
                    <UserRound size={18} />
                    <span>
                      <strong>{checkoutSubmitting === "staff_to_table" ? "送信中..." : "スタッフを呼んで支払う"}</strong>
                      <small>テーブル会計を依頼します</small>
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
