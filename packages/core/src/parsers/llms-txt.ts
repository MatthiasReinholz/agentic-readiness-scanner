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

const LINK_PATTERN = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

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
    for (const match of line.matchAll(LINK_PATTERN)) {
      links.push({ text: match[1] ?? '', url: match[2] ?? '', section });
    }
  }

  return { title, summary, sections, links };
}

export function isWellFormedLlmsTxt(parsed: LlmsTxt): boolean {
  return parsed.title !== null && parsed.links.length > 0;
}
