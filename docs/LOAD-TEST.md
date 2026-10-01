# 压测已结束（历史入口说明）

2026-10-01：1000/10000 级虚构客户测试已结束，不再提供数据导入流程。

- seed:generate、seed:remote 和远程压测导入器已经删除。
- LOAD_TEST_CUSTOMERS / LOAD_TEST_STORE_ID 已失效，应在 Cloudflare 控制台删除，不要重新添加。
- 正式构建不自动生成、导入、清空或替换客户数据；迁移只应用正式迁移链。
- 历史压测生成规则仅作为内存测试夹具保留，无法通过命令行访问生产 D1。
- Server-Timing 默认关闭；维护时显式启用方式见 [性能诊断](PERFORMANCE-DIAGNOSTICS.md)。

已有虚构数据的清理、只读核验和 Cloudflare 操作见 [生产收尾](PRODUCTION-RELEASE.md)。不要运行旧提交的 seed 脚本，也不要把旧离线导入 SQL 再次上传。CHANGELOG 中以前的压测说明只是历史记录。
