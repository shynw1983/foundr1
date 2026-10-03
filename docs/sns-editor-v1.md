# SNS 素材编辑器 v1 — 审阅交付

基线：远端 main `488ef8666105ce68a5eede8cecb40af2ddad4f73`。Web 发布分支 `sns-editor-web-v1`。Web 已获用户发布授权；Android 草案保持本地，需实体机验收后另行发布。原 Desktop/foundr1 的既有提交和未提交工作未改动。

## 使用与边界

- Store `/store/sns` 为日常入口；OS `/os/sns` 为固定模板管理/预览入口，两端共享编辑器。
- 先选授权まぁ麻门店，然后选择 JPEG/PNG，切换 A/B，拖动、缩放、预览并保存精确 1080×1920 PNG/JPEG。文案单独复制，绝不绘入照片。
- 照片仅在浏览器本地解码、缩放、裁切。无照片上传、AI重绘、翻译接口、Instagram自动发布或新数据库。
- 模板由登录状态、既有门店范围、active 店铺/品牌及 exact 品牌名 `まぁ麻`/`maamaa` 过滤。现有品牌导入脚本使用 `まぁ麻`；不根据“麻辣湯”品类模糊匹配其他品牌。OS 再检查 `module.procedures`。模板资产不放 public，通过认证 `/api/sns` 读取，no-store。
- HEIC/HEIF 明确不支持，检查文件头和扩展名，即使伪装为 JPG 也拒绝。仅接受 JPEG/PNG；限25MB、80MP、长短边比≤8。解码时限制保留位图最长边≤2160；浏览器内部解码瞬时内存仍由浏览器控制。
- 原版 A `(345,1658,390,130)`；小版 B `(403,1651,274,91)`，均使用相同官方资产，B中心约(540,1696.5)。两者均保留，没有长期默认偏好保存。
- Android 下载桥加入 `supportsImages` 和 PDF/PNG/JPEG 允许列表、内容签名与正确后缀。已有 PDF 名称仍保留。旧 App 的 PDF-only 桥会显示“用浏览器保存”提示，不把图片保存成PDF。Web Share 不支持时明确提示保存图片；分享成功不等于Instagram已发布。

## 官方资产与私有验收输入

| 输入 | Library ID | 本机路径 |
| --- | --- | --- |
| 官方标准模板 | libfile_acae1573c990819185076d4b4de59fe6 | task/private-assets/10418.png |
| 小版位置参考 | libfile_141f5707006081918d558abb4a32a119 | task/private-assets/B-smaller-complete-logo-1080x1920.png |
| 白菜原照 | libfile_4c824b16b9448191852a836ee24422bb | task/private-assets/10413.jpg |

三项均实际下载到Mac并逐张查看。官方模板1080×1920，白底，非白范围 x345–734/y1658–1787；白菜原照实际1536×2048。小版生成稿仅供定位，没有提取其重画logo。官方模板 SHA256 `615c8ec13d59a1f1024381947a5256da583ec6fbb5fa32de4347ff4bee0aafd9`。最终logo SHA256 `37e1c62ffc4b190e1c7121e36c1165580db0e05b2f8c264f1e18c291f3b86eeb`。

`node scripts/extract-sns-logo.mjs /private/path/10418.png` 可复现390×130资产：保留红章全部内部像素、章内白字、まぁ麻和出来立て麻辣湯；去除外白底并从原色确定性解除边缘白底混色。没有字体重绘或照片修饰。私有原照和生成验收图不纳入 Git，也未上传生产。

## 验证与复现

- 最终 `npm run build` 成功（包含 TypeScript 和静态页），日志 `/tmp/sns-release-build.log`。使用 localhost 占位 DATABASE_URL，不连接生产。既有 receipt PDF 的 NFT tracing 警告保留。
- `node --experimental-strip-types --test scripts/tests/sns-composition.test.ts`：4/4通过；涵盖固定预设、横竖裁切覆盖、边界裁切、解码限制和文件头尺寸读取。
- `node scripts/tests/sns-browser.mjs`：独立headless Chrome；授权API模拟，照片取自本机 `/tmp/sns-evidence/10413.jpg`。浏览器结果见私有 `browser-results.json`；A/B原始照片区域像素oracle通过（同解码参数，排除logo区域），切换预设保持构图，PNG/JPEG尺寸、重复点击锁定、取消及同图重选、横图、EXIF6方向像素、48MP、HEIC内容拒绝、新旧Android桥模拟、手机390/平板820/桌面1280无溢出及无pageerror。
- 实际未登录 `/api/sns`、logo资产、OS查询均401；未登录页面跳转登录页。
- 完整画布截图和导出样本逐张视觉查看，1380/1490价签均保持原样；不能将测试API模拟写成生产权限验证。
- Android 草案使用已有 Gradle/SDK 完成离线 Store Java/Kotlin 编译，Java 专项使用已有 JDK17 通过，涵盖 PDF 名称/签名、图片后缀与 MIME 拒绝。ADB 没有连接设备；真实 App 的 MediaStore、存储权限回调及系统分享仍未验证，因此不发布 APK。Android 草案不包含在本次 Web 提交。
- 使用现有有效会话、真实生产品牌及门店 scope 在本地 production server 验证：匿名拒绝、owner/员工/店主/终端范围、选定门店、跨门店拒绝、其他品牌无模板、终端不能管理 OS 模板及官方资产校验通过。仅最小只读配置，不持久化凭据或员工资料。Safari/iOS 和实体 Android 尚未验证。

## 审阅与上线范围

主交付目录：`task/sns-review`（隔离分支）；因Documents文件读取阻塞，最终验证在 `/tmp/foundr1-sns-local` 完成后把最终源代码同步回主交付目录。证据保留在 `task/review-evidence`；禁止把证据照片提交公开仓库。

Web 已获授权发布：两入口、导航/模块权限、认证模板 API、共享编辑器、中文翻译及官方提取 logo；原有 OS 会话的 procedures 导航权限兼容新 SNS 页面。Android 的下载桥/策略源码需实体机 PDF 与图片下载/分享回归后才能发布 APK。本次不涉及数据库变更或自动Instagram发布。
