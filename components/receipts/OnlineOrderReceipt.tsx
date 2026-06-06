import type { OnlineReceiptViewModel } from "../../lib/receipt-data";

type OnlineOrderReceiptProps = {
  receipt: OnlineReceiptViewModel;
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY"
  }).format(Number.isFinite(amount) ? amount : 0);
}

function getFooterBrandText() {
  return `© ${new Date().getFullYear()} Foundr1`;
}

function DetailList({ items }: { items: string[] }) {
  const visibleItems = items.map((item) => item.trim()).filter(Boolean);
  if (!visibleItems.length) return null;
  return (
    <div className="online-receipt-detail-list">
      {visibleItems.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

export function OnlineOrderReceipt({ receipt }: OnlineOrderReceiptProps) {
  const brandClass = receipt.brand === "maamaa" ? "is-maamaa" : "is-nanacha";
  return (
    <article className={`online-receipt-sheet ${brandClass}`} aria-label="領収書">
      <header className="online-receipt-header">
        <div className="online-receipt-brand">
          <img src={receipt.logoSrc} alt={receipt.brandName} />
          <div>
            <p>{receipt.brandName}</p>
            <span>Online pickup receipt</span>
          </div>
        </div>
        <div className="online-receipt-title-block">
          <h1>領収書</h1>
          <p>Receipt No. {receipt.receiptNo}</p>
        </div>
      </header>

      <section className="online-receipt-hero" aria-label="金額">
        <div>
          <p className="online-receipt-recipient">{receipt.recipientName || "\u00a0"} 様</p>
          <span>但し {receipt.purposeText}として</span>
        </div>
        <strong>{formatCurrency(receipt.totalAmount)}</strong>
      </section>

      <section className="online-receipt-info-grid" aria-label="注文と発行者">
        <div>
          <h2>注文情報</h2>
          <dl>
            <div>
              <dt>取餐番号</dt>
              <dd>{receipt.pickupCode}</dd>
            </div>
            <div>
              <dt>受取日時</dt>
              <dd>{receipt.pickupDate} {receipt.pickupTime}</dd>
            </div>
            <div>
              <dt>支払方法</dt>
              <dd>{receipt.paymentProvider || "決済済み"}</dd>
            </div>
            <div>
              <dt>支払日時</dt>
              <dd>{receipt.paidAt}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h2>発行者</h2>
          <dl>
            <div>
              <dt>会社名</dt>
              <dd>{receipt.issuer.name}</dd>
            </div>
            {receipt.issuer.invoiceRegistrationNumber ? (
              <div>
                <dt>登録番号</dt>
                <dd>{receipt.issuer.invoiceRegistrationNumber}</dd>
              </div>
            ) : null}
            {receipt.issuer.address ? (
              <div>
                <dt>住所</dt>
                <dd>{receipt.issuer.address}</dd>
              </div>
            ) : null}
            {receipt.issuer.phone ? (
              <div>
                <dt>TEL</dt>
                <dd>{receipt.issuer.phone}</dd>
              </div>
            ) : null}
            <div>
              <dt>発行日</dt>
              <dd>{receipt.issuedAt}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="online-receipt-items" aria-label="明細">
        <div className="online-receipt-section-heading">
          <h2>明細</h2>
          <span>{receipt.items.length} item{receipt.items.length === 1 ? "" : "s"}</span>
        </div>
        <div className="online-receipt-item-list">
          {receipt.items.map((item, index) => (
            <div className="online-receipt-item" key={`${item.title}-${index}`}>
              <div className="online-receipt-item-main">
                <div>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{item.title}</h3>
                  {item.description ? <p>{item.description}</p> : null}
                </div>
                <strong>{formatCurrency(item.amount)}</strong>
              </div>
              <DetailList items={item.details} />
              {item.sections.length ? (
                <div className="online-receipt-section-list">
                  {item.sections.map((section) => (
                    <div key={`${item.title}-${section.title}`}>
                      <p>{section.title}</p>
                      <DetailList items={section.items} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="online-receipt-total-panel" aria-label="合計">
        <dl>
          <div>
            <dt>小計</dt>
            <dd>{formatCurrency(receipt.subtotalAmount)}</dd>
          </div>
          {receipt.couponDiscountAmount > 0 ? (
            <div>
              <dt>クーポン値引き</dt>
              <dd>-{formatCurrency(receipt.couponDiscountAmount)}</dd>
            </div>
          ) : null}
          <div className="is-total">
            <dt>合計</dt>
            <dd>{formatCurrency(receipt.totalAmount)}</dd>
          </div>
          <div>
            <dt>内消費税等 {receipt.taxRate}%対象</dt>
            <dd>{formatCurrency(receipt.taxIncludedAmount)}</dd>
          </div>
        </dl>
      </section>

      <footer className="online-receipt-footer">
        <p>この領収書は電子的に発行されています。</p>
        <span>{getFooterBrandText()}</span>
      </footer>
    </article>
  );
}
