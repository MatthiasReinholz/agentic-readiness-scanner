// Verifies that relative Markdown links point at files that exist.
// External links are not fetched; this check stays offline and deterministic.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = process.cwd();
const skipDirs = new Set(['node_modules', 'dist', '.turbo', '.git']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

const linkPattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
let failures = 0;

for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(linkPattern)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const [pathPart] = target.split('#');
    if (!pathPart) continue;
    const resolved = resolve(dirname(file), pathPart);
    if (!existsSync(resolved)) {
      console.error(`${file}: broken link -> ${target}`);
      failures += 1;
    }
  }
}

if (failures > 0) {
  console.error(`${failures} broken Markdown link(s).`);
  process.exit(1);
}
console.log('All relative Markdown links resolve.');
