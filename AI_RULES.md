# AI_RULES

本文档规定以后 AI 在 Foundr1 OS 项目中修改代码时必须遵守的规则。若本文件与用户本轮明确指示冲突，以用户本轮指示为准；若涉及破坏性操作、数据库字段、权限或支付流程，必须先说明影响范围并等待明确确认。

## 基本原则

- 修改前先读代码。必须先检查相关页面、API、`lib/` 工具、`db/schema.sql`、已有 docs、样式和翻译文件，再判断怎么改。
- 不要凭空假设业务。无法从代码或文档确认的内容标记为「未确认」，不要写成已完成事实。
- 不要随意重构。除非用户明确要求或不重构无法完成任务，否则保持改动最小、局部、可回滚。
- 不要为了“顺手整理”改无关文件。尤其不要格式化大文件、重排 schema、重命名目录、替换 UI 体系。
- 不要覆盖用户已有改动。遇到未提交/未跟踪文件时，先识别是否与当前任务有关；无关则忽略，有关则小心合并。
- 不要修改业务代码以外的东西来绕过问题。需要依赖、网络、数据库或部署权限时，说明原因并按项目流程执行。

## 修改前必须说明影响范围

进行以下修改前，必须先向用户说明将影响哪些模块、文件和数据流：

- 数据库 schema 或迁移。
- 权限、登录、session、员工 role/scope。
- 支付、checkout、webhook、refund、レシート。
- POS、Web 预约、厨房制作、销售订单同步。
- 品牌网站联动、公开 API、会员/积分。
- 会影响日语 UI 术语或翻译的大面积文案调整。
- 跨 `/os`、`/store`、`/member` 或外部品牌网站的流程改动。

说明应包含：

- 触及的路由/API/表。
- 是否可能影响现有数据。
- 是否需要跑 `npm run build`、`npm run db:check`、`npm run db:push`。
- 是否需要同步 nanacha 和 maamaa 两个品牌网站。

## 数据库规则

- 不要随意新增、删除或重命名数据库字段。
- schema 变更只在 `db/schema.sql` 中进行，除非项目后来新增正式迁移系统。
- 不要为了兼容猜测旧字段。项目尚未正式上线时，优先干净 schema；但任何删除字段、删除表、改约束都必须先确认。
- レシート数据属于供应商履行维度，使用 `purchase_order_supplier_fulfillments.receipt_photo_url`，不要重新附到单个 item。
- 改动 schema 后通常需要运行：
  - `npm run db:check`
  - `npm run db:push`（只有用户确认允许应用数据库变更时）
  - `npm run build`
- 涉及 `store_customer_orders`、`sales_orders`、POS、会员积分、支付回调时，必须检查数据同步路径，避免只更新一张表导致报表或厨房显示不一致。

## 业务用语规则

日语 UI 必须保持现有术语：

- 使用 `発注` 表示门店侧请求/需求。
- 使用 `購入` 表示实际购买。
- 使用 `納品` 表示交付/到货。
- 使用 `店舗確認` 表示门店侧确认。
- 使用 `レシート` 表示收据，不使用 `小票`。
- 使用 `発注先` 表示供应商/下单目的地。
- 供应商角色使用 `メイン発注先`、`予備発注先`、`臨時発注先`。

不要把采购主流程重新改成 `仕入れ`，除非业务负责人明确改变词汇。

## UI 与样式规则

- 保持 Foundr1 OS 的现有风格：深绿主色、干净中性色、紧凑运营界面。
- 优先使用 `app/globals.css` 中已有 token，例如 `--green`、`--green-soft`、`--bg`、`--ink`、`--muted`、`--line`、`--panel`。
- 不要添加营销式 hero、大面积渐变、装饰色块或嵌套卡片。
- 移动端、平板/半宽桌面、宽屏都必须避免横向溢出。
- KPI 卡片保持稳定纵向布局：label、value、note 分层，不要让数字和说明互相挤压。
- 表单控件不要回退到浏览器默认蓝色；checkbox/select 等要保持 Foundr1 绿色主题和紧凑尺寸。
- OS 侧导航/移动菜单必须保持语言切换可见，尤其桌面折叠 sidebar 和移动导航。
- 新增按钮/控件优先使用 `lucide-react` 图标和现有按钮样式。

## 翻译规则

- 新增可见文案时，必须检查本地翻译系统期望的位置。
- 当前 OS 翻译资源在 `public/locales/os/`，包含简体/繁体相关 JSON。
- 新增 label、placeholder、select option、button、empty state、notice、error 都要补翻译。
- 商品名、商品 master 内容、品牌菜单数据属于业务数据，不要自动翻译。

## 权限规则

- 当前主要 role：`owner`、`manager`、`store_owner`、`store_manager`、`staff`、`store_terminal`。
- 权限由 role 加 scope 决定，不能只看 role。
- `employees.role` 控制大类权限；`employee_scopes` 控制门店、品牌、供应商可见范围。
- 菜单应隐藏不可访问模块，不要显示死链接。
- `owner` 可以删除订单履历、订单项目和联络/报告。
- `manager` 可以管理员工，但不能管理 owner 级账号。
- `store_owner`、`store_manager` 只能管理其 scope 内普通 staff 和 store terminal。
- 加盟/门店 owner 可看商品 master，但默认不应获得编辑/删除/复制/创建控件，除非业务明确允许。

## 采购与レシート规则

- 门店/request side 是 `/os/orders`。
- Buyer/procurement side 是 `/os/procurement`。
- requester 默认当前登录用户。
- buyer 默认 store owner，其次 owner/manager fallback。
- 只改实际数量不能创建门店确认/report。
- 店铺确认只在 delivery、arrival、confirmed purchase 等执行动作之后产生。
- 店铺确认应在发注/request 侧处理，不应主要放在 procurement。
- 网店和批发商是供应商级别的下单/到货流程，不是实体配送 batch。
- 一个订单可以有多个 online/wholesale suppliers，每个有不同到货日。
- `購入不可` 不阻止订单整体完成。
- 已完成 disabled 按钮使用黑底白字。
- 如果商品已购买但没有レシート，要显示 `レシート未アップロード`。
- レシート预览应为 modal，不要新开 tab。
- 移动端上传图片时保留客户端压缩。

## 菜单、厨房、POS、品牌网站规则

- `/os/menus` 是品牌网站、POS、手顺书共享的菜单源头。
- 改 online ordering、checkout、member/loyalty、completion、receipt、pickup-status 时，应同时检查 nanacha 和 maamaa 品牌网站，除非用户明确只改一个品牌。
- nanacha 风格饮品可使用 `temperature`、`sweetness`、`ice`。
- maamaa 麻辣烫不要把辣度/麻度/药膳香辛料硬塞进饮品字段；应保留品牌专属结构化 payload。
- buildable 品牌如 maamaa 应使用 `customer_summary.maamaa`、`size_key = 'maamaa_buildable'`、`topping_labels`/结构化 label 支撑厨房制作。
- 厨房显示应优先使用结构化 order item 字段，不要只解析顾客长文本 summary。
- 避免在厨房屏同时显示长 summary 和重复结构化 toppings，防止配料重复。
- 新品牌接入时，必须同时测试 POS checkout 与 Web checkout 的厨房输出。

## 重要文件检查清单

按任务类型至少检查：

- 通用业务/规则：`AGENTS.md`、`README.md`、`docs/operations-platform-roadmap.md`。
- 数据库：`db/schema.sql`、相关 `lib/*.ts`、相关 `app/api/**/route.ts`。
- OS 页面：`app/os/**/page.tsx`、`app/os/components/OsNavList.tsx`、`app/os/components/MobileNavMenu.tsx`。
- 店铺现场：`app/store/**/page.tsx`、`app/store/components/**`、`app/api/store/**`。
- 菜单/品牌：`app/os/menus/page.tsx`、`app/api/menus/route.ts`、`lib/nanacha-compatible-menu.ts`、`lib/maamaa-compatible-menu.ts`、`scripts/import-brand-menus.mjs`。
- 订单/厨房/POS：`lib/customer-orders.ts`、`lib/sales-orders.ts`、`lib/order-production.ts`、`app/api/public/orders/**`、`app/api/store/pos/**`、`app/api/store/display/**`。
- 采购/レシート：`lib/procurement-data.ts`、`lib/receipt-data.ts`、`lib/receipt-pdf.ts`、`app/api/procurement/**`、`components/receipts/**`。
- Timecard：`lib/timecard.ts`、`app/api/timecard/**`、`app/os/timecard/**`、`app/store/timecard/page.tsx`。
- 会员/积分：`lib/loyalty.ts`、`app/member/page.tsx`、`app/api/os/loyalty/route.ts`、`app/api/public/members/**`。
- 样式/翻译：`app/globals.css`、`public/locales/os/*.json`。

## 验证规则

代码修改完成前，按风险运行验证：

- 普通代码/UI 修改：至少运行 `npm run build` 与 `git diff --check`。
- 数据库相关修改：再运行 `npm run db:check`；只有确认需要应用时才运行 `npm run db:push`。
- 前端明显改动：用浏览器检查相关页面，至少覆盖桌面和移动宽度。
- 订单/POS/checkout/厨房/会员积分修改：验证完整流程，不只验证单个 API。
- 如果因环境变量、网络、数据库权限或外部服务无法验证，必须在最终说明中明确写出未验证项。

## Git 规则

- 不要自动提交或推送，除非用户要求。
- 常规结束前检查：
  - `npm run build`
  - `git diff --check`
  - `git status --short`
- 永远不要执行破坏性命令如 `git reset --hard`、无确认删除业务文件、覆盖用户改动。
- `.next`、`.next.broken-build-cache` 等构建缓存通常不应提交；如果显示为未跟踪，先询问或忽略。
