"use client";

import { useMemo, useState } from "react";

export type ReceiptRecipientMode = "blank" | "registered" | "custom";

type ReceiptRecipientControlsProps = {
  orderId: string;
  pickupCode: string;
  demo: string;
  mode: ReceiptRecipientMode;
  customName: string;
  registeredName: string;
};

export function ReceiptRecipientControls({
  orderId,
  pickupCode,
  demo,
  mode,
  customName,
  registeredName
}: ReceiptRecipientControlsProps) {
  const [selectedMode, setSelectedMode] = useState<ReceiptRecipientMode>(mode);
  const [name, setName] = useState(customName);
  const canUseRegisteredName = Boolean(registeredName.trim());
  const actionParams = useMemo(() => {
    const params = new URLSearchParams();
    if (demo) {
      params.set("demo", demo);
    } else {
      params.set("orderId", orderId);
      params.set("pickupCode", pickupCode);
    }
    return params;
  }, [demo, orderId, pickupCode]);

  return (
    <form className="online-receipt-recipient-controls" method="get" action="/public/orders/receipt/preview">
      {[...actionParams.entries()].map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <div className="online-receipt-recipient-header">
        <span>宛名</span>
        <small>会社名や正式名が必要な場合だけ入力してください。</small>
      </div>
      <div className="online-receipt-recipient-options">
        <label>
          <input
            type="radio"
            name="recipientMode"
            value="blank"
            checked={selectedMode === "blank"}
            onChange={() => setSelectedMode("blank")}
          />
          <span>宛名なし</span>
        </label>
        <label className={!canUseRegisteredName ? "is-disabled" : ""}>
          <input
            type="radio"
            name="recipientMode"
            value="registered"
            checked={selectedMode === "registered"}
            disabled={!canUseRegisteredName}
            onChange={() => setSelectedMode("registered")}
          />
          <span>注文/登録名</span>
        </label>
        <label>
          <input
            type="radio"
            name="recipientMode"
            value="custom"
            checked={selectedMode === "custom"}
            onChange={() => setSelectedMode("custom")}
          />
          <span>自分で入力</span>
        </label>
      </div>
      {canUseRegisteredName ? <p className="online-receipt-recipient-source">登録候補: {registeredName}</p> : null}
      <div className="online-receipt-recipient-custom">
        <input
          type="text"
          name="recipientName"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onFocus={() => setSelectedMode("custom")}
          placeholder="例: 株式会社〇〇 / 山田 太郎"
          maxLength={80}
        />
        <button type="submit">反映</button>
      </div>
    </form>
  );
}
