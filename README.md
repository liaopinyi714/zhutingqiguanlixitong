# 聆讯 · 助听器客户管理

面向助听器门店的客户、听力、验配和售后档案网站。React + TypeScript 前端，Hono API，Cloudflare Workers Static Assets、D1 和私有 R2；正式登录使用 Cloudflare Access。代码在 GitHub，客户资料存于 D1/R2，不进入仓库。

当前基线为 **第一长期版本 v1.0.0**，发布和维护约定见 [长期版本说明](docs/STABLE-V1.md)。

## 文档入口

| 要做的事                                 | 文档                               |
| ---------------------------------------- | ---------------------------------- |
| 只通过 Cloudflare、GitHub 网站首次部署   | [网页部署](docs/DEPLOYMENT-GUI.md) |
| 本机部署、环境变量、平台额度             | [部署说明](docs/DEPLOYMENT.md)     |
| 阅读代码、理解加载与权限分层、迁移服务商 | [项目架构](docs/ARCHITECTURE.md)   |
| 理解表、字段、关联、删除恢复             | [数据模型](docs/DATA-MODEL.md)     |
| 查询现有接口和请求示例                   | [API 契约](docs/API.md)            |
| 理解分页、按需加载、统计和索引成本       | [数据加载](docs/DATA-LOADING.md)   |
| 排查网络、认证与 D1 等待耗时             | [临时性能诊断](docs/PERFORMANCE-DIAGNOSTICS.md) |
| 接手开发、测试、修改迁移、发布           | [开发与维护](docs/DEVELOPMENT.md)  |
| 开通账户、管理门店、排查线上故障         | [运行维护](docs/OPERATIONS.md)     |
| 理解权限边界及现有安全限制               | [安全说明](docs/SECURITY.md)       |
| 备份、恢复、业务资料迁移                 | [备份恢复](docs/BACKUP.md)         |
| 查看本次收尾范围与验收                   | [更新记录](CHANGELOG.md)           |
| 核对第一长期版本及兼容维护约定           | [长期版本](docs/STABLE-V1.md)      |

文档以当前源码为准，加载优化核对日期为 **2026-10-01**。Cloudflare 的界面、额度和价格以各文档链接的官方说明及账户控制台为准。

## 当前功能

- 客户资料、住址、本人及亲属联系方式；同页录入检查、验配和首次随访，基本资料可逐项编辑。
- 客户全局搜索、独立设备/维修/保修目录、相互关联跳转、浏览器返回和刷新恢复页面。
- 左右耳听力图直接作图，AC/BC/UCL，六个录入频率、掩蔽、无反应、擦除撤销、平均听阈、历史对比与打印。
- 自填设备品牌、系列、型号和左右耳序列号；维修故障、处理、更换零件、费用、保修与备注。
- 随访预约、逾期、完成结果；客户及服务统计，已过期与未来 90 天保修提醒。
- 私有 PDF/JPG/PNG 报告上传下载，单文件 10 MB；客户和业务记录删除恢复，保留 30 天。
- 核心 Excel 两张客户表（已验配/未验配），业务 Excel 另加最新听力、验配、维修、随访分表；保留姓名、编号和文本型电话/序列号。
- JSON 门店业务导出；完整 SQL/报告备份工具。
- 独立账户、个人头像、自行创建/切换/更名/删除/退出门店、添加已有授权店主、成员启停与近似在线状态。
- 当前页真实分区加载、对应业务布局的骨架、移动端适配和减少动态效果设置。
- 客户/设备/维修/随访/保修/回收站游标分页；候选项按需搜索；D1 聚合统计。

**登录账户只能由系统提供者开通。** 所有用户身份均为店主；网站不能注册或创建登录账户。账户可以不属于任何门店。姓名和头像仅本人可修改；同一门店的启用成员拥有相同的客户读写和门店管理权限。系统没有收费、订阅或“单位”层级，也没有账号密码登录。

## 本地演示

需要 Node.js **24.x** 与 pnpm **11.19.0**。克隆后的仓库根目录含 `package.json`，无需再进入 `app`（该名称仅是原开发工作区目录）。

```sh
git clone https://github.com/liaopinyi714/zhutingqiguanlixitong.git
cd zhutingqiguanlixitong
pnpm install --frozen-lockfile
pnpm build
pnpm db:local
pnpm dev:api
```

打开 `http://127.0.0.1:8787`，使用演示店主进入。本地配置 `wrangler.demo.jsonc` 和演示迁移含虚构资料；正式配置 `wrangler.jsonc` 使用独立空库迁移，不带演示客户。本地状态在 `.wrangler/state/`，不要提交。

开发时另开终端执行 `pnpm dev`，打开 `http://127.0.0.1:5173`，API 代理到 8787。源码更新由 Vite 刷新；直接浏览 8787 时需重新构建前端。

```sh
pnpm check      # 文档链接、全部测试、TypeScript 和生产构建
pnpm test       # 仅回归测试
pnpm build      # 仅类型检查和前端构建
```

## 项目目录

```text
shared/                前后端共用的纯听力规则和北京时间日历
src/App.tsx            页面组合、会话与业务交互状态
src/IntakePage.tsx      同页建档
src/Audiogram.tsx       客户概览听力图
src/HearingEditor.tsx   双耳交互式作图
src/RecordEditor.tsx    页内业务表单
src/Accounts.tsx        个人资料、成员和门店管理
src/ServiceDirectory.tsx 设备、维修和保修目录
src/api.ts             每个浏览器标签页的请求门店绑定
src/readPlan.ts        页面按需读取计划
src/useReadResource.ts 当前页、游标、重试及晚到结果控制
src/useWorkspaceData.ts 页面资源与统计摘要
src/RecordPicker.tsx   可检索和分页的客户/设备候选项
src/ui.tsx             通用展示、统计和加载组件
src/refreshAfterWrite.ts 保存成功与刷新失败的分离处理
src/WorkspaceSkeletons.tsx 各业务页面的对应骨架
server/index.ts        Worker 入口、客户业务路由和模块挂载
server/http.ts         统一 HTTP 安全和权限边界
server/timing.ts       临时请求阶段计时（仅响应头，无持久化日志）
server/mutations.ts    写入时范围校验、状态冲突和事务审计
server/attachments.ts  私有报告上传、补偿、删除恢复与下载
server/auth.ts         Access JWT 与提供者名单校验
server/accounts.ts     独立账户与门店成员关系
server/account-resolution.ts 单次 D1 身份/门店解析与首次资料引导
server/exports.ts      JSON/Excel 数据快照接口
server/read-model.ts   门店列表、客户详情入口和聚合统计
server/pagination.ts   有界参数、位置游标与分页响应
server/retention.ts    定时清理
migrations/            演示迁移链
migrations-production/ 正式迁移链
scripts/               配置、名单上传、备份和文档检查
tests/                 日期、业务、权限、隔离、导出、导航和骨架回归
docs/                  技术与运维文档
```

## 生产更新

已有 GitHub → Workers Builds 配置的实例，在 `main` 更新后自动配置、检查、构建、应用未执行的正式迁移并发布。**Git 推送成功不等于生产部署成功**，应检查 Cloudflare Builds 的对应提交。第一长期版本包括正式迁移 0001–0008；构建会执行尚未应用的迁移。本次收尾未新增迁移、资源或变量，不需要重新建库。

正式版要求 Access Allow 策略、正确 JWT 配置和运行时 `STAFF_ACCOUNTS` Secret。生产公网不接受 Demo 登录。首次操作使用 [网页部署步骤](docs/DEPLOYMENT-GUI.md)，账户和门店操作见 [运行维护](docs/OPERATIONS.md)。

日常列表按服务端游标读取，统计由 D1 聚合；包含词语的 LIKE 搜索和精确聚合仍有随数据量增加的扫描成本，见 [数据加载](docs/DATA-LOADING.md)。没有写入冲突版本、自动备份或仪器导入。完整备份需要 SQL 与报告原件；Excel 和 JSON 下载均不能独立承担完整恢复。更换服务商可复用业务代码，但仍需适配数据库、对象存储和认证。听力图用于记录展示，不自动诊断或生成验配处方。
