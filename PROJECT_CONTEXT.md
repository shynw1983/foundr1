# PROJECT_CONTEXT

本文档根据当前仓库中的 `README.md`、`AGENTS.md`、`docs/`、`package.json`、`db/schema.sql`、`app/` 路由、`lib/` 工具模块、`public/locales/os/` 翻译资源整理。没有从外部系统确认生产数据状态；凡无法从代码直接确认的事项标记为「未确认」。

## 项目背景

Foundr1 OS 是面向餐饮门店运营的后台与现场工作台。项目当前重点不是 `foundr1.jp` 的公开官网，而是管理后台 `/os` 与门店现场入口 `/store`。现有代码已从早期发注/采购后台扩展为餐饮门店 OS：发注、购买、纳品、レシート、商品总表、供应商、门店、品牌、员工权限、电子手顺书、菜单、POS、Timecard、销售分析、会员积分等模块共享同一套基础数据。

项目关联两个独立品牌网站项目：

- nanacha milk tea site：`/Users/wushengyin/Desktop/nanacha New HP`
- maamaa / まぁ麻 malatang site：`/Users/wushengyin/Desktop/maamaa`

Foundr1 OS 负责共享菜单/目录、门店营业状态、公开 checkout API、订单记录、厨房/制作数据、POS 链接、会员/积分记录。品牌网站是顾客侧前端，应向 Foundr1 OS 传递结构化订单和会员字段，避免重复实现后台业务逻辑。

## 业务目标

当前产品目标是把餐饮门店日常运营闭环统一在 Foundr1 OS 内：

- 门店提出「発注」需求。
- 采购/负责人执行「購入」。
- 商品「納品」后由门店做「店舗確認」。
- レシート按供应商履行维度保存和复核。
- 商品总表、菜单、手顺书、POS、Web 预约、厨房制作、会员积分和经营分析共用基础数据。
- `/os` 面向管理、设置、确认和分析；`/store` 面向现场快速操作。

重要日语业务用语：

- `発注`：门店侧请求/需求。
- `購入`：实际购买工作。
- `納品`：交付/到货。
- `店舗確認`：门店侧确认。
- `レシート`：收据，不使用 `小票`。
- `発注先`：供应商/下单目的地。

## 技术栈

- Framework：Next.js App Router，当前依赖 `next ^16.2.6`。
- Language：TypeScript / React，当前依赖 `typescript 5.8.3`、`react ^19.2.3`。
- Database：Neon/Postgres，通过 `@neondatabase/serverless` 与 `DATABASE_URL` 连接。
- File storage：Vercel Blob，用于商品、菜单、比较、レシート等图片上传。
- Styling：全局 CSS 在 `app/globals.css`，主题 token 以深绿 `--green`、中性色、蓝/琥珀/红等语义色为主。
- Icons：`lucide-react`。
- Auth：
  - OS 员工登录使用自有 session cookie：`foundr1_os_session`，逻辑在 `lib/auth.ts`。
  - 会员端 `/member` 依赖 Clerk；README 标注 Clerk 只用于顾客身份，Foundr1 OS 员工登录仍使用自有 session。
- Notifications：站内通知表为 `os_notifications`，Lark 集成在 `lib/lark.ts`，Web Push 相关逻辑在 `lib/web-push.ts`。
- Realtime：Pusher/Pusher JS 依赖存在，并有订单实时配置/鉴权 API。
- Email：Resend 依赖和 `lib/email.ts`。
- PDF/receipt：`puppeteer-core`、`@sparticuz/chromium`、`qrcode`、`components/receipts/`、`lib/receipt-pdf.ts`。
- Spreadsheet import：`xlsx`，销售导入逻辑在 `lib/sales-imports.ts` 与 `app/api/sales/imports/route.ts`。

## 目录结构

- `app/`：Next.js App Router 页面与 API。
  - `app/os/`：Foundr1 OS 管理后台。
  - `app/store/`：门店现场工作台。
  - `app/member/`：顾客会员页。
  - `app/api/`：业务 API，包括 auth、orders、procurement、products、menus、store、timecard、sales、analytics、loyalty、webhooks 等。
  - `app/globals.css`：全局样式与大量模块样式。
- `lib/`：数据库访问和业务工具，包括采购、认证、Lark、POS、会员、销售订单、门店营业状态、Web Push、上传安全、レシート等。
- `db/schema.sql`：数据库 schema 和增量 `alter table` 语句。
- `scripts/`：数据库初始化/检查/应用 schema、导入品牌菜单、修复菜单规则、创建管理员等脚本。
- `components/receipts/`：在线订单レシート预览/操作组件。
- `docs/`：业务框架、路线图、待办记录。
- `public/`：PWA manifest、service worker、品牌 logo、OS 翻译资源。
- `fonts/`：Noto Sans CJK JP 字体文件和许可说明。

## 数据库结构概览

数据库定义集中在 `db/schema.sql`。主要表按领域可分为：

- 基础数据：`stores`、`companies`、`brands`、`store_brands`、`employees`、`employee_scopes`、`employee_work_stores`、`module_settings`、`os_audit_logs`。
- 店铺支付/营业：`store_payment_accounts`、`store_operations`、`store_temporary_closures`。
- Timecard/薪资：`timecard_store_settings`、`timecard_employee_settings`、`timecard_punches`、`timecard_shifts`、`timecard_shift_requests`、`timecard_payroll_confirmations`、`timecard_workload_settings`、税率/保险相关表。
- 商品与供应商：`product_categories`、`product_subcategories`、`products`、`product_brand_usages`、`suppliers`、`supplier_locations`、`product_supplier_options`。
- 发注/采购：`purchase_orders`、`purchase_order_items`、`purchase_order_supplier_fulfillments`、`purchase_actuals`、`delivery_batches`、`delivery_batch_items`、`purchase_exceptions`、`price_records`。
- レシート/通知：レシート URL 存于 `purchase_order_supplier_fulfillments.receipt_photo_url`；通知表为 `os_notifications`，Web Push 表为 `web_push_subscriptions`。
- 现场记录与商品比较：`field_notes`、`field_note_comments`、`product_comparisons`。
- 手顺书/菜单：`procedure_books`、`procedure_book_stores`、`procedure_steps`、`procedure_step_products`、`procedure_action_types`、`procedure_locations`、`procedure_equipment`、`procedure_containers`、`procedure_materials`、`procedure_variants`、`procedure_step_actions`、`menu_sources`、`menu_categories`、`menu_catalog_items`、`menu_option_groups`、`menu_options`、`menu_store_settings`、`menu_option_store_settings`、`menu_external_platforms`、`menu_change_sync_tasks`。
- 订单/厨房/POS：`store_customer_orders`、`store_customer_order_items`、`order_production_tasks`、`pos_store_settings`、`pos_customer_display_states`、`pos_cash_sessions`、`pos_cash_movements`、`pos_order_corrections`。
- 统一销售：`sales_orders`、`sales_order_items`、`sales_import_batches`、`store_sales_sources`、`sales_import_rows`。
- 会员/积分：`members`、`member_identity_links`、`member_brand_links`、`member_accounts`、`loyalty_tiers`、`loyalty_reward_settings`、`loyalty_point_ledger`、`loyalty_stamp_campaigns`、`loyalty_stamp_ledger`、`member_coupons`、`loyalty_settlement_entries`。
- 分析/经费：`analytics_expenses`、`sales_analysis_settings`。

注意：schema 中保留了较多 `alter table add column if not exists` 与少量 `drop column/drop constraint`，说明项目仍在快速演进阶段。不要把这些历史迁移形态误认为最终稳定 schema。

## 核心功能

### `/os` 管理后台

`app/os/page.tsx` 显示主要模块：

- 店舗ワークベンチ：跳转 `/store`。
- 発注・購入管理：从 `/os/orders` 到 `/os/procurement`、`/os/history` 等。
- 店舗運営：当前以 `/os/procedures` 手顺书为核心，并关联菜单/商品。
- タイムカード：出退勤、希望シフト、勤務実績、給与、负荷分析。
- 経営分析：销售、人件费、原价/经费、月次损益。
- POS：会计、税率/支付设置、日次レジ締め、交易履历。
- 共有数据：商品、菜单、会员、门店、员工、系统设置。

### `/store` 店铺现场工作台

`app/store/page.tsx` 显示现场模块：

- 注文：Web 预约订单处理。
- キッチン：Web 预约与 POS 制作任务显示。
- 受取表示：顾客侧取餐号码显示。
- 販売状態：商品销售可否、售罄/恢复、现场 memo。
- 手順書：门店/品牌/菜单条件匹配的公开手顺书。
- タイムカード：员工打卡、休息、班表、希望班。
- POS：店头会计、订单输入、收款、レジ开闭、返金。

### 公开/会员/品牌接口

- `/member`：顾客会员页，展示会员资料、积分、优惠券、stamp card，并使用 Clerk 登录。
- `/api/public/menus`、`/api/public/menus/nanacha-compatible`、`/api/public/menus/maamaa-compatible`：品牌网站读取菜单数据。
- `/api/public/orders/nanacha/checkout`、`/api/public/orders/maamaa/checkout`：品牌网站 checkout 入口。
- `/api/webhooks/square`、`/api/webhooks/komoju`：支付回调。

## 当前完成进度

从代码可确认：

- Next.js App Router 项目结构完整，`package.json` 提供 `dev`、`build`、`db:push`、`db:check`、`db:seed` 等脚本。
- `/os` 和 `/store` 入口已经存在，导航和模块入口已覆盖主要业务模块。
- 数据库 schema 已覆盖采购、商品、供应商、Timecard、菜单、手顺书、POS、销售订单、会员积分、通知、审计等核心领域。
- OS 端自有登录、权限角色和员工 scope 数据模型已存在。
- UI 翻译资源存在于 `public/locales/os/zh-Hans.json`、`zh-Hant.json`、`zh.json`；新增可见文案需要补翻译。
- 菜单导入脚本 `scripts/import-brand-menus.mjs` 已存在，用于从关联品牌网站导入菜单。
- Vercel Blob、Lark、Web Push、Resend、Pusher 等集成入口/依赖已存在，但运行时配置状态未确认。
- `.next.broken-build-cache/`、`app/store/kitchen/`、`app/store/pickup-display/`、`fonts/OFL.txt` 当前显示为未跟踪文件；是否应纳入版本控制未确认。

未确认：

- 当前数据库中真实生产/测试数据规模和完整性。
- 当前部署环境变量是否完整配置。
- 所有 API 是否已通过最新端到端验证。
- POS、Timecard、会员积分、销售分析等模块在业务上是否已经达到可正式上线标准。
- `buyer` 角色在旧文档中出现，但当前 AGENTS.md 的角色列表以 `owner`、`manager`、`store_owner`、`store_manager`、`staff`、`store_terminal` 为准；是否仍保留 `buyer` 未确认。

## 下一步计划

根据现有 `docs/operations-platform-roadmap.md` 与代码结构，合理的下一步是：

- 持续完善电子手顺书：变体条件、步骤动作、商品/材料/设备/容器引用、门店适用范围。
- 打通菜单、POS、Web 预约、厨房制作、手顺书之间的结构化数据一致性。
- 完善 `/store/orders` 为统一现场订单工作台，覆盖 Web 预约、POS、外部配送和手动订单。
- 继续推进统一销售模型 `sales_orders` / `sales_order_items`，减少只面向 Web 预约的过渡逻辑。
- 完善 Timecard、排班、工资、负荷分析和法定数据更新提醒。
- 完善经营分析：销售、人件费、原価、経費、月次損益的口径和可视化。
- 明确会员/积分/优惠券与 POS、Web checkout 的结算闭环。
- 为重要流程补充端到端验证：品牌网站 checkout、POS checkout、厨房显示、レシート、会员积分、销售汇总。
- 清理或确认未跟踪文件是否应提交：`.next.broken-build-cache/` 应通常不提交；`app/store/kitchen/`、`app/store/pickup-display/` 是否为新业务代码需由维护者确认。
