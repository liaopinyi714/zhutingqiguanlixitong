# 临时性能诊断

核对日期：2026-10-01。用于区分浏览器等待与应用内等待。当前已按实测将身份解析的串行读取合并为一次 SQL，不改变业务响应内容、权限、数据库结构或前端加载流程。

## 1. 实现和范围

`server/http.ts` 的最外层 API 中间件在每个请求中创建独立 `RequestTimings`，返回 `Server-Timing` 响应头。计时使用 `performance.now()`；请求结束后计时对象可被回收。没有计时日志、遥测上传或数据库记录；没有追加查询。现有错误处理的脱敏日志保持原样。

头中只有固定阶段名和毫秒数，例如：

```http
Server-Timing: worker;dur=85.00, access_jwt;dur=5.00, account_store;dur=30.00, summary_d1;dur=45.00
```

不输出 JWT、邮箱、客户资料、门店标识、SQL、参数、错误消息或动态描述。不添加跨域读取计时的许可。执行失败的阶段也在原有错误响应中保留耗时；未执行的阶段省略。相同阶段在一次请求中多次执行时累加，不能把首次建档或恢复默认门店的额外查询隐藏掉。

| 阶段                   | 记录内容                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `worker`               | API 请求进入 HTTP 边界到响应构造完成的经过时间，含认证、D1 等待及响应构造；所有 `/api/*` 响应，包括 config 和错误响应 |
| `access_jwt`           | 应用内 Access 配置、JWT 声明/签名验证；公钥缓存未命中时也含现有 JWKS 请求等待；止于账户解析开始之前                   |
| `account_store`        | 账户授权及资料、初始引导、门店及成员解析；含 `/me` 的下列 D1 阶段，也含失效默认门店的原有恢复流程                     |
| `summary_d1`           | `/api/summary` 原有四条聚合 SQL 的一次 D1 batch 往返，两种 detail 参数均覆盖                                          |
| `me_resolve_d1`        | `/api/me` 合并的个人资料、初始成员/门店状态和当前门店读取；首次引导后复读会累加                                       |
| `account_resolve_d1`   | 其他请求同样的实时身份读取；仅门店列表接口返回本人全部有效门店                                                        |
| `me_bootstrap_d1`      | `/api/me` 首次账户/门店/成员初始化的一个事务（仅实际需要时，至多五条固定语句）                                        |
| `account_bootstrap_d1` | 其他请求确实需要首次初始化时的事务；不在常规请求中写入                                                                |
| `presence_d1`          | 在线状态接口原有的活动时间更新，附加执行时成员和门店核对                                                              |
| `demo_session_d1`      | 仅本地演示 Cookie 会话查询；演示不产生虚构的 Access/JWT 指标                                                          |

`/api/me` 路由只返回会话，其主要数据库工作发生在认证中间件，因此计时从那里传入 `resolveAccountRequest`。其他 API 仍显示 `account_store` 总计和 `account_resolve_d1`。旧 `me_profile_d1`、`me_membership_d1`、`me_stores_d1`、`me_store_d1` 已合并为 `me_resolve_d1`，不能为保持原标签而给同一次查询填入三个虚构耗时。

`/api/config` 在应用内无需 JWT 或 D1，因此只输出 `worker`，作为轻量基线。它仍受网站现有的 Cloudflare Access 上游策略约束；没有新增公开路径或绕过 Access。

## 2. Chrome 查看步骤

1. 等待对应提交在 Cloudflare Workers Builds 发布成功，登录网站。
2. 按 **F12** 或 **Ctrl + Shift + I** 打开开发者工具，选择 **Network / 网络**。
3. 选择 **No throttling / 不限速**，勾选 **Disable cache / 停用缓存**；如需观察登录跳转，另勾选 **Preserve log / 保留日志**。
4. 清空请求列表，刷新网页。筛选框输入 `/api/`。
5. 分别点击 `config`、`me`、`summary` 请求。工作台和统计页会请求 summary；页面不需要摘要时不会额外请求它。
6. 打开请求的 **Timing / 时间**，查看 **Waiting for server response / 等待服务器响应（TTFB）** 和 **Server Timing** 指标。以毫秒为单位。
7. 若当前 Chrome 的 Timing 面板没有列出自定义指标，进入 **Headers / 标头 → Response Headers / 响应标头**，查看 `server-timing`；其中 `dur` 就是毫秒。
8. 用相同门店和网络重复刷新几次，分别观察第一次与后续请求，避免把 JWKS 缓存或初始资料引导的差异误判为每次必然发生的开销。

浏览器说明：[Chrome Network 参考](https://developer.chrome.com/docs/devtools/network/reference)、[Server-Timing 响应头](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing)。

## 3. 如何判断

- `worker` 明显小于 TTFB：大部分等待在应用测量范围之外，可能来自网络往返、Cloudflare Access、边缘排队或调度等。
- `worker` 较大且 `summary_d1` 占比大：等待集中在统计的 D1 往返。
- `account_store` 较大：结合 `me_resolve_d1` / `account_resolve_d1` 和条件出现的 bootstrap 指标判断是解析读取还是首次引导。
- 第一次 `access_jwt` 明显大、后续变小：可能与 Worker 公钥缓存未命中有关；该指标不是 Cloudflare Access 上游网关耗时。

**这些值有包含关系，不能全部相加。** `worker` 已包含其他阶段；`account_store` 已包含 resolve / bootstrap；JWT 验证与账户解析是互不包含的顺序阶段。`summary_d1` 和 `presence_d1` 在身份解析后执行。D1 指标是调用前到结果返回的经过时间，包含绑定调用/等待/结果返回，并非纯 SQL 执行时间或 D1 CPU 时间。

`TTFB - worker` 只能作为未被应用计时覆盖的等待估算，不能精确拆出网络与 Access 各自花了多少时间。DNS、TCP、TLS 等另有浏览器 Timing 阶段，不要把整个请求总耗时当成 TTFB。Access 返回的登录跳转、拒绝响应或未进入 Worker 的请求不会有本项目的指标。

Cloudflare Workers 出于安全原因使时钟仅随 I/O 推进。短阶段/纯计算可能显示 `0.00`，config 基线也可能为零；不意味着零 CPU 开销。不要加入人为等待或额外请求来制造非零值。这些指标不覆盖模块初始化、进入应用前的运行时调度、响应头的最终发送、后续流式文件传输或后台定时任务。[Cloudflare 计时限制](https://developers.cloudflare.com/workers/runtime-apis/performance/)

## 4. 关闭

将 `server/timing.ts` 的 `PERFORMANCE_DIAGNOSTICS` 改为 `false`，按现有检查和发布流程提交。之后不创建请求计时对象，不读计时时钟，不追加本项目的 `Server-Timing` 头；数据库操作仍原样执行。无需修改 Cloudflare 变量、数据库或绑定。

启用状态的接口诊断测试跟随此开关，关闭时跳过；计时器单元测试、关闭状态的 HTTP 边界测试及全部原有业务回归仍执行。无需为了关闭诊断删除测试。第一长期版本 `v1.0.0` 标签仍指向诊断前的基线，勿移动标签。诊断不构成业务版本或数据库迁移。

## 5. 实测后的路径优化

本次依据门店提供的实测：`/me` 的个人资料、初始成员、有效门店列表各约 182–185 ms，串行合计约 550 ms；`/summary` 身份约 558 ms，业务聚合约 190 ms，总计约 748 ms。

常规请求（资料已初始化）D1 往返对比：

| 请求              | 优化前                        | 优化后                                  |
| ----------------- | ----------------------------- | --------------------------------------- |
| config            | 无 D1 查询                    | 无 D1 查询                              |
| me                | 三次串行身份读取              | 一次合并 SQL                            |
| summary           | 三次身份读取 + 一次统计 batch | 一次身份 SQL + 原有一次统计 batch       |
| accounts/stores   | 三次身份读取 + 再读门店列表   | 一次 SQL 返回本次授权门店列表，路由复用 |
| accounts/presence | 三次身份读取 + 一次活动写入   | 一次身份 SQL + 一次活动写入             |

明确指定门店的请求不读取所有门店，用成员 `(email,tenant_id)`、账户 email、门店 id 主键定位；默认选择最多返回一行。初始状态读取一起合并在 SQL 中，但其条件引导仍检查墓碑、保留期和名单，且复读事务后的真实状态。无效默认 Cookie 在原允许恢复的个人接口内一次选出默认门店并清除 Cookie；显式无权门店仍拒绝。首次完全初始化从七次往返降至三次（读取 → 一个至多五语句事务 → 复读），不按缓存或猜测跳过权限读取。

按单次往返保持约 180–190 ms 估算，常规 `account_store` 约可从 550 ms 降到 180–200 ms，`summary` 的 Worker 内时间约可从 748 ms 降到 370–400 ms。**这是路径分析的预期，不是优化后线上实测或 SLA**；联合查询、运行位置、网络与负载会影响读数。统计 SQL 本身没有重写。

发布成功后在同一门店、同一网络重复测 `me`、`summary` 和 `accounts/presence`，比较 `worker`、`account_store`、`me_resolve_d1`、`account_resolve_d1`、`summary_d1`、`presence_d1`。首次初始化或获取 JWKS 公钥时单独比较，不混入常规样本。保留原有 UI/心跳频率/在线阈值，没有 Redis、KV、Durable Objects、跨请求权限缓存或数据库迁移。

测试覆盖同 JWT 撤权、退出、删除/过期门店、墓碑、初始引导期间的并发撤权、一次查询路径、列表复用、无权显式范围、Cookie 恢复、活动写入的二次范围校验及主键执行计划。本地模拟批次只计算一次往返，避免把事务内的 SQL 条数误计为网络次数。本地 SQLite 执行计划不代表实际 D1 rows_read。

参考 [D1 批处理说明](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)：一个调用内顺序执行语句并具有事务语义，用于降低多次网络往返；常规身份解析使用一条 SQL，以同时减少语句数和往返。
