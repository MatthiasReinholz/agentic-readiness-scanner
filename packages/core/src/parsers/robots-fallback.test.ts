import { describe, expect, it } from 'vitest';

import { groupFor, isAgentNamed, isAllowed, parseRobotsTxt } from './robots.js';

describe('documented fallback groups', () => {
  it('lets Applebot follow the Googlebot group when no group names Applebot', () => {
    const robots = parseRobotsTxt(
      'User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\nDisallow: /private/\n',
    );
    expect(isAllowed(robots, 'Applebot', '/product/a')).toBe(true);
    expect(isAllowed(robots, 'Applebot', '/private/x')).toBe(false);
    expect(groupFor(robots, 'Applebot')?.agents).toEqual(['googlebot']);
    // Being covered by the fallback is not being named.
    expect(isAgentNamed(robots, 'Applebot')).toBe(false);
  });

  it('prefers an Applebot group, and falls back to "*" without a Googlebot group', () => {
    const own = parseRobotsTxt(
      'User-agent: Googlebot\nAllow: /\n\nUser-agent: Applebot\nDisallow: /\n',
    );
    expect(isAllowed(own, 'Applebot', '/')).toBe(false);
    const star = parseRobotsTxt('User-agent: *\nDisallow: /search\n');
    expect(isAllowed(star, 'Applebot', '/search')).toBe(false);
  });

  it('gives Applebot-Extended no Googlebot fallback, since Apple documents none', () => {
    const robots = parseRobotsTxt(
      'User-agent: *\nAllow: /\n\nUser-agent: Googlebot\nDisallow: /\n',
    );
    expect(isAllowed(robots, 'Applebot-Extended', '/')).toBe(true);
  });
});
