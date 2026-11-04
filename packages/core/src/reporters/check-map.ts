/**
 * The check map: one small cell per check, grouped by section and coloured by verdict,
 * the same grid the hosted scan console fills while a scan runs. On the report it stays
 * as an overview and a navigation aid: every cell links to its check. When the page is
 * opened straight from a scan, the console's grid morphs into this one (cross-document
 * view transitions where the browser supports them) and a short completion animation
 * plays once. Self-contained: the CLI's HTML report carries it too, without the animation
 * trigger.
 */
import { dimensionCopy, type CheckResult, type ScanResult } from '@agentic-readiness/catalog';

import { dimensionScore, incompleteScoreSentence, scoreGroup } from '../scoring.js';
import { scoreTone } from './html-theme.js';
import { groupIsOptional, skipPhrases } from './priorities.js';
import { ceilingSentence, countVerdicts, escapeHtml, groupResults } from './shared.js';

const VERDICT_WORD: Record<CheckResult['verdict'], string> = {
  pass: 'pass',
  warn: 'warn',
  fail: 'fail',
  skip: 'skipped',
};

/** Styles for the map and the arrival animation; tokens come from the shared theme. */
export const CHECK_MAP_CSS = `
@view-transition{navigation:auto}
.cm-grid{view-transition-name:check-map;container-type:inline-size}
.cm-dim+.cm-dim{margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid hsl(var(--border))}
.cm-dim-head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:.25rem 1rem}
.cm-meter{grid-column:1/-1;height:.375rem;margin-top:.5rem;overflow:hidden;border-radius:9999px;background:hsl(var(--muted))}
.cm-meter i{display:block;height:100%;border-radius:inherit;background:currentColor}
.cm-row{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"label score" "cells cells";align-items:center;gap:.375rem .75rem;padding-block:.5rem}
.cm-label{grid-area:label;min-width:0}
.cm-cells{grid-area:cells;display:flex;min-width:0;flex-wrap:wrap;gap:.25rem}
.cm-score{grid-area:score}
@container (min-width:40rem){.cm-row{grid-template-columns:18rem minmax(0,1fr) auto;grid-template-areas:"label cells score"}}
.cm-cell{display:grid;place-items:center;width:1.5rem;height:1.5rem;flex:none;font:700 .75rem/1 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;color:hsl(var(--background));border-radius:4px;background:hsl(var(--muted));border:1px solid hsl(var(--input));transition:transform .15s}
.cm-cell:hover,.cm-cell:focus-visible{transform:translateY(-2px);outline:2px solid hsl(var(--ring));outline-offset:2px}
.cm-cell[data-v=pass]{background:hsl(var(--success));border-color:hsl(var(--success))}
.cm-cell[data-v=warn]{background:hsl(var(--warning));border-color:hsl(var(--warning))}
.cm-cell[data-v=fail]{background:hsl(var(--destructive));border-color:hsl(var(--destructive))}
.cm-cell[data-v=skip]{background:transparent;border-style:dashed}
.cm-key{display:inline-flex;align-items:center;gap:6px}
.cm-key .cm-cell{width:.875rem;height:.875rem;font-size:.625rem;border-radius:3px}
.cm-cell[data-v=pass]::after{content:"✓" / ""}.cm-cell[data-v=warn]::after{content:"!" / ""}.cm-cell[data-v=fail]::after{content:"×" / ""}
.lv-badge{position:relative;view-transition-name:level-badge}
.lv-burst{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none}
.lv-burst i{position:absolute;width:7px;height:7px;margin:-3.5px;border-radius:2px;opacity:0}
.cm-arrive .cm-cell{animation:cm-pop .45s cubic-bezier(.3,1.6,.6,1) backwards;animation-delay:calc(var(--i) * 14ms)}
.lv-celebrate{animation:lv-bounce .7s cubic-bezier(.3,1.6,.6,1) both}
.lv-celebrate::after{content:'';position:absolute;inset:-2px;border-radius:18px;border:2px solid hsl(var(--primary));animation:lv-ring 1s ease-out .15s both}
.lv-celebrate .lv-burst i{animation:lv-fly .9s cubic-bezier(.2,.7,.3,1) both;animation-delay:calc(.12s + var(--d))}
@keyframes cm-pop{0%{transform:scale(.2);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes lv-bounce{0%{transform:scale(.6)}60%{transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes lv-ring{0%{transform:scale(1);opacity:.9}100%{transform:scale(1.9);opacity:0}}
@keyframes lv-fly{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--x),var(--y)) rotate(var(--r));opacity:0}}
@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}.cm-arrive .cm-cell,.lv-celebrate,.lv-celebrate::after,.lv-celebrate .lv-burst i{animation:none}}
`;

/**
 * The overview at a glance: one block per score ("Visible to AI", "Shoppable by AI") with
 * its value and the question it answers, then one row per section with its plain name,
 * its question, a cell per check and its score. Every row links to the section and every
 * cell to its check, so a beginner reads the names and the colours and an expert goes
 * straight to the evidence. A summary of all verdicts closes it.
 */
export function checkMapHtml(result: ScanResult, cardClass: string): string {
  let index = 0;
  const groups = groupResults(result);
  const blocks = (['ingestion', 'commerce'] as const)
    .map((dimension) => {
      const sections = groups.filter(
        (group) => group.dimension === dimension && group.results.length > 0,
      );
      if (sections.length === 0) return '';
      const copy = dimensionCopy(dimension);
      const score = dimensionScore(result.scores, dimension);
      const tone = scoreTone(score.value);
      const value =
        score.state === 'incomplete'
          ? '<span class="text-lg font-bold text-muted-foreground">Incomplete</span>'
          : score.value === null
            ? '<span class="text-lg font-bold text-muted-foreground">n/a</span>'
            : `<span class="text-3xl font-extrabold leading-none ${tone}">${String(score.value)}</span><small class="ml-1 text-sm font-semibold text-muted-foreground">/ 100</small>`;
      const note =
        score.state === 'incomplete'
          ? incompleteScoreSentence(score)
          : ceilingSentence(result, dimension);
      const meter =
        score.value === null
          ? ''
          : `<div class="cm-meter ${tone}" aria-hidden="true"><i style="width:${String(score.value)}%"></i></div>`;
      const rows = sections
        .map((group) => {
          const sectionScore = scoreGroup(result.results, group.id);
          // A section made only of optional checks is scored, but its zero is no red flag.
          const optional = groupIsOptional(group.results);
          const scoreClass =
            sectionScore === null || optional ? 'text-muted-foreground' : scoreTone(sectionScore);
          const cells = group.results
            .map((item) => {
              const label = `${item.id} ${item.title}: ${VERDICT_WORD[item.verdict]}`;
              const cell = `<a class="cm-cell" href="#${escapeHtml(item.id)}" data-v="${item.verdict}" style="--i:${String(index)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></a>`;
              index += 1;
              return cell;
            })
            .join('');
          return `<div class="cm-row" data-section="${escapeHtml(group.id)}"><a class="cm-label group/label" href="#group-${escapeHtml(group.id)}" title="${escapeHtml(`${group.id} ${group.title}`)}"><span class="block text-sm font-semibold leading-5 group-hover/label:text-primary">${escapeHtml(group.label)}${optional ? ' <span class="ml-1 text-xs font-normal text-muted-foreground">optional</span>' : ''}</span><span class="block text-xs leading-5 text-muted-foreground">${escapeHtml(group.question)}</span></a><span class="cm-cells">${cells}</span><span class="cm-score w-8 text-right text-sm font-bold tabular-nums ${scoreClass}">${sectionScore === null ? '–' : String(sectionScore)}</span></div>`;
        })
        .join('');
      return `<div class="cm-dim" data-dimension="${dimension}"><div class="cm-dim-head"><div class="min-w-0"><h3 class="text-base font-semibold tracking-tight">${escapeHtml(copy.label)}</h3><p class="text-sm text-muted-foreground">${escapeHtml(copy.question)}</p></div><div class="whitespace-nowrap text-right" data-score="${dimension}">${value}</div>${meter}</div>${note ? `<p class="mt-2 text-sm leading-6" data-ceiling>${escapeHtml(note)}</p>` : ''}<div class="mt-2 divide-y divide-border">${rows}</div></div>`;
    })
    .join('');
  const counts = countVerdicts(result);
  const evaluated = counts.pass + counts.warn + counts.fail;
  const skipped = skipPhrases(result);
  const summary = `${String(evaluated)} checks evaluated: <span class="text-success">${String(counts.pass)} passed</span> · <span class="text-warning">${String(counts.warn)} with warnings</span> · <span class="text-destructive">${String(counts.fail)} failed</span>${counts.skip > 0 ? ` · ${String(counts.skip)} skipped${skipped.length > 0 ? ` (${escapeHtml(skipped.join(', ').replace('did not apply', 'did not apply to this site'))})` : ''}` : ''}.`;
  const key = (['pass', 'warn', 'fail', 'skip'] as const)
    .map(
      (verdict) =>
        `<span class="cm-key"><span class="cm-cell" data-v="${verdict}"></span>${VERDICT_WORD[verdict]}</span>`,
    )
    .join('');
  return `<section class="${cardClass} mt-3 p-4 sm:p-6" id="check-map" aria-labelledby="check-map-title"><div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2"><h2 class="text-lg font-semibold tracking-tight" id="check-map-title">At a glance</h2><p class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">${key}</p></div><div class="cm-grid mt-4">${blocks}</div><p class="mt-5 border-t border-border pt-4 text-sm text-muted-foreground" data-verdict-summary>${summary}</p><p class="cm-done-slot mt-3 text-sm text-muted-foreground" aria-live="polite"></p></section>`;
}

/**
 * Plays the arrival animation once, when the scan console handed over to this report:
 * the console leaves the report path in sessionStorage just before it navigates, so a
 * reload, a shared link or the CLI's report never animates. Cells pop in as a wave, the
 * level badge bounces with a ring and a burst of verdict-coloured confetti.
 */
export const CHECK_MAP_SCRIPT = `(function(){window.addEventListener('pagereveal',function(e){var t=e.viewTransition;if(t){var q=function(){};t.ready.catch(q);t.finished.catch(q);t.updateCallbackDone.catch(q)}});var key='ars-arrived';var v=null;try{v=sessionStorage.getItem(key);if(v)sessionStorage.removeItem(key)}catch(e){}
if(!v||v.split('|')[0]!==location.pathname)return;if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
var grid=document.querySelector('.cm-grid'),badge=document.querySelector('.lv-badge'),slot=document.querySelector('.cm-done-slot'),ran=false;
function celebrate(wave){if(ran)return;ran=true;
if(grid&&wave)grid.classList.add('cm-arrive');
if(badge){var burst=document.createElement('span');burst.className='lv-burst';var colors=['--success','--warning','--primary','--destructive','--success','--primary'];for(var i=0;i<22;i++){var p=document.createElement('i');var a=Math.PI*2*i/22+Math.random()*0.3,r=60+Math.random()*70;p.style.setProperty('--x',Math.cos(a)*r+'px');p.style.setProperty('--y',Math.sin(a)*r+'px');p.style.setProperty('--r',(Math.random()*540-270)+'deg');p.style.setProperty('--d',(Math.random()*120)+'ms');p.style.background='hsl(var('+colors[i%colors.length]+'))';if(i%3===0)p.style.borderRadius='50%';burst.appendChild(p)}badge.appendChild(burst);badge.classList.add('lv-celebrate');setTimeout(function(){burst.remove()},1800)}
var s=v.split('|')[1];if(slot&&s){slot.textContent='Scan complete in '+s+'. Click any cell to jump to its check.'}}
var morphing=false;window.addEventListener('pagereveal',function(e){if(e.viewTransition){morphing=true;e.viewTransition.finished.then(function(){celebrate(false)},function(){celebrate(true)})}else celebrate(true)});
setTimeout(function(){if(!morphing)celebrate(true)},120)})();`;
