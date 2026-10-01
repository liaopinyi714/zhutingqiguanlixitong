# 临时性能诊断

核对日期：2026-10-01。用于区分浏览器等待与应用内等待，不改变业务响应内容、权限、SQL、数据库结构或前端加载流程。

## 1. 实现和范围

`server/http.ts` 的最外层 API 中间件在每个请求中创建独立 `RequestTimings`，返回 `Server-Timing` 响应头。计时使用 `performance.now()`；请求结束后计时对象可被回收。没有计时日志、遥测上传或数据库记录；没有追加查询。现有错误处理的脱敏日志保持原样。

头中只有固定阶段名和毫秒数，例如：

```http
Server-Timing: worker;dur=85.00, access_jwt;dur=5.00, account_store;dur=30.00, summary_d1;dur=45.00
```

不输出 JWT、邮箱、客户资料、门店标识、SQL、参数、错误消息或动态描述。不添加跨域读取计时的许可。执行失败的阶段也在原有错误响应中保留耗时；未执行的阶段省略。相同阶段在一次请求中多次执行时累加，不能把首次建档或恢复默认门店的额外查询隐藏掉。

| 阶段               | 记录内容                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `worker`           | API 请求进入 HTTP 边界到响应构造完成的经过时间，含认证、D1 等待及响应构造；所有 `/api/*` 响应，包括 config 和错误响应 |
| `access_jwt`       | 应用内 Access 配置、JWT 声明/签名验证；公钥缓存未命中时也含现有 JWKS 请求等待；止于账户解析开始之前                   |
| `account_store`    | 账户授权及资料、初始引导、门店及成员解析；含 `/me` 的下列 D1 阶段，也含失效默认门店的原有恢复流程                     |
| `summary_d1`       | `/api/summary` 原有四条聚合 SQL 的一次 D1 batch 往返，两种 detail 参数均覆盖                                          |
| `me_profile_d1`    | `/api/me` 查询个人资料；引导后再次读取时累加                                                                          |
| `me_membership_d1` | `/api/me` 查询配置中的初始门店成员关系（仅配置有初始门店时）                                                          |
| `me_store_d1`      | `/api/me` 引导前核对初始门店状态（仅成员关系尚不存在时）                                                              |
| `me_stores_d1`     | `/api/me` 查询账户有效门店和成员关系的联表读取                                                                        |
| `me_bootstrap_d1`  | `/api/me` 原有的首次账户插入及初始门店/成员引导写入（仅实际需要时）                                                   |
| `demo_session_d1`  | 仅本地演示 Cookie 会话查询；演示不产生虚构的 Access/JWT 指标                                                          |

`/api/me` 路由只返回会话，其主要数据库工作发生在认证中间件，因此计时从那里传入 `resolveAccount`。其他 API 仍显示 `account_store` 总计，但不输出 `me_*` 明细。

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
- `account_store` 较大：结合 `/me` 的 D1 明细判断是个人资料、成员/门店读取还是首次引导。
- 第一次 `access_jwt` 明显大、后续变小：可能与 Worker 公钥缓存未命中有关；该指标不是 Cloudflare Access 上游网关耗时。

**这些值有包含关系，不能全部相加。** `worker` 已包含其他阶段；`account_store` 已包含 `me_*`；JWT 验证与账户解析是互不包含的顺序阶段。D1 指标是调用前到结果返回的经过时间，包含绑定调用/等待/结果返回，并非纯 SQL 执行时间或 D1 CPU 时间。

`TTFB - worker` 只能作为未被应用计时覆盖的等待估算，不能精确拆出网络与 Access 各自花了多少时间。DNS、TCP、TLS 等另有浏览器 Timing 阶段，不要把整个请求总耗时当成 TTFB。Access 返回的登录跳转、拒绝响应或未进入 Worker 的请求不会有本项目的指标。

Cloudflare Workers 出于安全原因使时钟仅随 I/O 推进。短阶段/纯计算可能显示 `0.00`，config 基线也可能为零；不意味着零 CPU 开销。不要加入人为等待或额外请求来制造非零值。这些指标不覆盖模块初始化、进入应用前的运行时调度、响应头的最终发送、后续流式文件传输或后台定时任务。[Cloudflare 计时限制](https://developers.cloudflare.com/workers/runtime-apis/performance/)

## 4. 关闭

将 `server/timing.ts` 的 `PERFORMANCE_DIAGNOSTICS` 改为 `false`，按现有检查和发布流程提交。之后不创建请求计时对象，不读计时时钟，不追加本项目的 `Server-Timing` 头；数据库操作仍原样执行。无需修改 Cloudflare 变量、数据库或绑定。

启用状态的接口诊断测试跟随此开关，关闭时跳过；计时器单元测试、关闭状态的 HTTP 边界测试及全部原有业务回归仍执行。无需为了关闭诊断删除测试。第一长期版本 `v1.0.0` 标签仍指向诊断前的基线，勿移动标签。诊断不构成业务版本或数据库迁移。
