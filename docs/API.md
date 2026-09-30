# 当前 API 契约

核对日期：2026-10-01。这是现有 Web 应用的同源内部接口说明；尚未提供 API Key、外部 SDK、公开注册、独立客户端或版本化 API。

## 1. 通用规则

基础路径 `/api`。JSON 写请求使用 `Content-Type: application/json`；附件为 FormData，浏览器自行设置 multipart boundary。写请求生产环境要求同源 Origin 和 `X-Requested-With: hearing-care`；这些头不是认证凭证。

Access 在受保护请求中提供 `Cf-Access-Jwt-Assertion`；应用校验签名及提供者名单。客户端不能通过自填邮箱/角色认证。读取 `/api/me` 后，带 `X-Hearing-Store: <tenant_id>` 请求本标签页显示的门店；生产客户业务写入未带门店返回 409。无门店账户可发送空门店头访问个人操作。

下载链接不能自设请求头，使用 `/api/files/<id>?store=<tenant_id>`；仍受同样的成员资格验证。Cookie `hearing_store` 仅作为新页面默认选择。显式门店拒绝时不能回退别家。

JSON 上限 128 KiB；附件 multipart 总请求上限 11 MiB，其中文件上限 10 MiB。普通 GET 返回对象或数组；新增多为 201 `{ "id": "..." }`；更新、删除、恢复通常 200 `{ "ok": true }`。错误为 `{ "error": "中文说明" }`，不依赖说明文字做程序分支。

| 状态码 | 常见含义                                               |
| ------ | ------------------------------------------------------ |
| 400    | 格式/字段校验、日期/序列号、搜索长度、确认门店名称不符 |
| 401    | 缺少/无效/过期身份，演示未登录                         |
| 403    | 提供者未开通、无门店资格、越权或来源不允许             |
| 404    | 当前可访问范围没有该档案、文件或可恢复记录             |
| 409    | 未显式绑定生产门店、恢复期间状态/期限已变化            |
| 413    | 请求超过大小上限                                       |
| 500    | 处理或存储失败，返回通用错误                           |
| 503    | 正式认证或员工配置缺失/损坏                            |

Access 登录过期也可能在 Worker 前返回重定向/HTML。`src/api.ts` 使用 manual redirect 并检测响应类型，提示用户保存输入后重新登录；不会自动重发写请求。API 数据响应禁止缓存。

## 2. 身份、账户和门店

| 方法   | 路径（以下省略 /api）        | 请求/返回及权限                                                              |
| ------ | ---------------------------- | ---------------------------------------------------------------------------- |
| GET    | /config                      | `{demo:boolean}`，不含名单与敏感配置                                         |
| GET    | /auth/start                  | 重定向到根页，仍经正常身份检查                                               |
| POST   | /login                       | 仅 localhost 显式 Demo；`{role:"店主"}`；公网拒绝                            |
| GET    | /me                          | role、tenant_id、name、email、actor、storeName、avatar、demo                 |
| POST   | /logout                      | 清除应用选择/演示会话；正式返回 Access logoutUrl                             |
| GET    | /accounts                    | 当前门店的授权成员；无门店时仅本人；含 self/enabled/online/lastSeenAt/leftAt |
| PUT    | /accounts                    | `{email,enabled,name?,avatar?}`；本人可改名头像；他人只可添加/启停成员资格   |
| POST   | /accounts/presence           | 更新本人当前门店活动时间，无门店也可调用                                     |
| GET    | /accounts/stores             | 本人可进入门店，含 id/name/current                                           |
| GET    | /accounts/stores/left        | 本人恢复期内主动退出的门店                                                   |
| GET    | /accounts/stores/removed     | 本人有恢复资格且删除未满 30 天的门店                                         |
| POST   | /accounts/stores             | `{name}`；创建门店和本人关系，201 返回 id/name；不直接切店                   |
| PATCH  | /accounts/stores/:id         | `{name}`；必须是当前门店，更名                                               |
| DELETE | /accounts/stores/:id         | `{name}` 必须等于完整当前门店名；返回 nextStoreId，可为空                    |
| POST   | /accounts/stores/:id/switch  | 验证成员后设置 Cookie，返回 store id/name；客户端再读 /me                    |
| POST   | /accounts/stores/:id/leave   | 只允许当前门店；返回 nextStoreId，可为空                                     |
| POST   | /accounts/stores/:id/rejoin  | 本人主动退出 30 天内且未被撤资格；恢复并设置选择 Cookie                      |
| POST   | /accounts/stores/:id/restore | 原有效成员恢复删除 30 天内门店；不自动切店                                   |

PUT /accounts 不是注册接口。目标 email 必须在提供者 Secret 店主名单中；不能修改他人的 name/avatar。停用成员清除主动退出时间，取消本人自行恢复资格。头像接受空字符串或有限大小、有效签名的 PNG/JPEG/WebP data URL，拒绝外链和 SVG。

## 3. 客户与业务

| 方法   | 路径                                   | 说明                                                                                                              |
| ------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | /customers                             | 当前门店未删除客户游标列表，按 created_at DESC/id DESC；含 birthDate/contactPhone，paged=1 列表不含 history/needs |
| GET    | /customers/:id                         | 当前门店有效客户完整基本资料，包括 history/needs；不依赖列表页，未找到为 404                                      |
| GET    | /customers/duplicates                  | name、birthDate、exclude 参数；同门店有效客户精确重复提示，最多 5 条 id/name                                      |
| GET    | /summary?detail=0或1                   | D1 聚合摘要，detail=1 加来源/年龄/随访类型分布                                                                    |
| GET    | /search?q=关键词                       | 当前门店跨客户、检查、设备、维修、随访文本，最多 50 位客户；LIKE 完整模式最多 50 UTF-8 字节                       |
| POST   | /customers                             | 仅创建基本档案                                                                                                    |
| POST   | /intakes                               | `{customer,exam?,fitting?,followup?}`，一次批量建档                                                               |
| GET    | /customers/removed                     | 30 天内已删除客户游标列表，按 deleted_at DESC/id DESC                                                             |
| DELETE | /customers/:id                         | 软删除档案，隐藏子记录                                                                                            |
| POST   | /customers/:id/restore                 | 恢复有效期限内客户                                                                                                |
| GET    | /customers/:id/detail                  | exams/fittings/repairs/followups/attachments/audit；检查和验配 JSON 展开                                          |
| PUT    | /customers/:id/profile                 | 完整客户资料；逐字段 UI 编辑也提交完整资料                                                                        |
| GET    | /customers/:id/removed                 | 客户有效时读取可恢复业务记录                                                                                      |
| POST   | /customers/:id/exams                   | 新检查                                                                                                            |
| PUT    | /customers/:id/exams/:recordId         | 完整更新检查                                                                                                      |
| POST   | /customers/:id/fittings                | 新验配                                                                                                            |
| PUT    | /customers/:id/fittings/:recordId      | 完整更新验配                                                                                                      |
| POST   | /customers/:id/repairs                 | 新维修，设备必须属于同客户同门店且有效                                                                            |
| PUT    | /customers/:id/repairs/:recordId       | 完整更新维修                                                                                                      |
| POST   | /customers/:id/followups               | 新随访                                                                                                            |
| PUT    | /customers/:id/followups/:recordId     | 更新计划及完成结果                                                                                                |
| DELETE | /customers/:id/:kind/:recordId         | kind 为 exams/fittings/repairs/followups，软删除                                                                  |
| POST   | /customers/:id/:kind/:recordId/restore | 期限和父记录有效时恢复                                                                                            |
| GET    | /devices                               | 有效客户的有效验配，包含客户姓名/电话和 JSON 设备资料                                                             |
| GET    | /repairs                               | 有效客户/设备的维修，包含关联 device                                                                              |
| GET    | /warranties                            | 有效设备保修游标目录，日期/缺填筛选由 D1 执行，全部含缺填日期记录                                                 |
| GET    | /followups                             | 有效客户的未删除计划和完成记录                                                                                    |
| PUT    | /followups/:id                         | `{result:string}`，去空白后非空、最多 3000 字；设为已完成，不能撤销完成                                           |

所有业务接口只允许当前已授权门店。子记录 ID 同时匹配 customer_id、tenant_id；不能用其他门店或其他客户的 ID 修改关系。

### 客户写入字段

必需 name（去空白后 1–40 字）、gender（男/女/未填写）、birthDate（空字符串或 1900-01-01 至北京时间今天）、phone（可空，最多 30 字）、source（可空，最多 40 字）、status（待评估/试戴中/已验配/长期随访）。可省略 contact、contactPhone、address、history、needs，默认空字符串。接口“字段必需”不等于 UI 必填；页面会为未知字段提交空值和默认选项。

```json
{
  "customer": {
    "name": "示例客户",
    "gender": "未填写",
    "birthDate": "",
    "phone": "",
    "source": "自然到店",
    "status": "待评估"
  }
}
```

以上可用于 POST /intakes（仅虚构资料）；创建只含姓名的 HTTP 请求并不完整。

### 专业记录字段

- 检查：date、right/left/boneRight/boneLeft 四条 11 点曲线，speech、other、conclusion；可选 uclRight/uclLeft。点字段、范围见 [数据模型](DATA-MODEL.md)。空文本允许，不能缺少必需曲线。
- 验配：date、side（双耳/左耳/右耳）、model（可空）、amount（0–10000000 元）、warranty（日期或空）、notes（可空）；brand/serialLeft/serialRight 默认空，series 可省略。服务端规范耳侧并生成 serial。
- 维修：fittingId、occurredDate、receivedDate/completedDate（可空）、status（待送修/维修中/已完成/无法修复）、problem/findings/workDone/parts/notes（可空）、price、warrantyCovered。接收不可早于故障，完工不可早于接收或故障。
- 随访新增：due、type（适应回访/听力复查/清洁保养/维修跟进/到店预约）、note（可空）。客户内更新可另带 result；保留数据库中的完成状态，已完成记录必须有非空结果，未完成记录仍只修改计划。完成操作使用 PUT /followups/:id。

服务器以 `server/domain.ts` 为准确校验来源；未知对象字段由 Zod 默认剥离，不用于权限或门店判断。

## 4. 附件与导出

| 方法   | 路径                                         | 说明                                                                                                         |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| POST   | /customers/:id/attachments                   | FormData 中 file；PDF/JPG/PNG，文件大小和格式头检查，201 返回 id                                             |
| DELETE | /customers/:id/attachments/:recordId         | 软删除                                                                                                       |
| POST   | /customers/:id/attachments/:recordId/restore | 30 天内恢复，要求客户有效                                                                                    |
| GET    | /files/:id?store=门店ID                      | 受保护流式附件下载，attachment 响应，不公开 R2 地址                                                          |
| GET    | /export                                      | version=1 的门店 JSON，含业务软删除/审计/旧字典目录，不含原文件及全局账户/成员                               |
| GET    | /export/spreadsheet                          | JSON 快照 exportedAt/customers/exams/fittings/repairs/followups，浏览器生成 XLSX；只取有效资料和每客最新检查 |

Excel 端点返回数据而不是二进制文件。`src/spreadsheetExport.ts` 定义工作表，`src/xlsx.ts` 写 OOXML（文本安全、筛选、冻结首行）。两种表格共用同一快照；客户存在有效验配记录就归入已验配表，与其手工服务阶段无关。JSON 没有恢复导入接口，完整恢复见 [备份指南](BACKUP.md)。

## 5. 扩展前必须保留的规则

不能只凭 Cookie 或请求 body.tenant_id 选择数据；不能为独立客户端去掉 JWT/提供者名单、同源保护或直接开放 R2。当前已有有界列表和游标分页，没有自动写入重试、幂等键或 API 版本兼容承诺。未来正式 API 应另外设计凭证、版本、限流和并发写入策略。

## 6. 列表查询和聚合摘要

`/customers`、`/customers/removed`、`/devices`、`/repairs`、`/followups`、`/warranties` 共用以下参数：

- `paged=1` 返回 `{items:数组,nextCursor:字符串或null}`；未带此参数返回有界数组，仍只读一页。
- `limit` 为 1–100 的整数，默认 50；首页和候选项分别使用更小的 limit。
- `cursor` 为前一页 nextCursor；首屏省略。不使用 offset；换门店、接口、关键词或筛选必须从第一页开始。
- `q` 在服务端对整个门店筛选。`%`/`_`/`!` 为普通字符，转义后完整 LIKE 模式不超过 50 UTF-8 字节。
- `filter` 默认全部，支持：客户（全部/全部客户/待评估/试戴中/已验配/长期随访）；设备（全部/双耳/左耳/右耳）；维修（全部/待送修/维修中/已完成/无法修复）；随访（全部/待完成/今日/已逾期/已完成）；保修（全部/需关注/90 天内到期/已到期/保修中/未填写）；回收站仅全部。

保修全部列表包含未填日期的设备，置于末尾；需关注为已到期加未来 90 天。参数/游标无效返回 400；跨日相对日期游标需重置。客户端每页最多 limit 条，不返回总匹配数；默认门店总数来自摘要，筛选搜索显示本页数量。

摘要字段：date、customers、fitted、status（阶段→数量）、pending、completed、today、overdue、devices、repairs、warrantyAlerts。详细模式另有 sources、ages、types（分组名称→数量）。所有计算排除外店和已删除父/子记录；fitted 按已验配/长期随访阶段统计，与 Excel 按有效验配记录分表的口径不同。

完整排序、索引、主动导出例外和成本边界见 [数据加载](DATA-LOADING.md)。
