/**
 * MCP 服务器配置加载
 *
 * 优先级：MCP_SERVERS_JSON env（运行时覆盖） > data/mcp.json（默认配置） > system_state DB（WebUI）
 */

import fs from 'fs';
import path from 'path';
import { stateDb } from '../db/database.js';

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
}

function loadFromFile(): McpServerConfig[] | null {
  try {
    const filePath = path.join(process.cwd(), 'data', 'mcp.json');
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return null;
}

export function loadMcpConfig(): McpServerConfig[] {
  try {
    // 1. env 覆盖（最高优先级）
    const envJson = process.env.MCP_SERVERS_JSON;
    if (envJson) {
      return JSON.parse(envJson) as McpServerConfig[];
    }

    // 2. data/mcp.json（默认配置文件）
    const fileConfig = loadFromFile();
    if (fileConfig) return fileConfig;

    // 3. system_state DB（WebUI 写入）
    const raw = stateDb.get('_system', 'mcp_servers');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }

    return [];
  } catch {
    return [];
  }
}

export function saveMcpConfig(servers: McpServerConfig[]): void {
  stateDb.set('_system', 'mcp_servers', JSON.stringify(servers));
}
