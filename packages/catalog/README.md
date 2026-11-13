# @agentic-readiness/catalog

> Private workspace package, not published to npm. It is bundled into [`@agentic-readiness/core`](../core/README.md), which re-exports everything below, and into [`@agentic-readiness/cli`](../cli/README.md).

The check catalog of the [Agentic Readiness Scanner](https://github.com/MatthiasReinholz/agentic-readiness-scanner) as data: check definitions, sections, levels, profiles, score ceilings, fixes, knowledge-base articles, the law registry for legal signals and the versioned scan result schema (`agentic-readiness-scanner/1`).

```ts
import { catalog, getCheck, ScanResultSchema } from '@agentic-readiness/core';
```

| Path                                                           | Holds                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `data/checks/<section>.json`                                   | the 87 readiness checks in 9 sections (A1 to B5)                           |
| `data/legal/`                                                  | the 24 legal-signal checks (C1 to C6), their sections and the law registry |
| `data/levels.json`, `data/profiles.json`, `data/ceilings.json` | levels and their gates, profiles, score caps                               |
| `data/meta.json`                                               | the catalog version and the scoring version                                |
| `fixes/<id>.md`                                                | one fix per check: summary, optional snippet, agent prompt, platform notes |
| `knowledge/<id>.md`, `knowledge/guides/`                       | knowledge-base articles and guides                                         |
| `src/result.ts`                                                | the result contract                                                        |

`pnpm --filter @agentic-readiness/catalog validate` checks all of it. `src/generated` is written by the build, so do not edit it. Non-JavaScript consumers can read `catalog.json` and the JSON Schemas (`scan-result.schema.json`, `catalog.schema.json`), which every GitHub release carries as assets. The human-readable table is [docs/checks.md](../../docs/checks.md).

Licence: GPL-3.0-or-later.
