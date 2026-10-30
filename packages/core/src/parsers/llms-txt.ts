export interface LlmsTxtLink {
  text: string;
  url: string;
  section: string | null;
}

export interface LlmsTxt {
  title: string | null;
  summary: string | null;
  sections: string[];
  links: LlmsTxtLink[];
}

/**
 * Extracts Markdown links `[text](url "optional title")` from one line with a single
 * forward scan. A hand-written scanner is used instead of a regular expression so that
 * hostile input (thousands of unbalanced brackets) cannot trigger quadratic backtracking.
 */
export function extractMarkdownLinks(line: string): { text: string; url: string }[] {
  const found: { text: string; url: string }[] = [];
  let index = 0;
  while (index < line.length) {
    const open = line.indexOf('[', index);
    if (open === -1) break;
    const close = line.indexOf(']', open + 1);
    if (close === -1) break;
    if (line[close + 1] !== '(') {
      index = close + 1;
      continue;
    }
    const end = line.indexOf(')', close + 2);
    if (end === -1) break;
    const target = line.slice(close + 2, end).trim();
    const url = target.split(/\s+/, 1)[0] ?? '';
    if (url.length > 0) {
      found.push({ text: line.slice(open + 1, close), url });
    }
    index = end + 1;
  }
  return found;
}

export function parseLlmsTxt(text: string): LlmsTxt {
  let title: string | null = null;
  let summary: string | null = null;
  const sections: string[] = [];
  const links: LlmsTxtLink[] = [];
  let section: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (title === null && line.startsWith('# ')) {
      title = line.slice(2).trim();
      continue;
    }
    if (summary === null && line.startsWith('> ')) {
      summary = line.slice(2).trim();
      continue;
    }
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      sections.push(section);
      continue;
    }
    for (const link of extractMarkdownLinks(line)) {
      links.push({ ...link, section });
    }
  }

  return { title, summary, sections, links };
}

export function isWellFormedLlmsTxt(parsed: LlmsTxt): boolean {
  return parsed.title !== null && parsed.links.length > 0;
}
