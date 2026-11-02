/**
 * The knowledge base: an index at /knowledge, one page per catalog section and one
 * article per check. Articles come from @agentic-readiness/catalog/knowledge; everything
 * else on the page (priority, the levels a check gates, its dependencies, the fix and
 * the specifications) is read from the catalog, so the two can never disagree. Every page
 * also exists as Markdown for agents, and carries schema.org structured data for search.
 */
import { catalog, type CheckDefinition, type Group } from '@agentic-readiness/catalog';
import { knowledge, type KnowledgeArticle } from '@agentic-readiness/catalog/knowledge';
import { escapeHtml, tierOf, type Tier } from '@agentic-readiness/core';
import { badge, button, card, icon } from '@agentic-readiness/ui';

import type { AppConfig } from '../config.js';
import { page } from '../pages/layout.js';
import { faqPairs, markdownToHtml, plainText, section, slugify } from './markdown.js';

/** When the articles were last reviewed as a whole; bump with substantive rewrites. */
export const KNOWLEDGE_UPDATED = '2026-11-02';
const AUTHOR = { name: 'Matthias Reinholz', url: 'https://matthiasreinholz.com/about/' };

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
  return `/knowledge/${article.slug}`;
}

function checkOf(article: KnowledgeArticle): CheckDefinition {
  const check = catalog.checks.find((candidate) => candidate.id === article.id);
  if (!check) throw new Error(`knowledge article ${article.id} has no check`);
  return check;
}

function groupOf(check: CheckDefinition): Group {
  const group = catalog.groups.find((candidate) => candidate.id === check.group);
  if (!group) throw new Error(`check ${check.id} has no group`);
  return group;
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
    ? `<a class="font-medium text-primary underline-offset-4 hover:underline" href="${articlePath(article)}">${escapeHtml(id)}</a>`
    : escapeHtml(id);
}

function jsonLd(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function headFor(
  config: AppConfig,
  path: string,
  title: string,
  description: string,
  type: string,
): string {
  const url = `${config.baseUrl}${path}`;
  return [
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<link rel="alternate" type="text/markdown" href="${escapeHtml(`${url}.md`)}" title="Markdown">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta property="og:site_name" content="${escapeHtml(config.appName)}">`,
    `<meta name="author" content="${AUTHOR.name}">`,
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
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${config.baseUrl}${item.path}`,
    })),
  };
}

function scanCta(): string {
  return `<section class="${card} mt-10 flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between"><div><h2 class="text-base font-semibold tracking-tight">See how your store does</h2><p class="mt-1 text-sm text-muted-foreground">One scan runs every check in this knowledge base against your site and ends with a prioritised fix list.</p></div><a class="${button()}" href="/">Scan a store${icon('arrow-right')}</a></section>`;
}

function checkRow(check: CheckDefinition): string {
  const article = articleFor(check.id);
  const tier = tierOf(check.weight);
  const title = article ? article.headline : check.title;
  return `<li class="py-4"><div class="flex flex-wrap items-center gap-2"><span class="font-mono text-xs text-muted-foreground">${escapeHtml(check.id)}</span><span class="${TIER_BADGE[tier]}">${TIER_TEXT[tier]}</span></div><h3 class="mt-1.5 text-base font-semibold">${
    article
      ? `<a class="hover:text-primary" href="${articlePath(article)}">${escapeHtml(title)}</a>`
      : escapeHtml(title)
  }</h3><p class="mt-1 text-sm leading-6 text-muted-foreground">${escapeHtml(article?.description ?? check.question)}</p></li>`;
}

/** /knowledge */
export function knowledgeIndexPage(config: AppConfig): string {
  const title = 'Agentic readiness knowledge base';
  const description = `How AI agents find, read, trust and buy from online stores: ${catalog.checks.length} checks explained, with what each one tests, why it matters and how to fix it.`;
  const sections = catalog.groups
    .map((group) => {
      const checks = catalog.checks.filter((check) => check.group === group.id);
      return `<section class="mt-10" id="${escapeHtml(group.id)}"><div class="flex flex-wrap items-baseline justify-between gap-2"><h2 class="flex items-center gap-2 text-lg font-semibold tracking-tight"><span class="${badge()}">${escapeHtml(group.id)}</span><a class="hover:text-primary" href="/knowledge/${groupSlug(group)}">${escapeHtml(group.title)}</a></h2><span class="text-sm text-muted-foreground">${checks.length} checks</span></div><p class="mt-2 max-w-[70ch] text-sm leading-6 text-muted-foreground">${escapeHtml(group.description)}</p><ul class="mt-2 divide-y divide-border">${checks.map(checkRow).join('')}</ul></section>`;
    })
    .join('');
  const tiers = (Object.keys(TIER_TEXT) as Tier[])
    .map(
      (tier) =>
        `<li class="flex items-start gap-3"><span class="${TIER_BADGE[tier]} mt-0.5 shrink-0">${TIER_TEXT[tier]}</span><span class="text-sm leading-6 text-muted-foreground">${TIER_HELP[tier]}</span></li>`,
    )
    .join('');
  const levels = [...catalog.levels]
    .sort((a, b) => a.value - b.value)
    .map(
      (level) =>
        `<li class="text-sm leading-6 text-muted-foreground"><strong class="font-semibold text-foreground">Level ${level.value}, ${escapeHtml(level.name)}.</strong> ${escapeHtml(level.description)}</li>`,
    )
    .join('');
  const body = `
${breadcrumbs([{ label: 'Home', href: '/' }, { label: 'Knowledge base' }])}
<h1 class="mt-4 max-w-[22ch] text-balance text-3xl font-bold tracking-tight sm:text-4xl">${title}</h1>
<p class="mt-3 max-w-[66ch] leading-7 text-muted-foreground">An AI agent that shops for someone has to find a store, be allowed in, read its products as data, trust the merchant and, eventually, check out. Each article below explains one check of the <a class="font-medium text-primary underline-offset-4 hover:underline" href="/">Agentic Readiness Scanner</a>: what it looks at, why agents care, exactly how the scanner decides, and how to fix it on WordPress and WooCommerce, Shopify or any other stack.</p>
<div class="mt-8 grid gap-3 md:grid-cols-2">
<section class="${card} p-5"><h2 class="text-base font-semibold tracking-tight">How to read priorities</h2><ul class="mt-3 space-y-2.5">${tiers}</ul></section>
<section class="${card} p-5"><h2 class="text-base font-semibold tracking-tight">Readiness levels</h2><ul class="mt-3 space-y-1.5">${levels}</ul></section>
</div>
${sections}
${scanCta()}
${jsonLd({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'CollectionPage',
      name: title,
      description,
      url: `${config.baseUrl}/knowledge`,
      inLanguage: 'en',
      dateModified: KNOWLEDGE_UPDATED,
      author: { '@type': 'Person', ...AUTHOR },
      hasPart: knowledge.map((article) => ({
        '@type': 'TechArticle',
        headline: article.headline,
        url: `${config.baseUrl}${articlePath(article)}`,
      })),
    },
    breadcrumbLd(config, [
      { name: 'Home', path: '/' },
      { name: 'Knowledge base', path: '/knowledge' },
    ]),
  ],
})}`;
  return page(
    config,
    {
      title: `${title} · ${config.appName}`,
      description,
      head: headFor(config, '/knowledge', title, description, 'website'),
    },
    body,
  );
}

/** /knowledge/<group-slug> */
export function knowledgeGroupPage(config: AppConfig, group: Group): string {
  const checks = catalog.checks.filter((check) => check.group === group.id);
  const path = `/knowledge/${groupSlug(group)}`;
  const title = `${group.title}: ${checks.length} agentic readiness checks explained`;
  const description =
    group.description.length > 170
      ? `${group.description.slice(0, 167).replace(/\s+\S*$/, '')}...`
      : group.description;
  const dimension = group.dimension === 'ingestion' ? 'Agentic ingestion' : 'Agentic commerce';
  const body = `
${breadcrumbs([{ label: 'Knowledge base', href: '/knowledge' }, { label: group.title }])}
<p class="mt-4 font-mono text-xs text-muted-foreground">Section ${escapeHtml(group.id)} · ${dimension}</p>
<h1 class="mt-1 text-balance text-3xl font-bold tracking-tight">${escapeHtml(group.title)}</h1>
<p class="mt-3 max-w-[66ch] leading-7 text-muted-foreground">${escapeHtml(group.description)}</p>
<ul class="mt-4 divide-y divide-border">${checks.map(checkRow).join('')}</ul>
${scanCta()}
${jsonLd({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'CollectionPage',
      name: title,
      description,
      url: `${config.baseUrl}${path}`,
      inLanguage: 'en',
      isPartOf: { '@type': 'CollectionPage', url: `${config.baseUrl}/knowledge` },
    },
    breadcrumbLd(config, [
      { name: 'Knowledge base', path: '/knowledge' },
      { name: group.title, path },
    ]),
  ],
})}`;
  return page(
    config,
    {
      title: `${title} · ${config.appName}`,
      description,
      head: headFor(config, path, title, description, 'website'),
    },
    body,
  );
}

function fixCard(check: CheckDefinition): string {
  const { fix } = check;
  return `<section class="${card} mt-10 p-6" id="fix"><h2 class="text-xl font-semibold tracking-tight">The fix in one step</h2><p class="mt-3 leading-7 text-muted-foreground">${escapeHtml(fix.summary)}</p>${
    fix.snippet
      ? `<pre class="mt-4 overflow-x-auto rounded-lg border border-border bg-muted/50 p-4 text-[0.82rem] leading-6" data-language="${escapeHtml(fix.snippet_language ?? 'text')}"><code>${escapeHtml(fix.snippet)}</code></pre>`
      : ''
  }<details class="group mt-4 rounded-lg border border-border"><summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">Prompt for a coding agent${icon('chevron-down', 'size-4 transition-transform group-open:rotate-180')}</summary><p class="border-t border-border px-4 py-3 text-sm leading-6 text-muted-foreground">${escapeHtml(fix.agent_prompt)}</p></details></section>`;
}

/** /knowledge/<article-slug> */
export function knowledgeArticlePage(config: AppConfig, article: KnowledgeArticle): string {
  const check = checkOf(article);
  const group = groupOf(check);
  const tier = tierOf(check.weight);
  const path = articlePath(article);
  const rendered = markdownToHtml(article.body);
  const toc = rendered.headings
    .filter((heading) => heading.level === 2)
    .map(
      (heading) =>
        `<li><a class="hover:text-foreground" href="#${heading.id}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join('');
  const siblings = catalog.checks.filter((candidate) => candidate.group === check.group);
  const position = siblings.findIndex((candidate) => candidate.id === check.id);
  const previous = siblings[position - 1];
  const next = siblings[position + 1];
  const neighbour = (target: CheckDefinition | undefined, label: string, align: string) => {
    const linked = target ? articleFor(target.id) : undefined;
    return linked
      ? `<a class="${card} block p-4 ${align} hover:border-primary/50" href="${articlePath(linked)}"><span class="text-xs text-muted-foreground">${label} · ${escapeHtml(linked.id)}</span><span class="mt-1 block text-sm font-medium">${escapeHtml(linked.headline)}</span></a>`
      : '<span></span>';
  };
  const facts = [
    [
      'Priority',
      `<span class="${TIER_BADGE[tier]}">${TIER_TEXT[tier]}</span> <span class="text-muted-foreground">${TIER_HELP[tier]}</span>`,
    ],
    ['Readiness level', escapeHtml(gateSentence(check.id))],
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
        `<div class="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4"><dt class="text-sm font-medium">${label}</dt><dd class="text-sm leading-6">${value}</dd></div>`,
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
  const body = `
${breadcrumbs([
  { label: 'Knowledge base', href: '/knowledge' },
  { label: group.title, href: `/knowledge/${groupSlug(group)}` },
  { label: check.id },
])}
<article class="mt-4">
<p class="font-mono text-xs text-muted-foreground">Check ${escapeHtml(check.id)} · ${escapeHtml(check.title)}</p>
<h1 class="mt-1 max-w-[26ch] text-balance text-3xl font-bold tracking-tight sm:text-4xl">${escapeHtml(title)}</h1>
<p class="mt-3 max-w-[66ch] text-lg leading-8 text-muted-foreground">${escapeHtml(article.description)}</p>
<p class="mt-3 text-sm text-muted-foreground">By <a class="hover:text-foreground" href="${AUTHOR.url}" rel="author">${AUTHOR.name}</a> · Updated <time datetime="${KNOWLEDGE_UPDATED}">${KNOWLEDGE_UPDATED}</time> · <a class="hover:text-foreground" href="${path}.md">Markdown</a></p>
<dl class="${card} mt-6 divide-y divide-border px-5">${facts}</dl>
<nav class="mt-6" aria-label="On this page"><p class="text-sm font-medium">On this page</p><ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">${toc}<li><a class="hover:text-foreground" href="#fix">The fix in one step</a></li><li><a class="hover:text-foreground" href="#sources">Sources</a></li></ul></nav>
<div class="max-w-[72ch]">${rendered.html}</div>
${fixCard(check)}
<section class="mt-10" id="sources"><h2 class="text-xl font-semibold tracking-tight">Sources and specifications</h2><ul class="mt-4 list-disc space-y-2 pl-6 text-sm leading-6 marker:text-muted-foreground/70">${sources}</ul></section>
</article>
<nav class="mt-10 grid gap-3 sm:grid-cols-2" aria-label="More in ${escapeHtml(group.title)}">${neighbour(previous, 'Previous', '')}${neighbour(next, 'Next', 'sm:text-right')}</nav>
${scanCta()}
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
      inLanguage: 'en',
      datePublished: KNOWLEDGE_UPDATED,
      dateModified: KNOWLEDGE_UPDATED,
      author: { '@type': 'Person', ...AUTHOR },
      publisher: { '@type': 'Organization', name: config.appName, url: config.baseUrl },
      isPartOf: {
        '@type': 'CollectionPage',
        name: 'Agentic readiness knowledge base',
        url: `${config.baseUrl}/knowledge`,
      },
      about: group.title,
      citation: check.spec.map((ref) => ref.url),
      proficiencyLevel: 'Beginner',
    },
    {
      '@type': 'FAQPage',
      mainEntity: faq.map((pair) => ({
        '@type': 'Question',
        name: pair.question,
        acceptedAnswer: { '@type': 'Answer', text: pair.answer },
      })),
    },
    breadcrumbLd(config, [
      { name: 'Knowledge base', path: '/knowledge' },
      { name: group.title, path: `/knowledge/${groupSlug(group)}` },
      { name: title, path },
    ]),
  ],
})}`;
  return page(
    config,
    {
      title: `${title} · ${config.appName}`,
      description: article.description,
      head: `${headFor(config, path, title, article.description, 'article')}\n<meta name="keywords" content="${escapeHtml(article.keywords.join(', '))}">`,
    },
    body,
  );
}

function absolute(config: AppConfig, markdown: string): string {
  return markdown.replace(/\]\(\/(?!\/)/g, `](${config.baseUrl}/`);
}

/** The article as one Markdown document: the article, then the catalog's facts, fix and sources. */
export function articleMarkdown(config: AppConfig, article: KnowledgeArticle): string {
  const check = checkOf(article);
  const group = groupOf(check);
  const tier = tierOf(check.weight);
  const url = `${config.baseUrl}${articlePath(article)}`;
  const { fix } = check;
  return `# ${article.headline}

> ${article.description}

- Check: ${check.id} ${check.title} (section ${group.id}, ${group.title})
- Priority: ${TIER_TEXT[tier].toLowerCase()}. ${TIER_HELP[tier]}
- Readiness level: ${gateSentence(check.id)}
${check.depends_on.length > 0 ? `- Runs after: ${check.depends_on.join(', ')}\n` : ''}- Canonical URL: ${url}
- Author: ${AUTHOR.name} (${AUTHOR.url}), updated ${KNOWLEDGE_UPDATED}

${absolute(config, article.body)}

## The fix in one step

${fix.summary}
${fix.snippet ? `\n\`\`\`${fix.snippet_language ?? ''}\n${fix.snippet}\n\`\`\`\n` : ''}
### Prompt for a coding agent

${fix.agent_prompt}

## Sources and specifications

${check.spec.map((ref) => `- [${ref.title}](${ref.url})`).join('\n')}
`;
}

/** The index as Markdown: every section and article with absolute links. */
export function knowledgeIndexMarkdown(config: AppConfig): string {
  const sections = catalog.groups
    .map((group) => {
      const items = catalog.checks
        .filter((check) => check.group === group.id)
        .map((check) => {
          const article = articleFor(check.id);
          return article
            ? `- [${check.id} ${article.headline}](${config.baseUrl}${articlePath(article)}.md): ${article.description}`
            : `- ${check.id} ${check.title}`;
        })
        .join('\n');
      return `## ${group.id} ${group.title}\n\n${group.description}\n\n${items}`;
    })
    .join('\n\n');
  return `# Agentic readiness knowledge base

> How AI agents find, read, trust and buy from online stores: every check of the ${config.appName} explained, with what it tests, why it matters, how the scanner decides and how to fix it.

By ${AUTHOR.name} (${AUTHOR.url}). Each article is also an HTML page at the same URL without .md.

${sections}
`;
}

/** Every article in one Markdown file, for agents that want the whole knowledge base at once. */
export function knowledgeFullMarkdown(config: AppConfig): string {
  return [
    knowledgeIndexMarkdown(config),
    ...knowledge.map((article) => articleMarkdown(config, article)),
  ].join('\n\n---\n\n');
}
