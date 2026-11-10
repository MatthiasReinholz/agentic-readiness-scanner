# @agentic-readiness/cli

The command line and local MCP server of the [Agentic Readiness Scanner](https://github.com/MatthiasReinholz/agentic-readiness-scanner). The scanner checks whether AI agents that find, compare and buy on a person's behalf can read and use an online store. It reads only public pages, runs 80 checks, and reports a readiness level from 0 to 5, two scores (agentic ingestion and agentic commerce) and a fix for every finding. The package is self-contained and needs Node 24 or later.

## Scan a store

```bash
npx @agentic-readiness/cli scan https://example.com
```

```bash
npx @agentic-readiness/cli scan https://example.com --format json --output report.json
```

| Option             | Meaning                                                   | Default  |
| ------------------ | --------------------------------------------------------- | -------- |
| `--format <fmt>`   | `md`, `json`, `html` or `badge`                           | `md`     |
| `--profile <id>`   | `woocommerce-store`, `other-store` or `content-site`      | detected |
| `--budget <n>`     | Maximum requests per scan                                 | 40       |
| `--sample <n>`     | Product pages to sample                                   | 2        |
| `--timeout <ms>`   | Timeout per request in milliseconds                       | 10000    |
| `--markets <list>` | Markets for legal signals, for example `eu,uk,us`         | detected |
| `--fixture <dir>`  | Answer from a recorded store directory instead of the web | none     |
| `--output <file>`  | Write the report to a file instead of printing it         | stdout   |

The report names the recognised platform, the level and the checks that stand before the next one, the two scores and any cap on them, and what to fix first. Each fix has a summary, an optional snippet and a brief you can hand to a coding agent. Legal signals are added to the Markdown and HTML reports and included in JSON. They are never scored and are not legal advice.

## Other commands

- `diff <a> <b>` compares two saved JSON reports and exits with code 3 when something changed (`--format text|json`, default `text`). Use it in a pipeline to catch regressions.
- `mcp` runs the MCP server over stdio.
- `catalog` prints the check catalog.
- `version` prints the scanner version.
- `help` prints the full usage.

Install it globally (`npm install -g @agentic-readiness/cli`) to call it as `agentic-readiness`.

## Use it from an AI assistant

MCP (Model Context Protocol) lets AI assistants call tools. Add an MCP server to Claude Code, Cursor, Claude Desktop or any other MCP client with this command:

```bash
npx -y @agentic-readiness/cli mcp
```

It offers three tools: `scan_store(url, profile?, format?)` (format `json` or `markdown`), `get_fix(check_id, platform?)` and `list_checks()`.

## How it fetches

The scanner names itself on every request as `AgenticReadinessScanner/<version>`, obeys robots.txt for that name, never pretends to be another agent, never runs JavaScript and never signs in.

## More

- [What every check looks at](https://github.com/MatthiasReinholz/agentic-readiness-scanner/blob/main/docs/checks.md)
- [How scores and levels work](https://github.com/MatthiasReinholz/agentic-readiness-scanner/blob/main/docs/scoring.md)
- The hosted scanner: <https://agentic-readiness-scanner.space.fast/>
- The engine as a library: [`@agentic-readiness/core`](https://www.npmjs.com/package/@agentic-readiness/core)

Licence: GPL-3.0-or-later.
