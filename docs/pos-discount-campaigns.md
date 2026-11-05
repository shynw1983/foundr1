# POS discounts and campaigns

The October 26, 2026 decision adds store-scoped automatic campaigns alongside existing staff-selected discount presets. It does not activate a campaign or choose dates/prices for any live store.

## Configuration and pricing

- `/os/pos` → **割引・キャンペーン** → **キャンペーンを追加**. New campaigns start disabled and default to today's start/end dates; name, benefit, period and conditions must be reviewed before enabling.
- Campaign rules use the existing `pos_store_settings.discount_presets` JSON array. A preset gains `applicationMode: manual | campaign`, inclusive Japanese calendar dates `startsOn` and `endsOn`, and integer-yen `minimumSubtotal`. Existing records without these fields remain manual. No DDL or migration is required.
- The start day begins at 00:00 Asia/Tokyo. The entire end day is included. Invalid/reversed dates or malformed minimums cannot save and fail closed when evaluating stored rules.
- The threshold is the whole cart's **pre-discount merchandise subtotal**, in the POS's configured product price basis (including tax for tax-included prices, excluding tax for tax-excluded prices). Selected options are part of that subtotal. The benefit itself is limited to the existing configured all/category/item-kind/brand target. It does not discount unrelated target lines. A minimum of zero removes the threshold.
- Percent OFF retains floor-to-integer-yen rounding. Fixed discounts are capped at eligible merchandise value. There are at most 20 combined presets and campaigns.
- A manual discount requires staff selection; its eligibility is not inferred. Compare that selected manual discount with every currently eligible campaign and use the greatest **single** discount amount. Never add campaigns or manual discounts together. A tie keeps the staff selection; campaign ties use a stable key order.
- Coupon combination and stamp eligibility come from the winning preset's existing flags. Campaigns do not introduce a separate coupon/loyalty policy.

## Checkout and output

The shared policy in `lib/pos-discount-campaigns.ts` drives the POS preview and authoritative checkout. The POS calibrates its promotion clock from the server, updates on date boundaries and visibility changes, and shows automatic benefits without another staff button.

The client submits an applied-key/amount quote. The server recalculates from its current store settings, time and trusted catalog prices before any payment persistence. A stale/missing campaign quote returns `409 POS_DISCOUNT_CHANGED` with current presets and server time. The POS retains the cart, refreshes the discount calculation and requires another cashier confirmation. It does not create a replacement/offline sale for that rejection or an uncertain payment. Legacy clients may continue manual-only checkout; they must reload when an automatic campaign changes the payable amount.

The existing financial discount, proportional item allocations, tax, cash change, receipts and customer display use the winning amount. The POS total and completion notice show the actual benefit name, rather than a fixed student-discount label. Paid orders record the winning key/name and an immutable `discountCampaign` rule snapshot. Editing or ending a campaign never reprices a paid order or saved print document.

Active discounts/campaigns retain the existing offline restriction. A previously completed queued offline sale keeps its recorded price; today's campaign is never retrospectively applied during synchronization. Table QR bill payments retain their already-established bill; these campaigns apply to merchandise checkout through the normal POS cart. Debug checkout remains nonpersistent and can preview campaigns/customer display.

## Safe configuration ownership

Discount-section saves own only `discount_presets`. Clients use `discountCampaignVersion: 1`; an older editor is rejected if it would erase campaigns it cannot edit. The scoped update also checks existing campaigns atomically. Full-settings callers omitting discounts retain the current discount JSON. Printing, scale, customer-display, operator and other-store settings retain their own boundaries.

Store scope and POS-management permissions are checked by the existing APIs. No public Web予約 or delivery checkout imports this POS-only policy; the two brand sites need no change. Native printers already render the financial discount amount, so no APK update is needed for campaigns.

## Per-bowl choice benefits (2026-10-27)

`/os/pos` → **1杯ごとの特典を追加** creates a disabled-by-default campaign with a ¥1,000 per-bowl threshold, 10% discount draft and no required dates. Configure the intended rate and gifts, then enable and save. No live store or campaign is automatically enabled by deployment. POS menu updates remain manual.

- A bowl's threshold includes its weight/body price plus all paid selected options, before discounts. ¥800 + ¥200 qualifies at ¥1,000. Two ¥800 bowls never combine to qualify. Non-bowl products cannot claim this benefit. Every bowl has a separate choice and quantity of one. Duplicating a bowl clears its choice.
- A cashier chooses **割引** or the configurable **プレゼント** button; selecting one replaces the other, or both can be cleared. Each qualifying bowl may choose one gift. Gifts never contribute to the threshold. No choice leaves this campaign unapplied.
- Gift sources are either explicit store menu product IDs, or brand-and-category pairs. A category is a live association: later sellable products added to it qualify automatically. Explicit IDs never expand. Both source types may be combined. Category labels/identity are those of the POS menu; after renaming a category, review and reselect its campaign association.
- The gift selector excludes unavailable/hidden, weight-priced, bowl and required-customization products. This release supports simple fixed-price products; products requiring mandatory choices must first have a suitable standalone version. Source menus and store-owned dine-in menus retain separate identities.
- Dates may be left blank together for a permanent campaign controlled by the enabled switch. Otherwise both dates are required and remain inclusive Japanese dates. This option also works for automatic whole-order campaigns.
- Existing automatic/manual discount policy first selects its best whole-order discount. Its integer discount is allocated only to eligible lines. For a bowl with an explicit campaign choice, compare that choice's discount (or gift's normal price) with the other discount allocated to that bowl and use the larger benefit, never both. A tie retains the explicit bowl choice. Unrelated lines retain their applicable discount. A gift is not automatically replaced with the campaign's alternative discount button; it competes only against other selected/automatic discount rules.
- The visible controls and customer display show the effective gift/discount; if another discount is better, the cashier sees that explanation. Incomplete gift selection or a stale invalid bowl choice blocks confirmation until reselected/cleared. Offline benefit checkout is blocked. Debug preview remains nonpersistent.

### Checkout, receipts, inventory and refunds

The server reconstructs each bowl and the gift catalog from trusted scoped menu data. It checks threshold, sale status, dates, rule selection and the version-2 quote before any payment or ticket allocation. Forged or stale choices cannot create a sale. Existing checkout request IDs retain idempotent behavior. `bowlBenefits` in the paid order summary is an immutable per-bowl snapshot of rule, food subtotal, effective choice, original gift price and evaluation time.

A gift uses the existing product-backed customization contract (`campaign_gift`, `linkedItems`) attached to its bowl. It carries both store-menu and canonical product identities, quantity one, zero unit price, `complimentary:true`, campaign key and `originalUnitPrice`. Kitchen/finishing/receipt snapshots therefore retain the named gift on the correct bowl; existing inventory synchronization consumes its product identity. Monetary discounts are allocated directly to their affected bowl lines. Refunds use the recorded paid amounts; a gift never adds cash refund value. Saved orders/print documents never reprice when configuration changes. Native printer payloads already accept these structured options, so no APK update is required. Physical printing/inventory deduction still depends on the store's existing printer/SKU mappings.

Settings remain in `discount_presets` JSON: `campaignBasis: order | bowl_choice`, `giftButtonLabel`, `giftCategories`, `giftItemIds`. No DDL is required. `discountCampaignVersion:2` protects bowl campaign fields against older editors, including atomic SQL protection. Current v1 automatic campaigns remain readable; old POS clients do not apply an unselected bowl benefit. OS/store scope and management permissions remain enforced. Public Web予約/delivery menus and their checkout rules are unchanged.

## 選択肢のプレゼント

管理画面では商品・カテゴリに加え、選択肢の個別指定と選択肢グループ全体を指定できます。グループ全体には将来追加した販売可能な選択肢も含みます。非表示・販売停止・負の価格の選択肢は除外します。通常価格0円の選択肢は指定可能です。

選択肢は対象の1杯にサービス0円の独立したカスタマイズとして追加し、元の選択肢ID、グループID、ローカル由来、リンク商品、50g等の規格を保持します。有料選択と同じ選択肢でも分離し、最低金額・支払額に加算しません。通常の必須選択や個数制限を置き換えません。注文・伝票・客表示・返金は保存済みのスナップショットを利用します。サーバーが現在の店舗カタログと設定から再検証し、クライアントの価格を信用しません。

設定保存はdiscountCampaignVersion=3。選択肢贈品を含む既存設定は旧version2以下の画面からの上書きを防ぎます。商品贈品のみの既存version2クライアントは互換です。DBスキーマと通常の有料商品・選択肢の対応関係は変更しません。

## 1杯ごとの特典の種類

`bowlBenefitMode`は`choice`（割引かプレゼント）、`discount_only`（割引のみ）、`gift_only`（プレゼントのみ）。未指定の既存設定はchoiceです。管理画面とPOSは該当する入力・ボタンだけを表示し、サーバーでも禁止された選択を409で拒否します。gift_onlyは割引率・割引額を要求せず、discount_onlyは贈品設定を要求しません。切替時は以前の設定を保持します。gift_onlyも既存の他の活動・手動割引との比較、非重複ルールを保持し、全体の割引機能を無効化する設定ではありません。

保存version4は非choice設定を旧画面からの上書きから保護します。既存choiceはversion2/3互換で、選択肢贈品のversion3保護も維持します。開店・番号・印刷等の設定は変更しません。

## 贈品範囲の選択画面

商品カテゴリ・選択肢グループは折りたたまず、名前・通常価格とチェックを一覧表示します。検索は名称とグループ名のNFKC正規化検索、選択済みのみ表示にも対応。選択済みサマリーは検索対象外の選択を含む全体を表示し、現在選択可能な実項目数と、現在選べない参照を別に表示します。商品と選択肢の同名項目は別の出所として表示します。

全体チェックは将来追加も含む動的設定です。全体チェックのON/OFFはそのグループの個別参照を整理してON時に二重設定、OFF時に意図しない選択残りを防ぎます。全体選択中の一つだけ外すと、残りの現在選べる項目を明示的な個別選択に変換し、以後の追加は自動対象にしません。サマリーからの解除も同じ処理です。現在選べない設定はユーザーが解除するまで保存し、検索・フィルタ・表示変更では設定を変更しません。設定API、DB、POS評価、贈品の価格・規格・出所の契約は変更しません。

## コンパクトな活動一覧

初期表示は全活動を折りたたみ、名称・有効/停止・計算単位・最低金額・割引/プレゼント・期間と贈品候補数を表示します。名称/条件検索と有効/停止フィルタは表示だけを変更し、保存内容には影響しません。編集は一度に1件で、閉じたり別件を開いても親フォームの未保存編集を保持します。変更がある活動に未保存を表示し、保存完了後に解除します。新規追加は検索/状態フィルタを解除して新規行を自動展開。検証エラー時は該当活動を表示して展開します。既存の設定JSON、保存API、価格、活動適用方式は変更しません。

## POS settings groups and save ownership

OS POS settings have five functional groups: checkout/operations (tax, default pricing and fulfillment), scale (tare and stability filter), printing (connections and documents), customer display (standby designer and advertising), and discounts/campaigns. Business overview is a separate read-only collapsed panel. Advanced scale filtering, printer setup/testing and standby editing expand within their group instead of occupying separate navigation pages.

A sticky save bar saves changed sections within the active group only. Each part retains its existing scoped API and permissions; the group is not a cross-request transaction. Local tare/filter/fulfillment/designer validation runs before starting a grouped save. During the sequence, navigation, store switching and editing are locked. If a later request fails, successful parts remain saved, the failed/unattempted drafts remain dirty, and the notice explicitly states that part was saved. Retry sends only the remaining changed sections. Saved baselines merge functionally so one response cannot erase a preceding successful save or another group's drafts. The existing explicit save-and-leave action still saves the full form.

General tax/sales and linked brand defaults retain their existing transaction and scope checks. Advertising preserves standby designer and unknown JSON fields. Existing discount evaluation, order data, printer behavior, device bindings, APK and database schema are unchanged. Device binding remains in the existing equipment settings, linked from the scale group.

### Daily summary refresh and optional default bowl discounts

The POS daily card uses a scoped, no-store summary endpoint, independently of menu refresh. Order/reconciliation events, a visible-page 15-second fallback, return-to-page/online events and a compact manual refresh update payment and product statistics without replacing the cart or menu. Responses started before a newer checkout/refund projection or store switch are discarded; failed refreshes retain prior values and show retry text. Locally unsynchronized sales remain explicitly provisional and are not overwritten by a server-only total.

Each per-bowl campaign may set `bowlDefaultChoice` to `discount`; missing/`none` preserves manual selection. Qualification remains per single bowl including paid options before discount, respecting store, target, date and enabled status. Explicit gifts/discounts and per-bowl opt-outs override the default; overlapping defaults choose one greatest eligible discount with a stable key tie-break. Gifts and discounts do not stack, and existing comparisons with other benefits remain in force. Server checkout evaluates the same default and requires the matching version-2 bowl quote, so stale clients cannot silently charge full price. The OS editor submits discount configuration version 5; older editors cannot erase a saved default, including concurrent saves. Publishing does not enable the default on all stores: activation of an existing store campaign is a separate scoped configuration write. No schema or APK change is needed.
