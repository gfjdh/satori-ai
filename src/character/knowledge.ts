import fs from 'fs';
import path from 'path';
import { logDb } from '../db/database.js';
import * as stringSimilarity from 'string-similarity';

const CHARACTER_KNOWLEDGE_DIR = path.join(process.cwd(), 'character-cards');

// 角色知识条目
export interface CharacterKnowledgeItem {
  source: string;  // 角色ID
  category: string; // 分类
  id: string;       // 条目ID
  content: string;  // 条目内容（完整内容）
  keywords: string[]; // 关键词
  rawData: Record<string, unknown>; // 原始数据（用于展示）
}

// 角色知识库（内存缓存）
const knowledgeCache: Map<string, CharacterKnowledgeItem[]> = new Map();

// 当前角色ID（由外部设置）
// 模块变量优先；process.env 作为跨模块实例（源码 vs dist 编译产物）的共享回退
let currentCharacterId: string = '';

// 设置当前角色ID
export function setCurrentCharacterId(characterId: string): void {
  currentCharacterId = characterId;
  process.env.CURRENT_CHARACTER_ID = characterId;
}

// 获取当前角色ID
export function getCurrentCharacterId(): string {
  return currentCharacterId || process.env.CURRENT_CHARACTER_ID || '';
}

// 加载角色知识
export function loadCharacterKnowledge(characterId: string): CharacterKnowledgeItem[] {
  // 检查缓存
  if (knowledgeCache.has(characterId)) {
    return knowledgeCache.get(characterId)!;
  }

  const knowledgeDir = path.join(CHARACTER_KNOWLEDGE_DIR, characterId, 'knowledge');
  if (!fs.existsSync(knowledgeDir)) {
    knowledgeCache.set(characterId, []);
    return [];
  }

  const items: CharacterKnowledgeItem[] = [];

  // 读取 knowledge 目录下所有 .ts 文件
  const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.ts'));

  for (const file of files) {
    const filePath = path.join(knowledgeDir, file);
    try {
      // 动态导入 TypeScript 文件
      const module = require(filePath);

      // 假设导出的是一个数组
      for (const exportName of Object.keys(module)) {
        const exportValue = module[exportName];
        if (Array.isArray(exportValue)) {
          const category = file.replace('.ts', '');

          for (const item of exportValue) {
            if (typeof item === 'object' && item !== null) {
              // 提取关键词和内容
              const keywords = extractKeywords(item);
              const content = extractContent(item);

              items.push({
                source: characterId,
                category,
                id: (item as Record<string, unknown>).id as string || `${category}_${items.length}`,
                content,
                keywords,
                rawData: item
              });
            }
          }
        }
      }
    } catch (error) {
      logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'agent', content: `Failed to load ${filePath}: ${error}`, createdAt: new Date() });
    }
  }

  knowledgeCache.set(characterId, items);
  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Loaded ${items.length} knowledge items for ${characterId}`, createdAt: new Date() });
  return items;
}

// 从条目对象中提取关键词
function extractKeywords(item: Record<string, unknown>): string[] {
  const keywords: string[] = [];

  // 优先从 keywords 字段提取
  if (Array.isArray(item.keywords)) {
    keywords.push(...item.keywords.map(k => String(k)));
  }

  // 从 name 字段提取
  if (item.name) {
    keywords.push(String(item.name));
    // 提取中文名称中的关键词
    const name = String(item.name);
    const parts = name.split(/[　\s、,，()（）]/);
    for (const part of parts) {
      if (part.length >= 2) {
        keywords.push(part);
      }
    }
  }

  // 从 id 字段提取
  if (item.id) {
    keywords.push(String(item.id));
  }

  // 从 alias 别名字段提取（支持字符串或数组）
  if (item.alias) {
    if (Array.isArray(item.alias)) {
      for (const a of item.alias) {
        const aliasStr = String(a);
        keywords.push(aliasStr);
        // 别名中可能包含分割的词
        const parts = aliasStr.split(/[　\s、,，()（）]/);
        for (const part of parts) {
          if (part.length >= 2) {
            keywords.push(part);
          }
        }
      }
    } else {
      keywords.push(String(item.alias));
    }
  }

  // 去重
  return [...new Set(keywords)];
}

// 从条目对象中提取内容描述（直接序列化，避免遗漏数组等字段）
function extractContent(item: Record<string, unknown>): string {
  return JSON.stringify(item);
}

// 搜索角色知识
export function searchCharacterKnowledge(
  characterId: string,
  keywords: string[],
  limit: number = 10
): CharacterKnowledgeItem[] {
  const knowledge = loadCharacterKnowledge(characterId);

  if (knowledge.length === 0) {
    return [];
  }

  if (keywords.length === 0) {
    return knowledge.slice(0, limit);
  }

  // 计算单条目的匹配分数
  const scoreItem = (item: CharacterKnowledgeItem): number => {
    let score = 0;
    for (const k of keywords) {
      // 关键词匹配（精确或模糊）
      const kwMatch = item.keywords.some(kw => k.includes(kw) || kw.includes(k) ||
        stringSimilarity.compareTwoStrings(k, kw) > 0.3);
      // 内容匹配（模糊）
      const contentMatch = stringSimilarity.compareTwoStrings(k, item.content) > 0.3 ||
        item.content.includes(k);
      if (kwMatch || contentMatch) {
        score += kwMatch ? 0.7 : 0.3;
      }
    }
    return score / keywords.length; // 归一化
  };

  // 合并结果并排序
  const results = knowledge
    .filter(item => scoreItem(item) > 0)
    .sort((a, b) => scoreItem(b) - scoreItem(a))
    .slice(0, limit);

  return results.map(item => ({ ...item, relevance: scoreItem(item) })) as (CharacterKnowledgeItem & { relevance: number })[];
}

// 获取所有已加载的角色知识
export function getAllCharacterKnowledge(characterId: string): CharacterKnowledgeItem[] {
  return loadCharacterKnowledge(characterId);
}

// 清除角色知识缓存
export function clearKnowledgeCache(characterId?: string): void {
  if (characterId) {
    knowledgeCache.delete(characterId);
  } else {
    knowledgeCache.clear();
  }
}

// 搜索接口（返回格式统一）
export interface CharacterKnowledgeSearchResult {
  source: 'character';
  characterId: string;
  category: string;
  id: string;
  content: string;
  relevance: number;
  keywords_matched: string[];
  rawData: Record<string, unknown>;
}

export function searchCharacterKnowledgeWithFormat(
  characterId: string,
  keywords: string[],
  limit: number = 10
): CharacterKnowledgeSearchResult[] {
  const results = searchCharacterKnowledge(characterId, keywords, limit) as (CharacterKnowledgeItem & { relevance: number })[];

  logDb.insert({ id: crypto.randomUUID(), level: 'debug', category: 'agent', content: `[searchCharacterKnowledgeWithFormat] results.length=${results.length}, first.content=${results[0]?.content.substring(0, 100)}`, createdAt: new Date() });

  return results.map(item => ({
    source: 'character' as const,
    characterId: item.source,
    category: item.category,
    id: item.id,
    content: item.content,
    relevance: item.relevance || 0,
    keywords_matched: item.keywords.filter(kw =>
      keywords.some(k => k.includes(kw) || kw.includes(k))
    ),
    rawData: item.rawData
  }));
}