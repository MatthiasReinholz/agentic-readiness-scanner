/**
 * Parses and validates one knowledge-base article: `knowledge/<CHECK-ID>.md`, the long
 * explanation of a check that the hosted app publishes at /knowledge-base/<slug>, or a
 * guide, `knowledge/guides/<slug>.md`, about a topic no single check covers. The format
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

interface Parsed {
  meta: Record<string, string>;
  slug: string;
  headline: string;
  description: string;
  keywords: string[];
  body: string;
  prose: string[];
  problems: string[];
}

/** Front matter, the shared metadata rules and the Markdown subset, for articles and guides. */
function parseCommon(source: string, fileName: string): Parsed {
  const problems: string[] = [];
  const frontMatter = FRONT_MATTER.exec(source);
  if (!frontMatter) throw new Error(`${fileName}: missing front matter`);
  const meta: Record<string, string> = {};
  for (const line of frontMatter[1]?.split('\n') ?? []) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
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
  return { meta, slug, headline, description, keywords, body, prose, problems };
}

function sectionsOf(prose: readonly string[]): string[] {
  return prose.filter((line) => line.startsWith('## ')).map((line) => line.slice(3).trim());
}

/** The FAQ's `###` questions: three to six, each ending with a question mark. */
function checkFaq(prose: readonly string[], problems: string[]): void {
  const faqStart = prose.indexOf('## FAQ');
  const rest = faqStart === -1 ? [] : prose.slice(faqStart + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  const questions = (end === -1 ? rest : rest.slice(0, end)).filter((line) =>
    line.startsWith('### '),
  );
  if (questions.length < 3 || questions.length > 6)
    problems.push('FAQ needs three to six ### questions');
  for (const question of questions)
    if (!question.trim().endsWith('?')) problems.push(`FAQ heading is not a question: ${question}`);
}

function fail(problems: readonly string[], fileName: string): never {
  throw new Error(problems.map((problem) => `${fileName}: ${problem}`).join('\n'));
}

/** Parses an article; throws with every problem found, prefixed by the file name. */
export function parseKnowledgeMarkdown(source: string, fileName: string): KnowledgeArticle {
  const { slug, headline, description, keywords, body, prose, problems } = parseCommon(
    source,
    fileName,
  );
  const id = fileName.replace(/\.md$/, '');
  const sections = sectionsOf(prose);
  if (sections.join('|') !== KNOWLEDGE_SECTIONS.join('|'))
    problems.push(
      `sections must be exactly: ${KNOWLEDGE_SECTIONS.join(', ')} (found: ${sections.join(', ')})`,
    );
  checkFaq(prose, problems);
  if (problems.length > 0) fail(problems, fileName);
  return { id, slug, headline, description, keywords, body };
}

/**
 * A guide: an article about a topic that spans checks or explains how the scanner works,
 * published at /knowledge-base/guides/<slug>. Its sections are free, apart from an answer
 * first and its public sources last.
 */
export interface KnowledgeGuide {
  /** Permanent URL segment: /knowledge-base/guides/<slug>. */
  slug: string;
  headline: string;
  description: string;
  keywords: string[];
  /** Check ids the guide is about; their articles link back to it. */
  related: string[];
  body: string;
}

/** A guide opens with this section... */
export const GUIDE_FIRST_SECTION = 'In short';
/** ...and ends with its sources: public links only, every claim traceable. */
export const GUIDE_LAST_SECTION = 'Sources';

/** Parses a guide; throws with every problem found, prefixed by the file name. */
export function parseGuideMarkdown(source: string, fileName: string): KnowledgeGuide {
  const { meta, slug, headline, description, keywords, body, prose, problems } = parseCommon(
    source,
    fileName,
  );
  if (`${slug}.md` !== fileName) problems.push(`file name must be the slug (${slug}.md)`);
  const related = (meta.related ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const sections = sectionsOf(prose);
  if (sections[0] !== GUIDE_FIRST_SECTION)
    problems.push(`the first section must be "${GUIDE_FIRST_SECTION}"`);
  if (sections.at(-1) !== GUIDE_LAST_SECTION)
    problems.push(`the last section must be "${GUIDE_LAST_SECTION}"`);
  if (sections.length < 4)
    problems.push('a guide needs at least two sections between the first and the last');
  if (new Set(sections).size !== sections.length) problems.push('section headings must be unique');
  if (sections.includes('FAQ')) checkFaq(prose, problems);
  const sourcesStart = prose.indexOf(`## ${GUIDE_LAST_SECTION}`);
  const sourceLinks = (sourcesStart === -1 ? [] : prose.slice(sourcesStart + 1)).filter((line) =>
    /^- \[[^\]]+\]\(https:\/\/[^)\s]+\)/.test(line),
  );
  if (sourceLinks.length < 2)
    problems.push('Sources needs at least two "- [title](https://...)" links');
  if (problems.length > 0) fail(problems, fileName);
  return { slug, headline, description, keywords, related, body };
}

/** Links inside articles and guides to articles: /knowledge-base/<slug>. */
export function articleLinks(article: Pick<KnowledgeArticle, 'body'>): string[] {
  return [...article.body.matchAll(/\]\(\/knowledge-base\/([a-z0-9-]+)\)/g)].map(
    (match) => match[1] ?? '',
  );
}

/** Links inside articles and guides to guides: /knowledge-base/guides/<slug>. */
export function guideLinks(article: Pick<KnowledgeArticle, 'body'>): string[] {
  return [...article.body.matchAll(/\]\(\/knowledge-base\/guides\/([a-z0-9-]+)\)/g)].map(
    (match) => match[1] ?? '',
  );
}
