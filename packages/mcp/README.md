# @agentic-readiness/mcp

> Private workspace package, not published to npm. It is bundled into [`@agentic-readiness/cli`](../cli/README.md), whose `mcp` command runs it over stdio. The hosted scanner serves it over Streamable HTTP at `/mcp`.

The MCP server definition of the [Agentic Readiness Scanner](https://github.com/MatthiasReinholz/agentic-readiness-scanner). MCP (Model Context Protocol) lets AI assistants call tools. One definition serves both transports.

| Tool                                 | Returns                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `scan_store(url, profile?, format?)` | the result object (`json`, the default) or the Markdown report (`markdown`)     |
| `get_fix(check_id, platform?)`       | the fix, its specs and the brief for a coding agent, with platform advice       |
| `list_checks()`                      | every check with its section, weight and dependencies, plus levels and profiles |
| `get_history(host)`                  | the recorded states of a host (only when the host passes `history`)             |
| `explain_check(check_id)`            | the knowledge-base article (only when the host passes `explain`)                |

The CLI registers the first three. The hosted scanner also passes `history` and `explain`.

```ts
import { createMcpServer } from '@agentic-readiness/mcp';
import { scan } from '@agentic-readiness/core';

const server = createMcpServer({ scanner: (url, profile) => scan(url, { profile }) });
```

Connect the server to any transport from the MCP SDK.

Licence: GPL-3.0-or-later.
