# 只用网页部署到 Cloudflare

核对日期：2026-09-27。本指南适用于 `liaopinyi714/zhutingqiguanlixitong` 仓库的 `main` 分支。你不需要在电脑上安装 Git、Node.js 或 pnpm，也不需要打开命令行。Cloudflare 的 Workers Builds 会从 GitHub 拉取代码，在云端运行项目自带的测试、建表和发布步骤。

首次配置预计需要 Cloudflare 账户、GitHub 仓库的管理权限、你能收验证码的员工邮箱。界面文字可能随控制台版本略有变化，认准对应的 Worker、D1、R2、Access 和 Builds 页面。

## 先准备四个名称

本项目默认使用以下名称。请直接使用，减少配置差错。

| 用途 | 名称 |
| --- | --- |
| Worker 网站 | `hearing-care` |
| D1 正式数据库 | `hearing-care-production` |
| R2 私有存储桶 | `hearing-care-production-private` |
| GitHub 仓库 | `liaopinyi714/zhutingqiguanlixitong`，生产分支 `main` |

## 1. 创建空的 Worker

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，选中你自己的账户。
2. 打开 **Workers & Pages → Create application → Create Worker / Start with Hello World**。将名称设为 `hearing-care`，点击 **Deploy**。现在显示的只是临时 Hello World 页面。
3. 记下此 Worker 的 `*.workers.dev` 地址。正式代码将在后面的 GitHub 构建中覆盖临时页面。
4. 在账户概览或 Workers 页面复制 **Account ID**，暂时保存于自己的笔记中。

不要在此时上传真实客户资料。

## 2. 创建数据库和报告存储桶

1. 打开 **Storage & databases → D1 SQL Database → Create database**。名称填 `hearing-care-production`，创建后复制该库的 **Database ID**。这是数据库 ID，不是 Account ID。保持空库，不手动粘贴 SQL，也不要导入 Demo 数据。
2. 打开 **Storage & databases → R2 Object Storage**。若尚未启用，请在页面完成开通。选择 **Create bucket**，名称填 `hearing-care-production-private`，存储类别选 **Standard**。
3. 进入这个 R2 桶的设置，确认没有启用公开 `r2.dev` URL，也没有公开自定义域名。报告会通过受保护的 Worker 下载。

R2 有免费额度，但超过免费额度会按量收费；开通页面可能要求付款资料。D1 和 R2 的费用及限制以控制台显示为准。

## 3. 先保护 Worker，并记下登录配置

1. 打开 **Zero Trust / Cloudflare One**，首次使用时创建团队并选择 **Free** 计划。记下团队域名，格式类似 `你的团队.cloudflareaccess.com`，不要复制 `https://`。
2. 在 **Integrations → Identity providers** 中启用 **One-time PIN**，这样员工可以通过邮箱验证码登录。
3. 回到 **Workers & Pages → hearing-care → Access → Protect this Worker behind Access**。选择 **All traffic**。创建只允许指定员工邮箱的 Allow 策略；不要选 Everyone 或 Bypass。保存。
4. 在 **Zero Trust → Access controls → Applications** 找到对应的 Worker 应用，确认登录方式包含 One-time PIN。在应用详情的 **Configure / Additional settings** 复制 **Application Audience (AUD) Tag**。它通常是 64 位十六进制字符。

这一步必须覆盖生产网址；之后若添加自定义域名，也应检查它处于同一个 Worker Access 保护下。应用后用无痕窗口打开临时网址，应该先看到 Cloudflare 登录页。

## 4. 在 Worker 页面设置员工名单 Secret

进入 **Workers & Pages → hearing-care → Settings → Variables and Secrets → Add**。类型选 **Secret**，名称准确填写 `STAFF_ACCOUNTS`，值填写下面这样的 JSON；将邮箱、姓名、门店名称换成自己的真实信息：

```json
[{"email":"你用于登录的邮箱@example.com","name":"你的姓名","role":"店主","tenantId":"store-001","storeName":"你的助听器门店"}]
```

示例中的邮箱是占位符，必须替换为真实邮箱。`role` 填 `店主`。初始店主配置成功后，点击网站头像 → 账户管理即可添加其他店主，不再需要为每个账户编辑 Secret。配置中同一门店的 `tenantId` 和 `storeName` 保持相同。`tenantId` 是数据归属标识，正式使用后不要随意改变。员工邮箱还必须同时出现在上一步的 Access Allow 策略中。

**Secret 要加在 Worker 的运行时 Variables and Secrets 页面，不要加在 Builds 的 Build Variables 页面，也不要提交到 GitHub。** 创建后保存/部署 Secret。后续代码发布会保留该 Secret。

## 5. 让云端构建有建表权限

Workers Builds 创建的默认发布令牌不包含 D1 写入权限。本项目让 Cloudflare 自动应用 `migrations-production/` 中的建表文件，因此构建令牌还需要目标账户的 **D1 → Edit** 权限。

在 Cloudflare 网站中完成以下配置：

1. 打开右上角头像 → **My Profile → API Tokens**。
2. 创建一个仅限当前账户的自定义 API Token。可从 **Edit Cloudflare Workers** 模板开始，再检查或补齐这些权限：**Account Settings → Read、Workers Scripts → Edit、Workers KV Storage → Edit、Workers R2 Storage → Edit、D1 → Edit**；若界面要求，还需 **Zone Workers Routes → Edit**、**User Details → Read**、**Memberships → Read**。资源范围限制到本项目使用的 Cloudflare 账户。
3. 保存 Token。不要将 Token 填入 GitHub 文件、Build Variables 或聊天消息。下一步在 Worker 的 **Settings → Builds → API token** 处选择刚创建的 Token。如果控制台允许直接编辑已经自动生成的 Builds Token，也可以给它增加 D1 Edit，而不另建一个。

此 Token 供 Cloudflare 自己的构建环境使用；你不需要在本机登录 Wrangler。

## 6. 把 Worker 连接到 GitHub

1. 打开 **Workers & Pages → hearing-care → Settings → Builds → Connect**，选择 **GitHub**，按照弹出的 GitHub 页面授权 Cloudflare GitHub App 读取该仓库。
2. 选择仓库 `liaopinyi714/zhutingqiguanlixitong`，生产分支选 `main`，**Root directory** 保持仓库根目录 `/`。从 GitHub 拉下来的仓库根目录已经有 `package.json`，不要填本地工作区的 `app`。
3. 填写 **Build command**：`pnpm run build:cloudflare`。
4. 填写 **Deploy command**：`pnpm exec wrangler deploy --config wrangler.jsonc`。
5. 在 **API token** 下拉框选择第 5 步的 Token。
6. 在 **Build Variables and Secrets** 中加入下表。这里是构建期间的变量，不是 Worker 运行时的 Secret。除表中值外不要添加 `STAFF_ACCOUNTS`。

| 变量名 | 填写值 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 第 1 步复制的 Account ID |
| `D1_DATABASE_ID` | 第 2 步复制的 Database ID |
| `ACCESS_TEAM_DOMAIN` | 第 3 步的团队域名，不带协议前缀 |
| `ACCESS_AUD` | 第 3 步的 Application Audience (AUD) Tag |
| `PNPM_VERSION` | `11.19.0` |
| `NODE_VERSION` | `24` |

名称与本文一致时，无需填写 `WORKER_NAME`、`D1_DATABASE_NAME` 或 `R2_BUCKET_NAME`。构建会根据这些值生成正式配置；仓库里的占位配置不会被直接发布。`PNPM_VERSION` 必须设置，因为 Cloudflare 构建镜像默认 pnpm 版本与本项目锁文件不一致。

7. 在 **Settings → Builds → Branch control** 关闭 **Enable Preview Builds**。本项目第一次上线只使用 `main` 的正式构建；脚本也会拒绝在其他 Cloudflare 构建分支操作正式数据库。
8. 保存构建设置。若连接仓库时已经启动了第一次构建，而此时变量或 Token 尚未填完，第一次失败是预期结果。设置完成后打开 **Builds**，对最近的 `main` 构建点 **Retry**；若界面没有 Retry，可从 GitHub 网页对 `main` 提交一次实际代码更新来触发新构建。

`build:cloudflare` 在云端先核对配置、运行测试、构建前端，再对远程 D1 应用尚未运行的迁移。只有全部成功，Deploy command 才会发布网站。首次会建立客户、检查、验配、随访和审计等表，正式库里不会生成演示客户。

## 7. 核对部署结果

1. 在 Worker 的 **Builds** 页面确认最新 `main` 构建和部署成功；失败时展开日志，看失败处是依赖安装、配置检查、D1 迁移还是 Worker 发布。
2. 在 Worker **Settings → Bindings / Variables and Secrets** 检查 `DB` 指向正式 D1，`FILES` 指向私有 R2，`DEMO_MODE` 是 `false`，`STAFF_ACCOUNTS` 显示为 Secret，Team Domain 和 AUD 与 Access 应用相同。
3. 在 D1 的 **Console** 输入 `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`，执行后应能看到 `customers` 等业务表和 `d1_migrations`。这是网页内的 SQL 查询框，不需要在电脑上运行命令。
4. 用无痕窗口打开 Worker 的 `workers.dev` 地址。先应出现 Access 登录；输入你在 Allow 策略和 `STAFF_ACCOUNTS` 中登记的邮箱，收取验证码后进入系统。正式库的客户数应为 0，不能出现演示角色选择。
5. 只用虚构资料做一次新建、搜索与附件测试。确认登录和访问权限后，再考虑录入真实资料。

中国大陆网络可能影响 `workers.dev` 的打开速度与稳定性。请分别用门店宽带和手机网络实测登录、搜索及文件上传。自定义域名可在 Worker 的 **Settings → Domains & Routes** 后续添加，但域名本身不保证大陆加速。

## 常见失败原因

| 页面或日志信息 | 处理办法 |
| --- | --- |
| `pnpm` 版本或锁文件错误 | 在 **Settings → Builds → Build Variables and Secrets** 核对 `PNPM_VERSION=11.19.0`，再 Retry。 |
| 缺少 Account ID、D1 ID、Team Domain 或 AUD | 核对六项 Build Variables 的名称和值；Team Domain 不带 `https://`。 |
| D1 migration 显示 `authentication` / `permission` | 在 **Settings → Builds → API token** 检查选中的 Token，给目标账户授予 D1 Edit 后 Retry。 |
| 访问出现 `no such table` | 最新构建中的 D1 migration 未成功；检查数据库 ID 指向正式库，不要手动导入 Demo SQL。 |
| 登录后提示员工权限问题 | 检查 Worker 运行时 `STAFF_ACCOUNTS` Secret 的 JSON、登录邮箱与 Access Allow 策略。 |
| 上传报告失败 | 检查私有 R2 已开通，`FILES` 绑定正确；单份文件上限为 10 MB。 |
| 页面仍显示 Hello World | 检查 `main` 分支的最新 Build 是否成功部署，以及 Worker 名称为 `hearing-care`。 |

正式数据开始录入后，后续每次向 GitHub `main` 推送代码都会自动运行正式迁移并发布。修改员工名单只需在 Cloudflare 的 Access 策略与 Worker Secret 中同步修改。完整的 D1 与 R2 配套备份仍需另行安排；控制台里的 D1 Time Travel 不能单独恢复报告文件，详见 [备份与恢复](BACKUP.md)。

## 官方资料

- [将现有 Worker 连接 GitHub](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Workers Builds 的构建设置、API Token 和变量](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [构建镜像中 Node.js 与 pnpm 的版本设置](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
- [D1 迁移在非交互构建环境运行](https://developers.cloudflare.com/d1/wrangler-commands/)
- [为 Worker 设置 Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
