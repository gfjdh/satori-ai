/**
 * Search Skill — 统一检索入口
 *
 * 检索策略：
 * - 记忆/知识库：向量检索 + 关键词检索，各取 topK 后合并去重
 * - 角色知识：仅关键词检索
 *
 * 计分规则：
 * - bm25Score = stringSimilarity(query, doc) + BM25(keywords) * 2，归一化到 [0,1]
 * - 向量检索：cosine similarity
 * - 合并后：关键词路径结果在前，向量路径结果在后
 */

import { vectorSearch } from '../../retrieval/vector-search.js';
import { memoryDb, knowledgeDb, logDb } from '../../db/database.js';
import { searchCharacterKnowledge, getCurrentCharacterId } from '../../character/knowledge.js';
import { v4 as uuidv4 } from 'uuid';
import StringSimilarity from 'string-similarity';
import { Memory } from '../../types/index.js';

interface SearchParams {
  query: string;
  keywords?: {
    direct?: string[];
  };
  timeRange?: {
    start?: string;
    end?: string;
  };
  limit?: number;
}

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

// BM25 参数
const BM25_K1 = 1.6;

// 粒度层级，从细到粗（用于富化逻辑）
// topic 最细，year 最粗
const GRANULARITY_HIERARCHY: Record<string, string[]> = {
  'topic': ['day', 'week', 'month', 'season', 'year'],
  'day': ['week', 'month', 'season', 'year'],
  'week': ['month', 'season', 'year'],
  'month': ['season', 'year'],
  'season': ['year'],
  'year': []
};

/**
 * 计算 BM25 得分（关键词匹配部分）
 * 返回值在 [0,1] 之间，表示关键词在文档中的相关程度
 * 这里简化了 IDF 部分，假设所有关键词的 IDF 都相同，因此只计算 TF 饱和度
 * TF 计算为：查询关键词在文档中出现的总次数
 * BM25 公式简化为：TF / (K1 + TF)，其中 K1 是调节参数，常用值在 1.2 到 2.0 之间
 */
function computeBM25(doc: string, keywords: string[]): number {
  if (!keywords || keywords.length === 0) return 0;

  const docLower = doc.toLowerCase();
  let totalTF = 0;

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    // 计算词频：kw 在 doc 中出现的次数
    let count = 0;
    let pos = 0;
    while ((pos = docLower.indexOf(kwLower, pos)) !== -1) {
      count++;
      pos += kwLower.length;
    }
    totalTF += count;
  }

  // 简化的 BM25：TF / (K1 + TF) * IDF（这里假设 IDF = 1）
  const tfSaturate = totalTF / (BM25_K1 + totalTF);
  return tfSaturate;
}

/**
 * BM25 风格计分
 * 返回 stringSimilarity + BM25 * 2，归一化到 [0,1]
 */
function bm25Score(query: string, doc: string, keywords: string[]): number {
  const stringSim = StringSimilarity.compareTwoStrings(query.toLowerCase(), doc.toLowerCase());
  const bm25 = computeBM25(doc, keywords);

  // 权重 1:2，所以 max = 1 + 2 = 3
  const raw = stringSim + bm25 * 2;
  return Math.min(raw / 3, 1);
}

/**
 * 对记忆进行富化：补充更粗粒度的记忆内容
 */
function enrichMemoryWithCoarser(memResult: { id: string; content: string; granularity?: string }, startDate?: Date, endDate?: Date): string {
  const mem = memoryDb.getAll().find(m => m.id === memResult.id && m.granularity === memResult.granularity);
  if (!mem) return memResult.content;

  const coarserLevels = GRANULARITY_HIERARCHY[mem.granularity];
  if (!coarserLevels || coarserLevels.length === 0) return memResult.content;

  const coarserMemories = memoryDb.getCoarserMemories(mem, startDate, endDate);
  if (coarserMemories.length === 0) return memResult.content;

  // 按从粗到细排序
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

/**
 * 记忆检索（向量 + 关键词，各取 topK 后合并去重）
 */
async function searchMemories(
  query: string,
  keywords: string[],
  timeRange: { start?: string; end?: string } | undefined,
  topK: number
): Promise<RetrievalResult[]> {
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
    logDb.insert({ id: uuidv4(), level: 'warn', category: 'retrieval', content: `Memory vector search failed: ${error}`, createdAt: new Date() });
  }

  // 关键词检索：getAll + timeRange 预筛选 + bm25Score 排序
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

  // 合并去重：关键词结果在前，向量结果在后
  const seen = new Set<string>();
  const merged: RetrievalResult[] = [];

  for (const r of keywordResults) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }
  for (const r of vectorResults) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }

  return merged.slice(0, topK);
}

/**
 * 知识库检索（向量 + 关键词，各取 topK 后合并去重）
 */
async function searchKnowledge(
  query: string,
  keywords: string[],
  topK: number
): Promise<RetrievalResult[]> {
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
    logDb.insert({ id: uuidv4(), level: 'warn', category: 'retrieval', content: `Knowledge vector search failed: ${error}`, createdAt: new Date() });
  }

  // 关键词检索：getAll + bm25Score 排序
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

  // 合并去重：关键词结果在前，向量结果在后
  const seen = new Set<string>();
  const merged: RetrievalResult[] = [];

  for (const r of keywordResults) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }
  for (const r of vectorResults) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }

  return merged.slice(0, topK);
}

/**
 * 角色知识检索（仅关键词）
 */
function searchCharKnowledge(
  query: string,
  keywords: string[],
  topK: number
): RetrievalResult[] {
  const characterId = getCurrentCharacterId();
  if (!characterId) return [];

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
    logDb.insert({ id: uuidv4(), level: 'warn', category: 'retrieval', content: `Character knowledge search failed: ${error}`, createdAt: new Date() });
  }

  return charResults
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * 格式化检索结果
 */
function formatRetrievalContext(results: RetrievalResult[]): string {
  if (results.length === 0) return '（无相关检索结果）';

  return results
    .map(r => {
      let label = `[${r.source}]`;

      if (r.source === 'memory' && r.metadata.granularity) {
        const period = r.metadata.periodStart && r.metadata.periodEnd
          ? `${formatDate(r.metadata.periodStart)}~${formatDate(r.metadata.periodEnd)}`
          : '';
        label = `[${r.metadata.granularity}${period ? ' ' + period : ''}]`;
      } else if (r.source === 'knowledge' && r.metadata.category) {
        label = `[${r.metadata.category}]`;
      }

      const stateSuffix = r.metadata.userState ? `（此时段用户状态: ${r.metadata.userState}）` : '';
      return `${label} ${r.content}${stateSuffix} (score: ${r.score.toFixed(3)})`;
    })
    .join('\n');
}

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 执行检索 — Skill 入口函数
 */
export async function search(params: SearchParams): Promise<string> {
  const startTime = Date.now();

  // 兼容嵌套参数结构 {action, params}
  const actualParams = 'params' in params && typeof params.params === 'object'
    ? params.params as SearchParams
    : params;

  const {
    query,
    keywords,
    timeRange,
    limit = 10
  } = actualParams;

  try {
    const queryStr = typeof query === 'string' ? query : '';
    if (!queryStr) {
      return '（查询内容为空）';
    }

    const k = Math.max(1, Math.floor(limit / 2));
    const keywordList = keywords?.direct || [];

    // 三种来源各自独立容错，一个源失败不影响其他源
    let memoryResults: RetrievalResult[] = [];
    let knowledgeResults: RetrievalResult[] = [];
    let charResults: RetrievalResult[] = [];

    try {
      memoryResults = await searchMemories(queryStr, keywordList, timeRange, k);
    } catch (error) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'retrieval', content: `Memory search crashed: ${error}`, createdAt: new Date() });
    }

    try {
      knowledgeResults = await searchKnowledge(queryStr, keywordList, k);
    } catch (error) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'retrieval', content: `Knowledge search crashed: ${error}`, createdAt: new Date() });
    }

    try {
      charResults = searchCharKnowledge(queryStr, keywordList, k);
    } catch (error) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'retrieval', content: `Character knowledge search crashed: ${error}`, createdAt: new Date() });
    }

    // 对记忆进行富化（前3条）
    const enrichedMemoryResults = memoryResults.slice(0, 3).map(r => ({
      ...r,
      content: enrichMemoryWithCoarser(r, timeRange?.start ? new Date(timeRange.start) : undefined, timeRange?.end ? new Date(timeRange.end) : undefined)
    }));

    // 合并结果（去重）
    // 优先级：关键词检索结果 > 向量检索结果
    const combined = new Map<string, RetrievalResult>();

    for (const r of enrichedMemoryResults) {
      if (!combined.has(r.id)) combined.set(r.id, r);
    }
    for (const r of memoryResults.slice(3)) {
      if (!combined.has(r.id)) combined.set(r.id, r);
    }
    for (const r of knowledgeResults) {
      if (!combined.has(r.id)) combined.set(r.id, r);
    }
    for (const r of charResults) {
      if (!combined.has(r.id)) combined.set(r.id, r);
    }

    const finalResults = Array.from(combined.values()).slice(0, limit);

    const formatted = formatRetrievalContext(finalResults);
    const searchTime = Date.now() - startTime;

    return `[检索结果] 查询: "${queryStr}" | 找到: ${finalResults.length} 条 | 耗时: ${searchTime}ms\n\n${formatted}`;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'agent', content: `SearchSkill failed: ${error}`, createdAt: new Date() });
    return `[检索出错] ${errorMsg}`;
  }
}

export type { SearchParams };