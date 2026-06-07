# DATABASE

本文档根据当前 `db/schema.sql`、`package.json`、`lib/db.ts`、`README.md`、`AGENTS.md` 和已有业务文档整理。未连接实际 Neon 数据库检查生产/测试数据；数据量、现有记录质量、线上 schema 是否完全同步均为「未确认」。

## 数据库概览

Foundr1 OS 使用 Neon/Postgres，应用侧通过 `@neondatabase/serverless` 连接。连接入口在 `lib/db.ts`：

- 必需环境变量：`DATABASE_URL`
- 导出对象：`sql = neon(process.env.DATABASE_URL)`

schema 文件是 `db/schema.sql`。当前项目没有独立迁移目录，schema 采用 `create table if not exists` 加 `alter table ... add column if not exists` 的方式维护，并包含少量历史清理语句，例如 `drop column if exists`、`drop constraint if exists`。

常用数据库命令在 `package.json`：

```bash
npm run db:check
npm run db:push
npm run db:seed
npm run db:data
```

- `npm run db:check`：运行 `scripts/check-db.mjs`，检查数据库连接/状态。
- `npm run db:push`：运行 `scripts/apply-schema.mjs`，把 `db/schema.sql` 应用到数据库。
- `npm run db:seed`：运行 `scripts/seed-db.mjs`。
- `npm run db:data`：运行 `scripts/check-data.mjs`。

## 重要维护规则

- schema 变更只改 `db/schema.sql`，除非项目以后引入正式迁移系统。
- 不要随意新增、删除、重命名字段或表。涉及字段删除、约束变更、数据迁移前必须先说明影响范围并确认。
- 当前系统尚在快速演进，schema 中已有许多 `alter table`。不要为了“整理”重排或压缩整个文件。
- レシート数据是供应商履行维度，不是商品明细维度；当前字段是 `purchase_order_supplier_fulfillments.receipt_photo_url`。
- POS、Web 预约、会员、厨房、销售分析之间有关联数据同步，修改相关表时必须检查 API 和 `lib/` 同步逻辑。
- 运行 `npm run db:push` 会真实修改连接的数据库，执行前必须确认当前 `DATABASE_URL` 指向的环境。

## 基础主数据

### stores

门店主表。保存门店名称、公司、地址、营业时间、预约说明、工资周期、社保默认地区、天气/考勤定位、班表提交截止规则等。

关键关系：

- `company_id -> companies.id`
- `default_procurement_staff_id -> employees.id`
- 被大量业务表引用，如订单、Timecard、POS、销售、菜单、手顺书、会员结算等。

### companies

公司/法人主表。包含法定名称、发票登记号、レシート用途文本、默认税率、地址、电话等。

### brands / store_brands

品牌与门店品牌关系。

- `brands`：品牌名称、类型、状态。
- `store_brands`：门店与品牌的多对多关系，并保存 POS 定价模式、称重单位、单位价格。

当前 schema 中对 `まぁ麻` 默认设置了按重量计价的更新逻辑。

### employees

员工/账号主表。包含姓名、login id、email、密码 hash、role、状态、Lark ID、session version、UI 偏好、员工基础资料等。

当前主要角色来自项目规则：

- `owner`
- `manager`
- `store_owner`
- `store_manager`
- `staff`
- `store_terminal`

旧文档中出现过 `buyer`，但当前 AGENTS.md 的角色列表不包含它，是否仍使用为「未确认」。

### employee_scopes

员工可见范围。role 只决定大类权限，具体门店、品牌、供应商可见性应结合 scope 判断。

字段包括：

- `employee_id`
- `scope_type`
- `store_id`
- `brand_id`
- `supplier_id`

### employee_work_stores

员工实际工作门店与工资/雇佣设置关系表。Timecard、排班、工资计算依赖该表。

### module_settings

模块设置表。以 `scope_key + module_key` 唯一，`settings` 使用 JSONB。

### os_audit_logs

操作审计日志。保存 actor、action、target、metadata、IP、user agent、创建时间。

## Timecard / 薪资 / 法定数据

相关表：

- `timecard_store_settings`
- `timecard_employee_settings`
- `employee_work_store_payroll_history`
- `timecard_punches`
- `timecard_shifts`
- `timecard_shift_requests`
- `timecard_shift_request_windows`
- `timecard_shift_request_candidates`
- `timecard_shift_request_messages`
- `timecard_shift_publications`
- `timecard_payroll_confirmations`
- `timecard_workload_settings`
- `payroll_statutory_alert_dismissals`
- `withholding_tax_tables`
- `withholding_tax_table_rows`
- `social_insurance_tables`
- `social_insurance_table_rows`
- `employment_insurance_rate_tables`
- `employment_insurance_rate_rows`

主要用途：

- 员工打卡、休息、シフト。
- 希望シフト和交代请求。
- 工资设置历史和月度工资确认。
- 店铺负荷分析。
- 源泉所得税、社会保险、雇用保险等法定数据。

注意：

- 工资历史表有有效期索引和按员工/门店查询索引。
- 修改工资和法定数据相关字段时，应检查 `lib/timecard.ts`、`app/api/timecard/**`、`app/os/timecard/**`、`app/store/timecard/page.tsx`。

## 商品 / 供应商 / 发注先

相关表：

- `product_categories`
- `product_subcategories`
- `products`
- `product_brand_usages`
- `suppliers`
- `supplier_locations`
- `product_supplier_options`

### products

商品 master，是运营基础数据，不只是展示数据。

重要字段：

- `name`
- `product_brand_name`
- `manufacturer`
- `category`
- `subcategory`
- `unit`
- `reference_price`
- `origin_countries`
- `package_quantity`
- `package_quantity_unit`
- `package_spec`
- `spec_note`
- `japanese_note`
- `photo_url`
- `brand_scope`
- `is_key_item`
- `is_price_sensitive`
- `storage_type`
- `usage_type`

注意：

- 当前 schema 已删除 `products.name` 唯一约束。
- 单价计算应优先使用数量，其次才使用重量；g/kg 可换算，ml/L 不按重量换算。

### product_supplier_options

商品与供应商/发注先的关系，包含 role、参考价格、最小订购量、lead time、购买 URL、备注等。

业务术语：

- `メイン発注先`
- `予備発注先`
- `臨時発注先`

## 发注 / 购买 / 納品 / レシート

相关表：

- `purchase_orders`
- `purchase_order_items`
- `purchase_order_supplier_fulfillments`
- `purchase_actuals`
- `delivery_batches`
- `delivery_batch_items`
- `purchase_exceptions`
- `price_records`

### purchase_orders

发注主表。保存订单号、门店、品牌、请求人、采购负责人、截止时间、优先级、状态、备注。

关键关系：

- `store_id -> stores.id`
- `brand_id -> brands.id`
- `requested_by -> employees.id`
- `assigned_to -> employees.id`

### purchase_order_items

发注明细。保存商品、品牌、请求数量、单位、实际数量、实际价格、采购备注、价格异常备注、选中供应商、门店确认信息等。

注意：

- `receipt_photo_url` 已从明细表删除。
- 不要把レシート重新放回 item 级别。

### purchase_order_supplier_fulfillments

供应商履行记录。用于网店/批发商下单到货和レシート管理。

重要字段：

- `purchase_order_id`
- `supplier_id`
- `supplier_name`
- `expected_arrival_date`
- `online_order_status`
- `receipt_photo_url`
- `receipt_confirmed_at`
- `receipt_confirmed_by`

唯一约束：

- `(purchase_order_id, supplier_name)`

### delivery_batches / delivery_batch_items

实体采购配送批次。网店和批发商不应强行套用实体配送 batch 流程。

### purchase_exceptions

采购异常、门店确认和后续处理记录。包括数量差异、价格异常、購入不可、备注等业务场景。

### price_records

商品价格历史。用于价格趋势、基准价格、供应商价格记录等。

## 菜单 / 手顺书 / 店铺运营

相关表：

- `procedure_books`
- `procedure_book_stores`
- `procedure_steps`
- `procedure_step_products`
- `procedure_action_types`
- `procedure_locations`
- `procedure_equipment`
- `procedure_containers`
- `procedure_materials`
- `procedure_variants`
- `procedure_step_actions`
- `menu_sources`
- `menu_categories`
- `menu_catalog_items`
- `menu_option_groups`
- `menu_options`
- `menu_store_settings`
- `menu_option_store_settings`
- `menu_external_platforms`
- `menu_change_sync_tasks`
- `store_operations`
- `store_temporary_closures`

### menu_catalog_items

OS 侧菜单主数据，是品牌网站、POS、手顺书、厨房显示共享的菜单源头。

重要字段：

- `brand_id`
- `store_id`
- `menu_source_id`
- `external_id`
- `item_kind`
- `name`
- `category`
- `description`
- `image_url`
- `base_price`
- `variable_schema`
- `sort_order`
- `is_active`

`item_kind` 可区分固定商品和可组装商品，例如 nanacha 固定饮品与 maamaa 麻辣烫 buildable 商品。

### menu_option_groups / menu_options

菜单选项和加料。`affects_procedure`、`rule_json` 可影响手顺书变体。

### procedure_books

手顺书主体。包含标题、分类、摘要、状态、品牌、版本号、发布时间、创建人、手顺类型、关联菜单项。

### procedure_steps / procedure_step_actions

步骤和结构化动作。动作可以关联商品、材料、设备、容器、位置和变体。

注意：

- 手顺书步骤应尽量链接商品 master 或结构化材料/设备，不要只复制文本。
- 菜单变体条件使用 JSONB，例如饮品规格/温度，或麻辣烫辣度/麻度/配料条件。

## Web 预约 / POS / 厨房制作 / 统一销售

相关表：

- `store_customer_orders`
- `store_customer_order_items`
- `order_production_tasks`
- `pos_store_settings`
- `pos_customer_display_states`
- `pos_cash_sessions`
- `pos_cash_movements`
- `pos_order_corrections`
- `sales_orders`
- `sales_order_items`
- `sales_import_batches`
- `store_sales_sources`
- `sales_import_rows`

### store_customer_orders

当前 Web 预约和 POS 现场订单的业务订单表之一。包含品牌、门店、来源、取餐码、状态、支付状态、支付 provider、支付账户、Square/KOMOJU 等支付字段、取餐时间、金额、顾客 summary、饮品字段、生命周期时间戳、会员、POS 现金会话等。

注意：

- Nanacha 饮品字段包括 `drink`、`size`、`temperature`、`sweetness`、`ice`。
- Maamaa 麻辣烫等复杂品牌应使用 `customer_summary` 和 `store_customer_order_items` 的结构化字段，不要硬塞进饮品字段。

### store_customer_order_items

订单明细结构化表。包含菜单项、商品名、size、temperature、sweetness、ice、option、toppings、数量、称重数量、金额等。

厨房显示应优先使用这里的结构化字段。

### order_production_tasks

厨房/制作任务表。按订单和 production area 生成任务，支持制作状态、打印状态、item summary、开始/完成时间等。

### pos_cash_sessions / pos_cash_movements / pos_order_corrections

POS 现金会话、现金出入、订单更正/退款/取消记录。

重要约束：

- `idx_pos_cash_sessions_one_open_per_store` 确保同门店只允许一个 open cash session（基于索引条件，具体条件见 schema）。

### sales_orders / sales_order_items

统一销售订单模型，用于 POS、Web 预约、外部配送、手动导入等渠道的经营分析。

`sales_orders` 重要字段：

- `source_order_id`
- `source_external_id`
- `brand_id`
- `store_id`
- `channel`
- `source_platform`
- `order_no`
- `pickup_code`
- `status`
- `payment_status`
- `ordered_at`
- `paid_at`
- `completed_at`
- `subtotal`
- `discount`
- `tax`
- `service_fee`
- `delivery_fee`
- `total`
- `currency`
- `payment_provider`
- `payment_reference`
- `receipt_url`
- `metadata`

`sales_order_items` 保存商品快照、数量、单价、选项金额、行合计和 modifiers JSON。

注意：

- 修改 checkout、POS、Web 预约、外部销售导入时，需要检查是否同步写入/更新 `sales_orders`。
- 不要只更新 `store_customer_orders` 而遗漏销售分析模型。

## 会员 / 积分 / 优惠券

相关表：

- `members`
- `member_identity_links`
- `member_brand_links`
- `member_accounts`
- `loyalty_tiers`
- `loyalty_reward_settings`
- `loyalty_point_ledger`
- `loyalty_stamp_campaigns`
- `loyalty_stamp_ledger`
- `member_coupons`
- `loyalty_settlement_entries`

### members

顾客会员主表。包含会员号、public token、姓名、电话、email、生日、语言、状态、metadata。

唯一索引：

- 非空 phone 唯一。
- 非空 email lower-case 唯一。

### member_accounts

会员账户汇总，包括积分余额、累计获得/使用积分、累计消费、来店次数、当前 tier。

### loyalty_point_ledger

积分流水。通过唯一索引避免同一订单同一 movement type 重复入账。

### loyalty_stamp_campaigns / loyalty_stamp_ledger

Stamp card 活动与流水。schema 中会为 nanacha 插入/更新默认 stamp campaign。

### member_coupons

会员优惠券。保存 coupon code、折扣类型/金额、状态、来源、过期时间、使用订单与门店。

### loyalty_settlement_entries

积分跨门店/公司结算记录。

## 通知 / 外部集成

相关表：

- `os_notifications`
- `web_push_subscriptions`
- `store_payment_accounts`

### os_notifications

站内通知表。保存收件人、类型、标题、正文、链接、Lark 发送状态、读取时间。

Lark 是可选增强，失败不应阻断核心业务。

### web_push_subscriptions

Web Push 订阅。保存 endpoint、p256dh、auth、user agent、成功/错误时间、撤销时间。

### store_payment_accounts

门店支付账户配置。保存 provider、密钥或环境变量名、webhook secret、可用支付方式等。

注意：

- 不要把真实 secret 写进文档或提交到仓库。
- 支付相关表改动前必须检查 Square/KOMOJU webhook 和 checkout API。

## 分析 / 现场记录 / 商品比较

相关表：

- `analytics_expenses`
- `sales_analysis_settings`
- `field_notes`
- `field_note_comments`
- `product_comparisons`

### analytics_expenses

经营分析的月度经费设置。按门店、分类、名称、金额、开始月、结束月保存。

业务分类应保持：

- `固定費`
- `変動費`
- `雑費`

采购/发注数据 feeding product costs，不应与月度经费混淆。

### field_notes

现场记录。用于商品创意、供应商发现、更便宜渠道、现场备注和图片。

### product_comparisons

商品比较。支持候选商品、供应商、采购 URL、外币/CNY、汇率、运费、税费、照片、归档等。

注意：

- 只对 g/kg 做重量换算。
- ml/L 不应当作重量。
- `箱` 需要运费比较时应要求 case weight。

## 索引与唯一约束提示

schema 已为常用查询建立索引，主要覆盖：

- 发注订单按门店/状态、截止时间。
- 供应商履行按订单。
- 配送批次按订单/状态。
- 异常按状态。
- 价格记录按商品/时间。
- 通知按收件人/读取状态/时间。
- Timecard 按员工/门店/日期。
- 菜单与手顺书按品牌、门店、状态、排序。
- Web 预约订单按门店/状态、取餐码、支付 session、支付 ID、会员。
- 厨房任务按订单、门店/状态。
- POS cash session 按门店/日期，并限制 open session。
- 统一销售按门店/渠道/支付时间、下单时间、渠道/状态。
- 会员 phone/email、积分流水、stamp 流水、优惠券状态。

新增高频查询 API 时，应先检查是否已有合适索引；不要盲目加索引，尤其是多列唯一索引或条件唯一索引。

## 高风险修改清单

以下修改必须先说明影响范围，并通常需要完整验证：

- `employees`、`employee_scopes`、`employee_work_stores`：影响登录、权限、Timecard、可见范围。
- `store_customer_orders`、`store_customer_order_items`、`sales_orders`、`sales_order_items`：影响 Web/POS/厨房/销售分析。
- `store_payment_accounts` 与支付字段：影响 checkout、webhook、refund、レシート。
- `purchase_order_supplier_fulfillments`：影响供应商履行、到货、レシート。
- `products`、`menu_catalog_items`、`menu_options`：影响商品 master、菜单、品牌网站、POS、手顺书。
- `members`、`loyalty_*`、`member_coupons`：影响会员、积分、优惠券和结算。
- 条件唯一索引、外键、`drop column`、`drop constraint`：可能导致数据丢失或线上写入失败。

## 变更验证建议

普通 schema 或数据库相关改动后：

```bash
npm run db:check
npm run build
git diff --check
```

需要真实应用 schema 时，在确认数据库环境后执行：

```bash
npm run db:push
```

涉及数据流的改动还应按模块验证：

- 发注/采购：创建发注、采购记录、供应商履行、納品、店舗確認、レシート上传/预览。
- POS/Web 预约：checkout、支付回调、订单状态、厨房任务、取餐显示、销售订单同步。
- 菜单：OS 菜单保存、品牌兼容 API、POS 显示、Web 预约读取、手顺书条件。
- Timecard：打卡、休息、希望シフト、工资确认。
- 会员：登录、会员资料、积分流水、stamp、优惠券使用。
