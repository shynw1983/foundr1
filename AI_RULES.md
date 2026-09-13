# AI_RULES — 项目说明索引

项目代理的执行方式、授权边界、验证要求与 Git 流程统一维护在 [AGENTS.md](AGENTS.md)。本文件只提供导航，不重复定义规则，避免多份说明互相冲突。

按当前任务选择相关资料，并沿实际代码依赖继续检查；以下内容不是每次任务的必读清单。

| 任务 | 参考入口 |
| --- | --- |
| 产品与架构 | [README.md](README.md)、[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)、[运营平台路线图](docs/operations-platform-roadmap.md) |
| 数据库 | [DATABASE.md](DATABASE.md)、`db/schema.sql`、相关 API 与 `lib/` 数据访问代码 |
| OS / 门店 UI | [界面细则](docs/os-ui-guidelines.md)、`app/os/`、`app/store/`、相关组件、`app/globals.css`、`public/locales/os/` |
| 菜单与品牌网站 | [菜单翻译与标准 API](docs/customer-menu-i18n.md)、`app/api/public/menus/route.ts`、`app/os/menus/` |
| 订单 / POS / 厨房 | [门店与厨房数据规则](docs/store-operation-rules.md)、`lib/customer-orders.ts`、`lib/sales-orders.ts`、`lib/order-production.ts`、相关 public/store API |
| 采购 / レシート / 商品总表 / 比较 | [采购业务框架](docs/procurement-backoffice-framework.md)、`lib/procurement-data.ts`、`lib/receipt-data.ts`、`components/receipts/` |
| Timecard | `lib/timecard.ts`、`app/api/timecard/`、`app/os/timecard/`、`app/store/timecard/` |
| 会员与积分 | [会员认证](docs/member-auth.md)、`lib/member-auth.ts`、`lib/loyalty.ts`、`app/member/` |
| 外卖平台菜单发布 | [Uber 菜单权威与同步约束](docs/uber-menu-authority.md)、`lib/menu-authority-guard.ts`；[早期平台盘点与发布草案](docs/delivery-menu-publishing-rules.md) 仅在需要历史背景时阅读 |
| 门店手顺书 / 原生壳 | [门店与原生能力规则](docs/store-operation-rules.md)、[运营平台路线图](docs/operations-platform-roadmap.md) |
| 食品商品图 | [已确认的商品图流程](docs/product-image-workflow.md) |

业务数据的归属、权限范围、菜单翻译审核与外部平台发布要求仍由对应领域文档说明。业务文档中的历史状态应结合当前代码和可核验环境判断，不能当作永久现状。
