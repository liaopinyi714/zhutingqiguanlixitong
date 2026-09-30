# Cloudflare 正式部署指南

如果你希望只通过 Cloudflare 与 GitHub 网页完成首次部署，请改用 [网页操作指南](DEPLOYMENT-GUI.md)。本文保留本机命令行及 GitHub Actions 的部署方式。

核对日期：2026-09-27。适用于本仓库 1.0 版本。业务功能与已验收 Demo 一致；正式版使用员工身份登录、独立空数据库和私有报告存储。本文先给出一次性部署，再说明更新、备份和迁移。

## 1. 使用哪些服务、是否收费

| 服务                                | 用途                                       | 当前免费额度或限制                                                             |
| ----------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| Workers Static Assets               | 网站页面、脚本、样式                       | 静态资源请求免费且不限量                                                       |
| Workers Free                        | 客户与业务 API、到期清理                   | 每天 10 万次请求；每次 10 ms CPU；免费账户 5 个 Cron Trigger                   |
| D1 Free                             | 客户、检查、验配、随访、附件目录、操作记录 | 每天读 500 万行、写 10 万行；单库 500 MB，账户合计 5 GB；Time Travel 7 天      |
| R2 Standard                         | 私有 PDF、JPG、PNG 报告                    | 每月 10 GB-month 存储、100 万次 A 类操作、1000 万次 B 类操作免费；出站流量免费 |
| Cloudflare Access / Zero Trust Free | 员工邮箱身份验证                           | Free 计划最多 50 个用户；席位按账户使用情况计算                                |

官方依据：[静态资源计费](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)、[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[D1 定价](https://developers.cloudflare.com/d1/platform/pricing/)、[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)、[R2 定价](https://developers.cloudflare.com/r2/pricing/)、[Access 计划](https://www.cloudflare.com/plans/zero-trust-services/)。额度可能调整，开通时以控制台为准。

Workers 和 D1 保持 Free，超额主要表现为请求失败或停止写入。**R2 是有免费额度的按量计费服务，超额会收费，不能承诺永久零账单。** R2 开通需完成订阅流程，控制台可能要求付款信息；选择 Standard，不选 Infrequent Access。账户里的其他项目也会消耗共享额度。[R2 开通说明](https://developers.cloudflare.com/r2/get-started/)

本项目没有购买 Workers Paid、KV、Queues、Images、AI 或其他付费服务。代码不会自动升级套餐，也没有实现账户总账单的硬性封顶。建议报告存储接近 8 GB、D1 接近 400 MB 时评估容量；定期在账户 Billing / Billable Usage 与各服务 Metrics 中检查用量。通知不等于阻止计费。

## 2. 准备电脑和代码

安装 Git、Node.js 24、pnpm 11.19.0。Windows 使用 PowerShell。若没有 pnpm：

```powershell
npm install --global pnpm@11.19.0
git clone https://github.com/liaopinyi714/zhutingqiguanlixitong.git
cd zhutingqiguanlixitong
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler whoami
```

已有仓库则进入仓库根目录执行 `git pull --ff-only` 和 `pnpm install --frozen-lockfile`。从 GitHub 克隆时，`package.json` 就在根目录，不需要再进入 `app`；Codex 本地工作区才使用 `app` 子目录。

`wrangler login` 会打开浏览器授权，登录你准备部署的 Cloudflare 账户。为 Cloudflare 管理账户启用多因素认证。记录 Account ID：可在账户或 Workers & Pages 总览的账户详情中复制。

## 3. 在 Cloudflare 创建三个资源

下面使用固定名称，方便直接复制命令；如果修改名称，后续配置保持一致。

### 3.1 建立正式 Worker

1. 打开 Cloudflare 控制台 → **Workers & Pages**（部分界面位于“计算 / Compute”下）。
2. 选择 **Create application / 创建应用** → 创建 Worker，使用 **Hello World** 模板。
3. 名称填 `hearing-care`，部署这个临时空页面。此时没有客户数据。
4. 记录网址，例如 `https://hearing-care.你的子域.workers.dev`。

创建这个临时 Worker 是为了先配置 Access 和 Secret，之后命令会用本项目代码替换它。这里不创建 Pages 项目，不需要配置 Git 自动构建。

### 3.2 建立空的 D1 数据库

1. **Storage & databases / 存储和数据库 → D1 SQL Database → Create database**。
2. 名称填 `hearing-care-production`，按页面完成创建。
3. 复制 **Database ID**。它与 Account ID 不是同一个值。
4. 保持数据库为空；后面的迁移命令会建表。

不要复用之前的 Demo 数据库，不要导入 `migrations/0002_demo_seed.sql`。本版本正式迁移目录为 `migrations-production/`，只包含结构和索引，没有演示资料。

### 3.3 建立私有 R2 桶

1. **Storage & databases → R2 Object Storage → Overview**；如尚未开通，完成 R2 订阅。
2. **Create bucket**，名称填 `hearing-care-production-private`。
3. 使用 **Standard** 存储类别。
4. 保持 **Public development URL / r2.dev** 关闭，不给这个桶绑定公开域名。
5. 不给桶设置“所有对象若干天后删除”的生命周期规则；正常客户报告需要保留。删除过期文件由本项目按业务记录处理。

应用通过 Worker 的 `FILES` 绑定读取文件，下载也必须验证员工身份和客户门店，不需要 R2 公开 URL 或 CORS 配置。

## 4. 配置员工登录（Access）

### 4.1 开通 Zero Trust Free 并添加邮箱验证码

1. 从 Cloudflare 控制台进入 **Zero Trust / Cloudflare One**，首次进入按向导建立组织，明确选择 **Free** 计划。
2. 记录团队域名，例如 `my-hearing-team.cloudflareaccess.com`。配置时不填写 `https://`。
3. 进入 **Integrations → Identity providers → Add new identity provider → One-time PIN**，添加邮箱验证码登录。

新组织不一定默认启用 One-time PIN，因此请显式添加。员工不用注册 Cloudflare 管理账户，只需使用授权邮箱接收验证码。验证码不经本应用保存。也可以日后替换成企业身份提供商。[官方 OTP 配置](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)

### 4.2 保护整个 Worker

1. 返回 **Workers & Pages → hearing-care → Access**。
2. 选择 **Protect this Worker behind Access**。
3. 范围选 **All traffic**，不要只保护预览。
4. 在 Authentication policy 中选择按具体 **Email addresses / Emails** 授权，填入需要使用系统的员工邮箱。
5. 保存后，在 Zero Trust → **Access controls → Applications** 中找到这个 Worker 对应的应用，检查 Allow 策略中的邮箱。不要使用 Everyone、Bypass 或整个公共邮箱域名。
6. 在该应用的登录方式中启用刚添加的 One-time PIN；会话时长建议 8 小时。
7. **Configure → Additional settings**，复制 **Application Audience (AUD) Tag**，通常为 64 位十六进制字符串。

这条路径会保护 Worker 的域名和路由。若你的控制台仍是旧版，可在 **Settings → Domains & Routes → workers.dev → Enable Access** 建立对应保护，再进入 Access 应用核对邮箱和 AUD。若之后添加自定义域名，确认它也包含在 Access 保护范围内。

参考：[Worker 的 Access 配置](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)、[获取 AUD 与验证签名](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)。代码会验证 JWT 的签名、签发方、AUD 和有效期，不仅仅读取一个邮箱请求头；即使漏配某个路由保护，业务 API 也会拒绝没有有效凭证的请求。

## 5. 填写配置、员工权限和部署

### 5.1 运行配置向导

在仓库根目录运行：

```powershell
pnpm configure
```

按提示填入 Account ID、Worker 名称、D1 名称与 Database ID、R2 桶名称、Team Domain 和 AUD。保留默认资源名称的项目按回车即可。向导更新 `wrangler.jsonc`，这些 ID 不是密码；员工名单和 API Token 不放在该文件里。

`wrangler.jsonc` 虽以 jsonc 命名，但本项目脚本按标准 JSON 读取，请不要添加注释或末尾逗号。配置内容建议由向导生成。

### 5.2 建表

```powershell
pnpm db:production
```

检查提示中的资源确实是 `hearing-care-production`，确认应用迁移。首次应应用 `0001_initial.sql` 和 `0002_query_indexes.sql`。正式数据库保持零客户，之后由员工录入。

`pnpm db:local` 只服务本地演示；`pnpm db:production` 才操作远程正式库。不要将正式迁移应用到 Demo 库或其他已有业务库。

### 5.3 配置员工名单

```powershell
Copy-Item config/staff.example.json config/staff.local.json
```

用编辑器打开 `config/staff.local.json`，删除不用的员工行，并替换邮箱、姓名和门店名称。例如只有你一个人时：

```json
[
  {
    "email": "你的真实邮箱",
    "name": "你的姓名",
    "role": "店主",
    "tenantId": "store-001",
    "storeName": "你的助听器门店名称"
  }
]
```

`role` 填 `店主`，前台和验配师身份已停用。同一门店所有员工使用相同 `tenantId` 和 `storeName`。**`tenantId` 是数据归属标识，开始使用后不要随意更改**；改门店显示名称只改 `storeName`。

该文件已经被 Git 忽略。运行：

```powershell
pnpm staff:upload
```

脚本校验名单后，将压缩 JSON 经标准输入上传为 Worker Secret `STAFF_ACCOUNTS`，不会把名单放入命令参数或日志。你也可以在 **Worker → Settings → Variables and Secrets → Add → Secret** 中粘贴压缩后的 JSON，名称必须完全一致。采用脚本更容易避免格式错误。

账户必须同时通过 Access 的 Allow 策略，并出现在提供者维护的 STAFF_ACCOUNTS 店主名单。D1 中的账户或成员行不能自行授予登录资格。所有用户都不能开通新账户；网站仅将已有授权邮箱添加到门店。每个账户可加入多家门店，也可没有门店。单个 Secret 值受 5 KB 限制，脚本会检查。新账户的 tenantId 和 storeName 可以同时省略，已有门店成员关系独立保存在 D1。

### 5.4 发布网站

```powershell
pnpm test
pnpm run deploy
```

命令会先检查正式配置，再进行类型检查和构建，最后发布 Worker、静态资源与每日定时任务。部署不会删除已设置的 `STAFF_ACCOUNTS` Secret。确认输出中的绑定为：

| 绑定名               | 资源                              |
| -------------------- | --------------------------------- |
| `DB`                 | `hearing-care-production`         |
| `FILES`              | `hearing-care-production-private` |
| `DEMO_MODE`          | `false`                           |
| `ACCESS_TEAM_DOMAIN` | 你的团队域名                      |
| `ACCESS_AUD`         | 该应用的 AUD                      |
| `STAFF_ACCOUNTS`     | 员工名单 Secret，不应显示明文     |

在控制台 **Worker → Settings → Trigger Events / Cron Triggers** 确认 `0 18 * * *` 存在，即北京时间每天 02:00。删除记录可恢复 30 天，超过期限立即不能恢复；定时任务物理清理数据库和 R2 文件。每次最多处理 500 个附件，积压会留待后续运行；失败可在 Worker 的调用日志和指标中查看。[Cron 使用 UTC](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

## 6. 首次上线核对

用无痕窗口打开 Worker 网址，应先出现 Access 登录，输入授权邮箱和验证码后进入工作台。正式版应显示真实门店名、员工姓名与“门店版”，客户数为 0，不出现角色选择或内置演示客户。

使用一份虚构测试档案核对录入、搜索、听力图、报告上传下载以及删除恢复；用已停用账户核对访问被拒绝。未授权邮箱不能进入，退出后再次访问需要登录。不要在确认身份保护和备份之前导入真实资料。

Workers Free 的 CPU 上限很低，自动化测试与本地模拟器不能证明线上永远不触顶。首次实际部署后查看 **Worker → Metrics** 的错误和 CPU 时间，尤其是登录冷启动、10 MB 上传和全量导出；如出现 1102 或 CPU 限额错误，应继续优化或升级计划，不能通过关闭认证解决。

中国大陆访问请分别用门店宽带和手机网络测试登录、查询和文件传输。前端脚本、字体和图标均由本站提供；静态资源缓存不会缓存客户 API。`workers.dev` 可先用于验证，正式入口可绑定你持有的自定义域名，但域名不能保证大陆加速。Cloudflare China Network 是企业计划下的额外订阅，不包含在本免费组合内。[中国网络说明](https://developers.cloudflare.com/china-network/)

本方案不提供中国大陆数据驻留保证。客户资料包含听力与健康信息，真实使用前需确认门店的数据处理授权及跨境处理安排；部署成功不能代替这项确认。

## 7. 自定义域名（可选）

1. 将你已有域名接入 Cloudflare DNS，使用该域名的 Free 计划即可。域名购买费用不属于免费托管额度。
2. **Worker → Settings → Domains & Routes → Add → Custom Domain**，输入如 `crm.example.com`。
3. 等待证书和 DNS 生效；确认新域名也被同一个 Access 应用保护。
4. 如使用独立的 hostname Access 应用，需要使用匹配的 AUD，本项目一次只配置一个应用 AUD。推荐同一 Worker 使用统一的 Access 应用。
5. 若停用 workers.dev，请在 `wrangler.jsonc` 中同时设置 `workers_dev: false`，防止下次部署重新开启。保留 `preview_urls: false`。

[官方自定义域名流程](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## 8. 后续更新与员工变动

更新代码前做一次完整备份。在仓库执行 `git pull --ff-only`、`pnpm install --frozen-lockfile`、`pnpm test`、`pnpm db:production`、`pnpm run deploy`。`db:production` 只应用尚未执行的迁移，不会重建全部表。

开通账户：由网站提供者把邮箱、name 和 role（店主）添加到 STAFF_ACCOUNTS Secret 的完整名单，并加入 Access Allow 策略；不要覆盖掉原有邮箱。账户可省略初始门店信息。门店店主再通过网站头像 → 账户管理 → 添加已有店主把该邮箱加入门店。姓名和头像只能本人修改。停用只撤销当前门店资格，不能自行恢复；主动退出则保留 30 天恢复资格，现有店主可取消这一资格。所有有效成员退出或被后台撤权后，门店保留 30 天再清理。删除唯一门店也不会删除账户。要撤销账户全部登录资格，请从 Secret 移除邮箱，再移除 Access 策略中的邮箱。已有 JWT 和遗留 managed 行不能绕过后台授权。迁移前在网页开通的合法账户需补入 Secret 才能继续登录。

代码回退可在 Worker → Deployments 选择旧版本，但**代码回退不会回滚数据库迁移或已删除的附件**。新增迁移应先备份、验证，尽量保持前后版本兼容。

### 可选：从 GitHub 手动发布

仓库包含 `Production checks` 和 `Deploy production` 两个工作流。普通 push 只检查；部署需在 Actions 中手动运行，限定 `main` 分支。

先完成一次本地部署和员工 Secret 配置。在 GitHub 仓库 **Settings → Environments** 创建 `production`，配置：

| 类型           | 名称                                                  | 内容                       |
| -------------- | ----------------------------------------------------- | -------------------------- |
| Secret         | `CLOUDFLARE_API_TOKEN`                                | 仅授权目标账户的部署 Token |
| Variable       | `CLOUDFLARE_ACCOUNT_ID`                               | Account ID                 |
| Variable       | `D1_DATABASE_ID`                                      | 正式数据库 ID              |
| Variable       | `ACCESS_TEAM_DOMAIN`                                  | Team Domain                |
| Variable       | `ACCESS_AUD`                                          | 应用 AUD                   |
| Variable，可选 | `WORKER_NAME` / `D1_DATABASE_NAME` / `R2_BUCKET_NAME` | 修改了默认资源名称时填写   |

API Token 从 Cloudflare **My Profile → API Tokens → Create Token** 创建，可基于 Edit Cloudflare Workers 模板，限定到目标账户并包含 Worker Scripts Edit、D1 Edit、Workers R2 Storage Edit，以及模板所需的账户读取权限；若管理自定义域名，还要相应 Zone 读取/路由权限。不要使用 Global API Key。Token 只存 GitHub Secret；Access Allow 策略和员工名单仍在 Cloudflare 管理。

随后进入 **Actions → Deploy production → Run workflow → main**。流程执行测试、正式迁移与发布。不要同时开启另一套 Cloudflare Git 自动部署，以免发布顺序冲突。生产备份需在运行该工作流之前完成。

## 9. 备份、恢复与问题排查

完整步骤见 [备份与恢复](BACKUP.md)。D1 免费版只有 7 天 Time Travel，不能代替数据库与附件的成套备份。页面 JSON 导出便于查看和迁移业务数据，不包含报告二进制文件。

| 现象                         | 检查方法                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| “员工登录尚未配置”           | 检查 Team Domain 无协议前缀、AUD 来自对应 Access 应用                                                          |
| “员工权限尚未正确配置”       | 检查 `STAFF_ACCOUNTS` Secret 是有效 JSON、角色正确、无重复邮箱                                                 |
| “该员工尚未获得门店访问权限” | Access 已通过，但邮箱不在员工名单中；核对邮箱并重新上传 Secret                                                 |
| 验证码收不到                 | 核对 Allow 邮箱、One-time PIN 是否启用、垃圾邮件及 `noreply@notify.cloudflare.com`；被拒绝的邮箱不会收到验证码 |
| 持续“无法验证登录身份”       | 核对 AUD/团队域名，退出 Access 后重新登录；检查 Cloudflare 服务状态                                            |
| “no such table”              | 核对 DB 绑定，并运行正式迁移；不要向正式库运行 Demo 种子                                                       |
| 报告上传 413                 | 单份文件上限 10 MB，先压缩或分文件上传                                                                         |
| API 1027 / D1 配额错误       | 查看 Workers 请求数和 D1 当日行读写额度，等待重置或评估升级                                                    |
| R2 报错                      | 确认 R2 已开通、绑定名称为 `FILES`、桶名与配置一致                                                             |
| 更新后仍旧界面               | 刷新页面；入口 HTML 不长缓存，带哈希的脚本文件可以长期缓存                                                     |

当前自动化测试覆盖权限、门店隔离、签名与过期检查、删除恢复、到期清理和空库初始化；真实账户的 Access 策略、支付开通、网络质量及云端恢复需在你的账户完成部署后核对。
