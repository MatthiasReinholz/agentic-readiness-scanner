/**
 * The MCP surface of the scanner. One definition, two transports: the CLI connects it
 * to stdio, the hosted app to Streamable HTTP. Tools return the same result object the
 * JSON report uses, so an agent gets the full contract, not a summary.
 */
import { catalog, getCheck, type ScanResult } from '@agentic-readiness/catalog';
import { renderMarkdown, SCANNER_VERSION } from '@agentic-readiness/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export type Scanner = (url: string, profile?: string) => Promise<ScanResult>;

export interface McpServerOptions {
  scanner: Scanner;
  name?: string;
  version?: string;
}

const PROFILE_IDS = catalog.profiles.map((profile) => profile.id);

export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer({
    name: options.name ?? 'agentic-readiness-scanner',
    version: options.version ?? SCANNER_VERSION,
  });

  server.registerTool(
    'scan_store',
    {
      title: 'Scan a store for agentic readiness',
      description:
        'Scans a public store URL for agentic ingestion and agentic commerce readiness. Returns the versioned result object: level, scores, one entry per check with verdict, evidence and fix. Public signals only; no credentials.',
      inputSchema: {
        url: z.string().min(1).describe('Store URL or hostname, e.g. https://example.shop'),
        profile: z
          .enum(PROFILE_IDS as [string, ...string[]])
          .optional()
          .describe('Override the detected profile'),
        format: z
          .enum(['json', 'markdown'])
          .optional()
          .describe('json (default) returns the result object; markdown returns the report'),
      },
    },
    async ({ url, profile, format }) => {
      const result = await options.scanner(url, profile);
      const text = format === 'markdown' ? renderMarkdown(result) : JSON.stringify(result);
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'get_fix',
    {
      title: 'Get the fix for a check',
      description:
        'Returns the fix for a check id in all three forms: summary, snippet and a prompt for a coding agent, plus the specs the check is grounded in.',
      inputSchema: {
        check_id: z
          .string()
          .regex(/^[AB][1-5]\.\d{1,2}$/)
          .describe('Check id, e.g. B3.1'),
      },
    },
    ({ check_id }) => {
      const check = getCheck(check_id);
      if (!check) {
        return { content: [{ type: 'text', text: `Unknown check ${check_id}` }], isError: true };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: check.id,
              title: check.title,
              question: check.question,
              method: check.method,
              weight: check.weight,
              spec: check.spec,
              fix: check.fix,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_checks',
    {
      title: 'List the check catalog',
      description:
        'Lists every check with id, title, group, weight and dependencies, plus the levels and profiles.',
      inputSchema: {},
    },
    () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            catalog_version: catalog.version,
            scoring_version: catalog.scoring_version,
            groups: catalog.groups,
            levels: catalog.levels,
            profiles: catalog.profiles,
            checks: catalog.checks.map(
              ({ id, group, title, question, weight, requires, depends_on }) => ({
                id,
                group,
                title,
                question,
                weight,
                requires,
                depends_on,
              }),
            ),
          }),
        },
      ],
    }),
  );

  return server;
}
