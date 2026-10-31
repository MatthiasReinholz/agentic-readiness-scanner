import type { ScanResult } from '@agentic-readiness/catalog';

export function renderJson(result: ScanResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
