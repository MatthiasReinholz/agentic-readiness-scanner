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

function patternToRegExp(pattern: string): RegExp {
  let source = '';
  for (const char of pattern) {
    if (char === '*') source += '.*';
    else if (char === '$') source += '$';
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}`);
}

export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  const unknownLines: string[] = [];
  let contentSignals: ContentSignal | null = null;
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
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
      if ((token.startsWith(agent) || token === agent) && agent.length > bestLength) {
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
    group.agents.some((agent) => agent !== '*' && (token.startsWith(agent) || token === agent)),
  );
}

/** Longest-match evaluation; Allow wins ties. Paths include the query string. */
export function isAllowed(robots: RobotsTxt, productToken: string, path: string): boolean {
  const group = groupFor(robots, productToken);
  if (!group) return true;
  let winner: RobotsRule | null = null;
  let winnerLength = -1;
  for (const rule of group.rules) {
    if (patternToRegExp(rule.pattern).test(path)) {
      const length = rule.pattern.length;
      if (length > winnerLength || (length === winnerLength && rule.type === 'allow')) {
        winner = rule;
        winnerLength = length;
      }
    }
  }
  return winner === null || winner.type === 'allow';
}
