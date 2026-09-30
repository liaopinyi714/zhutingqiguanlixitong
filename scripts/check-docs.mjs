import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Resolve relative links from their own document, as GitHub does. External URLs
// and section anchors are outside this offline check's scope.
const documents = [
  'README.md',
  'CHANGELOG.md',
  ...readdirSync('docs')
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`),
];
let checked = 0;
const failures = [];
for (const document of documents) {
  const source = readFileSync(document, 'utf8');
  for (const match of source.matchAll(/\[[^\]\n]*\]\((<[^>\n]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
    const path = target.split(/[?#]/)[0];
    if (!path) continue;
    checked++;
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      failures.push(`${document}: 无效链接 ${target}`);
      continue;
    }
    if (!existsSync(resolve(dirname(document), decoded))) {
      failures.push(`${document}: 找不到 ${target}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`已检查 ${documents.length} 份文档、${checked} 个本地链接。`);
}
