import { scan } from '@agentic-readiness/core';
import { createMcpServer } from '@agentic-readiness/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export async function runMcp(): Promise<number> {
  const server = createMcpServer({
    scanner: (url, profile) => scan(url, profile !== undefined ? { profile } : {}),
  });
  await server.connect(new StdioServerTransport());
  // Keep the process alive until the transport closes.
  await new Promise<void>((resolve) => {
    server.server.onclose = () => {
      resolve();
    };
  });
  return 0;
}
