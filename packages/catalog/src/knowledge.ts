/**
 * Parses and validates one knowledge-base article: `knowledge/<CHECK-ID>.md`, the long
 * explanation of a check that the hosted app publishes at /knowledge-base/<slug>. The format
 * and the writing rules are in docs/knowledge-base.md. Everything the catalog already
 * knows (weight, levels, fix, specifications) is added by the page, never repeated here.
 */

export interface KnowledgeArticle {
  /** The check this article explains. */
  id: string;
  /** Permanent URL segment: /knowledge-base/<slug>. */
  slug: string;
  /** The page's H1 and title; written as the question or task a reader searches for. */
  headline: string;
  /** Meta description, 100 to 180 characters. */
  description: string;
  keywords: string[];
  /** The article body in the supported Markdown subset, front matter removed. */
  body: string;
}

/** The `##` sections every article carries, in this order. */
export const KNOWLEDGE_SECTIONS = [
  'In short',
  'What this check looks at',
  'Why it matters for AI agents',
  'How the scanner decides',
  'How to fix it',
  'Verify it yourself',
  'Common mistakes',
  'FAQ',
] as const;

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Splits the body into lines outside fenced code blocks, so rules ignore code. */
function proseLines(body: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) lines.push(line);
  }
  return lines;
}

/** Parses an article; throws with every problem found, prefixed by the file name. */
export function parseKnowledgeMarkdown(source: string, fileName: string): KnowledgeArticle {
  const problems: string[] = [];
  const frontMatter = FRONT_MATTER.exec(source);
  if (!frontMatter) throw new Error(`${fileName}: missing front matter`);
  const meta: Record<string, string> = {};
  for (const line of frontMatter[1]?.split('\n') ?? []) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  const id = fileName.replace(/\.md$/, '');
  const slug = meta.slug ?? '';
  const headline = meta.headline ?? '';
  const description = meta.description ?? '';
  const keywords = (meta.keywords ?? '')
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  if (!SLUG.test(slug)) problems.push('slug must be lower-case kebab-case');
  if (headline.length < 10 || headline.length > 90)
    problems.push('headline must be 10 to 90 characters');
  if (description.length < 100 || description.length > 180)
    problems.push(`description must be 100 to 180 characters (has ${description.length})`);
  if (keywords.length < 3) problems.push('keywords needs at least three entries');

  const body = source.slice(frontMatter[0].length).trim();
  const prose = proseLines(body);
  const sections = prose
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim());
  if (sections.join('|') !== KNOWLEDGE_SECTIONS.join('|'))
    problems.push(
      `sections must be exactly: ${KNOWLEDGE_SECTIONS.join(', ')} (found: ${sections.join(', ')})`,
    );
  const faqStart = prose.indexOf('## FAQ');
  const questions =
    faqStart === -1 ? [] : prose.slice(faqStart).filter((line) => line.startsWith('### '));
  if (questions.length < 3 || questions.length > 6)
    problems.push('FAQ needs three to six ### questions');
  for (const question of questions)
    if (!question.trim().endsWith('?')) problems.push(`FAQ heading is not a question: ${question}`);
  prose.forEach((line, index) => {
    if (/^#(?!#)|^####/.test(line))
      problems.push(`line ${index + 1}: only ## and ### headings are supported`);
    if (/<\/?[a-z][^>]*>/i.test(line.replace(/`[^`]*`/g, '')))
      problems.push(`line ${index + 1}: raw HTML is not supported`);
    if (line.includes('—')) problems.push(`line ${index + 1}: no em dashes`);
    if (/^\s+[-*] |^\s+\d+\. /.test(line))
      problems.push(`line ${index + 1}: nested lists are not supported`);
    if (line.includes('![')) problems.push(`line ${index + 1}: images are not supported`);
  });
  if ((body.match(/^```/gm) ?? []).length % 2 !== 0) problems.push('unclosed code fence');

  if (problems.length > 0)
    throw new Error(problems.map((problem) => `${fileName}: ${problem}`).join('\n'));
  return { id, slug, headline, description, keywords, body };
}

/** Links inside articles to other articles: /knowledge-base/<slug>. */
export function articleLinks(article: KnowledgeArticle): string[] {
  return [...article.body.matchAll(/\]\(\/knowledge-base\/([a-z0-9-]+)\)/g)].map(
    (match) => match[1] ?? '',
  );
}
