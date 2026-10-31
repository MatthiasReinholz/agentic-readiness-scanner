import { escapeHtml } from '@agentic-readiness/core';

import type { AppConfig } from '../config.js';
import type { StoredScan } from '../store/types.js';
import { page } from './layout.js';

export const MONITOR_CSS = `
.monitor{margin-top:24px;display:grid;gap:18px;grid-template-columns:1fr}
@media (min-width:720px){.monitor{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:center}}
.monitor h2{display:flex;align-items:center;gap:10px}
.monitor p{margin-top:6px;color:var(--fg-muted);font-size:.95rem}
.monitor-form{display:grid;gap:10px;grid-template-columns:minmax(0,1fr) auto}
.monitor-form .consent{grid-column:1/-1;font-size:.82rem;color:var(--fg-faint);line-height:1.5}
.monitor-form .consent a{color:var(--fg-muted)}
dialog.monitor-dialog{border:1px solid var(--line-strong);border-radius:16px;background:var(--bg-raised);color:var(--fg);padding:0;max-width:min(520px,calc(100vw - 32px));box-shadow:0 24px 64px rgba(0,0,0,.45)}
dialog.monitor-dialog::backdrop{background:rgba(5,10,20,.6);backdrop-filter:blur(2px)}
dialog.monitor-dialog .inner{padding:24px}
dialog.monitor-dialog .monitor{margin-top:0;grid-template-columns:1fr}
dialog.monitor-dialog .close{position:absolute;top:12px;right:12px}
.monitor-ok{display:inline-flex;align-items:center;gap:8px;color:var(--pass);font-weight:650}
`;

function form(scan: StoredScan, idPrefix: string, autofocus: boolean): string {
  return `<form method="post" action="/monitor" class="monitor-form" data-monitor-form>
<input type="hidden" name="scan_id" value="${escapeHtml(scan.id)}">
<label class="sr-only" for="${idPrefix}-email" style="position:absolute;left:-9999px">Email address</label>
<input class="field" id="${idPrefix}-email" type="email" name="email" placeholder="you@example.com" required autocomplete="email" inputmode="email" ${autofocus ? 'autofocus' : ''}>
<button type="submit" class="btn">Monitor this site</button>
<p class="consent">Double opt-in: we send one confirmation email first. Afterwards we rescan about weekly and only write when something changed. One-click unsubscribe in every email. Nothing else is done with the address.</p>
</form>`;
}

/** The signup block shown between the scores and the sections of a report. */
export function monitorPanel(config: AppConfig, scan: StoredScan): string {
  return `<section class="card monitor" id="monitor" aria-labelledby="monitor-title">
<div><h2 id="monitor-title"><span class="pill pill-accent">New</span>Get told when this changes</h2>
<p>${escapeHtml(config.appName)} can rescan <strong>${escapeHtml(scan.host)}</strong> every ${config.monitoring.intervalDays} days and email you when the level, a score or any check result changes. Useful after a theme update, a plugin change or a platform release.</p></div>
${form(scan, 'monitor', false)}
</section>`;
}

/** The same offer as a dialog, opened by script after a delay unless the visitor already acted. */
export function monitorDialog(config: AppConfig, scan: StoredScan): string {
  return `<dialog class="monitor-dialog" id="monitor-dialog" aria-labelledby="monitor-dialog-title">
<div class="inner">
<form method="dialog"><button class="btn btn-ghost btn-sm close" value="dismiss" aria-label="Close">✕</button></form>
<section class="monitor">
<div><h2 id="monitor-dialog-title">Want to know when ${escapeHtml(scan.host)} changes?</h2>
<p>${escapeHtml(config.appName)} rescans every ${config.monitoring.intervalDays} days and emails you only when the level, a score or a check result moved.</p></div>
${form(scan, 'monitor-dialog', true)}
</section>
</div>
</dialog>`;
}

/**
 * Opens the dialog after `delayMs` unless the visitor subscribed to this host before,
 * dismissed the dialog in the last 30 days, or is already using the inline form. Both
 * forms mark the host as subscribed on submit so no second offer follows.
 */
export function monitorScript(host: string, delayMs = 10_000): string {
  const key = JSON.stringify(`ars-monitor:${host}`);
  return `(function(){var K=${key};var d=document.getElementById('monitor-dialog');if(!d||typeof d.showModal!=='function')return;var get=function(){try{return JSON.parse(localStorage.getItem(K)||'null')}catch(e){return null}};var set=function(v){try{localStorage.setItem(K,JSON.stringify(v))}catch(e){}};var busy=false;document.querySelectorAll('[data-monitor-form]').forEach(function(f){f.addEventListener('focusin',function(){busy=true});f.addEventListener('submit',function(){set({state:'subscribed',at:Date.now()})})});d.addEventListener('close',function(){if(d.returnValue==='dismiss'||d.returnValue===''){set({state:'dismissed',at:Date.now()})}});var s=get();if(s&&s.state==='subscribed')return;if(s&&s.state==='dismissed'&&Date.now()-s.at<30*86400000)return;setTimeout(function(){if(busy||document.hidden||d.open)return;var again=get();if(again&&again.state==='subscribed')return;d.showModal()},${delayMs})})();`;
}

export type MonitorPageKind = 'check_inbox' | 'confirmed' | 'unsubscribed' | 'invalid' | 'disabled';

export interface MonitorPageContext {
  host?: string;
  reportUrl?: string;
  unsubscribeUrl?: string;
}

export function monitorPage(
  config: AppConfig,
  kind: MonitorPageKind,
  context: MonitorPageContext = {},
): string {
  const host = context.host ? `<strong>${escapeHtml(context.host)}</strong>` : 'this site';
  const back = context.reportUrl
    ? `<a class="btn btn-ghost" href="${escapeHtml(context.reportUrl)}">Back to the report</a>`
    : `<a class="btn btn-ghost" href="/">Back to the scanner</a>`;
  let title: string;
  let body: string;
  let script = '';
  switch (kind) {
    case 'check_inbox':
      title = 'Check your inbox';
      body = `<p class="muted">If this address was not already monitoring ${host}, a confirmation email is on its way. Open the link in it to start monitoring. Nothing is sent until you do.</p>`;
      if (context.host) {
        script = `try{localStorage.setItem(${JSON.stringify(`ars-monitor:${context.host}`)},JSON.stringify({state:'subscribed',at:Date.now()}))}catch(e){}`;
      }
      break;
    case 'confirmed':
      title = 'Monitoring is on';
      body = `<p class="monitor-ok">✓ Confirmed</p><p class="muted" style="margin-top:10px">${host} is rescanned about every ${config.monitoring.intervalDays} days. You get an email only when the level, a score or a check result changes, and every email has an unsubscribe link.</p>`;
      if (context.host) {
        script = `try{localStorage.setItem(${JSON.stringify(`ars-monitor:${context.host}`)},JSON.stringify({state:'subscribed',at:Date.now()}))}catch(e){}`;
      }
      break;
    case 'unsubscribed':
      title = 'Monitoring stopped';
      body = `<p class="muted">You will not hear from us about ${host} again. The address is kept only to honour this choice.</p>`;
      if (context.host) {
        script = `try{localStorage.removeItem(${JSON.stringify(`ars-monitor:${context.host}`)})}catch(e){}`;
      }
      break;
    case 'invalid':
      title = 'This link is not valid';
      body = `<p class="muted">It may have been used already or has been replaced by a newer email. Run a scan and sign up again if you want monitoring.</p>`;
      break;
    case 'disabled':
      title = 'Monitoring is not available';
      body = `<p class="muted">This deployment has no email provider configured.</p>`;
      break;
  }
  return page(
    config,
    { title: `${title} · ${config.appName}`, ...(script ? { scripts: [script] } : {}) },
    `<section class="card stack" style="max-width:560px"><h1 style="font-size:1.5rem">${title}</h1>${body}<p style="margin-top:8px">${back}</p></section>`,
  );
}
