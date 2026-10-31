# @agentic-readiness/core

> Not published to npm yet; consume it through the pnpm workspace of this repository. The package name is reserved for the first npm release.

The scanning engine of the [Agentic Readiness Scanner](https://github.com/MatthiasReinholz/agentic-readiness-scanner): budgeted fetcher with URL policy, target resolution, parsers, checks, runner, scoring and reporters. Web-standard APIs only, so it runs in workers, Node and tests.

```ts
import { scan, renderMarkdown } from '@agentic-readiness/core';

const result = await scan('https://example.com', { budget: 40 });
console.log(renderMarkdown(result));
```

`@agentic-readiness/core/testing` adds Node-only helpers for recorded fixtures.

GPL-3.0-or-later.
