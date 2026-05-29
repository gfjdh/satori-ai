/**
 * ToolRegistry — 可插拔工具注册中心
 *
 * 解耦 Agent 和 Skill：Agent 不感知具体工具实现，只和 Registry 交互。
 * Skill 通过桥接函数注册为 Tool，外部插件也可直接 register()。
 *
 * 二次开发接口：
 *   import { toolRegistry } from './tool-registry.js';
 *   toolRegistry.register('my_tool', definition, handler);
 *   toolRegistry.unregister('my_tool');
 */

import { ToolDef } from '../types/index.js';

export type ToolHandler = (params: Record<string, unknown>) => Promise<string>;

export interface ToolRegistration {
  definition: ToolDef;
  handler: ToolHandler;
}

class ToolRegistry {
  private tools = new Map<string, ToolRegistration>();

  /** 注册工具。同名工具会被覆盖（实现热更新）。 */
  register(name: string, definition: ToolDef, handler: ToolHandler): void {
    this.tools.set(name, { definition, handler });
  }

  /** 插拔工具。不存在也不报错。 */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /** 工具是否存在 */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** 获取单个工具注册信息 */
  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name);
  }

  /** 获取所有 OpenAI tool definitions（给 LLM 请求用） */
  getDefinitions(): ToolDef[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /** 执行工具。不存在的工具返回错误文本（不抛异常，让 LLM 自行消化）。 */
  async execute(name: string, params: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `未知工具: ${name}`;
    }
    try {
      return await tool.handler(params);
    } catch (e) {
      return `工具执行出错: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /** 列出所有已注册工具名 */
  list(): string[] {
    return Array.from(this.tools.keys());
  }

  /** 清空（测试用） */
  clear(): void {
    this.tools.clear();
  }
}

export const toolRegistry = new ToolRegistry();
