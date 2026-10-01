# 开发、测试与发布维护

核对日期：2026-10-01。仓库根目录有 package.json；原 Codex 工作区使用 app 子目录只是本地路径差异。

## 1. 环境和日常命令

Node.js 24.x、pnpm 11.19.0；锁文件提交版本固定依赖。首次安装用 `pnpm install --frozen-lockfile`，更新依赖才使用明确版本的 pnpm update 并提交锁文件。

| 命令                  | 效果/访问范围                                                    |
| --------------------- | ---------------------------------------------------------------- |
| pnpm build            | TypeScript strict 检查 src/server/shared；Vite 生成 dist，不发布 |
| pnpm test             | Vitest 回归，不访问真实云数据库或 R2                             |
| pnpm check:docs       | 文档本地文件链接检查，不验证外部网页可用性                       |
| pnpm check            | 文档链接 → 测试 → 类型与构建                                     |
| pnpm db:local         | 在本地模拟库运行 Demo 迁移（含虚构客户）                         |
| pnpm dev:api          | 本地 Worker / D1 / R2，端口 8787                                 |
| pnpm dev              | Vite 5173，API 代理到 8787                                       |
| pnpm configure        | 本机填写正式资源配置；不上传员工名单                             |
| pnpm check:production | 正式配置格式检查，不证明云端资源/Access 策略正确                 |
| pnpm db:production    | 真实云端正式迁移，需先备份并核对绑定                             |
| pnpm staff:upload     | 从忽略的 config/staff.local.json 上传运行时 Secret               |
| pnpm backup           | 真实 D1 SQL 与 R2 文件复制/核对，需 Wrangler/rclone 与停写       |
| pnpm deploy           | 检查正式配置、构建、发布；**不自动应用迁移**                     |
| pnpm build:cloudflare | 构建环境配置 → check → 远程正式迁移；之后另有 Deploy command     |

代码、迁移和公开文档可提交。`.dev.vars*`、`.env*`、staff.local.json、.wrangler、backups、日志、work 和 dist 均忽略；禁止强制添加真实资料或 Secret。

## 2. 测试层次

| 测试                                       | 验证内容                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| domain.test.ts / calendar.test.ts          | 曲线、平均值、角色、北京时间边界、出生日期、日期差和精确恢复截止时刻        |
| api.test.ts                                | SQLite 事务模拟、Demo 接口、关联记录、门店生命周期、附件和导出              |
| production.test.ts                         | 空正式迁移链、真实生成的 RS256 签名/JWKS mock、JWT/名单/来源/门店隔离与恢复 |
| client-api.test.ts / request-order.test.ts | 每标签页门店范围、注销及晚到结果                                            |
| refresh-after-write.test.ts                | 已确认保存后的读取成功/失败处理，不重发写入                                 |
| navigation.test.ts                         | Hash 路由、记录定位与关联跳转                                               |
| spreadsheet.test.ts                        | Excel 工作表内容、文本序列号、公式文本化与 OOXML 包                         |
| skeleton.test.tsx                          | 11 主页面/6 客户标签结构及听力编辑器骨架                                    |
| pagination.test.ts / read-plan.test.tsx    | 游标边界、全店搜索、聚合、索引范围、按需读取计划和分页按钮                  |
| account-resolution.test.ts                | 一次身份解析、首次引导、并发撤权和执行时权限复核                            |
| load-test-cleanup.test.ts / production-release.test.ts | 退役虚构数据清理、真实资料保护、旧变量失效、绑定顺序与非 main 构建保护 |

退役压测数据仅在 `tests/fixtures/retired-load-data.mjs` 中作为内存回归夹具保留，没有命令行入口、文件生成或远程数据库能力，不被 Worker 或构建配置脚本导入。一次性 SQL 位于 `maintenance/`，必须由操作者按 [生产收尾](PRODUCTION-RELEASE.md) 执行，不进入正式迁移、部署和定时任务。

接口测试使用 Node 24 的内存 SQLite 模拟 D1 prepare/bind/first/all/batch，batch 显式事务回滚；附件用内存对象。它们验证 SQL 和应用逻辑，不模拟所有 D1 CPU/配额、Access 控制台配置或移动浏览器交互。

提交前运行 `pnpm check`、`git diff --check` 和 Worker dry-run；新增权限/关系/迁移要补对应回归。无需为每个低影响颜色调整增加镜像测试。当前 TypeScript 不单独检查 tests/scripts，Vitest 编译运行它们；脚本的真实云操作仍须按环境核对。

## 3. 修改规则

- 服务端确认保存后关闭新增表单，再通过 refreshAfterWrite 读取最新数据；读取失败提示已保存，不让用户误以为要重新提交。请求响应丢失时先查询核实，不能自动重发。
- 页面静态结构尽早显示，动态区域独立 loading/ready/error；不能增加人为等待让骨架看似渐进。对应骨架复用布局，优先真实组件，错误显示重试。
- 增加业务写入先定义 Zod 校验，再在 SQL 中验证门店、客户及关联设备；不能采用客户端 body 的 tenant_id。
- HTTP 路由必须在 installHttpBoundary 注册之后。拆分路由后维持原先客户范围中间件，不可因模块化丢失保护。
- 所有值参数化；动态表名仅来自代码内固定白名单，不来自 URL 任意字符串。
- 查询关联设备时同时匹配设备 ID、tenant_id 和 customer_id，不能因为正常写入已校验就省略读路径约束；历史错误关联也须保持隔离。
- 配置/备份脚本使用 productionBindings 按 DB/FILES 名称定位唯一资源，不用 d1_databases[0] 或 r2_buckets[0] 推断业务资源。
- 同页建档继续用一次 batch；写入与审计同批。普通客户业务使用 server/mutations.ts；把门店/成员/客户/设备约束放进执行的 SQL，RETURNING 为空视为冲突，不能无条件记录成功审计。文件操作维持补偿与失败重试关系，不声称跨 R2/D1 事务。
- 前端计算导入 shared，不能导入服务端路由或校验模块。未知/空业务信息允许留空，不新增任意必填。
- UI 维持白/灰和克制蓝色，现有样式顺序固定；优先修改对应模块，避免全局覆盖互相竞争。
- 30 天期限常量在 shared/calendar.ts；SQL 中仍有对应的 -30 days 条件。改变期限必须同时修改 SQL、Cron测试、界面、备份说明，不能只改常量。

## 4. 数据库迁移

1. 新增正式编号迁移，同时新增 Demo 链兼容迁移；不得改写已在正式库执行的文件。
2. 从空库运行正式链、从旧版本库升级，核对资料和隔离。当前 production.test.ts 有旧账户升级场景。
3. 尽量采用新增列/表/索引和兼容读写；不在同一次部署中直接删除旧字段。
4. 对生产做 SQL + 文件成套备份后再发布。代码发布失败时已经执行的迁移不会自动撤销。
5. 回退前检查旧代码能否读新结构；不要把 Demo 迁移当恢复脚本。

此次加载优化新增正式 0008 和演示 0013 索引迁移，不改变业务字段。后续收紧历史 JSON 类型或金额单位必须有兼容路径。第一长期版本收尾没有新增迁移，发布和兼容维护约定见 [长期版本](STABLE-V1.md)。

## 5. 发布途径

### 现有 Cloudflare Git 构建（当前主要途径）

推送 main → Workers Builds 获取代码 → 安装依赖 → configure-ci 校验构建变量 → pnpm check → D1 正式增量迁移 → Wrangler deploy。预览关闭，Cloudflare Builds 非 main 会被脚本拒绝触碰正式库。参见 [网页部署](DEPLOYMENT-GUI.md)。

### GitHub Actions

`.github/workflows/ci.yml` 的 Production checks 在 push/PR 检查并 dry-run，不发布。deploy.yml 的 Deploy production 需手动 workflow_dispatch、main 和 production 环境，验证、配置、迁移、发布。两条发布途径选一种，不同时自动触发生产。

### 本机

运行 `pnpm check`、`pnpm db:production`，再 `pnpm deploy`，详见 [部署指南](DEPLOYMENT.md)。只有部署命令成功并核对 Cloudflare 对应提交/版本才说明上线；推送、构建和迁移成功都不等于发布成功。

## 6. 代码接手顺序

先读 [架构](ARCHITECTURE.md)、[数据模型](DATA-MODEL.md)、[安全](SECURITY.md)，再看 shared、http/auth、accounts、业务路由，最后 App 与编辑组件。API 字段以 [契约](API.md) 和 server/domain.ts 为准。

分页/聚合已实现，规则见 [数据加载](DATA-LOADING.md)。尚未实现的幂等、编辑版本、自动备份等不要在维护说明中标成已实现。出现真实业务需求时再新增，不为了结构漂亮引入数据库搬迁、微服务或付费平台。
