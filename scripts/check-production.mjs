import { configErrors, readConfig } from './production-config.mjs';
const errors = configErrors(readConfig());
if (errors.length) {
  console.error(
    '部署配置尚未完成，请运行 pnpm configure：\n' + errors.map((s) => `- ${s}`).join('\n'),
  );
  process.exit(1);
}
console.log('正式环境配置格式检查通过。员工 Secret、Access 策略与绑定资源还需按部署指南核对。');
