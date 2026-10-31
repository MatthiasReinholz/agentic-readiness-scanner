import { escapeHtml } from '@agentic-readiness/core';
import { badge, button, card, icon, input } from '@agentic-readiness/ui';

import type { AppConfig } from '../config.js';
import type { StoredScan } from '../store/types.js';
import { page } from './layout.js';

function form(scan: StoredScan, idPrefix: string, autofocus: boolean): string {
  return `<form method="post" action="/monitor" class="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto]" data-monitor-form>
<input type="hidden" name="scan_id" value="${escapeHtml(scan.id)}">
<label class="sr-only" for="${idPrefix}-email">Email address</label>
<input class="${input}" id="${idPrefix}-email" type="email" name="email" placeholder="you@example.com" required autocomplete="email" inputmode="email" ${autofocus ? 'autofocus' : ''}>
<button type="submit" class="${button({ size: 'lg' })}">${icon('bell')}Monitor this site</button>
<p class="text-xs leading-5 text-muted-foreground sm:col-span-2">Double opt-in: we send one confirmation email first. Afterwards we rescan about weekly and only write when something changed. One-click unsubscribe in every email. Nothing else is done with the address.</p>
</form>`;
}

function offer(scan: StoredScan, config: AppConfig, titleId: string, title: string): string {
  return `<div><h2 id="${titleId}" class="flex flex-wrap items-center gap-2.5 text-lg font-semibold tracking-tight">${title}</h2>
<p class="mt-1.5 text-[0.95rem] text-muted-foreground">${escapeHtml(config.appName)} can rescan <strong class="font-semibold text-foreground">${escapeHtml(scan.host)}</strong> every ${config.monitoring.intervalDays} days and email you when the level, a score or any check result changes. Useful after a theme update, a plugin change or a platform release.</p></div>`;
}

/** The signup block shown between the scores and the sections of a report. */
export function monitorPanel(config: AppConfig, scan: StoredScan): string {
  return `<section class="${card} mt-6 grid gap-4 p-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-center" id="monitor" aria-labelledby="monitor-title">
${offer(scan, config, 'monitor-title', `<span class="${badge()}">New</span>Get told when this changes`)}
${form(scan, 'monitor', false)}
</section>`;
}

/** The same offer as a dialog, opened by script after a delay unless the visitor already acted. */
export function monitorDialog(config: AppConfig, scan: StoredScan): string {
  return `<dialog class="w-[min(520px,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-[2px] open:animate-content-in" id="monitor-dialog" aria-labelledby="monitor-dialog-title" data-host="${escapeHtml(scan.host)}" data-delay="${MONITOR_DIALOG_DELAY_MS}">
<div class="relative space-y-4 p-6">
<form method="dialog"><button class="${button({ variant: 'ghost', size: 'icon-sm' })} absolute right-3 top-3 text-muted-foreground" value="dismiss" aria-label="Close">${icon('x')}</button></form>
${offer(scan, config, 'monitor-dialog-title', `Want to know when ${escapeHtml(scan.host)} changes?`)}
${form(scan, 'monitor-dialog', true)}
</div>
</dialog>`;
}

/** Milliseconds before the dialog opens on a report. */
export const MONITOR_DIALOG_DELAY_MS = 10_000;

/**
 * Opens the dialog after its `data-delay` unless the visitor subscribed to this host
 * before, dismissed the dialog in the last 30 days, or is already using the inline form.
 * Both forms mark the host as subscribed on submit so no second offer follows. The
 * script is static; the host comes from a data attribute, never from code construction.
 */
export const MONITOR_SCRIPT = `(function(){var d=document.getElementById('monitor-dialog');if(!d||typeof d.showModal!=='function')return;var K='ars-monitor:'+(d.getAttribute('data-host')||'');var delay=parseInt(d.getAttribute('data-delay')||'10000',10);var get=function(){try{return JSON.parse(localStorage.getItem(K)||'null')}catch(e){return null}};var set=function(v){try{localStorage.setItem(K,JSON.stringify(v))}catch(e){}};var busy=false;document.querySelectorAll('[data-monitor-form]').forEach(function(f){f.addEventListener('focusin',function(){busy=true});f.addEventListener('submit',function(){set({state:'subscribed',at:Date.now()})})});d.addEventListener('close',function(){if(d.returnValue==='dismiss'||d.returnValue===''){set({state:'dismissed',at:Date.now()})}});var s=get();if(s&&s.state==='subscribed')return;if(s&&s.state==='dismissed'&&Date.now()-s.at<30*86400000)return;setTimeout(function(){if(busy||document.hidden||d.open)return;var again=get();if(again&&again.state==='subscribed')return;d.showModal()},delay)})();`;

/** Records the visitor's monitoring state for a host from a data attribute on the status page. */
const MONITOR_STATE_SCRIPT = `(function(){var el=document.querySelector('[data-monitor-host]');if(!el)return;var K='ars-monitor:'+el.getAttribute('data-monitor-host');var state=el.getAttribute('data-monitor-state');try{if(state==='subscribed'){localStorage.setItem(K,JSON.stringify({state:'subscribed',at:Date.now()}))}else if(state==='cleared'){localStorage.removeItem(K)}}catch(e){}})();`;

export type MonitorPageKind = 'check_inbox' | 'confirmed' | 'unsubscribed' | 'invalid' | 'disabled';

export interface MonitorPageContext {
  host?: string;
  reportUrl?: string;
}

export function monitorPage(
  config: AppConfig,
  kind: MonitorPageKind,
  context: MonitorPageContext = {},
): string {
  const host = context.host
    ? `<strong class="font-semibold text-foreground">${escapeHtml(context.host)}</strong>`
    : 'this site';
  const back = context.reportUrl
    ? `<a class="${button({ variant: 'outline' })}" href="${escapeHtml(context.reportUrl)}">${icon('arrow-left')}Back to the report</a>`
    : `<a class="${button({ variant: 'outline' })}" href="/">${icon('arrow-left')}Back to the scanner</a>`;
  let title: string;
  let body: string;
  let state: 'subscribed' | 'cleared' | null = null;
  switch (kind) {
    case 'check_inbox':
      title = 'Check your inbox';
      body = `<p class="text-muted-foreground">If this address was not already monitoring ${host}, a confirmation email is on its way. Open the link in it to start monitoring. Nothing is sent until you do.</p>`;
      state = 'subscribed';
      break;
    case 'confirmed':
      title = 'Monitoring is on';
      body = `<p class="inline-flex items-center gap-2 font-semibold text-success">${icon('circle-check', 'size-4')}Confirmed</p><p class="text-muted-foreground">${host} is rescanned about every ${config.monitoring.intervalDays} days. You get an email only when the level, a score or a check result changes, and every email has an unsubscribe link.</p>`;
      state = 'subscribed';
      break;
    case 'unsubscribed':
      title = 'Monitoring stopped';
      body = `<p class="text-muted-foreground">You will not hear from us about ${host} again. The address is kept only to honour this choice.</p>`;
      state = 'cleared';
      break;
    case 'invalid':
      title = 'This link is not valid';
      body = `<p class="text-muted-foreground">It may have been used already or has been replaced by a newer email. Run a scan and sign up again if you want monitoring.</p>`;
      break;
    case 'disabled':
      title = 'Monitoring is not available';
      body = `<p class="text-muted-foreground">This deployment has no email provider configured.</p>`;
      break;
  }
  const stateAttributes =
    state && context.host
      ? ` data-monitor-host="${escapeHtml(context.host)}" data-monitor-state="${state}"`
      : '';
  return page(
    config,
    {
      title: `${title} · ${config.appName}`,
      ...(stateAttributes ? { scripts: [MONITOR_STATE_SCRIPT] } : {}),
    },
    `<section class="${card} max-w-[560px] space-y-3 p-6"${stateAttributes}><h1 class="text-2xl font-bold tracking-tight">${title}</h1>${body}<p class="pt-1">${back}</p></section>`,
  );
}
