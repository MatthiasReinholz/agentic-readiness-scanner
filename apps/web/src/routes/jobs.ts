import { escapeHtml } from '@agentic-readiness/core';
import { Hono, type Context } from 'hono';

import type { AppConfig } from '../config.js';
import { JOB_ID } from '../jobs/types.js';
import { disposableReport } from '../pages/disposable-report.js';
import { homePage } from '../pages/home.js';
import { page } from '../pages/layout.js';
import { siteProfilePath } from '../scan-scope.js';
import {
  advanceJob,
  donePayload,
  jobsFor,
  pendingOutcome,
  ScanRequestError,
  type FinishedOutcome,
  type PendingOutcome,
  type ScanDependencies,
  type ScanOutcome,
} from '../scan-service.js';

/**
 * The second trigger after the page: when a step paused, the app asks itself for the
 * next one in a request of its own, so a scan carries on with no page open. Best effort:
 * where the platform gives no way to outlive the response, the page and the sweeper cron
 * carry the scan instead, and a step someone else is running is never run twice.
 */
export function continueInBackground(c: Context, config: AppConfig, outcome: ScanOutcome): void {
  if (outcome.persistence !== 'pending' || outcome.busy) return;
  let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
  try {
    const ctx = c.executionCtx;
    waitUntil = ctx.waitUntil.bind(ctx);
  } catch {
    return;
  }
  const next = fetch(`${config.baseUrl}/api/scan/jobs/${outcome.job.id}/continue`, {
    method: 'POST',
    headers: { 'x-scan-chain': '1' },
  })
    .then((response) => response.body?.cancel())
    .catch(() => undefined);
  waitUntil(next);
}

/** The JSON a scan request answers with, finished or pending. */
export function outcomeJson(config: AppConfig, outcome: ScanOutcome): Record<string, unknown> {
  if (outcome.persistence === 'disposable')
    return { persistence: 'disposable', reused: false, result: outcome.result };
  if (outcome.persistence === 'stored') {
    const { scan: stored, reused } = outcome;
    return {
      persistence: 'stored',
      id: stored.id,
      profile_id: stored.host,
      profile_url: `${config.baseUrl}${siteProfilePath(stored.host)}`,
      snapshot_url: `${config.baseUrl}/r/${stored.id}`,
      reused,
      report_url: `${config.baseUrl}${siteProfilePath(stored.host)}`,
      result: stored.result,
    };
  }
  const { job } = outcome;
  return {
    persistence: 'pending',
    status: 'running',
    job_id: job.id,
    host: job.host,
    reused: outcome.reused,
    busy: outcome.busy,
    steps: job.state?.steps ?? 0,
    decided: outcome.decided,
    total: outcome.total,
    status_url: `${config.baseUrl}/api/scan/jobs/${job.id}`,
    continue_url: `${config.baseUrl}/api/scan/jobs/${job.id}/continue`,
    ...(job.persistent ? { profile_url: `${config.baseUrl}${siteProfilePath(job.host)}` } : {}),
  };
}

/** A job poll's answer: status plus, once done, what the page needs to open the report. */
function jobStatusJson(config: AppConfig, outcome: ScanOutcome): Record<string, unknown> {
  if (outcome.persistence === 'pending') return outcomeJson(config, outcome);
  const finished: FinishedOutcome = outcome;
  return {
    status: 'done',
    ...outcomeJson(config, finished),
    ...(finished.persistence === 'stored' ? { done: donePayload(finished) } : {}),
  };
}

function waitingPage(config: AppConfig, outcome: PendingOutcome) {
  const { job } = outcome;
  // The page drives the scan while it is open; without JavaScript it reloads and the
  // app and the sweeper cron advance the scan in between. The script is constant: it
  // reads the job id from its own URL.
  const script = `(function(){var id=location.pathname.split('/').pop();function go(){fetch('/api/scan/jobs/'+id+'/continue',{method:'POST',cache:'no-store'}).then(function(r){return r.json()}).then(function(j){if(j.status==='running'){var el=document.getElementById('job-progress');if(el)el.textContent=Math.round(100*j.decided/Math.max(1,j.total))+'% of the checks decided';setTimeout(go,j.busy?3000:300)}else location.reload()}).catch(function(){setTimeout(go,3000)})}go()})();`;
  return page(
    config,
    {
      title: `Scanning ${job.host}`,
      head: '<meta http-equiv="refresh" content="10"><meta name="robots" content="noindex">',
      hero: `<p class="hero-eyebrow">Agentic readiness</p><h1 class="hero-title">Scanning ${escapeHtml(job.host)}</h1>`,
      scripts: [script],
    },
    `<section class="space-y-3"><p aria-live="polite"><span id="job-progress">${String(Math.round((100 * outcome.decided) / Math.max(1, outcome.total)))}% of the checks decided</span>. This scan runs in steps; the page opens the report when it is done.</p></section>`,
  );
}

/** Scans in progress: their status, the next step, and the page the form lands on. */
export function createJobRoutes(deps: ScanDependencies): Hono {
  const { config } = deps;
  const app = new Hono();

  const respondError = (c: Context, error: unknown) => {
    if (error instanceof ScanRequestError)
      return c.json({ status: 'failed', error: error.message }, error.status as 400 | 404 | 500);
    console.error('[scan-job]', error instanceof Error ? error.name : 'UnexpectedError');
    return c.json({ status: 'failed', error: 'The scan step failed. It is retried shortly.' }, 500);
  };

  app.get('/api/scan/jobs/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    const id = c.req.param('id');
    if (!JOB_ID.test(id)) return c.notFound();
    const job = await jobsFor(deps).get(id);
    if (!job) return c.json({ status: 'failed', error: 'This scan is not known.' }, 404);
    if (job.status === 'failed') return c.json({ status: 'failed', error: job.error }, 200);
    if (job.status === 'running') {
      return c.json(outcomeJson(config, pendingOutcome(job)));
    }
    try {
      return c.json(
        jobStatusJson(config, await advanceJob(deps, id, undefined, { deliver: true })),
      );
    } catch (error) {
      return respondError(c, error);
    }
  });

  // Runs the next step when nobody else is: the page, the app itself and the cron call it.
  // A one-time result stays for the request that shows it (the waiting page reloads).
  app.post('/api/scan/jobs/:id/continue', async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    const id = c.req.param('id');
    if (!JOB_ID.test(id)) return c.notFound();
    try {
      const outcome = await advanceJob(deps, id);
      continueInBackground(c, config, outcome);
      return c.json(jobStatusJson(config, outcome));
    } catch (error) {
      return respondError(c, error);
    }
  });

  app.get('/scan/jobs/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    const id = c.req.param('id');
    if (!JOB_ID.test(id)) return c.notFound();
    const job = await jobsFor(deps).get(id);
    if (!job) return c.html(homePage(config, 'This scan is not known. It may have expired.'), 404);
    if (job.status !== 'running') {
      try {
        const outcome = await advanceJob(deps, id, undefined, { deliver: true });
        if (outcome.persistence === 'disposable')
          return c.html(disposableReport(config, outcome.result));
        return c.redirect(siteProfilePath(job.host), 303);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The scan failed.';
        return c.html(homePage(config, message), 200);
      }
    }
    return c.html(waitingPage(config, pendingOutcome(job)));
  });

  return app;
}
