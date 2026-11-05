"use client";

import type { PosCustomerDisplayWeighingDraft } from "../../../../lib/pos-customer-display";
import styles from "./CustomerDisplayWeighing.module.css";

export type WeighingLanguage = "ja" | "en" | "zh" | "zh-Hant" | "ko" | "vi" | "ne";
const copy = {
  ja: { title: "選択中の商品", waiting: "重量を確認しています", stable: "確認済みの重量", manual: "手入力の重量", amount: "この商品の金額", notAdded: "まだ合計に含まれていません", cartTotal: "追加済み商品の合計", noItems: "追加済みの商品はありません", extras: "追加分", tare: "容器差引", included: "税込", excluded: "税抜", taxNote: "消費税は会計の合計で計算します", stale: "接続・重量を確認しています" },
  en: { title: "Current item", waiting: "Waiting for weight", stable: "Confirmed weight", manual: "Manually entered weight", amount: "This item", notAdded: "Not included in the total yet", cartTotal: "Total of added items", noItems: "No items added yet", extras: "Options", tare: "Plate deducted", included: "Tax included", excluded: "Before tax", taxNote: "Tax is calculated on the order total", stale: "Checking connection and weight" },
  zh: { title: "正在选择的商品", waiting: "等待确认重量", stable: "已确认的重量", manual: "手动输入的重量", amount: "本商品金额", notAdded: "尚未计入合计", cartTotal: "已添加商品合计", noItems: "尚未添加商品", extras: "加料", tare: "已扣盘重", included: "含税", excluded: "未税", taxNote: "消费税在结账合计中计算", stale: "正在确认连接和重量" },
  "zh-Hant": { title: "正在選擇的商品", waiting: "等待確認重量", stable: "已確認的重量", manual: "手動輸入的重量", amount: "本商品金額", notAdded: "尚未計入合計", cartTotal: "已加入商品合計", noItems: "尚未加入商品", extras: "加料", tare: "已扣盤重", included: "含稅", excluded: "未稅", taxNote: "消費稅在結帳合計中計算", stale: "正在確認連線和重量" },
  ko: { title: "선택 중인 상품", waiting: "무게 확인 중", stable: "확인된 무게", manual: "직원이 입력한 무게", amount: "이 상품 금액", notAdded: "아직 합계에 포함되지 않았습니다", cartTotal: "추가한 상품 합계", noItems: "아직 추가한 상품이 없습니다", extras: "추가 옵션", tare: "용기 무게 제외", included: "세금 포함", excluded: "세금 별도", taxNote: "세금은 주문 합계에서 계산됩니다", stale: "연결과 무게 확인 중" },
  vi: { title: "Món đang chọn", waiting: "Đang xác nhận trọng lượng", stable: "Trọng lượng đã xác nhận", manual: "Trọng lượng nhập tay", amount: "Giá món này", notAdded: "Chưa bao gồm trong tổng tiền", cartTotal: "Tổng các món đã thêm", noItems: "Chưa có món được thêm", extras: "Phần thêm", tare: "Đã trừ đĩa", included: "Đã gồm thuế", excluded: "Chưa gồm thuế", taxNote: "Thuế được tính trên tổng đơn hàng", stale: "Đang kiểm tra kết nối và trọng lượng" },
  ne: { title: "छानिँदै गरेको वस्तु", waiting: "तौल पुष्टि हुँदैछ", stable: "पुष्टि गरिएको तौल", manual: "हातले लेखिएको तौल", amount: "यस वस्तुको रकम", notAdded: "कुल रकममा अझै समावेश छैन", cartTotal: "थपिएका वस्तुहरूको कुल", noItems: "अझै वस्तु थपिएको छैन", extras: "थप विकल्प", tare: "प्लेटको तौल घटाइएको", included: "करसहित", excluded: "करबाहेक", taxNote: "कर अर्डरको कुल रकममा गणना गरिन्छ", stale: "जडान र तौल जाँच हुँदैछ" }
};
export function customerWeighingText(language: WeighingLanguage) { return copy[language]; }

export function CustomerDisplayWeighing({ preview, language, fresh }: {
  preview: PosCustomerDisplayWeighingDraft; language: WeighingLanguage; fresh: boolean;
}) {
  const text = copy[language];
  const ready = fresh && preview.status !== "waiting" && preview.quantity !== null && preview.amount !== null;
  const yen = (value: number) => `¥${Math.round(value).toLocaleString("ja-JP")}`;
  const number = (value: number) => value.toLocaleString("ja-JP", { maximumFractionDigits: 3 });
  const status = !fresh ? text.stale : !ready ? text.waiting : preview.source === "manual" ? text.manual : text.stable;
  return <section className={styles.card} data-pos-weighing data-weighing-status={ready ? preview.status : "waiting"}>
    <header className={styles.heading}><span>{text.title}</span><strong title={preview.itemName}>{preview.itemName}</strong></header>
    <div className={styles.values} aria-live="polite">
      <div><span>{status}</span><strong data-weighing-weight>{ready ? number(preview.quantity!) : "—"}<small>{preview.unit}</small></strong></div>
      <div className={styles.amount}><span>{text.amount} · {preview.priceTaxMode === "tax_excluded" ? text.excluded : text.included}</span><strong data-weighing-amount>{ready ? yen(preview.amount!) : "—"}</strong></div>
    </div>
    <div className={styles.details}>
      <p className={styles.formula}><span>¥{number(preview.unitPrice)}/{preview.unit}</span>{preview.optionsAmount !== 0 ? <span>{text.extras} {preview.optionsAmount > 0 ? "+" : "−"}{yen(Math.abs(preview.optionsAmount))}</span> : null}
        {ready && preview.source === "capture" && preview.tareGrams ? <span>{text.tare} {number(preview.tareGrams)} g</span> : null}</p>
      {preview.optionLabel ? <p>{preview.optionLabel}</p> : null}
      {preview.priceTaxMode === "tax_excluded" ? <p>{text.taxNote}</p> : null}
    </div>
    <p className={styles.note}>{text.notAdded}</p>
  </section>;
}
