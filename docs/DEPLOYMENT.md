# Cloudflare Demo 部署

此文档为可执行部署步骤。本次版本在本地 D1/R2 模拟环境验证，未自动创建任何 Cloudflare 付费资源。

当前方案使用 Workers Static Assets、D1 和 R2 Standard。免费额度及超额后的行为以 Cloudflare 当时的 [Workers 限额](https://developers.cloudflare.com/workers/platform/limits/)、[D1 价格](https://developers.cloudflare.com/d1/platform/pricing/) 和 [R2 价格](https://developers.cloudflare.com/r2/pricing/) 为准；D1 免费额度用尽时查询会失败，正式运营前应设置用量监控。中国大陆访问速度与稳定性需在实际门店网络测试，无法由部署地区设置保证。

## 1. 准备

准备自己的 Cloudflare 账户、GitHub 仓库和 Node.js 24。启用 R2 时如控制台要求账单信息或接受服务条款，应由账户所有者完成。不要把令牌、客户资料或数据库导出提交 Git。

```sh
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler d1 create hearing-care-demo --location=apac
pnpm exec wrangler r2 bucket create hearing-care-demo-private
```

## 2. 更新绑定

修改 `wrangler.jsonc`：

- `name`：自选 Worker 名称。
- `d1_databases[0].database_name`：设为刚创建的数据库名。
- `d1_databases[0].database_id`：替换全零占位符，使用创建命令返回的 ID。
- `r2_buckets[0].bucket_name`：设为实际创建的私有桶。
- 仅虚构数据演示保留 `DEMO_MODE: "true"`。

不要开启桶的公共访问或 `r2.dev`，附件由带会话鉴权的 `/api/files/:id` 下载。

## 3. 建库与部署

```sh
pnpm exec wrangler d1 migrations apply hearing-care-demo --remote
pnpm test
pnpm build
pnpm exec wrangler deploy
```

四份迁移分别创建基础表、12 份虚构资料、助听器型号字典和建档/纠错字段。远程迁移会写入新演示数据库。已有业务数据库不能直接应用演示种子；已经运行旧版 Demo 的环境应按当前版本补齐 `0003_device_catalog.sql`、`0004_intake_and_corrections.sql`，迁移前先备份。`0004` 会调整两条虚构验配记录的保修日期，便于体验提醒页面。

部署后用命令返回的网址访问，验证登录、同页建档、保修到期提醒、检查和验配删除恢复、回访、报告上传和下载。随后用门店实际宽带和手机网络测试冷启动、列表加载、保存及附件传输。自定义域名可以后续在 Worker 设置中绑定，但不能据此保证中国大陆连接稳定。

## 4. GitHub 自动构建

项目含 GitHub Actions：每次 push 和 PR 执行测试与构建。Cloudflare 控制台可导入该 GitHub 仓库，构建命令使用 `pnpm build`，部署命令使用 `pnpm exec wrangler deploy`。构建环境选 Node.js 24，Worker 名称需与配置文件一致。

数据库迁移应在部署前单独执行并审查。开发、测试、正式环境要使用独立数据库、桶和配置；预览部署不能绑定真实生产资料。

## 5. 数据保存与恢复

本地数据保存于 `.wrangler/state/`。远程 D1 与 R2 不随前端代码发布清空。

店主界面提供的 JSON 导出用于资料可携带性，附件只包含目录，不是完整备份。生产前需补齐定时数据库备份、R2 文件备份、保留策略、加密和恢复演练。代码回滚不能撤销数据库迁移。

## 正式上线前

将真实员工认证、会话管理、权限细分、数据修订追踪、备份恢复、容量及费用告警作为上线工作完成。真实健康资料的存储地点和处理方式也必须先确定。当前代码明确是 Demo，不能通过隐藏演示提示直接投入真实客户使用。
