# @agentic-readiness/core

The scanning engine of the [Agentic Readiness Scanner](https://github.com/MatthiasReinholz/agentic-readiness-scanner). The scanner checks whether AI agents that find, compare and buy on a person's behalf can read and use an online store. It reads only public pages, runs 79 checks, and returns a readiness level from 0 to 5, two scores (agentic ingestion and agentic commerce) and a fix for every finding. To try it without code, use the [hosted scanner](https://agentic-readiness-scanner.space.fast/) or the [command line](https://www.npmjs.com/package/@agentic-readiness/cli).

This package contains the fetcher with its URL policy and request budget, the target resolver, parsers, checks, runner, scoring and reporters. The check catalog and the visual system are bundled in, so it needs nothing else from the repository. It uses only web-standard APIs (`fetch`, `Request`, `Response`), so it runs in Node 24 or later, in workers and in tests.

## Install

```bash
npm install @agentic-readiness/core
```

## Scan a store

```ts
import { scan, renderMarkdown } from '@agentic-readiness/core';

const result = await scan('https://example.com', { budget: 40 });
console.log(result.level, result.scores);
console.log(renderMarkdown(result));
```

`scan` returns the result object (schema `agentic-readiness-scanner/1`): the target with its recognised platform, the level and the checks that stand before the next one, the scores and their caps, one entry per check with verdict, evidence and fix, and the legal signals. Useful options: `budget` (maximum requests, default 40), `sampleSize` (product pages to sample), `timeoutMs` (per request), `profile` (`woocommerce-store`, `other-store` or `content-site`, detected when omitted) and `markets` (for legal signals, detected when omitted).

The reporters turn a result into other formats: `renderMarkdown`, `renderHtml` (one self-contained file), `renderJson` and `renderBadge` (SVG). The catalog is exported too, for example `catalog`, `getCheck` and `ScanResultSchema`.

## Scan in steps

Some hosts must answer each call within a fixed time. `startScan` and `continueScan` run one scan as several steps and pass a small JSON state between them:

```ts
import { startScan, continueScan } from '@agentic-readiness/core';

let step = await startScan('https://example.com', { stepDeadlineMs: 15_000 });
// store step.state (a few KiB), then in a later invocation:
while (!step.done) step = await continueScan(step.state, { stepDeadlineMs: 15_000 });
console.log(step.result.level);
```

A check cut off at the end of a step runs again in the next one, and the request budget counts across steps. `maxSteps`, `maxActiveMs` and a guard against steps that make no progress end the scan. Pass a `cache` so later steps do not fetch the same pages again.

## Offline runs and tests

`@agentic-readiness/core/testing` adds Node-only helpers: a fetcher that answers from a recorded store directory, and a harness (`mapFetcher`, `targetFor`, `runCheck`) for testing one check.

## Honest fetching

The scanner names itself on every request as `AgenticReadinessScanner/<version> (+https://github.com/MatthiasReinholz/agentic-readiness-scanner)`, obeys robots.txt for that name, never pretends to be another agent, never runs JavaScript and never signs in.

## More

- [What every check looks at](https://github.com/MatthiasReinholz/agentic-readiness-scanner/blob/main/docs/checks.md)
- [How scores and levels work](https://github.com/MatthiasReinholz/agentic-readiness-scanner/blob/main/docs/scoring.md)
- The command line and MCP server: [`@agentic-readiness/cli`](https://www.npmjs.com/package/@agentic-readiness/cli)

Licence: GPL-3.0-or-later.
