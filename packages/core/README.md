# @agentic-readiness/core

The scanning engine of the [Agentic Readiness Scanner](https://github.com/MatthiasReinholz/agentic-readiness-scanner): budgeted fetcher with URL policy, target resolution, parsers, checks, runner, scoring and reporters. Web-standard APIs only, so it runs in workers, Node and tests.

```ts
import { scan, renderMarkdown } from '@agentic-readiness/core';

const result = await scan('https://example.shop', { budget: 40 });
console.log(renderMarkdown(result));
```

`@agentic-readiness/core/testing` adds Node-only helpers for recorded fixtures.

GPL-3.0-or-later.
