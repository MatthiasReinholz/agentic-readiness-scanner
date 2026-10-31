import { describeDiff, escapeHtml, type ResultDiff } from '@agentic-readiness/core';

import type { AppConfig } from '../config.js';
import type { MailMessage } from './types.js';

/**
 * Plain-text first; the HTML version is the same words with links and a little
 * structure. Every message carries the unsubscribe link and says who sent it and why.
 */

function wrapHtml(title: string, bodyHtml: string, footerHtml: string): string {
  return `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f6f8fc;font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f1a2e">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #dde4f0;border-radius:12px;padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${title}</h1>
${bodyHtml}
<p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #dde4f0;color:#4b5b78;font-size:13px;line-height:1.6">${footerHtml}</p>
</div></body></html>`;
}

export interface ConfirmEmailInput {
  to: string;
  host: string;
  confirmUrl: string;
}

export function confirmEmail(config: AppConfig, input: ConfirmEmailInput): MailMessage {
  const subject = `Confirm monitoring for ${input.host}`;
  const text = `You (or someone using this address) asked ${config.appName} to monitor ${input.host}.

Confirm to receive an email whenever the agentic readiness of ${input.host} changes. We rescan about every ${config.monitoring.intervalDays} days and only write when the level, a score or a check result changed.

Confirm: ${input.confirmUrl}

If you did not request this, ignore this message; nothing is stored beyond this unconfirmed request, and it is never emailed again.

${config.appName} · ${config.baseUrl}`;
  const html = wrapHtml(
    `Confirm monitoring for ${escapeHtml(input.host)}`,
    `<p>You (or someone using this address) asked ${escapeHtml(config.appName)} to monitor <strong>${escapeHtml(input.host)}</strong>.</p>
<p>Confirm to receive an email whenever the agentic readiness of ${escapeHtml(input.host)} changes. We rescan about every ${config.monitoring.intervalDays} days and only write when the level, a score or a check result changed.</p>
<p style="margin:24px 0"><a href="${escapeHtml(input.confirmUrl)}" style="display:inline-block;background:#1d6ef5;color:#fff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:10px">Confirm monitoring</a></p>
<p style="color:#4b5b78;font-size:13px">Or open this link: <a href="${escapeHtml(input.confirmUrl)}">${escapeHtml(input.confirmUrl)}</a></p>`,
    `If you did not request this, ignore this message; nothing is stored beyond this unconfirmed request, and it is never emailed again.<br>${escapeHtml(config.appName)} · <a href="${escapeHtml(config.baseUrl)}">${escapeHtml(config.baseUrl)}</a>`,
  );
  return { to: input.to, subject, text, html };
}

export interface ChangeEmailInput {
  to: string;
  host: string;
  diff: ResultDiff;
  reportUrl: string;
  unsubscribeUrl: string;
  level: { value: number; name: string };
}

export function changeEmail(config: AppConfig, input: ChangeEmailInput): MailMessage {
  const lines = describeDiff(input.diff);
  const headline = input.diff.level
    ? `Level ${input.diff.level.from} → ${input.diff.level.to}`
    : `${lines.length} change${lines.length === 1 ? '' : 's'}`;
  const subject = `${input.host}: agentic readiness changed (${headline})`;
  const text = `The agentic readiness of ${input.host} changed since the last scan you were told about.

${lines.map((line) => `- ${line}`).join('\n')}

Current standing: Level ${input.level.value} (${input.level.name}).
Full report with fixes: ${input.reportUrl}

You receive this because you confirmed monitoring for ${input.host} on ${config.appName}. Stop at any time: ${input.unsubscribeUrl}`;
  const html = wrapHtml(
    `${escapeHtml(input.host)}: agentic readiness changed`,
    `<p>The agentic readiness of <strong>${escapeHtml(input.host)}</strong> changed since the last scan you were told about.</p>
<ul style="margin:16px 0;padding-left:20px">${lines.map((line) => `<li style="margin:4px 0">${escapeHtml(line)}</li>`).join('')}</ul>
<p>Current standing: <strong>Level ${input.level.value} (${escapeHtml(input.level.name)})</strong>.</p>
<p style="margin:24px 0"><a href="${escapeHtml(input.reportUrl)}" style="display:inline-block;background:#1d6ef5;color:#fff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:10px">Open the full report</a></p>`,
    `You receive this because you confirmed monitoring for ${escapeHtml(input.host)} on ${escapeHtml(config.appName)}. <a href="${escapeHtml(input.unsubscribeUrl)}">Stop monitoring</a> at any time.`,
  );
  return { to: input.to, subject, text, html };
}
