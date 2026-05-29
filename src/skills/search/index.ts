/**
 * Search Skill — 三个独立检索工具
 *
 * - search_memory：长期记忆检索（向量 + 关键词 + 时间范围 + 粗粒度富化）
 * - search_knowledge：本地资料库检索（向量 + 关键词）
 * - search_character：角色知识库检索（仅关键词）
 *
 * 计分规则：
 * - bm25Score = stringSimilarity(query, doc) + BM25(keywords) * 2，归一化到 [0,1]
 * - 向量检索：cosine similarity
 * - 合并后：关键词路径结果在前，向量路径结果在后
 */

import { vectorSearch } from '../../retrieval/vector-search.js';
import { memoryDb, knowledgeDb, logDb, now } from '../../db/database.js';
import { searchCharacterKnowledge, getCurrentCharacterId } from '../../character/knowledge.js';
import { v4 as uuidv4 } from 'uuid';
import StringSimilarity from 'string-similarity';
import { Memory } from '../../types/index.js';

// ========== 类型 ==========

interface RetrievalResult {
  id: string;
  content: string;
  source: 'memory' | 'knowledge' | 'character_knowledge';
  score: number;
  metadata: {
    granularity?: string;
    periodStart?: string;
    periodEnd?: string;
    category?: string;
    userState?: string;
  };
}

// ========== BM25 ==========

const BM25_K1 = 1.6;

function computeBM25(doc: string, keywords: string[]): number {
  if (!keywords || keywords.length === 0) return 0;

  const docLower = doc.toLowerCase();
  let totalTF = 0;

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    let count = 0;
    let pos = 0;
    while ((pos = docLower.indexOf(kwLower, pos)) !== -1) {
      count++;
      pos += kwLower.length;
    }
    totalTF += count;
  }

  return totalTF / (BM25_K1 + totalTF);
}

function bm25Score(query: string, doc: string, keywords: string[]): number {
  const stringSim = StringSimilarity.compareTwoStrings(query.toLowerCase(), doc.toLowerCase());
  const bm25 = computeBM25(doc, keywords);
  const raw = stringSim + bm25 * 2;
  return Math.min(raw / 3, 1);
}

// ========== 记忆富化 ==========

const GRANULARITY_HIERARCHY: Record<string, string[]> = {
  'topic': ['day', 'week', 'month', 'season', 'year'],
  'day': ['week', 'month', 'season', 'year'],
  'week': ['month', 'season', 'year'],
  'month': ['season', 'year'],
  'season': ['year'],
  'year': []
};

function enrichMemoryWithCoarser(
  memResult: { id: string; content: string; granularity?: string },
  startDate?: Date,
  endDate?: Date
): string {
  const mem = memoryDb.getAll().find(m => m.id === memResult.id && m.granularity === memResult.granularity);
  if (!mem) return memResult.content;

  const coarserLevels = GRANULARITY_HIERARCHY[mem.granularity];
  if (!coarserLevels || coarserLevels.length === 0) return memResult.content;

  const coarserMemories = memoryDb.getCoarserMemories(mem, startDate, endDate);
  if (coarserMemories.length === 0) return memResult.content;

  const order = ['year', 'season', 'month', 'week', 'day'];
  coarserMemories.sort((a, b) => order.indexOf(a.granularity) - order.indexOf(b.granularity));

  const enrichedParts: string[] = [memResult.content];

  const granularityLabel: Record<string, string> = {
    'year': '年',
    'season': '季',
    'month': '月',
    'week': '周',
    'day': '天'
  };

  for (const coarser of coarserMemories) {
    const label = granularityLabel[coarser.granularity] || coarser.granularity;
    const statePart = coarser.userState ? `（此时段用户状态: ${coarser.userState}）` : '';
    enrichedParts.push(`\n${label}记忆：${coarser.content}${statePart}`);
  }

  return enrichedParts.join('');
}

// ========== 通用格式化 ==========

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function formatRetrievalContext(results: RetrievalResult[], resultLabel: string): string {
  if (results.length === 0) return `（无相关${resultLabel}）`;

  return results
    .map(r => {
      let label: string;

      if (r.source === 'memory' && r.metadata.granularity) {
        const period = r.metadata.periodStart && r.metadata.periodEnd
          ? `${formatDate(r.metadata.periodStart)}~${formatDate(r.metadata.periodEnd)}`
          : '';
        label = `[${r.metadata.granularity}${period ? ' ' + period : ''}]`;
      } else if (r.source === 'knowledge' && r.metadata.category) {
        label = `[${r.metadata.category}]`;
      } else {
        label = `[${r.source}]`;
      }

      const stateSuffix = r.metadata.userState ? `（此时段用户状态: ${r.metadata.userState}）` : '';
      return `${label} ${r.content}${stateSuffix} (score: ${r.score.toFixed(3)})`;
    })
    .join('\n');
}

// ========== 核心检索函数 ==========

async function searchMemories(
  query: string,
  keywords: string[],
  timeRange: { start?: string; end?: string } | undefined,
  topK: number
): Promise<{ results: RetrievalResult[] }> {
  const startTime = timeRange?.start ? new Date(timeRange.start) : undefined;
  const endTime = timeRange?.end ? new Date(timeRange.end) : undefined;

  // 向量检索
  let vectorResults: RetrievalResult[] = [];
  try {
    const raw = await vectorSearch(query, topK);
    const filtered = raw.filter(r => r.source === 'memory');
    vectorResults = filtered.map(r => {
      const mem = memoryDb.getAll().find(m => m.id === r.id);
      return {
        id: r.id,
        content: r.content,
        source: 'memory' as const,
        score: r.score,
        metadata: {
          granularity: mem?.granularity,
          periodStart: mem?.periodStart.toISOString(),
          periodEnd: mem?.periodEnd.toISOString(),
          userState: mem?.userState
        }
      };
    });
  } catch (error) {
    logDb.insert({ id: uuidv4(), level: 'warn', category: 'retrieval', content: `Memory vector search failed: ${error}`, createdAt: now() });
  }

  // 关键词检索
  let allMemories = memoryDb.getAll();
  if (startTime || endTime) {
    allMemories = allMemories.filter(mem => {
      if (startTime && mem.periodEnd < startTime) return false;
      if (endTime && mem.periodStart > endTime) return false;
      return true;
    });
  }

  const keywordResults: RetrievalResult[] = allMemories
    .map(mem => ({
      id: mem.id,
      content: mem.content,
      source: 'memory' as const,
      score: bm25Score(query, mem.content, keywords),
      metadata: {
        granularity: mem.granularity,
        periodStart: mem.periodStart.toISOString(),
        periodEnd: mem.periodEnd.toISOString(),
        userState: mem.userState
      }
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // 合并去重：关键词在前，向量在后
  const seen = new Set<string>();
  const merged: RetrievalResult[] = [];

  for (const r of keywordResults) {
    if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
  }
  for (const r of vectorResults) {
    if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
  }

  return { results: merged.slice(0, topK) };
}

async function searchKnowledge(
  query: string,
  keywords: string[],
  topK: number
): Promise<{ results: RetrievalResult[] }> {
  // 向量检索
  let vectorResults: RetrievalResult[] = [];
  try {
    const raw = await vectorSearch(query, topK);
    const filtered = raw.filter(r => r.source === 'knowledge');
    vectorResults = filtered.map(r => {
      const kb = knowledgeDb.getAll().find(k => k.id === r.id);
      return {
        id: r.id,
        content: r.content,
        source: 'knowledge' as const,
        score: r.score,
        metadata: { category: kb?.category }
      };
    });
  } catch (error) {
    logDb.insert({ id: uuidv4(), level: 'warn', category: 'retrieval', content: `Knowledge vector search failed: ${error}`, createdAt: now() });
  }

  // 关键词检索
  const allEntries = knowledgeDb.getAll();
  const keywordResults: RetrievalResult[] = allEntries
    .map(entry => ({
      id: entry.id,
      content: entry.content,
      source: 'knowledge' as const,
      score: bm25Score(query, entry.content, keywords),
      metadata: { category: entry.category }
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // 合并去重
  const seen = new Set<string>();
  const merged: RetrievalResult[] = [];

  for (const r of keywordResults) {
    if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
  }
  for (const r of vectorResults) {
    if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
  }

  return { results: merged.slice(0, topK) };
}

function searchCharKnowledge(
  query: string,
  keywords: string[],
  topK: number
): { results: RetrievalResult[] } {
  const characterId = getCurrentCharacterId();
  if (!characterId) return { results: [] };

  const effectiveTerms = keywords.length > 0 ? keywords : (query.length >= 2 ? [query] : []);

  let charResults: RetrievalResult[] = [];
  try {
    const raw = searchCharacterKnowledge(characterId, effectiveTerms, topK * 2);
    charResults = raw.map(r => ({
      id: r.id || crypto.randomUUID(),
      content: r.content,
      source: 'character_knowledge' as const,
      score: bm25Score(query, r.content, effectiveTerms),
      metadata: {}
    }));
  } catch (error) {
    logDb.insert({ id: uuidv4(), level: 'warn', category: 'retrieval', content: `Character knowledge search failed: ${error}`, createdAt: now() });
  }

  return {
    results: charResults
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  };
}

// ========== Tool Handler 实现 ==========

async function handleSearchMemory(params: Record<string, unknown>): Promise<string> {
  const query = (params.query as string) || '';
  if (!query) return '（查询内容为空）';

  const keywords = (params.keywords as { direct?: string[] })?.direct || [];
  const timeRange = params.timeRange as { start?: string; end?: string } | undefined;
  const limit = Math.max(1, (params.limit as number) || 10);

  const startTime = Date.now();

  const { results } = await searchMemories(query, keywords, timeRange, limit);

  // 前3条富化
  const enrichedResults = results.slice(0, 3).map(r => ({
    ...r,
    content: enrichMemoryWithCoarser(
      r,
      timeRange?.start ? new Date(timeRange.start) : undefined,
      timeRange?.end ? new Date(timeRange.end) : undefined
    )
  }));

  const finalResults = [...enrichedResults, ...results.slice(3)];
  const formatted = formatRetrievalContext(finalResults, '记忆');
  const searchTime = Date.now() - startTime;

  return `[记忆检索] 找到: ${finalResults.length} 条 | 耗时: ${searchTime}ms\n\n${formatted}`;
}

async function handleSearchKnowledge(params: Record<string, unknown>): Promise<string> {
  const query = (params.query as string) || '';
  if (!query) return '（查询内容为空）';

  const keywords = (params.keywords as { direct?: string[] })?.direct || [];
  const limit = Math.max(1, (params.limit as number) || 10);

  const startTime = Date.now();

  const { results } = await searchKnowledge(query, keywords, limit);
  const formatted = formatRetrievalContext(results, '资料');
  const searchTime = Date.now() - startTime;

  return `[资料库检索] 找到: ${results.length} 条 | 耗时: ${searchTime}ms\n\n${formatted}`;
}

async function handleSearchCharacter(params: Record<string, unknown>): Promise<string> {
  const keywords = (params.keywords as { direct?: string[] })?.direct || [];
  if (keywords.length === 0) return '（关键词为空 — search_character 仅支持关键词检索，请提供 keywords.direct）';

  const query = (params.query as string) || '';
  const limit = Math.max(1, (params.limit as number) || 10);

  const startTime = Date.now();

  const { results } = searchCharKnowledge(query, keywords, limit);
  const formatted = formatRetrievalContext(results, '角色知识');
  const searchTime = Date.now() - startTime;

  return `[角色知识检索] 找到: ${results.length} 条 | 耗时: ${searchTime}ms\n\n${formatted}`;
}

// ========== 统一检索（内部 pre-retrieval 用，非 tool） ==========

export async function search(params: Record<string, unknown>): Promise<string> {
  const query = (params.query as string) || '';
  if (!query) return '（查询内容为空）';

  const keywords = (params.keywords as { direct?: string[] })?.direct || [];
  const timeRange = params.timeRange as { start?: string; end?: string } | undefined;
  const limit = Math.max(1, (params.limit as number) || 10);
  const k = Math.max(1, Math.floor(limit / 2));

  const startTime = Date.now();

  // 三个来源各自独立容错
  const [memResult, kbResult, charResult] = await Promise.all([
    searchMemories(query, keywords, timeRange, k).catch(() => ({ results: [] as RetrievalResult[] })),
    searchKnowledge(query, keywords, k).catch(() => ({ results: [] as RetrievalResult[] })),
    Promise.resolve(searchCharKnowledge(query, keywords, k))
  ]);

  // 记忆富化（前3条）
  const enrichedMems = memResult.results.slice(0, 3).map(r => ({
    ...r,
    content: enrichMemoryWithCoarser(
      r,
      timeRange?.start ? new Date(timeRange.start) : undefined,
      timeRange?.end ? new Date(timeRange.end) : undefined
    )
  }));

  // 合并去重
  const combined = new Map<string, RetrievalResult>();
  for (const r of enrichedMems) combined.set(r.id, r);
  for (const r of memResult.results.slice(3)) { if (!combined.has(r.id)) combined.set(r.id, r); }
  for (const r of kbResult.results) { if (!combined.has(r.id)) combined.set(r.id, r); }
  for (const r of charResult.results) { if (!combined.has(r.id)) combined.set(r.id, r); }

  const finalResults = Array.from(combined.values()).slice(0, limit);
  const formatted = formatRetrievalContext(finalResults, '结果');
  const searchTime = Date.now() - startTime;

  return `[检索结果] 找到: ${finalResults.length} 条 | 耗时: ${searchTime}ms\n\n${formatted}`;
}

// ========== Tool 注册 ==========

import type { ToolDef } from '../../types/index.js';

export const toolDefs: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description: '检索长期记忆。适用于用户提到过去的事、想回顾对话历史、询问"我之前说过..."等场景。支持时间范围过滤，结果自动附带更粗粒度记忆作为上下文。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '查询文本（用于向量检索的整句）' },
          keywords: {
            type: 'object',
            properties: { direct: { type: 'array', items: { type: 'string' }, description: '精确关键词列表' } },
            description: '关键词过滤（可选）'
          },
          timeRange: {
            type: 'object',
            properties: {
              start: { type: 'string', description: '开始日期 YYYY-MM-DD' },
              end: { type: 'string', description: '结束日期 YYYY-MM-DD' }
            },
            description: '时间范围筛选（可选）'
          },
          limit: { type: 'number', description: '返回数量，默认10' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: '检索本地资料库。适用于查找用户自行添加的资料、文档、笔记等结构化知识条目。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '查询文本（用于向量检索的整句）' },
          keywords: {
            type: 'object',
            properties: { direct: { type: 'array', items: { type: 'string' }, description: '精确关键词列表' } },
            description: '关键词过滤（可选）'
          },
          limit: { type: 'number', description: '返回数量，默认10' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_character',
      description: '检索角色知识库（仅关键词检索）。适用于需要了解角色设定、背景故事、性格特征、人物关系等角色相关信息时使用。',
      parameters: {
        type: 'object',
        properties: {
          keywords: {
            type: 'object',
            properties: { direct: { type: 'array', items: { type: 'string' }, description: '精确关键词列表（至少一个）' } },
            description: '关键词（必填）'
          },
          query: { type: 'string', description: '补充查询文本（可选）' },
          limit: { type: 'number', description: '返回数量，默认10' }
        },
        required: ['keywords']
      }
    }
  }
];

export const toolHandlers: Record<string, (params: Record<string, unknown>) => Promise<string>> = {
  search_memory: handleSearchMemory,
  search_knowledge: handleSearchKnowledge,
  search_character: handleSearchCharacter,
};
