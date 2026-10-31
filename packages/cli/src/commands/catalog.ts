import { catalog } from '@agentic-readiness/catalog';

export function renderCatalog(): string {
  const lines: string[] = [];
  lines.push(
    `Catalog ${catalog.version} (scoring ${catalog.scoring_version}), ${catalog.checks.length} checks`,
  );
  lines.push('');
  for (const group of catalog.groups) {
    lines.push(`${group.id}  ${group.title} (${group.dimension})`);
    for (const check of catalog.checks.filter((item) => item.group === group.id)) {
      const weight = check.weight === 'info' ? 'info' : `w${check.weight}`;
      const wc = check.requires.includes('woocommerce') ? ' [WC]' : '';
      const deps = check.depends_on.length > 0 ? ` (after ${check.depends_on.join(', ')})` : '';
      lines.push(`  ${check.id.padEnd(5)} ${weight.padEnd(4)} ${check.title}${wc}${deps}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
