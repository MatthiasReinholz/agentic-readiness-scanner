/**
 * RFC 9309 robots.txt parser with Content-Signal and Sitemap records.
 * Deterministic and dependency-free; fixture-tested.
 */
export interface RobotsRule {
  type: 'allow' | 'disallow';
  pattern: string;
}

export interface RobotsGroup {
  /** User-agent product tokens, lower-cased, as written. "*" is the default group. */
  agents: string[];
  rules: RobotsRule[];
}

export type ContentSignal = Record<string, 'yes' | 'no'>;

export interface RobotsTxt {
  groups: RobotsGroup[];
  sitemaps: string[];
  contentSignals: ContentSignal | null;
  /** Lines that could not be interpreted, kept for evidence. */
  unknownLines: string[];
}

/**
 * RFC 9309 path matching: the rule is a prefix of the path, `*` matches any run of
 * characters and a trailing `$` anchors the end. Implemented as a two-pointer scan with
 * backtracking to the last `*` only, so it is linear in the path length and immune to
 * the catastrophic patterns a regex translation would allow.
 */
export function matchesRobotsPattern(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const rule = anchored ? pattern.slice(0, -1) : pattern;
  let p = 0;
  let s = 0;
  let starIndex = -1;
  let starMatch = 0;
  while (s < path.length) {
    if (p < rule.length && rule[p] === '*') {
      starIndex = p;
      starMatch = s;
      p += 1;
    } else if (p < rule.length && rule[p] === path[s]) {
      p += 1;
      s += 1;
    } else if (starIndex !== -1) {
      p = starIndex + 1;
      starMatch += 1;
      s = starMatch;
    } else {
      return false;
    }
    if (p === rule.length && !anchored) return true;
  }
  while (p < rule.length && rule[p] === '*') p += 1;
  return p === rule.length;
}

export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  const unknownLines: string[] = [];
  let contentSignals: ContentSignal | null = null;
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const hash = rawLine.indexOf('#');
    const line = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) {
      unknownLines.push(rawLine.trim());
      continue;
    }
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    switch (field) {
      case 'user-agent': {
        const token = value.toLowerCase();
        if (current && lastWasAgent) {
          current.agents.push(token);
        } else {
          current = { agents: [token], rules: [] };
          groups.push(current);
        }
        lastWasAgent = true;
        break;
      }
      case 'allow':
      case 'disallow': {
        lastWasAgent = false;
        if (!current) {
          unknownLines.push(rawLine.trim());
          break;
        }
        if (value === '' && field === 'disallow') break;
        if (value === '') break;
        current.rules.push({ type: field, pattern: value });
        break;
      }
      case 'sitemap':
        lastWasAgent = false;
        if (value) sitemaps.push(value);
        break;
      case 'content-signal': {
        lastWasAgent = false;
        contentSignals ??= {};
        for (const part of value.split(',')) {
          const [name, setting] = part.split('=').map((s) => s.trim().toLowerCase());
          if (name && (setting === 'yes' || setting === 'no')) contentSignals[name] = setting;
        }
        break;
      }
      case 'crawl-delay':
      case 'host':
        lastWasAgent = false;
        break;
      default:
        lastWasAgent = false;
        unknownLines.push(rawLine.trim());
    }
  }

  return { groups, sitemaps, contentSignals, unknownLines };
}

/** The group that applies to a product token, per RFC 9309 section 2.2.1. */
export function groupFor(robots: RobotsTxt, productToken: string): RobotsGroup | null {
  const token = productToken.toLowerCase();
  let best: RobotsGroup | null = null;
  let bestLength = -1;
  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent === '*') continue;
      if (token === agent && agent.length > bestLength) {
        best = group;
        bestLength = agent.length;
      }
    }
  }
  if (best) return best;
  return robots.groups.find((group) => group.agents.includes('*')) ?? null;
}

/** True when the group explicitly names the token (not via "*"). */
export function isAgentNamed(robots: RobotsTxt, productToken: string): boolean {
  const token = productToken.toLowerCase();
  return robots.groups.some((group) =>
    group.agents.some((agent) => agent !== '*' && token === agent),
  );
}

/** Longest-match evaluation; Allow wins ties. Paths include the query string. */
export function isAllowed(robots: RobotsTxt, productToken: string, path: string): boolean {
  const group = groupFor(robots, productToken);
  if (!group) return true;
  let winner: RobotsRule | null = null;
  let winnerLength = -1;
  for (const rule of group.rules) {
    if (matchesRobotsPattern(rule.pattern, path)) {
      const length = rule.pattern.length;
      if (length > winnerLength || (length === winnerLength && rule.type === 'allow')) {
        winner = rule;
        winnerLength = length;
      }
    }
  }
  return winner === null || winner.type === 'allow';
}
