/**
 * Navigation for the knowledge base, so a reader always sees where they are:
 *   - the journey rail: the nine sections as the path an agent takes, from finding a
 *     store to checking out, with the current section lit;
 *   - the check strip: every check as a cell, the scanner's own check-map language, with
 *     the current check and its section highlighted and every cell a link;
 *   - the article sidebar: the section's checks and the article's own outline, with the
 *     section being read highlighted as you scroll;
 *   - a reading progress bar and, on the index, a filter by text and priority.
 * Everything is server-rendered links; the script only adds highlighting and filtering.
 */
import { catalog, type CheckDefinition, type Group } from '@agentic-readiness/catalog';
import { knowledge, type KnowledgeArticle } from '@agentic-readiness/catalog/knowledge';
import { escapeHtml, tierOf, type Tier } from '@agentic-readiness/core';

import { identifier } from '@agentic-readiness/ui';

import type { Heading } from './markdown.js';
import { slugify } from './markdown.js';

/** What each section means on an agent's way from finding a store to buying from it. */
export const JOURNEY_STEP: Record<string, string> = {
  A1: 'Find',
  A2: 'Get in',
  A3: 'Read',
  A4: 'Connect',
  B1: 'Catalog',
  B2: 'Products',
  B3: 'Identify',
  B4: 'Trust',
  B5: 'Buy',
};

export const TIER_DOT: Record<Tier, string> = {
  blocking: 'bg-destructive',
  expected: 'bg-warning',
  nice_to_have: 'bg-muted-foreground/50',
  informational: 'bg-border',
};

function articleOf(id: string): KnowledgeArticle | undefined {
  return knowledge.find((article) => article.id === id);
}

function hrefOf(id: string): string {
  const article = articleOf(id);
  return article ? `/knowledge-base/${article.slug}` : '/knowledge-base';
}

function groupHref(group: Group): string {
  return `/knowledge-base/${slugify(group.title)}`;
}

export const KB_CSS = `
.kb-filter-bar{margin-inline:calc(-1 * var(--page-gutter));padding-inline:var(--page-gutter)}
.kb-progress{position:fixed;inset:0 0 auto 0;height:3px;z-index:50;background:hsl(var(--primary));transform-origin:0 50%;transform:scaleX(0);pointer-events:none}
.kb-cell{display:block;width:1.5rem;height:1.5rem;flex:none;border-radius:4px;background:hsl(var(--muted));border:1px solid hsl(var(--input));transition:transform .15s,background .15s}
.kb-cell:hover,.kb-cell:focus-visible{transform:translateY(-2px);outline:2px solid hsl(var(--ring));outline-offset:2px;background:hsl(var(--primary)/.6)}
.kb-cell[data-state=group]{background:hsl(var(--primary)/.28);border-color:hsl(var(--primary)/.45)}
.kb-cell[data-state=current]{background:hsl(var(--primary));border-color:hsl(var(--primary));box-shadow:0 0 0 3px hsl(var(--primary)/.25);animation:kb-pulse 2.4s ease-in-out 2}
@keyframes kb-pulse{50%{box-shadow:0 0 0 4px hsl(var(--primary)/.08)}}
.kb-toc a{display:block;border-left:2px solid hsl(var(--border));min-height:2rem;padding:.375rem 0 .375rem .75rem;transition:color .15s,border-color .15s}
.kb-toc a[data-active]{color:hsl(var(--foreground));border-left-color:hsl(var(--primary));font-weight:500}
.kb-step[aria-current] .kb-dot{background:hsl(var(--primary));color:hsl(var(--primary-foreground));border-color:hsl(var(--primary));box-shadow:0 0 0 4px hsl(var(--primary)/.2)}
.kb-step[aria-current] .kb-label{color:hsl(var(--foreground));font-weight:600}
[data-kb-row][hidden],[data-kb-section][hidden]{display:none}
.kb-chip[aria-pressed=true]{background:hsl(var(--primary));color:hsl(var(--primary-foreground));border-color:hsl(var(--primary))}
@media (prefers-reduced-motion:reduce){.kb-cell[data-state=current]{animation:none}.kb-cell,.kb-toc a{transition:none}}
`;

/** Progress bar, scroll-spy for the outline, and the index filter. */
export const KB_SCRIPT = `(function(){
var step=document.querySelector('.kb-step[aria-current]');if(step){var rail=step.closest('nav');if(rail&&rail.scrollWidth>rail.clientWidth)rail.scrollLeft=Math.max(0,step.getBoundingClientRect().left-rail.getBoundingClientRect().left-rail.clientWidth/2+step.offsetWidth/2)}
var bar=document.querySelector('.kb-progress'),art=document.querySelector('[data-kb-article]');
if(bar&&art){var tick=false;var upd=function(){tick=false;var r=art.getBoundingClientRect(),h=window.innerHeight,total=r.height-h;var p=total>0?Math.min(1,Math.max(0,-r.top/total)):1;bar.style.transform='scaleX('+p+')'};window.addEventListener('scroll',function(){if(!tick){tick=true;requestAnimationFrame(upd)}},{passive:true});upd()}
var links=document.querySelectorAll('.kb-toc a[href^="#"]');
if(links.length&&'IntersectionObserver' in window){var heads=[];links.forEach(function(a){var t=document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));if(t&&heads.indexOf(t)<0)heads.push(t)});
var set=function(id){links.forEach(function(a){if(a.getAttribute('href')==='#'+id)a.setAttribute('data-active','');else a.removeAttribute('data-active')})};
var io=new IntersectionObserver(function(){var cur=null;for(var i=0;i<heads.length;i++){if(heads[i].getBoundingClientRect().top<window.innerHeight*0.3)cur=heads[i]}set(cur?cur.id:heads[0].id)},{rootMargin:'0px 0px -60% 0px',threshold:[0,1]});heads.forEach(function(h){io.observe(h)});
window.addEventListener('scroll',function(){var cur=null;for(var i=0;i<heads.length;i++){if(heads[i].getBoundingClientRect().top<window.innerHeight*0.3)cur=heads[i]}if(cur)set(cur.id)},{passive:true})}
var f=document.getElementById('kb-filter');
if(f){var tier='';var rows=document.querySelectorAll('[data-kb-row]'),secs=document.querySelectorAll('[data-kb-section]'),count=document.getElementById('kb-count'),chips=document.querySelectorAll('.kb-chip');
var apply=function(){var q=f.value.trim().toLowerCase(),n=0;rows.forEach(function(r){var ok=(!q||r.getAttribute('data-text').indexOf(q)>=0)&&(!tier||r.getAttribute('data-tier')===tier);if(ok){r.removeAttribute('hidden');n++}else r.setAttribute('hidden','')});secs.forEach(function(s){if(s.querySelector('[data-kb-row]:not([hidden])'))s.removeAttribute('hidden');else s.setAttribute('hidden','')});if(count)count.textContent=n===rows.length?n+' checks':n+' of '+rows.length+' checks'};
f.addEventListener('input',apply);chips.forEach(function(c){c.addEventListener('click',function(){var t=c.getAttribute('data-tier');tier=tier===t?'':t;chips.forEach(function(o){o.setAttribute('aria-pressed',String(o.getAttribute('data-tier')===tier))});apply()})});
document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==f&&!/input|textarea/i.test(document.activeElement.tagName)){e.preventDefault();f.focus()}})}
})();`;

/** The nine sections as an agent's journey, the current one lit. */
export function journeyRail(currentGroup?: string): string {
  const half = (dimension: 'ingestion' | 'commerce', label: string) => {
    const steps = catalog.groups
      .filter((group) => group.dimension === dimension)
      .map((group) => {
        const index = catalog.groups.indexOf(group) + 1;
        const current = group.id === currentGroup;
        return `<li class="min-w-0 flex-1"><a class="kb-step group flex flex-col items-center gap-1.5 rounded-lg px-1 py-2 text-center hover:bg-muted/60" href="${groupHref(group)}" title="${escapeHtml(`${group.id} ${group.title}`)}"${current ? ' aria-current="step"' : ''}><span class="kb-dot grid size-7 place-items-center rounded-full border border-border bg-card font-mono text-xs text-muted-foreground transition-colors group-hover:border-primary/60">${index}</span><span class="kb-label whitespace-nowrap text-xs text-muted-foreground">${escapeHtml(JOURNEY_STEP[group.id] ?? group.title)}</span></a></li>`;
      })
      .join('');
    return `<div class="min-w-0"><p class="mb-1 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">${label}</p><ol class="relative flex before:absolute before:left-6 before:right-6 before:top-[1.4rem] before:h-px before:bg-border">${steps}</ol></div>`;
  };
  return `<nav aria-label="The agent's journey" class="rounded-md overflow-x-auto" tabindex="0"><div class="grid min-w-[36rem] grid-cols-[4fr_5fr] gap-4">${half('ingestion', 'Agentic ingestion')}${half('commerce', 'Agentic commerce')}</div></nav>`;
}

/** Every check as one cell, grouped by section; the current check and section stand out. */
export function checkStrip(currentId?: string, currentGroup?: string): string {
  const current = currentId ? catalog.checks.find((check) => check.id === currentId) : undefined;
  const lit = current?.group ?? currentGroup;
  const groups = catalog.groups
    .map((group) => {
      const cells = catalog.checks
        .filter((check) => check.group === group.id)
        .map((check) => {
          const state = check.id === currentId ? 'current' : lit === group.id ? 'group' : 'other';
          const label = `${check.id} ${articleOf(check.id)?.headline ?? check.title}`;
          return `<a class="kb-cell" data-state="${state}" href="${hrefOf(check.id)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"${state === 'current' ? ' aria-current="page"' : ''}></a>`;
        })
        .join('');
      return `<span class="flex max-w-full flex-wrap items-center gap-1" title="${escapeHtml(`${group.id} ${group.title}`)}">${cells}</span>`;
    })
    .join('');
  return `<div class="flex flex-wrap items-center gap-x-2.5 gap-y-2" role="navigation" aria-label="All ${catalog.checks.length} checks">${groups}</div>`;
}

/** "Check 2 of 7 in Bot access control · 10 of 64 overall" */
export function positionLine(check: CheckDefinition, group: Group): string {
  const inGroup = catalog.checks.filter((candidate) => candidate.group === group.id);
  const position = inGroup.findIndex((candidate) => candidate.id === check.id) + 1;
  const overall = catalog.checks.findIndex((candidate) => candidate.id === check.id) + 1;
  return `Check ${position} of ${inGroup.length} in ${group.title} · ${overall} of ${catalog.checks.length} overall`;
}

/** The article sidebar: the section's checks with the current one marked, then the outline. */
export function articleSidebar(check: CheckDefinition, group: Group, outline: Heading[]): string {
  const checks = catalog.checks
    .filter((candidate) => candidate.group === group.id)
    .map((candidate) => {
      const current = candidate.id === check.id;
      const article = articleOf(candidate.id);
      return `<li><a class="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm ${current ? 'bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}" href="${hrefOf(candidate.id)}"${current ? ' aria-current="page"' : ''}><span class="mt-1.5 size-2 shrink-0 rounded-full ${TIER_DOT[tierOf(candidate.weight)]}" aria-hidden="true"></span><span><span class="${identifier} text-xs text-muted-foreground">${escapeHtml(candidate.id)}</span> ${escapeHtml(article?.headline ?? candidate.title)}</span></a></li>`;
    })
    .join('');
  return `<aside class="hidden lg:block" aria-label="Section navigation"><div class="sticky top-6 max-h-[calc(100vh-3rem)] space-y-6 overflow-y-auto pb-6 pr-1">
<div><a class="flex items-start gap-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground" href="${groupHref(group)}"><span class="${identifier}">${escapeHtml(group.id)}</span>${escapeHtml(group.title)}</a><ul class="mt-2 space-y-0.5">${checks}</ul></div>
<div><p class="px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">On this page</p><nav class="kb-toc mt-2 pl-2 text-sm text-muted-foreground">${tocLinks(outline)}</nav></div>
</div></aside>`;
}

export function tocLinks(outline: Heading[]): string {
  return [
    ...outline.filter((heading) => heading.level === 2),
    { level: 2 as const, text: 'The fix in one step', id: 'fix' },
    { level: 2 as const, text: 'Sources', id: 'sources' },
  ]
    .map(
      (heading) =>
        `<a class="hover:text-foreground" href="#${heading.id}">${escapeHtml(heading.text)}</a>`,
    )
    .join('');
}
