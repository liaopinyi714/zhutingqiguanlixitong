# 数据库与报告附件备份、恢复

代码保存在 GitHub，客户数据不在 GitHub。完整备份至少包含 D1 数据库 SQL、私有 R2 附件文件和对应校验清单；员工名单与 Cloudflare 配置另行保存到管理员的加密存储中。

## 备份频率与保留期限

建议每日营业结束后备份，且每次更新数据库结构前额外备份一次。每套业务备份最多保留 30 天，到期从电脑、外置盘及其他副本中删除；删除的是整套到期备份，避免仅删数据库、留下报告副本。程序不会自动删除你电脑上的文件。D1 免费版的 Time Travel 另有 7 天保留窗口。[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

应用“删除后 30 天彻底清理”仅涵盖在线数据库和 R2。旧备份可能继续含有这些资料，直到该备份本身的保留期结束。按此方案，某条已删除资料在旧备份中的残留可能比在线保留期更长，最长接近删除后的 60 天；如果门店要求 30 天后连备份也必须不可恢复，需要另外采用定向销毁或更短备份周期，不能把在线清理当成全部副本销毁。

备份文件包含客户隐私，使用加密磁盘并限制访问。项目已忽略 `backups/`，不要强制提交到 GitHub。本文步骤不会把业务数据上传到公共仓库。

## 一次性配置 R2 读取工具

备份使用 Cloudflare 官方文档支持的 [rclone](https://developers.cloudflare.com/r2/examples/rclone/)。安装 rclone 后确认终端运行 `rclone version` 有输出。

1. Cloudflare → R2 → Manage R2 API Tokens，创建仅针对 `hearing-care-production-private` 的 **Object Read only** 凭证。
2. 保存 Access Key ID 和 Secret Access Key 到密码管理器。该凭证与 Worker 的绑定不同，只供本地备份工具使用。
3. 运行 `rclone config`，新增远程配置，名称为 `hearing-r2`。
4. 存储类型选 Amazon S3 compatible，Provider 选 Cloudflare。
5. 填入上面的 Access Key ID 和 Secret Access Key。Endpoint 为控制台提供的 S3 endpoint，通常是 `https://你的AccountID.r2.cloudflarestorage.com`；Region 使用 `auto`。
6. 按官方说明设置 `no_check_bucket = true`，避免仅对象权限的凭证尝试检查桶时出错。可通过 `rclone config` 的高级选项设置。
7. 检查读取：`rclone lsf hearing-r2:hearing-care-production-private`。空桶没有输出是正常的，但不能有鉴权报错。

rclone 配置包含凭证，需要保护其配置文件；可以启用 rclone 的配置密码。不要将凭证填入网页源码或 `wrangler.jsonc`。

## 执行完整备份

先让员工暂停写入，避开北京时间 02:00 的定时清理窗口，再在项目根目录运行：

```powershell
pnpm exec wrangler login
pnpm backup
```

脚本将数据库导出为 SQL，使用 rclone **copy** 复制附件，逐个检查 SQL 目录中的报告是否存在且大小一致，并生成 SHA-256 校验清单。每次写入新的时间戳目录，不覆盖旧备份。它不会执行云端删除或 `rclone sync`。

配置、正式校验和备份按 `DB` / `FILES` 绑定名定位资源，不依赖数组顺序。清单中的数据库 ID 对应实际导出的 `DB`；缺失或重复绑定会在云端操作前停止。不要为调整配置文件排列而更改门店 ID 或对象路径。

完成后目录类似：

```text
backups/2026-09-27T10-00-00-000Z/
  database.sql
  files/store-001/客户ID/附件ID
  manifest.json
  COMPLETE
```

只有出现 `COMPLETE` 才表示脚本完成本次导出和附件核对。失败或中途退出的目录不能当成有效备份。备份期间停写是为了让数据库快照与文件副本一致；脚本本身不会自动让线上系统进入维护模式，也没有设置自动备份任务。

如 remote 名称不是 `hearing-r2`，在 PowerShell 先设置 `$env:RCLONE_REMOTE='你设置的名称'`。备份成功后把整套目录复制到第二个受保护位置，并记下对应 Git 提交版本。

## 恢复到新资源，先核对再切换

发生误操作时，优先恢复到新的 D1 数据库和新的私有 R2 桶，保留原资源以便回退。不要直接把 SQL 覆盖导入正在运行的生产库。

1. 选择含 `COMPLETE` 的备份，核对 `manifest.json` 中时间和数据库 ID。可用 PowerShell `Get-FileHash -Algorithm SHA256` 核对 `database.sql` 与清单的 `sqlSha256`。
2. 在 Cloudflare 新建空库，例如 `hearing-care-restore-20260927`，以及私有 Standard R2 桶 `hearing-care-restore-20260927`。
3. 将 SQL 导入**这个新空库**。下面的日期目录要替换成实际值：

```powershell
pnpm exec wrangler d1 execute hearing-care-restore-20260927 --remote --file backups/2026-09-27T10-00-00-000Z/database.sql
```

4. 为恢复目标桶单独配置有写权限的 rclone remote `hearing-r2-restore`，不要扩大日常备份只读凭证权限。保持对象路径不变：

```powershell
rclone copy backups/2026-09-27T10-00-00-000Z/files hearing-r2-restore:hearing-care-restore-20260927 --transfers 2
rclone check backups/2026-09-27T10-00-00-000Z/files hearing-r2-restore:hearing-care-restore-20260927 --download --one-way
```

`check --download` 会实际下载比对文件，消耗 R2 读取操作。恢复后核对客户与附件行数、几份听力图和报告内容。SQL 含原始 `tenant_id`、stores、accounts 和 store_memberships，应整体保留这些关联。提供者的 Access Allow 策略与 STAFF_ACCOUNTS Secret 不在数据库备份内，需要单独安全保存并恢复；新账户不必在 Secret 绑定门店，实际成员关系以恢复后的 D1 为准。

5. 检查新库中的 `d1_migrations` 记录。本版本已验证 Wrangler 本地 SQL 导出包含该表；如果所用导出方式未带迁移历史，先核对结构，再由维护者补齐已应用迁移记录，避免将初始建表重复应用到恢复库。
6. 在已启用 Access 的隔离 Worker 上验证恢复副本；该验证环境暂停 Cron，避免旧快照中的到期记录立即清理。核对完成后，在停写窗口将正式配置中的 D1 ID/名称与 R2 桶名切换为恢复目标，运行配置检查和部署。
7. 恢复正式 Cron、执行必要的后续迁移，验证后恢复员工访问。保留旧资源至确认恢复完成，再按门店保留规则处理旧副本。

恢复较旧备份会带回备份后已删除或修改的资料；重新开放访问之前，应根据操作记录补做删除和变更。本工具不提供跨数据库与对象存储的原子恢复。

## D1 Time Travel 的用途

仅数据库误删时，可在 D1 数据库的 Time Travel 页面选择免费版 7 天内的时间点进行恢复。它只处理数据库，不会复原已经从 R2 彻底删除的报告，所以恢复涉及附件的事故仍要使用成套备份。恢复前先导出当前状态并暂停员工操作。

## 迁移到其他服务商

SQLite/SQL 与独立附件路径都可导出。迁到其他 SQLite 平台可复用大部分结构；PostgreSQL/MySQL 需转换 SQL 方言和 JSON 查询。R2 使用 S3 兼容接口，可通过 rclone 复制到新的对象存储。JWT 验证集中在 `server/auth.ts`，请求权限边界在 `server/http.ts`；更换身份提供商时适配这两层。API 和业务校验可继续复用，但 Hono 的运行入口、数据库和文件绑定需要适配，不能声称零修改迁移。详见 [架构](ARCHITECTURE.md) 与 [数据模型](DATA-MODEL.md)。
