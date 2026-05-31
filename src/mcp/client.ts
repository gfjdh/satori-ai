/**
 * MCP 客户端管理器
 *
 * 连接 MCP 服务器，动态发现工具并注册到 ToolRegistry。
 * 启动时自动执行，工具注册后 LLM 通过 OpenAI function calling 可直接调用。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { toolRegistry } from '../agent/tool-registry.js';
import { logDb, now } from '../db/database.js';
import { loadMcpConfig, type McpServerConfig } from './config.js';
import type { ToolDef } from '../types/index.js';

interface McpConnection {
  serverName: string;
  client: Client;
  transport: StdioClientTransport;
  registeredTools: string[];
}

class McpClientManager {
  private connections = new Map<string, McpConnection>();

  async start(): Promise<void> {
    const servers = loadMcpConfig().filter(s => s.enabled);
    if (servers.length === 0) {
      logDb.insert({
        id: crypto.randomUUID(),
        level: 'info',
        category: 'mcp',
        content: 'No enabled MCP servers configured',
        createdAt: now()
      });
      return;
    }

    for (const serverConfig of servers) {
      try {
        await this.connectServer(serverConfig);
      } catch (error) {
        logDb.insert({
          id: crypto.randomUUID(),
          level: 'error',
          category: 'mcp',
          content: `Failed to connect MCP server "${serverConfig.name}": ${error}`,
          createdAt: now()
        });
      }
    }
  }

  private async connectServer(config: McpServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args
    });

    const client = new Client(
      { name: 'satori-ai', version: '0.1.0' },
      { capabilities: {} }
    );

    await client.connect(transport);

    const toolsResult = await client.listTools();
    const registeredTools: string[] = [];

    for (const tool of toolsResult.tools) {
      const toolName = tool.name;

      if (toolRegistry.has(toolName)) {
        logDb.insert({
          id: crypto.randomUUID(),
          level: 'warn',
          category: 'mcp',
          content: `Tool "${toolName}" from MCP server "${config.name}" conflicts with existing tool, skipping`,
          createdAt: now()
        });
        continue;
      }

      const toolDef: ToolDef = {
        type: 'function',
        function: {
          name: toolName,
          description: tool.description || `MCP tool from ${config.name}`,
          parameters: tool.inputSchema as Record<string, unknown>
        }
      };

      const serverName = config.name;
      toolRegistry.register(toolName, toolDef, async (params) => {
        const result = await client.callTool({
          name: toolName,
          arguments: params
        });

        const contentBlocks = result.content as Array<{ type: string; text?: string }>;

        if (result.isError) {
          const errorText = contentBlocks
            .filter(c => c.type === 'text')
            .map(c => c.text || '')
            .join('\n');
          return `MCP tool error: ${errorText}`;
        }

        return contentBlocks
          .filter(c => c.type === 'text')
          .map(c => c.text || '')
          .join('\n');
      });

      registeredTools.push(toolName);
      logDb.insert({
        id: crypto.randomUUID(),
        level: 'info',
        category: 'mcp',
        content: `Tool registered: ${toolName} (from MCP server "${serverName}")`,
        createdAt: now()
      });
    }

    this.connections.set(config.name, {
      serverName: config.name,
      client,
      transport,
      registeredTools
    });

    logDb.insert({
      id: crypto.randomUUID(),
      level: 'info',
      category: 'mcp',
      content: `MCP server "${config.name}" connected, ${registeredTools.length} tools registered`,
      createdAt: now()
    });
  }

  async stop(): Promise<void> {
    for (const [name, conn] of this.connections) {
      for (const toolName of conn.registeredTools) {
        toolRegistry.unregister(toolName);
      }
      try {
        await conn.transport.close();
      } catch {
        // transport close failure is non-critical
      }
      logDb.insert({
        id: crypto.randomUUID(),
        level: 'info',
        category: 'mcp',
        content: `MCP server "${name}" disconnected, ${conn.registeredTools.length} tools unregistered`,
        createdAt: now()
      });
    }
    this.connections.clear();
  }
}

export const mcpClientManager = new McpClientManager();
