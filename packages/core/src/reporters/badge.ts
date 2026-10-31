import type { ScanResult } from '@agentic-readiness/catalog';

import { escapeHtml } from './shared.js';

const LEVEL_COLORS = ['#9f1239', '#c2410c', '#b45309', '#4d7c0f', '#15803d', '#0f766e'];

/** A flat SVG badge: "agent ready | Level 3 · 71/54". Cacheable, no external fonts. */
export function renderBadge(result: Pick<ScanResult, 'level' | 'scores'>): string {
  const label = 'agent ready';
  const value = `Level ${result.level.value} · ${result.scores.ingestion}${result.scores.commerce === null ? '' : `/${result.scores.commerce}`}`;
  const labelWidth = 6 * label.length + 20;
  const valueWidth = 6.5 * value.length + 20;
  const width = Math.round(labelWidth + valueWidth);
  const color = LEVEL_COLORS[result.level.value] ?? LEVEL_COLORS[0];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escapeHtml(label)}: ${escapeHtml(value)}">`,
    `<title>${escapeHtml(label)}: ${escapeHtml(value)}</title>`,
    `<rect width="${labelWidth}" height="20" fill="#334155"/>`,
    `<rect x="${labelWidth}" width="${Math.round(valueWidth)}" height="20" fill="${color}"/>`,
    `<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">`,
    `<text x="${labelWidth / 2}" y="14">${escapeHtml(label)}</text>`,
    `<text x="${labelWidth + valueWidth / 2}" y="14">${escapeHtml(value)}</text>`,
    `</g>`,
    `</svg>`,
  ].join('');
}
