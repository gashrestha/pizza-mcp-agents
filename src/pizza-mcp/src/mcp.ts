import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { tools } from './tools.js';

export function getMcpServer() {
  const server = new McpServer({
    name: 'pizza-mcp',
    description:
      'Pizza tools to interact with the pizza API. Use these tools whenever you need information about pizzas, toppings, and orders. You can also use them to place new pizza orders and manage existing orders.',
    version: '1.0.0',
  });
  for (const tool of tools as any[]) {
    createMcpTool(server, tool);
  }
  return server;
}

// Helper that wraps MCP tool creation
// It handles arguments typing, error handling and response formatting
export function createMcpTool<S extends z.ZodRawShape>(
  server: McpServer,
  options: {
    name: string;
    description: string;
    schema?: z.ZodObject<S>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (args: any) => Promise<string>;
  },
) {
  if (!options.schema) {
    server.tool(options.name, options.description, async () => {
      try {
        const result = await options.handler(undefined as any);
        return {
          content: [{ type: 'text' as const, text: result }],
        };
      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error executing MCP tool:', errorMessage);
        return {
          content: [{ type: 'text' as const, text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    });
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.tool(options.name, options.description, (options.schema as any).shape, async (args: any) => {
      try {
        const result = await options.handler(args);
        return {
          content: [{ type: 'text' as const, text: result }],
        };
      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error executing MCP tool:', errorMessage);
        return {
          content: [{ type: 'text' as const, text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    });
  }
}
