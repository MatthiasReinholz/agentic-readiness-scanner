import { describe, expect, it } from 'vitest';

import { groupFor, isAgentNamed, isAllowed, parseRobotsTxt } from './robots.js';

const SAMPLE = `
User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
Disallow: /cart/

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: ChatGPT-User
Allow: /

Content-Signal: ai-train=no, search=yes
Sitemap: https://example.shop/sitemap.xml
`;

describe('parseRobotsTxt', () => {
  const robots = parseRobotsTxt(SAMPLE);

  it('groups consecutive user-agent lines', () => {
    expect(robots.groups).toHaveLength(3);
    expect(robots.groups[1]?.agents).toEqual(['gptbot', 'ccbot']);
  });

  it('collects sitemaps and content signals', () => {
    expect(robots.sitemaps).toEqual(['https://example.shop/sitemap.xml']);
    expect(robots.contentSignals).toEqual({ 'ai-train': 'no', search: 'yes' });
  });

  it('matches the most specific group and falls back to *', () => {
    expect(groupFor(robots, 'GPTBot')?.agents).toContain('gptbot');
    expect(groupFor(robots, 'Claude-User')?.agents).toEqual(['*']);
    expect(isAgentNamed(robots, 'CCBot')).toBe(true);
    expect(isAgentNamed(robots, 'ClaudeBot')).toBe(false);
  });

  it('applies longest match with allow winning ties', () => {
    expect(isAllowed(robots, 'Googlebot', '/wp-admin/admin-ajax.php')).toBe(true);
    expect(isAllowed(robots, 'Googlebot', '/wp-admin/edit.php')).toBe(false);
    expect(isAllowed(robots, 'Googlebot', '/product/mug/')).toBe(true);
    expect(isAllowed(robots, 'GPTBot', '/product/mug/')).toBe(false);
    expect(isAllowed(robots, 'ChatGPT-User', '/product/mug/')).toBe(true);
  });

  it('supports wildcards and end anchors', () => {
    const wild = parseRobotsTxt('User-agent: *\nDisallow: /*.pdf$\nDisallow: /private*');
    expect(isAllowed(wild, 'x', '/docs/a.pdf')).toBe(false);
    expect(isAllowed(wild, 'x', '/docs/a.pdfx')).toBe(true);
    expect(isAllowed(wild, 'x', '/private-area/')).toBe(false);
  });

  it('treats a missing or empty file as allow-all', () => {
    expect(isAllowed(parseRobotsTxt(''), 'anything', '/')).toBe(true);
  });
});
