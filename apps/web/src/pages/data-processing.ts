/**
 * /data-processing: how scans behave and what the hosted app stores, with a short
 * privacy policy. The facts come from the configuration and the code (budgets, limits,
 * retention, browser storage), so the page cannot drift from what the app does. The
 * content is Markdown rendered with the knowledge base's renderer, so the page and its
 * .md twin say the same thing.
 */
import { THEME_STORAGE_KEY } from '@agentic-readiness/core';
import { panel } from '@agentic-readiness/ui';

import type { AppConfig } from '../config.js';
import { markdownToHtml } from '../knowledge/markdown.js';
import { AUTHOR, jsonLd, metadataHead, siteGraph, webPage } from '../metadata.js';
import { page } from './layout.js';

export const DATA_PROCESSING_PATH = '/data-processing';
/** When the facts below were last checked against the code. */
export const DATA_PROCESSING_UPDATED = '2026-11-03';

const TITLE = 'Data processing and privacy';
const DESCRIPTION =
  'What a scan fetches, what the Agentic Readiness Scanner stores and for how long, and the short privacy policy: no cookies, no tracking, public pages only.';

/** "minute", "5 minutes", "hour": reads after "every". */
function every(seconds: number): string {
  if (seconds === 3600) return 'hour';
  if (seconds === 60) return 'minute';
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

const MAIL_PROVIDERS: Record<string, string> = { brevo: 'Brevo', resend: 'Resend' };

/** The few facts that matter most, in plain words, for the box at the top. */
function summary(config: AppConfig): string {
  const monitoring = config.monitoring.provider !== null;
  return [
    '- **Public pages only.** A scan reads what any visitor of a store can see. It never signs in, never fills in a form and never buys anything.',
    `- **It says who it is.** Every request carries the user agent \`AgenticReadinessScanner\` and follows the store's robots.txt. At most ${config.scanBudget} requests per scan, and one new scan per site every ${every(config.targetCooldownSeconds)}.`,
    `- **Root URLs become public profiles.** Scanning \`https://example.com/\` publishes its report at \`/sites/example.com\`, kept ${config.retentionDays} days. A short history of each site's results is kept without an end date.`,
    '- **Scans of a path or query are not saved.** Their result goes to you only. While such a scan runs in steps, the server keeps its progress until the result reaches you, two hours at most.',
    '- **No cookies, no tracking.** No analytics, no ads, no third-party scripts or fonts. We do not see or store your IP address, and we do not record who started a scan.',
    monitoring
      ? '- **Your email only if you ask for it.** Monitoring stores your address to email you when a site changes, after you confirm it. Every email has an unsubscribe link.'
      : '- **No personal data about you.** There are no accounts and no forms that ask for it.',
  ].join('\n');
}

/** Everything else, in detail. */
function details(config: AppConfig): string {
  const { monitoring } = config;
  const mail = monitoring.provider ? MAIL_PROVIDERS[monitoring.provider] : undefined;
  const stepSeconds = Math.round(config.scanStepMs / 1000);
  const activeMinutes = Math.round(config.scanMaxActiveMs / 60_000);
  const monitoringRow =
    monitoring.provider !== null
      ? `\n| Monitoring subscription | Your email address, the site, when it was confirmed and last checked, and the tokens in its links (stored only as SHA-256 hashes) | Until you unsubscribe; unconfirmed requests 48 hours |`
      : '';
  const monitoringSection =
    monitoring.provider !== null
      ? `
## Monitoring emails

Monitoring is optional. You enter your email address on a site's report and confirm it through the link we send. Nothing else is ever sent before you confirm.

- The site is scanned again every ${monitoring.intervalDays} days. You get an email only when its result changed.
- Every email has a link that ends the subscription at once.
- We store your address with the site you follow. The tokens in the links are stored only as SHA-256 hashes, so a copy of the database cannot be used to unsubscribe you or anyone else.
- The legal basis is your consent (Art. 6(1)(a) GDPR). Unsubscribing withdraws it.
${mail ? `- Emails are sent through ${mail}, which processes your address for that purpose only.\n` : ''}`
      : '';
  return `## Who runs this service

The Agentic Readiness Scanner is an experiment by [${AUTHOR.name}](${AUTHOR.url}). You can reach him through that page for any question about this page, a request about your data, or a site profile. The source code is public at [${config.repositoryUrl.replace(/^https:\/\//, '')}](${config.repositoryUrl}), so anyone can check what the scanner does.

## What a scan fetches

A scan starts from the URL you enter and reads public resources of that store: the home page, robots.txt, the sitemaps, a few product pages it picks, the pages behind policy links (returns, shipping, privacy, terms, contact, imprint), files under \`/.well-known/\`, \`/llms.txt\`, and public store APIs and feeds where the platform offers them.

- Every request carries the user agent \`AgenticReadinessScanner\` with a link to the source code. The scanner never pretends to be a browser or another crawler.
- It reads robots.txt right after the home page and fetches nothing that robots.txt disallows for its user agent.
- Requests go one after another, with a pause between them that grows when a store answers 429 Too Many Requests.
- A scan sends at most ${config.scanBudget} requests, redirects and retries included. On this site it runs in steps of up to ${stepSeconds} seconds, at most ${config.scanMaxSteps} steps and ${activeMinutes} minutes of active scanning.
- It never signs in, submits a form, adds to a cart, starts a checkout or pays.

A store that refuses these honest requests is reported as refusing them; the guide [Why the scanner reports crawler blocks](/knowledge-base/guides/crawler-blocks-and-browser-scans) explains why.

## Limits

- One new scan per site every ${every(config.targetCooldownSeconds)}, across every path and every way in (this page, the API and the MCP server). Inside that window the stored result is shown instead. A scan that failed counts too.
- A site's root URL (\`https://example.com/\`) creates or updates its public profile. A URL with a path or query (\`https://example.com/shop?x=1\`) runs once and is not saved.

## What is stored, and for how long

What the hosted app stores is about stores, which are businesses' public websites. It does not store who asked for a scan.

| Data | What it holds | Kept for |
| --- | --- | --- |
| Site report | The result of a root-URL scan: level, scores, a verdict per check and the evidence behind it (URLs and short excerpts of the store's public pages) | ${config.retentionDays} days |
| Report snapshots | The same result under a fixed link, \`/r/<id>\` | ${config.retentionDays} days |
| Site history | One row per distinct result of a site: level, scores and the verdict of each check, shown at \`/h/<site>\` | No end date |
| List of scanned sites | Site name, first and last scan, number of scans, last level, scores, platform and profile | No end date |
| Scan reservation | The site and the time of its last scan, for the limit above | One day |
| Scan in progress | The scan's state between steps and compressed copies of the public pages it fetched | Copies until the scan ends, two hours at most; the record one day after the end |
| Progress for the scan page | The list of steps and verdicts the page shows while a scan runs | One hour |
| Scans of a path or query | Their state and result while they run | Until the result reaches you, two hours at most |${monitoringRow}
${monitoringSection}
## What we do not collect

- No cookies. No accounts.
- No analytics, tracking pixels, ads or fingerprinting.
- No third-party scripts, fonts or embeds. The fonts are served from this site.
- No IP addresses: the hosting platform does not pass visitors' addresses to the app, and the app stores none. The platform may keep technical logs to run the service.

## Storage in your browser

Three small entries stay in your browser and are never sent to us. Clearing your browser's site data removes them.

- \`${THEME_STORAGE_KEY}\` in local storage: your light or dark theme, when you chose one.
- \`ars-monitor:<site>\` in local storage: whether you closed or used the monitoring prompt on a report, and when. Not your email address.
- \`ars-arrived\` in session storage: lets a report play its completion animation once after a scan, and is gone when you close the tab.

## Hosting

The app and its database run on [Spacefast](https://spacefast.com/), which processes requests and stores the data above on our behalf.

## For store owners

- A profile shows only what the store's public pages show to an honest automated client.
- To keep the scanner out, disallow its user agent in robots.txt (\`User-agent: AgenticReadinessScanner\` with \`Disallow: /\`). Scans then read only the home page and robots.txt, and report that the rest is disallowed.
- To have a profile removed, ask through the contact above.

## Your rights

Under the GDPR and similar laws you can ask which personal data we hold about you, have it corrected or deleted, and object to its processing. We process scan data on the basis of our legitimate interest in running a public technical scanner of public websites (Art. 6(1)(f) GDPR). You can also complain to a data protection supervisory authority.

## Changes

This page was last checked against the code on ${DATA_PROCESSING_UPDATED}. Changes to how the scanner works are recorded in the public repository.
`;
}

export function dataProcessingMarkdown(config: AppConfig): string {
  return `# ${TITLE}

> ${DESCRIPTION}

## The short version

${summary(config)}

${details(config).replace(/\]\(\/(?!\/)/g, `](${config.baseUrl}/`)}
Source: ${config.baseUrl}${DATA_PROCESSING_PATH}
`;
}

export function dataProcessingPage(config: AppConfig): string {
  const hero = `<p class="hero-eyebrow">${config.appName}</p><h1 class="hero-title">${TITLE}</h1><p class="hero-description">What a scan does, what we keep and for how long. The short version comes first.</p>`;
  const short = markdownToHtml(summary(config)).html;
  const body = `
<section class="${panel} border-primary/40" aria-labelledby="short-version"><h2 id="short-version" class="text-lg font-semibold tracking-tight">The short version</h2>${short}</section>
<article class="mt-4 max-w-[72ch]">${markdownToHtml(details(config)).html}</article>
${jsonLd({
  '@context': 'https://schema.org',
  '@graph': [
    {
      ...webPage(config, DATA_PROCESSING_PATH, TITLE, DESCRIPTION, 'home'),
      dateModified: DATA_PROCESSING_UPDATED,
    },
    ...siteGraph(config, 'home'),
  ],
})}`;
  return page(
    config,
    {
      title: `${TITLE} · ${config.appName}`,
      description: DESCRIPTION,
      hero,
      head: `${metadataHead(config, { path: DATA_PROCESSING_PATH, title: TITLE, description: DESCRIPTION, image: 'home' })}\n<link rel="alternate" type="text/markdown" href="${config.baseUrl}${DATA_PROCESSING_PATH}.md" title="Markdown">`,
    },
    body,
  );
}
