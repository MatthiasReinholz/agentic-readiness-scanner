/**
 * The check map: one small cell per check, grouped by section and coloured by verdict,
 * the same grid the hosted scan console fills while a scan runs. On the report it stays
 * as an overview and a navigation aid: every cell links to its check. When the page is
 * opened straight from a scan, the console's grid morphs into this one (cross-document
 * view transitions where the browser supports them) and a short completion animation
 * plays once. Self-contained: the CLI's HTML report carries it too, without the animation
 * trigger.
 */
import type { CheckResult, ScanResult } from '@agentic-readiness/catalog';

import { scoreGroup } from '../scoring.js';
import { escapeHtml, groupResults } from './shared.js';

const VERDICT_WORD: Record<CheckResult['verdict'], string> = {
  pass: 'pass',
  warn: 'warn',
  fail: 'fail',
  skip: 'skipped',
};

/** Styles for the map and the arrival animation; tokens come from the shared theme. */
export const CHECK_MAP_CSS = `
@view-transition{navigation:auto}
.cm-grid{view-transition-name:check-map}
.cm-cell{display:block;width:16px;height:16px;border-radius:4px;background:hsl(var(--muted));border:1px solid hsl(var(--border));transition:transform .15s}
.cm-cell:hover,.cm-cell:focus-visible{transform:scale(1.3);outline:none;box-shadow:0 0 0 2px hsl(var(--ring)/.5)}
.cm-cell[data-v=pass]{background:hsl(var(--success));border-color:hsl(var(--success))}
.cm-cell[data-v=warn]{background:hsl(var(--warning));border-color:hsl(var(--warning))}
.cm-cell[data-v=fail]{background:hsl(var(--destructive));border-color:hsl(var(--destructive))}
.cm-cell[data-v=skip]{background:transparent;border-style:dashed}
.cm-key{display:inline-flex;align-items:center;gap:6px}
.cm-key .cm-cell{width:11px;height:11px;border-radius:3px}
.lv-badge{position:relative;view-transition-name:level-badge}
.lv-burst{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none}
.lv-burst i{position:absolute;width:7px;height:7px;margin:-3.5px;border-radius:2px;opacity:0}
.cm-arrive .cm-cell{animation:cm-pop .45s cubic-bezier(.3,1.6,.6,1) both;animation-delay:calc(var(--i) * 14ms)}
.lv-celebrate{animation:lv-bounce .7s cubic-bezier(.3,1.6,.6,1) both}
.lv-celebrate::after{content:'';position:absolute;inset:-2px;border-radius:18px;border:2px solid hsl(var(--primary));animation:lv-ring 1s ease-out .15s both}
.lv-celebrate .lv-burst i{animation:lv-fly .9s cubic-bezier(.2,.7,.3,1) both;animation-delay:calc(.12s + var(--d))}
@keyframes cm-pop{0%{transform:scale(.2);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes lv-bounce{0%{transform:scale(.6)}60%{transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes lv-ring{0%{transform:scale(1);opacity:.9}100%{transform:scale(1.9);opacity:0}}
@keyframes lv-fly{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--x),var(--y)) rotate(var(--r));opacity:0}}
@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}.cm-arrive .cm-cell,.lv-celebrate,.lv-celebrate::after,.lv-celebrate .lv-burst i{animation:none}}
`;

/** The map markup: a legend, then one row per catalog group with its score. */
export function checkMapHtml(result: ScanResult, cardClass: string): string {
  let index = 0;
  const rows = groupResults(result)
    .map((group) => {
      const score = scoreGroup(result.results, group.id);
      const cells = group.results
        .map((item) => {
          const label = `${item.id} ${item.title}: ${VERDICT_WORD[item.verdict]}`;
          const cell = `<a class="cm-cell" href="#${escapeHtml(item.id)}" data-v="${item.verdict}" style="--i:${index}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></a>`;
          index += 1;
          return cell;
        })
        .join('');
      return `<div class="grid grid-cols-[2.25rem_1fr_auto] items-center gap-x-3 sm:grid-cols-[2.25rem_12rem_1fr_auto]"><a class="font-mono text-xs text-muted-foreground hover:text-foreground" href="#group-${escapeHtml(group.id)}">${escapeHtml(group.id)}</a><span class="hidden truncate text-sm text-muted-foreground sm:block">${escapeHtml(group.title)}</span><span class="flex flex-wrap gap-1">${cells}</span><span class="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">${score === null ? '–' : String(score)}</span></div>`;
    })
    .join('');
  const key = (['pass', 'warn', 'fail', 'skip'] as const)
    .map(
      (verdict) =>
        `<span class="cm-key"><span class="cm-cell" data-v="${verdict}"></span>${VERDICT_WORD[verdict]}</span>`,
    )
    .join('');
  return `<section class="${cardClass} mt-3 p-5 sm:p-6" id="check-map" aria-label="Check map"><div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2"><h2 class="text-base font-semibold tracking-tight">Check map</h2><p class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">${key}<span>section score</span></p></div><div class="cm-grid mt-4 grid gap-2">${rows}</div><p class="cm-done-slot mt-3 text-sm text-muted-foreground" aria-live="polite"></p></section>`;
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
