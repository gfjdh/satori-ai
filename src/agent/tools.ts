/**
 * Skill → Tool 桥接
 *
 * 启动时注册所有 skill 附带的 tool。渐进式披露在上下文构建时完成：
 * - 永久可见：Skill 列表（名称 + 简介）
 * - 动态可见：工具列表（仅已披露 skill 所附带 tool 的完整参数 schema）
 *
 * 披露来源：缓存预加载（search / image-analysis）+ read_skill 显式加载 + 触发词匹配
 */

import fs from 'fs';
import path from 'path';
import { ToolDef } from '../types/index.js';
import { toolRegistry } from './tool-registry.js';
import { skillEngine } from '../skills/engine.js';
import { logDb, now } from '../db/database.js';

// ========== 披露状态 ==========

const disclosedSkills = new Set<string>();

export function getDisclosedSkills(): Set<string> {
  return disclosedSkills;
}

export function discloseSkill(skillName: string): void {
  disclosedSkills.add(skillName);
}

// ========== read_skill：渐进式披露入口 ==========

const READ_SKILL_DEF: ToolDef = {
  type: 'function',
  function: {
    name: 'read_skill',
    description: '加载指定 skill 的完整说明文档（SKILL.md）。当前已在上下文中加载过 README 的 skill（见"已加载的 Skill README"章节）无需重复加载。',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'skill 名称，如 search、image-analysis'
        }
      },
      required: ['name']
    }
  }
};

async function handleReadSkill(params: Record<string, unknown>): Promise<string> {
  const rawName = params.name as string;
  if (!rawName) return '请提供 skill 名称';

  const skillName = rawName.replace(/_/g, '-');
  const skill = await skillEngine.loadSkill(skillName);
  if (!skill) return `未找到 skill: ${skillName}`;

  discloseSkill(skillName);

  logDb.insert({
    id: crypto.randomUUID(),
    level: 'info',
    category: 'agent',
    content: `Skill disclosed via read_skill: ${skillName}`,
    createdAt: now()
  });

  return skill.content;
}

// ========== 动态注册（供运行时安装的 skill 使用） ==========

export async function registerSkillTools(skillName: string): Promise<boolean> {
  const compiledPath = path.join(process.cwd(), 'dist', 'skills', skillName, 'index.js');
  if (!fs.existsSync(compiledPath)) return false;

  try {
    const module = await import(`file://${compiledPath}`);
    if (!module.toolDefs || !module.toolHandlers) return false;

    let registered = false;
    for (const def of module.toolDefs as ToolDef[]) {
      const toolName = def.function.name;
      if (toolRegistry.has(toolName)) continue;
      const handler = module.toolHandlers[toolName];
      if (handler) {
        toolRegistry.register(toolName, def, handler);
        registered = true;
        logDb.insert({
          id: crypto.randomUUID(),
          level: 'info',
          category: 'agent',
          content: `Tool registered (dynamic): ${toolName} (from ${skillName})`,
          createdAt: now()
        });
      }
    }
    return registered;
  } catch (err) {
    logDb.insert({
      id: crypto.randomUUID(),
      level: 'error',
      category: 'agent',
      content: `Failed to register tools for ${skillName}: ${err}`,
      createdAt: now()
    });
    return false;
  }
}

// ========== 启动初始化 ==========

export async function initTools(): Promise<void> {
  // 1. 注册 read_skill（引导工具）
  toolRegistry.register('read_skill', READ_SKILL_DEF, handleReadSkill);
  logDb.insert({
    id: crypto.randomUUID(),
    level: 'info',
    category: 'agent',
    content: 'Tool registered: read_skill',
    createdAt: now()
  });

  // 2. 加载所有 skill，注册其附带的 tool
  const skillMetas = skillEngine.getAllSkillMetas();
  let totalRegistered = 0;

  for (const meta of skillMetas) {
    const compiledPath = path.join(process.cwd(), 'dist', 'skills', meta.name, 'index.js');
    if (!fs.existsSync(compiledPath)) {
      logDb.insert({
        id: crypto.randomUUID(),
        level: 'warn',
        category: 'agent',
        content: `Skill compiled module not found: ${meta.name}`,
        createdAt: now()
      });
      continue;
    }

    try {
      const module = await import(`file://${compiledPath}`);
      if (!module.toolDefs || !module.toolHandlers) {
        logDb.insert({
          id: crypto.randomUUID(),
          level: 'warn',
          category: 'agent',
          content: `Skill ${meta.name} exports no toolDefs/toolHandlers`,
          createdAt: now()
        });
        continue;
      }

      for (const def of module.toolDefs as ToolDef[]) {
        const toolName = def.function.name;
        if (toolRegistry.has(toolName)) {
          logDb.insert({
            id: crypto.randomUUID(),
            level: 'warn',
            category: 'agent',
            content: `Tool ${toolName} already registered, skipping (from ${meta.name})`,
            createdAt: now()
          });
          continue;
        }
        const handler = module.toolHandlers[toolName];
        if (handler) {
          toolRegistry.register(toolName, def, handler);
          totalRegistered++;
          logDb.insert({
            id: crypto.randomUUID(),
            level: 'info',
            category: 'agent',
            content: `Tool registered: ${toolName} (from ${meta.name})`,
            createdAt: now()
          });
        }
      }
    } catch (err) {
      logDb.insert({
        id: crypto.randomUUID(),
        level: 'error',
        category: 'agent',
        content: `Failed to register tools for skill ${meta.name}: ${err}`,
        createdAt: now()
      });
    }
  }

  logDb.insert({
    id: crypto.randomUUID(),
    level: 'info',
    category: 'agent',
    content: `Total ${totalRegistered} skill tools registered from ${skillMetas.length} skills`,
    createdAt: now()
  });
}
