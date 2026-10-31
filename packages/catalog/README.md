# @agentic-readiness/catalog

The check catalog of the [Agentic Readiness Scanner](https://github.com/MatthiasReinholz/agentic-readiness-scanner) as data: check definitions, groups, levels, profiles, fixes in three forms, and the versioned scan result schema.

```ts
import { catalog, getCheck, ScanResultSchema } from '@agentic-readiness/catalog';
```

Non-JavaScript consumers read `catalog.json` and the JSON Schemas under `schema/` from the package or from a GitHub release. The human-readable table is [docs/checks.md](https://github.com/MatthiasReinholz/agentic-readiness-scanner/blob/main/docs/checks.md).

GPL-3.0-or-later.
