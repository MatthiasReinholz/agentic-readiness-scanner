# @agentic-readiness/mcp

> Not published to npm yet; consume it through the pnpm workspace of this repository. The package name is reserved for the first npm release.

The MCP server definition of the [Agentic Readiness Scanner](https://github.com/MatthiasReinholz/agentic-readiness-scanner): tools `scan_store`, `get_fix` and `list_checks`. Connect it to any transport from the MCP SDK.

```ts
import { createMcpServer } from '@agentic-readiness/mcp';
import { scan } from '@agentic-readiness/core';

const server = createMcpServer({ scanner: (url, profile) => scan(url, { profile }) });
```

GPL-3.0-or-later.
