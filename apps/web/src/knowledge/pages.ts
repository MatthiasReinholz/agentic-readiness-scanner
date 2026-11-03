/**
 * The knowledge base: an index at /knowledge-base, one page per catalog section, one
 * article per check, and guides on topics no single check covers (/knowledge-base/guides). Articles come from @agentic-readiness/catalog/knowledge; everything
 * else on the page (priority, the levels a check gates, its dependencies, the fix and
 * the specifications) is read from the catalog, so the two can never disagree. Every page
 * also exists as Markdown for agents, and carries schema.org structured data for search.
 */
import {
  catalog,
  getCheck,
  getGroup,
  getLaw,
  LEGAL_NOTICE,
  type CheckDefinition,
  type Group,
  type Law,
  PLATFORM_LABEL,
  requiredPlatform,
  type FixPlatform,
} from '@agentic-readiness/catalog';
import {
  guides,
  guidesForCheck,
  knowledge,
  type KnowledgeArticle,
  type KnowledgeGuide,
} from '@agentic-readiness/catalog/knowledge';
import { escapeHtml, tierOf, type Tier } from '@agentic-readiness/core';
import {
  alert,
  badge,
  button,
  card,
  codeInline,
  codeBlock,
  icon,
  input,
  identifier,
  panel,
  cn,
} from '@agentic-readiness/ui';

import type { AppConfig } from '../config.js';
import { AUTHOR, jsonLd, metadataHead, siteGraph, socialImage, webPage } from '../metadata.js';
import { page } from '../pages/layout.js';
import { faqPairs, markdownToHtml, plainText, section, slugify } from './markdown.js';
import {
  articleSidebar,
  checkStrip,
  JOURNEY_STEP,
  journeyRail,
  KB_CSS,
  KB_SCRIPT,
  positionLine,
  TIER_DOT,
  tocLinks,
} from './nav.js';

/** When the articles were last reviewed as a whole; bump with substantive rewrites. */
export const KNOWLEDGE_UPDATED = '2026-11-03';

const TIER_TEXT: Record<Tier, string> = {
  blocking: 'Blocking',
  expected: 'Expected',
  nice_to_have: 'Nice to have',
  informational: 'Informational',
};
const TIER_HELP: Record<Tier, string> = {
  blocking:
    'Weight 3. Gates a readiness level or carries the most weight in its section. Fix these first.',
  expected: 'Weight 2. Expected of a well-run store and counted in the section score.',
  nice_to_have: 'Weight 1. Helps agents, rarely decisive on its own.',
  informational: 'Not scored. Reported for context only.',
};
const TIER_BADGE: Record<Tier, string> = {
  blocking: badge({ variant: 'destructive' }),
  expected: badge({ variant: 'warning' }),
  nice_to_have: badge({ variant: 'outline' }),
  informational: badge({ variant: 'secondary' }),
};

export function groupSlug(group: Group): string {
  return slugify(group.title);
}

export function articlePath(article: KnowledgeArticle): string {
  return `/knowledge-base/${article.slug}`;
}

function checkOf(article: KnowledgeArticle): CheckDefinition {
  const check = getCheck(article.id);
  if (!check) throw new Error(`knowledge article ${article.id} has no check`);
  return check;
}

function groupOf(check: CheckDefinition): Group {
  const group = getGroup(check.group);
  if (!group) throw new Error(`check ${check.id} has no group`);
  return group;
}

/** Legal-signals checks have their own hub and page layout; they are never scored. */
export function isLegalCheck(check: Pick<CheckDefinition, 'group'>): boolean {
  return check.group.startsWith('C');
}

export const LEGAL_HUB_PATH = '/knowledge-base/legal-signals';
export const GUIDES_HUB_PATH = '/knowledge-base/guides';

export function guidePath(guide: KnowledgeGuide): string {
  return `${GUIDES_HUB_PATH}/${guide.slug}`;
}

export function guideBySlug(slug: string): KnowledgeGuide | undefined {
  return guides.find((guide) => guide.slug === slug);
}

/** The canonical article URL for a check, for reports that link into the knowledge base. */
export function knowledgeUrlFor(config: AppConfig, checkId: string): string | undefined {
  const article = articleFor(checkId);
  return article ? `${config.baseUrl}${articlePath(article)}` : undefined;
}

function lawsOf(check: CheckDefinition): Law[] {
  return check.laws.map((id) => getLaw(id)).filter((law): law is Law => law !== undefined);
}

function articleFor(checkId: string): KnowledgeArticle | undefined {
  return knowledge.find((article) => article.id === checkId);
}

export function groupBySlug(slug: string): Group | undefined {
  return catalog.groups.find((group) => groupSlug(group) === slug);
}

export function articleBySlug(slug: string): KnowledgeArticle | undefined {
  return knowledge.find((article) => article.slug === slug);
}

export function articleByCheckId(id: string): KnowledgeArticle | undefined {
  return knowledge.find((article) => article.id.toLowerCase() === id.toLowerCase());
}

/** The lowest level that requires the check, and the checks that can stand in for it there. */
export function gateOf(
  checkId: string,
): { value: number; name: string; alternatives: string[] } | null {
  for (const level of [...catalog.levels].sort((a, b) => a.value - b.value)) {
    const gate = level.gates.find((alternatives) => alternatives.includes(checkId));
    if (gate) {
      return {
        value: level.value,
        name: level.name,
        alternatives: gate.filter((id) => id !== checkId),
      };
    }
  }
  return null;
}

function gateSentence(checkId: string): string {
  const gate = gateOf(checkId);
  if (!gate) return 'Not a level gate. It counts toward its section score.';
  if (gate.alternatives.length === 0)
    return `Required from Level ${gate.value} (${gate.name}) upward.`;
  return `One of ${gate.alternatives.length + 1} alternatives for Level ${gate.value} (${gate.name}); ${gate.alternatives.join(', ')} can satisfy it instead.`;
}

function checkLink(id: string): string {
  const article = articleFor(id);
  return article
    ? `<a class="${identifier} font-medium text-primary underline-offset-4 hover:underline" href="${articlePath(article)}">${escapeHtml(id)}</a>`
    : escapeHtml(id);
}

function headFor(
  config: AppConfig,
  path: string,
  title: string,
  description: string,
  type: 'website' | 'article',
): string {
  const url = `${config.baseUrl}${path}`;
  return [
    metadataHead(config, {
      path,
      title,
      description,
      image: 'knowledge',
      type,
      ...(type === 'article' ? { published: KNOWLEDGE_UPDATED, modified: KNOWLEDGE_UPDATED } : {}),
    }),
    `<link rel="alternate" type="text/markdown" href="${escapeHtml(`${url}.md`)}" title="Markdown">`,
  ].join('\n');
}

function breadcrumbs(items: { label: string; href?: string }[]): string {
  return `<nav aria-label="Breadcrumb"><ol class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">${items
    .map(
      (item, index) =>
        `<li class="flex items-center gap-1.5">${index > 0 ? '<span aria-hidden="true">/</span>' : ''}${
          item.href
            ? `<a class="hover:text-foreground" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`
            : `<span class="text-foreground" aria-current="page">${escapeHtml(item.label)}</span>`
        }</li>`,
    )
    .join('')}</ol></nav>`;
}

function breadcrumbLd(config: AppConfig, items: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${config.baseUrl}${items.at(-1)?.path ?? '/'}#breadcrumb`,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${config.baseUrl}${item.path}`,
    })),
  };
}

function scanCta(): string {
  return `<section class="${panel} relative mt-12 overflow-hidden"><div class="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-primary/10 blur-2xl" aria-hidden="true"></div><div class="relative flex flex-wrap items-center justify-between gap-4"><div class="min-w-0 flex-1 basis-80"><h2 class="text-base font-semibold tracking-tight">See how your store does</h2><p class="mt-1 text-sm text-muted-foreground">One scan runs every check in this knowledge base against your site and ends with a prioritised fix list.</p></div><a class="${button()} shrink-0" href="/">Scan a store${icon('arrow-right')}</a></div></section>`;
}

/** Shared <head> and script for every knowledge-base page. */
function kbPage(
  config: AppConfig,
  title: string,
  description: string,
  head: string,
  body: string,
  hero: string,
): string {
  return page(
    config,
    {
      title: `${title} · ${config.appName}`,
      hero,
      description,
      head: `${head}\n<style>${KB_CSS}</style>`,
      scripts: [KB_SCRIPT],
    },
    `<div class="kb-progress" aria-hidden="true"></div>\n${body}`,
  );
}

/** "Shopify only" for a check bound to one platform, null for one that runs anywhere. */
function platformScope(check: CheckDefinition): string | null {
  const platform = requiredPlatform(check);
  return platform ? `${PLATFORM_LABEL[platform]} only` : null;
}

function platformSentence(check: CheckDefinition): string {
  const platform = requiredPlatform(check);
  return platform
    ? ` Runs only when the scan detects ${PLATFORM_LABEL[platform]}; on any other platform it is left out of the report and never scored.`
    : '';
}

/** A WordPress note also holds on WooCommerce, which runs on WordPress. */
const NOTE_LABEL: Record<FixPlatform, string> = {
  wordpress: 'WordPress and WooCommerce',
  woocommerce: 'WooCommerce',
  shopify: 'Shopify',
};

function platformNotesHtml(check: CheckDefinition): string {
  const notes = check.fix.platform_notes;
  if (notes.length === 0) return '';
  return `<h3 class="mt-5 text-sm font-semibold">By platform</h3><dl class="mt-2 space-y-2 text-sm leading-6">${notes
    .map(
      (note) =>
        `<div><dt class="font-medium">${NOTE_LABEL[note.platform]}</dt><dd class="text-muted-foreground">${escapeHtml(note.text)}</dd></div>`,
    )
    .join('')}</dl>`;
}

function platformNotesMarkdown(check: CheckDefinition): string {
  const notes = check.fix.platform_notes;
  if (notes.length === 0) return '';
  return `\n### By platform\n\n${notes.map((note) => `- **${NOTE_LABEL[note.platform]}:** ${note.text}`).join('\n')}\n`;
}

function checkRow(check: CheckDefinition): string {
  const article = articleFor(check.id);
  const tier = tierOf(check.weight);
  const title = article ? article.headline : check.title;
  const text =
    `${check.id} ${check.title} ${title} ${article?.description ?? ''} ${article?.keywords.join(' ') ?? ''}`.toLowerCase();
  const gate = gateOf(check.id);
  const scope = platformScope(check);
  return `<li data-kb-row data-tier="${tier}" data-text="${escapeHtml(text)}"><a class="kb-check-row group -mx-3 rounded-lg px-3 py-4 hover:bg-muted/50" href="${article ? articlePath(article) : '/knowledge-base'}"><span class="${identifier} mt-0.5 w-10 text-xs text-muted-foreground">${escapeHtml(check.id)}</span><span class="kb-check-copy min-w-0"><span class="flex flex-wrap items-center gap-2"><span class="font-semibold group-hover:text-primary">${escapeHtml(title)}</span><span class="${TIER_BADGE[tier]}">${TIER_TEXT[tier]}</span>${gate ? `<span class="${badge({ variant: 'outline' })}">Level ${gate.value}${gate.alternatives.length > 0 ? ' alternative' : ' gate'}</span>` : ''}${scope ? `<span class="${badge({ variant: 'outline' })}" data-platform-scope>${scope}</span>` : ''}</span><span class="mt-1 block text-sm leading-6 text-muted-foreground">${escapeHtml(article?.description ?? check.question)}</span></span>${icon('chevron-right', 'kb-check-arrow mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary')}</a></li>`;
}

function groupSection(group: Group, headingLevel: 'h2' | 'h3'): string {
  const checks = catalog.checks.filter((check) => check.group === group.id);
  const index = catalog.groups.indexOf(group) + 1;
  return `<section class="mt-10 scroll-mt-6" id="${escapeHtml(group.id)}" data-kb-section><div class="flex items-center gap-3"><span class="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-sm font-semibold text-primary">${index}</span><div class="min-w-0 flex-1"><${headingLevel} class="text-lg font-semibold tracking-tight"><a class="hover:text-primary" href="/knowledge-base/${groupSlug(group)}">${escapeHtml(group.title)}</a></${headingLevel}><p class="text-xs uppercase tracking-wider text-muted-foreground">${escapeHtml(group.id)} · ${escapeHtml(JOURNEY_STEP[group.id] ?? '')} · ${checks.length} checks</p></div></div><p class="mt-3 max-w-[70ch] text-sm leading-6 text-muted-foreground">${escapeHtml(group.description)}</p><ul class="kb-check-list mt-2">${checks.map(checkRow).join('')}</ul></section>`;
}

/** /knowledge-base */
export function knowledgeIndexPage(config: AppConfig): string {
  const title = 'Agentic readiness knowledge base';
  const description = `How AI agents find, read, trust and buy from online stores: ${catalog.checks.length} checks explained, with what each one tests, why it matters and how to fix it.`;
  const tiers = (Object.keys(TIER_TEXT) as Tier[])
    .map(
      (tier) =>
        `<li class="flex flex-wrap items-start gap-3"><span class="${TIER_BADGE[tier]} mt-0.5 shrink-0">${TIER_TEXT[tier]}</span><span class="text-sm leading-6 text-muted-foreground">${TIER_HELP[tier]}</span></li>`,
    )
    .join('');
  const levels = [...catalog.levels]
    .sort((a, b) => a.value - b.value)
    .map(
      (level) =>
        `<li class="flex gap-3 text-sm leading-6"><span class="grid size-6 shrink-0 place-items-center rounded-md bg-muted font-mono text-xs font-semibold">${level.value}</span><span class="text-muted-foreground"><strong class="font-semibold text-foreground">${escapeHtml(level.name)}.</strong> ${escapeHtml(level.description)}</span></li>`,
    )
    .join('');
  const chips = (Object.keys(TIER_TEXT) as Tier[])
    .map(
      (tier) =>
        `<button type="button" class="${cn(button({ variant: 'outline', size: 'sm' }), 'kb-chip whitespace-nowrap rounded-full text-xs')}" data-tier="${tier}" aria-pressed="false"><span class="size-2 rounded-full ${TIER_DOT[tier]}" aria-hidden="true"></span>${TIER_TEXT[tier]}</button>`,
    )
    .join('');
  const hero = `
<h1 class="hero-title">${title}</h1>
<p class="hero-description">An AI agent that shops for someone has to find a store, be allowed in, read its products as data, trust the merchant and, eventually, check out. Each article explains one check of the <a class="font-medium text-current underline-offset-4 hover:underline" href="/">Agentic Readiness Scanner</a>: what it looks at, why agents care, exactly how the scanner decides, and how to fix it on WordPress and WooCommerce, Shopify or any other stack.</p>
`;
  const body = `
${breadcrumbs([{ label: 'Home', href: '/' }, { label: 'Knowledge base' }])}

<section class="${panel} mt-8" aria-label="Overview"><p class="text-sm font-medium">The agent's journey, in nine sections</p><div class="mt-3">${journeyRail()}</div><div class="mt-4 border-t border-border pt-4"><p class="mb-2 text-xs text-muted-foreground">Every check, one cell each. Hover for its name, click to read it.</p>${checkStrip()}</div></section>
<div class="kb-filter-bar md:sticky top-0 z-10 mt-8 border-b border-border bg-background/85 py-3 backdrop-blur"><div class="flex flex-wrap items-center gap-2"><label class="relative min-w-0 basis-full flex-1 md:basis-56"><span class="sr-only">Filter checks</span><input id="kb-filter" type="search" class="${input} pr-10" placeholder="Filter checks, e.g. robots.txt, GTIN, MCP" autocomplete="off"><kbd aria-hidden="true" class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 font-mono text-xs text-muted-foreground">/</kbd></label><div class="flex min-w-0 flex-wrap gap-2" role="group" aria-label="Filter by priority">${chips}</div><span id="kb-count" class="ml-auto text-xs text-muted-foreground" aria-live="polite">${catalog.checks.length} checks</span></div></div>
${guidesCard()}
${catalog.groups.map((group) => groupSection(group, 'h2')).join('')}
${legalHubCard()}
<div class="mt-12 grid gap-3 md:grid-cols-2">
<section class="${panel}"><h2 class="text-base font-semibold tracking-tight">How to read priorities</h2><ul class="mt-3 space-y-2.5">${tiers}</ul></section>
<section class="${panel}"><h2 class="text-base font-semibold tracking-tight">Readiness levels</h2><ul class="mt-3 space-y-2">${levels}</ul></section>
</div>
<section class="${panel} mt-3"><h2 class="text-base font-semibold tracking-tight">For agents</h2><p class="mt-2 text-sm leading-6 text-muted-foreground">Every page is also Markdown: append <code class="${codeInline}">.md</code> or send <code class="${codeInline}">Accept: text/markdown</code>. The whole knowledge base is in <a class="font-medium text-primary underline-offset-4 hover:underline" href="/llms-full.txt">/llms-full.txt</a>, the index as data in <a class="font-medium text-primary underline-offset-4 hover:underline" href="/knowledge-base.json">/knowledge-base.json</a>, and the MCP server at <code class="${codeInline}">/mcp</code> answers <code class="${codeInline}">explain_check</code>. Cite articles by their canonical URL.</p></section>
${scanCta()}
${jsonLd({
  '@context': 'https://schema.org',
  '@graph': [
    {
      ...webPage(config, '/knowledge-base', title, description, 'knowledge'),
      '@type': 'CollectionPage',
      name: title,
      description,
      url: `${config.baseUrl}/knowledge-base`,
      inLanguage: 'en',
      dateModified: KNOWLEDGE_UPDATED,
      author: { '@id': `${AUTHOR.url}#person` },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: knowledge.length,
        itemListElement: knowledge.map((article, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${config.baseUrl}${articlePath(article)}`,
          name: article.headline,
        })),
      },
    },
    breadcrumbLd(config, [
      { name: 'Home', path: '/' },
      { name: 'Knowledge base', path: '/knowledge-base' },
    ]),
    ...siteGraph(config, 'knowledge'),
  ],
})}`;
  return kbPage(
    config,
    title,
    description,
    headFor(config, '/knowledge-base', title, description, 'website'),
    body,
    hero,
  );
}

/** /knowledge-base/<group-slug> */
export function knowledgeGroupPage(config: AppConfig, group: Group): string {
  const checks = catalog.checks.filter((check) => check.group === group.id);
  const path = `/knowledge-base/${groupSlug(group)}`;
  const title = `${group.title}: ${checks.length} agentic readiness checks explained`;
  const description =
    group.description.length > 170
      ? `${group.description.slice(0, 167).replace(/\s+\S*$/, '')}...`
      : group.description;
  const dimension = group.dimension === 'ingestion' ? 'Agentic ingestion' : 'Agentic commerce';
  const position = catalog.groups.indexOf(group);
  const previous = catalog.groups[position - 1];
  const next = catalog.groups[position + 1];
  const neighbour = (target: Group | undefined, label: string, align: string) =>
    target
      ? `<a class="${card} block p-4 ${align} transition-colors hover:border-primary/50" href="/knowledge-base/${groupSlug(target)}"><span class="text-xs text-muted-foreground">${label} section · ${escapeHtml(target.id)}</span><span class="mt-1 block text-sm font-medium">${escapeHtml(target.title)}</span></a>`
      : '<span></span>';
  const hero = `
<p class="hero-eyebrow">Section ${position + 1} of ${catalog.groups.length} · ${escapeHtml(group.id)} · ${dimension}</p>
<h1 class="hero-title">${escapeHtml(group.title)}</h1>
<p class="hero-description">${escapeHtml(group.description)}</p>
`;
  const body = `
${breadcrumbs([{ label: 'Knowledge base', href: '/knowledge-base' }, { label: group.title }])}
<div class="mt-5">${journeyRail(group.id)}</div>

<div class="mt-5">${checkStrip(undefined, group.id)}</div>
<ul class="kb-check-list mt-6">${checks.map(checkRow).join('')}</ul>
<nav class="mt-10 grid gap-3 sm:grid-cols-2" aria-label="Other sections">${neighbour(previous, 'Previous', '')}${neighbour(next, 'Next', 'sm:text-right')}</nav>
${scanCta()}
${jsonLd({
  '@context': 'https://schema.org',
  '@graph': [
    {
      ...webPage(config, path, title, description, 'knowledge'),
      '@type': 'CollectionPage',
      name: title,
      description,
      url: `${config.baseUrl}${path}`,
      inLanguage: 'en',
      isPartOf: { '@id': `${config.baseUrl}/knowledge-base#webpage` },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: checks.length,
        itemListElement: checks.map((check, index) => {
          const article = articleFor(check.id);
          return {
            '@type': 'ListItem',
            position: index + 1,
            url: `${config.baseUrl}${article ? articlePath(article) : '/knowledge-base'}`,
            name: article?.headline ?? check.title,
          };
        }),
      },
    },
    breadcrumbLd(config, [
      { name: 'Knowledge base', path: '/knowledge-base' },
      { name: group.title, path },
    ]),
    ...siteGraph(config, 'knowledge'),
  ],
})}`;
  return kbPage(
    config,
    title,
    description,
    headFor(config, path, title, description, 'website'),
    body,
    hero,
  );
}

function fixCard(check: CheckDefinition): string {
  const { fix } = check;
  return `<section class="${panel} mt-12 scroll-mt-6 border-primary/30" id="fix" aria-labelledby="fix-heading"><div class="flex items-center gap-2"><span class="grid size-7 shrink-0 place-items-center rounded-full bg-success/15 text-success">${icon('check', 'size-4')}</span><h2 id="fix-heading" class="text-xl font-semibold tracking-tight">The fix in one step</h2></div><p class="mt-3 leading-7 text-muted-foreground">${escapeHtml(fix.summary)}</p>${
    fix.snippet
      ? `<pre class="${codeBlock} mt-4" tabindex="0" aria-label="Code example" data-language="${escapeHtml(fix.snippet_language ?? 'text')}"><code>${escapeHtml(fix.snippet)}</code></pre>`
      : ''
  }${platformNotesHtml(check)}<details class="group mt-4 rounded-lg border border-border"><summary class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">Prompt for a coding agent${icon('chevron-down', 'size-4 transition-transform group-open:rotate-180')}</summary><p class="border-t border-border px-4 py-3 text-sm leading-6 text-muted-foreground">${escapeHtml(fix.agent_prompt)}</p></details></section>`;
}

/** /knowledge-base/<article-slug> */
export function knowledgeArticlePage(config: AppConfig, article: KnowledgeArticle): string {
  if (isLegalCheck(checkOf(article))) return legalArticlePage(config, article);
  const check = checkOf(article);
  const group = groupOf(check);
  const tier = tierOf(check.weight);
  const path = articlePath(article);
  const rendered = markdownToHtml(article.body);
  const siblings = catalog.checks.filter((candidate) => candidate.group === check.group);
  const position = siblings.findIndex((candidate) => candidate.id === check.id);
  // Previous and next run across sections, so the last check of one leads into the next.
  const overall = catalog.checks.findIndex((candidate) => candidate.id === check.id);
  const previous = catalog.checks[overall - 1];
  const next = catalog.checks[overall + 1];
  const neighbour = (target: CheckDefinition | undefined, label: string, align: string) => {
    const linked = target ? articleFor(target.id) : undefined;
    return linked
      ? `<a class="${card} group block p-4 ${align} transition-colors hover:border-primary/50" href="${articlePath(linked)}" rel="${label === 'Previous' ? 'prev' : 'next'}"><span class="text-xs text-muted-foreground">${label} · ${escapeHtml(linked.id)}</span><span class="mt-1 block text-sm font-medium group-hover:text-primary">${escapeHtml(linked.headline)}</span></a>`
      : '<span></span>';
  };
  const facts = [
    [
      'Priority',
      `<span class="${TIER_BADGE[tier]}">${TIER_TEXT[tier]}</span> <span class="text-muted-foreground">${TIER_HELP[tier]}</span>`,
    ],
    ['Readiness level', escapeHtml(gateSentence(check.id))],
    ...(requiredPlatform(check) ? [['Platform', escapeHtml(platformSentence(check).trim())]] : []),
    ['The question', escapeHtml(check.question)],
    ...(check.depends_on.length > 0
      ? [
          [
            'Runs after',
            `${check.depends_on.map(checkLink).join(', ')}. When a dependency fails, this check is skipped rather than guessed.`,
          ],
        ]
      : []),
  ]
    .map(
      ([label, value]) =>
        `<div class="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4"><dt class="text-sm font-medium">${label}</dt><dd class="text-sm leading-6">${value}</dd></div>`,
    )
    .join('');
  const sources = check.spec
    .map(
      (ref) =>
        `<li><a class="font-medium text-primary underline-offset-4 hover:underline" href="${escapeHtml(ref.url)}" rel="noopener">${escapeHtml(ref.title)}</a></li>`,
    )
    .join('');
  const summary = plainText(section(article.body, 'In short'));
  const faq = faqPairs(article.body);
  const title = article.headline;
  const hero = `
<p class="hero-eyebrow">Check ${escapeHtml(check.id)} · ${escapeHtml(check.title)}</p>
<h1 class="hero-title">${escapeHtml(title)}</h1>
<p class="hero-description">${escapeHtml(article.description)}</p>
<p class="mt-3 text-sm text-current">By <a class="underline underline-offset-4" href="${AUTHOR.url}" rel="author">${AUTHOR.name}</a> · Updated <time datetime="${KNOWLEDGE_UPDATED}">${KNOWLEDGE_UPDATED}</time> · <a class="underline underline-offset-4" href="${path}.md" type="text/markdown">Markdown</a></p>
`;
  const body = `
${breadcrumbs([
  { label: 'Knowledge base', href: '/knowledge-base' },
  { label: group.title, href: `/knowledge-base/${groupSlug(group)}` },
  { label: check.id },
])}
<div class="mt-5">${journeyRail(group.id)}</div>
<div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"><span class="text-xs text-muted-foreground">${escapeHtml(positionLine(check, group))}</span>${checkStrip(check.id)}</div>
<div class="mt-8 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
${articleSidebar(check, group, rendered.headings)}
<article data-kb-article class="min-w-0">

<dl class="${card} mt-6 divide-y divide-border px-5">${facts}</dl>
<details class="kb-toc-mobile mt-6 rounded-lg border border-border lg:hidden"><summary class="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">On this page${icon('chevron-down', 'size-4')}</summary><nav class="kb-toc border-t border-border px-4 py-3 text-sm text-muted-foreground">${tocLinks(rendered.headings)}</nav></details>
<div class="max-w-[72ch]">${rendered.html}</div>
${fixCard(check)}
${relatedGuides(check.id)}
<section class="mt-10 scroll-mt-6" id="sources" aria-labelledby="sources-heading"><h2 id="sources-heading" class="text-xl font-semibold tracking-tight">Sources and specifications</h2><ul class="mt-4 list-disc space-y-2 pl-6 text-sm leading-6 marker:text-muted-foreground/70">${sources}</ul></section>
<nav class="mt-10 grid gap-3 sm:grid-cols-2" aria-label="Previous and next check">${neighbour(previous, 'Previous', '')}${neighbour(next, 'Next', 'sm:text-right')}</nav>
${scanCta()}
</article>
</div>
${jsonLd({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'TechArticle',
      '@id': `${config.baseUrl}${path}#article`,
      headline: title,
      name: `${check.id} ${check.title}`,
      description: article.description,
      abstract: summary,
      keywords: article.keywords.join(', '),
      url: `${config.baseUrl}${path}`,
      mainEntityOfPage: { '@id': `${config.baseUrl}${path}#webpage` },
      inLanguage: 'en',
      datePublished: KNOWLEDGE_UPDATED,
      dateModified: KNOWLEDGE_UPDATED,
      author: { '@id': `${AUTHOR.url}#person` },
      publisher: { '@id': `${AUTHOR.url}#person` },
      image: { '@id': `${socialImage(config, 'knowledge').url}#image` },
      isAccessibleForFree: true,
      identifier: check.id,
      articleSection: group.title,
      isPartOf: {
        '@id': `${config.baseUrl}/knowledge-base#webpage`,
        '@type': 'CollectionPage',
        name: 'Agentic readiness knowledge base',
        url: `${config.baseUrl}/knowledge-base`,
      },
      about: {
        '@type': 'DefinedTerm',
        name: group.title,
        termCode: group.id,
        url: `${config.baseUrl}/knowledge-base/${groupSlug(group)}`,
      },
      position: position + 1,
      citation: check.spec.map((ref) => ref.url),
      encoding: {
        '@type': 'MediaObject',
        encodingFormat: 'text/markdown',
        contentUrl: `${config.baseUrl}${path}.md`,
      },
      proficiencyLevel: 'Beginner',
    },
    {
      '@type': 'FAQPage',
      '@id': `${config.baseUrl}${path}#faq`,
      isPartOf: { '@id': `${config.baseUrl}${path}#webpage` },
      mainEntity: faq.map((pair) => ({
        '@type': 'Question',
        name: pair.question,
        acceptedAnswer: { '@type': 'Answer', text: pair.answer },
      })),
    },
    breadcrumbLd(config, [
      { name: 'Knowledge base', path: '/knowledge-base' },
      { name: group.title, path: `/knowledge-base/${groupSlug(group)}` },
      { name: title, path },
    ]),
    {
      ...webPage(config, path, title, article.description, 'knowledge'),
      mainEntity: { '@id': `${config.baseUrl}${path}#article` },
    },
    ...siteGraph(config, 'knowledge'),
  ],
})}`;
  return kbPage(
    config,
    title,
    article.description,
    `${headFor(config, path, title, article.description, 'article')}\n<meta name="keywords" content="${escapeHtml(article.keywords.join(', '))}">`,
    body,
    hero,
  );
}

function absolute(config: AppConfig, markdown: string): string {
  return markdown.replace(/\]\(\/(?!\/)/g, `](${config.baseUrl}/`);
}

/** A YAML value on one line: quoted, with quotes and backslashes escaped. */
function yaml(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The article as one Markdown document: front matter, the article, then the catalog's fix and sources. */
export function articleMarkdown(config: AppConfig, article: KnowledgeArticle): string {
  if (isLegalCheck(checkOf(article))) return legalArticleMarkdown(config, article);
  const check = checkOf(article);
  const group = groupOf(check);
  const tier = tierOf(check.weight);
  const url = `${config.baseUrl}${articlePath(article)}`;
  const gate = gateOf(check.id);
  const { fix } = check;
  return `---
title: ${yaml(article.headline)}
description: ${yaml(article.description)}
canonical_url: ${url}
check_id: ${check.id}
check_title: ${yaml(check.title)}
section: ${yaml(`${group.id} ${group.title}`)}
priority: ${tier}
weight: ${check.weight}
level_gate: ${gate ? gate.value : 'none'}
depends_on: [${check.depends_on.join(', ')}]
keywords: [${article.keywords.map(yaml).join(', ')}]
author: ${yaml(AUTHOR.name)}
updated: ${KNOWLEDGE_UPDATED}
---

# ${article.headline}

> ${article.description}

Check ${check.id} (${check.title}) in section ${group.id}, ${group.title}. Priority: ${TIER_TEXT[tier].toLowerCase()}. ${TIER_HELP[tier]} ${gateSentence(check.id)}${platformSentence(check)}${check.depends_on.length > 0 ? ` Runs after ${check.depends_on.join(', ')}.` : ''}

${absolute(config, article.body)}

## The fix in one step

${fix.summary}
${fix.snippet ? `\n\`\`\`${fix.snippet_language ?? ''}\n${fix.snippet}\n\`\`\`\n` : ''}${platformNotesMarkdown(check)}
### Prompt for a coding agent

${fix.agent_prompt}

## Sources and specifications

${check.spec.map((ref) => `- [${ref.title}](${ref.url})`).join('\n')}

Source: ${url} (${config.appName} knowledge base, by ${AUTHOR.name}).
`;
}

function articleListItem(config: AppConfig, check: CheckDefinition): string {
  const article = articleFor(check.id);
  return article
    ? `- [${check.id} ${article.headline}](${config.baseUrl}${articlePath(article)}.md): ${article.description}`
    : `- ${check.id} ${check.title}`;
}

/** A section as Markdown: its description and every check with a link. */
export function groupMarkdown(config: AppConfig, group: Group): string {
  const items = catalog.checks
    .filter((check) => check.group === group.id)
    .map((check) => articleListItem(config, check))
    .join('\n');
  return `---
title: ${yaml(group.title)}
canonical_url: ${config.baseUrl}/knowledge-base/${groupSlug(group)}
section: ${group.id}
dimension: ${group.dimension}
---

# ${group.id} ${group.title}

${group.description}

${items}
`;
}

/** The index as Markdown: every section and article with absolute links. */
export function knowledgeIndexMarkdown(config: AppConfig): string {
  const sections = catalog.groups
    .map((group) => {
      const items = catalog.checks
        .filter((check) => check.group === group.id)
        .map((check) => articleListItem(config, check))
        .join('\n');
      return `## ${group.id} ${group.title}\n\n${group.description}\n\n${items}`;
    })
    .join('\n\n');
  return `# Agentic readiness knowledge base

> How AI agents find, read, trust and buy from online stores: every check of the ${config.appName} explained, with what it tests, why it matters, how the scanner decides and how to fix it.

By ${AUTHOR.name} (${AUTHOR.url}). Each article is also an HTML page at the same URL without .md. The index as data: ${config.baseUrl}/knowledge-base.json. Everything in one file: ${config.baseUrl}/llms-full.txt.

## Guides

Topics that span checks or explain how the scanner works.

${guides.map((guide) => guideListItem(config, guide)).join('\n')}

${sections}
`;
}

/** The index as data, for agents and tools: sections, checks, URLs, priorities and gates. */
export function knowledgeIndexJson(config: AppConfig) {
  return {
    name: 'Agentic readiness knowledge base',
    url: `${config.baseUrl}/knowledge-base`,
    markdown_url: `${config.baseUrl}/knowledge-base.md`,
    full_text_url: `${config.baseUrl}/llms-full.txt`,
    author: AUTHOR,
    updated: KNOWLEDGE_UPDATED,
    catalog_version: catalog.version,
    levels: [...catalog.levels]
      .sort((a, b) => a.value - b.value)
      .map((level) => ({ value: level.value, name: level.name, description: level.description })),
    guides: guides.map((guide) => ({
      slug: guide.slug,
      headline: guide.headline,
      description: guide.description,
      related_checks: guide.related,
      keywords: guide.keywords,
      url: `${config.baseUrl}${guidePath(guide)}`,
      markdown_url: `${config.baseUrl}${guidePath(guide)}.md`,
    })),
    sections: catalog.groups.map((group) => ({
      id: group.id,
      title: group.title,
      dimension: group.dimension,
      description: group.description,
      url: `${config.baseUrl}/knowledge-base/${groupSlug(group)}`,
      checks: catalog.checks
        .filter((check) => check.group === group.id)
        .map((check) => {
          const article = articleFor(check.id);
          const gate = gateOf(check.id);
          const url = `${config.baseUrl}${article ? articlePath(article) : '/knowledge-base'}`;
          return {
            id: check.id,
            title: check.title,
            headline: article?.headline ?? check.title,
            description: article?.description ?? check.question,
            question: check.question,
            priority: tierOf(check.weight),
            weight: check.weight,
            level_gate: gate ? { level: gate.value, alternatives: gate.alternatives } : null,
            depends_on: check.depends_on,
            keywords: article?.keywords ?? [],
            url,
            markdown_url: `${url}.md`,
          };
        }),
    })),
  };
}

/** Every article in one Markdown file, for agents that want the whole knowledge base at once. */
export function knowledgeFullMarkdown(config: AppConfig): string {
  return [
    knowledgeIndexMarkdown(config),
    ...guides.map((guide) => guideMarkdown(config, guide)),
    ...knowledge.map((article) => articleMarkdown(config, article)),
  ].join('\n\n---\n\n');
}

function legalHubCard(): string {
  return `<section class="${panel} mt-12" aria-labelledby="legal-signals-heading"><div class="flex flex-wrap items-start justify-between gap-4"><div class="min-w-0 flex-1 basis-80"><p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Separate from readiness · never scored</p><h2 id="legal-signals-heading" class="mt-1 text-lg font-semibold tracking-tight">Legal signals</h2><p class="mt-2 text-sm leading-6 text-muted-foreground">${catalog.legal.checks.length} checks of public legal disclosures in ${catalog.legal.groups.length} groups: seller identity, privacy, withdrawal and returns, accessibility, product information, and AI transparency. Each names the laws it relates to across the EU, the UK, Switzerland, the Americas and Australia. A technical evaluation, not legal advice.</p></div><a class="${button({ variant: 'outline' })} shrink-0" href="${LEGAL_HUB_PATH}">Read about legal signals${icon('arrow-right')}</a></div></section>`;
}

function legalNotice(): string {
  return `<div class="${alert({ variant: 'info' })} mt-6" role="note">${icon('info')}<span>${escapeHtml(LEGAL_NOTICE)}</span></div>`;
}

function lawItem(law: Law): string {
  const upcoming = law.applies_from && Date.parse(law.applies_from) > Date.parse(KNOWLEDGE_UPDATED);
  return `<li class="py-2.5"><a class="font-medium text-primary underline-offset-4 hover:underline" href="${escapeHtml(law.url)}" rel="noopener">${escapeHtml(law.name)}</a> <span class="${badge({ variant: 'outline' })} ml-1 font-mono">${escapeHtml(law.jurisdiction)}</span>${upcoming ? ` <span class="${badge({ variant: 'warning' })} ml-1">applies from ${escapeHtml(law.applies_from ?? '')}</span>` : ''}<span class="mt-0.5 block text-sm leading-6 text-muted-foreground">${escapeHtml(law.note)}</span></li>`;
}

function legalRow(check: CheckDefinition): string {
  const article = articleFor(check.id);
  const title = article ? article.headline : check.title;
  const markets = check.markets.length > 0 ? check.markets.join(', ') : 'any market';
  return `<li><a class="kb-check-row group -mx-3 rounded-lg px-3 py-4 hover:bg-muted/50" href="${article ? articlePath(article) : LEGAL_HUB_PATH}"><span class="${identifier} mt-0.5 w-10 text-xs text-muted-foreground">${escapeHtml(check.id)}</span><span class="kb-check-copy min-w-0"><span class="font-semibold group-hover:text-primary">${escapeHtml(title)}</span><span class="mt-0.5 block text-xs leading-5 text-muted-foreground">Markets: ${escapeHtml(markets)}</span><span class="mt-1 block text-sm leading-6 text-muted-foreground">${escapeHtml(article?.description ?? check.question)}</span></span>${icon('chevron-right', 'kb-check-arrow mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary')}</a></li>`;
}

/** /knowledge-base/legal-signals: every legal group and check, with the notice first. */
export function legalHubPage(config: AppConfig): string {
  const title = 'Legal signals for online stores';
  const description = `${catalog.legal.checks.length} technical checks of the legal disclosures a store's public pages show, each linked to the laws it relates to. Never scored, not legal advice.`;
  const hero = `
<p class="hero-eyebrow">Knowledge base · legal signals</p>
<h1 class="hero-title">${title}</h1>
<p class="hero-description">Many duties for online stores leave public traces: who sells, how to withdraw, who answers privacy requests, whether an assistant is a machine. The scanner reports which of those traces it can see on a store's pages, on a page of its own beside the readiness report. It never scores them and never says a store complies.</p>
`;
  const groups = catalog.legal.groups
    .map((group) => {
      const checks = catalog.legal.checks.filter((check) => check.group === group.id);
      return `<section class="mt-10 scroll-mt-6" id="${escapeHtml(group.id)}"><div class="flex items-center gap-3"><span class="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-sm font-semibold text-primary">${escapeHtml(group.id)}</span><div class="min-w-0 flex-1"><h2 class="text-lg font-semibold tracking-tight">${escapeHtml(group.title)}</h2><p class="text-xs uppercase tracking-wider text-muted-foreground">${checks.length} checks</p></div></div><p class="mt-3 max-w-[70ch] text-sm leading-6 text-muted-foreground">${escapeHtml(group.description)}</p><ul class="kb-check-list mt-2">${checks.map(legalRow).join('')}</ul></section>`;
    })
    .join('');
  const body = `
${breadcrumbs([{ label: 'Knowledge base', href: '/knowledge-base' }, { label: 'Legal signals' }])}
${legalNotice()}
<section class="${panel} mt-6"><h2 class="text-base font-semibold tracking-tight">How legal signals are reported</h2><ul class="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground"><li><strong class="text-foreground">Found</strong>: the disclosure, link or signal is on the pages read. It says nothing about whether its content is right.</li><li><strong class="text-foreground">Review</strong>: something is there but incomplete, or a risk was seen that a person should look at.</li><li><strong class="text-foreground">Not found in the pages read</strong>: the scan did not see it. It may be shown by JavaScript, after sign-in or in checkout.</li><li><strong class="text-foreground">Not applicable</strong>: the store shows no sign of selling to the markets the check is about. Markets are detected from the domain, page language, currency, addresses and register numbers, and a scan can name them.</li></ul><p class="mt-3 text-sm leading-6 text-muted-foreground">Results appear at <code class="${codeInline}">/sites/&lt;host&gt;/legal</code> beside each report. Those pages are not indexed or crawled.</p></section>
${groups}
${scanCta()}
${jsonLd({
  '@context': 'https://schema.org',
  '@graph': [
    {
      ...webPage(config, LEGAL_HUB_PATH, title, description, 'knowledge'),
      '@type': 'CollectionPage',
      name: title,
      description,
      url: `${config.baseUrl}${LEGAL_HUB_PATH}`,
      inLanguage: 'en',
      dateModified: KNOWLEDGE_UPDATED,
      author: { '@id': `${AUTHOR.url}#person` },
    },
    breadcrumbLd(config, [
      { name: 'Knowledge base', path: '/knowledge-base' },
      { name: 'Legal signals', path: LEGAL_HUB_PATH },
    ]),
    ...siteGraph(config, 'knowledge'),
  ],
})}`;
  return kbPage(
    config,
    title,
    description,
    headFor(config, LEGAL_HUB_PATH, title, description, 'website'),
    body,
    hero,
  );
}

export function legalHubMarkdown(config: AppConfig): string {
  const groups = catalog.legal.groups
    .map(
      (group) =>
        `## ${group.id} ${group.title}\n\n${group.description}\n\n${catalog.legal.checks
          .filter((check) => check.group === group.id)
          .map((check) => articleListItem(config, check))
          .join('\n')}`,
    )
    .join('\n\n');
  return `# Legal signals for online stores\n\n> ${LEGAL_NOTICE}\n\nLegal signals are reported on a page of their own beside each readiness report, never scored and never part of the readiness level.\n\n${groups}\n\nSource: ${config.baseUrl}${LEGAL_HUB_PATH}\n`;
}

/** A legal-signals article: the notice, the laws by market, the article, the fix. */
function legalArticlePage(config: AppConfig, article: KnowledgeArticle): string {
  const check = checkOf(article);
  const group = groupOf(check);
  const path = articlePath(article);
  const rendered = markdownToHtml(article.body);
  const all = catalog.legal.checks;
  const overall = all.findIndex((candidate) => candidate.id === check.id);
  const neighbour = (target: CheckDefinition | undefined, label: string, align: string) => {
    const linked = target ? articleFor(target.id) : undefined;
    return linked
      ? `<a class="${card} group block p-4 ${align} transition-colors hover:border-primary/50" href="${articlePath(linked)}" rel="${label === 'Previous' ? 'prev' : 'next'}"><span class="text-xs text-muted-foreground">${label} · ${escapeHtml(linked.id)}</span><span class="mt-1 block text-sm font-medium group-hover:text-primary">${escapeHtml(linked.headline)}</span></a>`
      : '<span></span>';
  };
  const laws = lawsOf(check);
  const facts = [
    [
      'Category',
      `Legal signal in ${escapeHtml(group.id)} ${escapeHtml(group.title)}. Reported on its own page beside the readiness report, never scored.`,
    ],
    ['Markets', escapeHtml(check.markets.length > 0 ? check.markets.join(', ') : 'Any market')],
    ['The question', escapeHtml(check.question)],
  ]
    .map(
      ([label, value]) =>
        `<div class="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4"><dt class="text-sm font-medium">${label}</dt><dd class="text-sm leading-6">${value}</dd></div>`,
    )
    .join('');
  const faq = faqPairs(article.body);
  const title = article.headline;
  const hero = `
<p class="hero-eyebrow">Legal signal ${escapeHtml(check.id)} · ${escapeHtml(check.title)}</p>
<h1 class="hero-title">${escapeHtml(title)}</h1>
<p class="hero-description">${escapeHtml(article.description)}</p>
<p class="mt-3 text-sm text-current">By <a class="underline underline-offset-4" href="${AUTHOR.url}" rel="author">${AUTHOR.name}</a> · Updated <time datetime="${KNOWLEDGE_UPDATED}">${KNOWLEDGE_UPDATED}</time> · <a class="underline underline-offset-4" href="${path}.md" type="text/markdown">Markdown</a></p>
`;
  const body = `
${breadcrumbs([
  { label: 'Knowledge base', href: '/knowledge-base' },
  { label: 'Legal signals', href: LEGAL_HUB_PATH },
  { label: check.id },
])}
${legalNotice()}
<div class="mt-8 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
<aside class="hidden lg:block"><nav class="kb-toc sticky top-6 text-sm text-muted-foreground" aria-label="On this page">${tocLinks(rendered.headings)}</nav></aside>
<article data-kb-article class="min-w-0">
<dl class="${card} mt-6 divide-y divide-border px-5">${facts}</dl>
<section class="mt-6" aria-labelledby="laws-heading"><h2 id="laws-heading" class="text-xl font-semibold tracking-tight">Which laws</h2><ul class="mt-3 divide-y divide-border">${laws.map(lawItem).join('')}</ul></section>
<details class="kb-toc-mobile mt-6 rounded-lg border border-border lg:hidden"><summary class="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">On this page${icon('chevron-down', 'size-4')}</summary><nav class="kb-toc border-t border-border px-4 py-3 text-sm text-muted-foreground">${tocLinks(rendered.headings)}</nav></details>
<div class="max-w-[72ch]">${rendered.html}</div>
${fixCard(check)}
<nav class="mt-10 grid gap-3 sm:grid-cols-2" aria-label="Previous and next legal signal">${neighbour(all[overall - 1], 'Previous', '')}${neighbour(all[overall + 1], 'Next', 'sm:text-right')}</nav>
${scanCta()}
</article>
</div>
${jsonLd({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'TechArticle',
      '@id': `${config.baseUrl}${path}#article`,
      headline: title,
      name: `${check.id} ${check.title}`,
      description: article.description,
      abstract: plainText(section(article.body, 'In short')),
      keywords: article.keywords.join(', '),
      url: `${config.baseUrl}${path}`,
      mainEntityOfPage: { '@id': `${config.baseUrl}${path}#webpage` },
      inLanguage: 'en',
      datePublished: KNOWLEDGE_UPDATED,
      dateModified: KNOWLEDGE_UPDATED,
      author: { '@id': `${AUTHOR.url}#person` },
      publisher: { '@id': `${AUTHOR.url}#person` },
      isAccessibleForFree: true,
      identifier: check.id,
      articleSection: 'Legal signals',
      citation: [...laws.map((law) => law.url), ...check.spec.map((ref) => ref.url)],
    },
    {
      '@type': 'FAQPage',
      '@id': `${config.baseUrl}${path}#faq`,
      isPartOf: { '@id': `${config.baseUrl}${path}#webpage` },
      mainEntity: faq.map((pair) => ({
        '@type': 'Question',
        name: pair.question,
        acceptedAnswer: { '@type': 'Answer', text: pair.answer },
      })),
    },
    breadcrumbLd(config, [
      { name: 'Knowledge base', path: '/knowledge-base' },
      { name: 'Legal signals', path: LEGAL_HUB_PATH },
      { name: title, path },
    ]),
    {
      ...webPage(config, path, title, article.description, 'knowledge'),
      mainEntity: { '@id': `${config.baseUrl}${path}#article` },
    },
    ...siteGraph(config, 'knowledge'),
  ],
})}`;
  return kbPage(
    config,
    title,
    article.description,
    `${headFor(config, path, title, article.description, 'article')}\n<meta name="keywords" content="${escapeHtml(article.keywords.join(', '))}">`,
    body,
    hero,
  );
}

function legalArticleMarkdown(config: AppConfig, article: KnowledgeArticle): string {
  const check = checkOf(article);
  const group = groupOf(check);
  const url = `${config.baseUrl}${articlePath(article)}`;
  const { fix } = check;
  const laws = lawsOf(check);
  return `---
title: ${yaml(article.headline)}
description: ${yaml(article.description)}
canonical_url: ${url}
check_id: ${check.id}
check_title: ${yaml(check.title)}
section: ${yaml(`${group.id} ${group.title}`)}
category: legal-signal
scored: false
markets: [${check.markets.join(', ')}]
laws: [${laws.map((law) => law.id).join(', ')}]
keywords: [${article.keywords.map(yaml).join(', ')}]
author: ${yaml(AUTHOR.name)}
updated: ${KNOWLEDGE_UPDATED}
---

# ${article.headline}

> ${article.description}

> ${LEGAL_NOTICE}

Legal signal ${check.id} (${check.title}) in ${group.id}, ${group.title}. Reported beside the readiness report, never scored.

## Which laws

${laws.map((law) => `- [${law.jurisdiction}: ${law.name}](${law.url})${law.applies_from && Date.parse(law.applies_from) > Date.parse(KNOWLEDGE_UPDATED) ? ` (applies from ${law.applies_from})` : ''}: ${law.note}`).join('\n')}

${absolute(config, article.body)}

## The fix in one step

${fix.summary}
${fix.snippet ? `\n\`\`\`${fix.snippet_language ?? ''}\n${fix.snippet}\n\`\`\`\n` : ''}${platformNotesMarkdown(check)}
### Prompt for a coding agent

${fix.agent_prompt}

## Sources and specifications

${check.spec.map((ref) => `- [${ref.title}](${ref.url})`).join('\n')}

Source: ${url} (${config.appName} knowledge base, by ${AUTHOR.name}).
`;
}

function guideListItem(config: AppConfig, guide: KnowledgeGuide): string {
  return `- [${guide.headline}](${config.baseUrl}${guidePath(guide)}.md): ${guide.description}`;
}

function guideRow(guide: KnowledgeGuide): string {
  const text = `${guide.headline} ${guide.description} ${guide.keywords.join(' ')}`.toLowerCase();
  return `<li data-text="${escapeHtml(text)}"><a class="kb-check-row group -mx-3 rounded-lg px-3 py-4 hover:bg-muted/50" href="${guidePath(guide)}"><span class="${identifier} mt-0.5 w-10 text-xs text-muted-foreground">Guide</span><span class="kb-check-copy min-w-0"><span class="font-semibold group-hover:text-primary">${escapeHtml(guide.headline)}</span><span class="mt-1 block text-sm leading-6 text-muted-foreground">${escapeHtml(guide.description)}</span>${guide.related.length > 0 ? `<span class="mt-1 block text-xs leading-5 text-muted-foreground">About ${guide.related.map(escapeHtml).join(', ')}</span>` : ''}</span>${icon('chevron-right', 'kb-check-arrow mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary')}</a></li>`;
}

/** The guides on the index, above the sections. */
function guidesCard(): string {
  if (guides.length === 0) return '';
  return `<section class="${panel} mt-10" aria-labelledby="guides-heading"><div class="flex flex-wrap items-baseline justify-between gap-2"><h2 id="guides-heading" class="text-lg font-semibold tracking-tight"><a class="hover:text-primary" href="${GUIDES_HUB_PATH}">Guides</a></h2><span class="text-xs text-muted-foreground">Topics across checks and how the scanner works</span></div><ul class="kb-check-list mt-2">${guides.map(guideRow).join('')}</ul></section>`;
}

/** On a check's article: the guides that are about it. */
function relatedGuides(checkId: string): string {
  const related = guidesForCheck(checkId);
  if (related.length === 0) return '';
  return `<section class="mt-10" aria-labelledby="guides-heading"><h2 id="guides-heading" class="text-xl font-semibold tracking-tight">Guides on this topic</h2><ul class="kb-check-list mt-2">${related.map(guideRow).join('')}</ul></section>`;
}

/** /knowledge-base/guides */
export function guidesHubPage(config: AppConfig): string {
  const title = 'Guides to agentic readiness';
  const description =
    'Guides on topics that span several checks or explain how the Agentic Readiness Scanner works, with the sources behind every claim.';
  const hero = `
<p class="hero-eyebrow">Knowledge base · guides</p>
<h1 class="hero-title">${title}</h1>
<p class="hero-description">Every check has its own article. These guides cover what no single check does: how the scanner works, why it reports what it reports, and what to do about it.</p>
`;
  const body = `
${breadcrumbs([{ label: 'Knowledge base', href: '/knowledge-base' }, { label: 'Guides' }])}
<ul class="kb-check-list mt-8">${guides.map(guideRow).join('')}</ul>
${scanCta()}
${jsonLd({
  '@context': 'https://schema.org',
  '@graph': [
    {
      ...webPage(config, GUIDES_HUB_PATH, title, description, 'knowledge'),
      '@type': 'CollectionPage',
      name: title,
      description,
      url: `${config.baseUrl}${GUIDES_HUB_PATH}`,
      inLanguage: 'en',
      dateModified: KNOWLEDGE_UPDATED,
      author: { '@id': `${AUTHOR.url}#person` },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: guides.length,
        itemListElement: guides.map((guide, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${config.baseUrl}${guidePath(guide)}`,
          name: guide.headline,
        })),
      },
    },
    breadcrumbLd(config, [
      { name: 'Knowledge base', path: '/knowledge-base' },
      { name: 'Guides', path: GUIDES_HUB_PATH },
    ]),
    ...siteGraph(config, 'knowledge'),
  ],
})}`;
  return kbPage(
    config,
    title,
    description,
    headFor(config, GUIDES_HUB_PATH, title, description, 'website'),
    body,
    hero,
  );
}

export function guidesHubMarkdown(config: AppConfig): string {
  return `# Guides to agentic readiness\n\n> Topics that span several checks or explain how the ${config.appName} works.\n\n${guides.map((guide) => guideListItem(config, guide)).join('\n')}\n\nSource: ${config.baseUrl}${GUIDES_HUB_PATH}\n`;
}

/** The URLs a guide lists under Sources, for structured data. */
function guideSources(guide: KnowledgeGuide): string[] {
  return [...section(guide.body, 'Sources').matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map(
    (match) => match[1] ?? '',
  );
}

/** /knowledge-base/guides/<slug> */
export function guidePage(config: AppConfig, guide: KnowledgeGuide): string {
  const path = guidePath(guide);
  const rendered = markdownToHtml(guide.body);
  const faq = faqPairs(guide.body);
  const title = guide.headline;
  const checks = guide.related
    .map((id) => getCheck(id))
    .filter((check): check is CheckDefinition => check !== undefined);
  const hero = `
<p class="hero-eyebrow">Guide</p>
<h1 class="hero-title">${escapeHtml(title)}</h1>
<p class="hero-description">${escapeHtml(guide.description)}</p>
<p class="mt-3 text-sm text-current">By <a class="underline underline-offset-4" href="${AUTHOR.url}" rel="author">${AUTHOR.name}</a> · Updated <time datetime="${KNOWLEDGE_UPDATED}">${KNOWLEDGE_UPDATED}</time> · <a class="underline underline-offset-4" href="${path}.md" type="text/markdown">Markdown</a></p>
`;
  const related =
    checks.length > 0
      ? `<section class="mt-10" aria-labelledby="related-checks-heading"><h2 id="related-checks-heading" class="text-xl font-semibold tracking-tight">Checks this guide is about</h2><ul class="mt-3 space-y-2 text-sm leading-6">${checks.map((check) => `<li>${checkLink(check.id)} <span class="text-muted-foreground">${escapeHtml(check.title)}</span></li>`).join('')}</ul></section>`
      : '';
  const body = `
${breadcrumbs([
  { label: 'Knowledge base', href: '/knowledge-base' },
  { label: 'Guides', href: GUIDES_HUB_PATH },
  { label: title },
])}
<div class="mt-8 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
<aside class="hidden lg:block"><nav class="kb-toc sticky top-6 text-sm text-muted-foreground" aria-label="On this page">${tocLinks(rendered.headings)}</nav></aside>
<article data-kb-article class="min-w-0">
<details class="kb-toc-mobile mt-6 rounded-lg border border-border lg:hidden"><summary class="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">On this page${icon('chevron-down', 'size-4')}</summary><nav class="kb-toc border-t border-border px-4 py-3 text-sm text-muted-foreground">${tocLinks(rendered.headings)}</nav></details>
<div class="max-w-[72ch]">${rendered.html}</div>
${related}
${scanCta()}
</article>
</div>
${jsonLd({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'TechArticle',
      '@id': `${config.baseUrl}${path}#article`,
      headline: title,
      description: guide.description,
      abstract: plainText(section(guide.body, 'In short')),
      keywords: guide.keywords.join(', '),
      url: `${config.baseUrl}${path}`,
      mainEntityOfPage: { '@id': `${config.baseUrl}${path}#webpage` },
      inLanguage: 'en',
      datePublished: KNOWLEDGE_UPDATED,
      dateModified: KNOWLEDGE_UPDATED,
      author: { '@id': `${AUTHOR.url}#person` },
      publisher: { '@id': `${AUTHOR.url}#person` },
      image: { '@id': `${socialImage(config, 'knowledge').url}#image` },
      isAccessibleForFree: true,
      articleSection: 'Guides',
      isPartOf: {
        '@id': `${config.baseUrl}/knowledge-base#webpage`,
        '@type': 'CollectionPage',
        name: 'Agentic readiness knowledge base',
        url: `${config.baseUrl}/knowledge-base`,
      },
      citation: guideSources(guide),
      encoding: {
        '@type': 'MediaObject',
        encodingFormat: 'text/markdown',
        contentUrl: `${config.baseUrl}${path}.md`,
      },
    },
    ...(faq.length > 0
      ? [
          {
            '@type': 'FAQPage',
            '@id': `${config.baseUrl}${path}#faq`,
            isPartOf: { '@id': `${config.baseUrl}${path}#webpage` },
            mainEntity: faq.map((pair) => ({
              '@type': 'Question',
              name: pair.question,
              acceptedAnswer: { '@type': 'Answer', text: pair.answer },
            })),
          },
        ]
      : []),
    breadcrumbLd(config, [
      { name: 'Knowledge base', path: '/knowledge-base' },
      { name: 'Guides', path: GUIDES_HUB_PATH },
      { name: title, path },
    ]),
    {
      ...webPage(config, path, title, guide.description, 'knowledge'),
      mainEntity: { '@id': `${config.baseUrl}${path}#article` },
    },
    ...siteGraph(config, 'knowledge'),
  ],
})}`;
  return kbPage(
    config,
    title,
    guide.description,
    `${headFor(config, path, title, guide.description, 'article')}\n<meta name="keywords" content="${escapeHtml(guide.keywords.join(', '))}">`,
    body,
    hero,
  );
}

/** A guide as one Markdown document: front matter, then the guide. */
export function guideMarkdown(config: AppConfig, guide: KnowledgeGuide): string {
  const url = `${config.baseUrl}${guidePath(guide)}`;
  return `---
title: ${yaml(guide.headline)}
description: ${yaml(guide.description)}
canonical_url: ${url}
category: guide
related_checks: [${guide.related.join(', ')}]
keywords: [${guide.keywords.map(yaml).join(', ')}]
author: ${yaml(AUTHOR.name)}
updated: ${KNOWLEDGE_UPDATED}
---

# ${guide.headline}

> ${guide.description}

${absolute(config, guide.body)}

Source: ${url} (${config.appName} knowledge base, by ${AUTHOR.name}).
`;
}
