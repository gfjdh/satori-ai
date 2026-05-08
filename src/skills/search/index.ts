import * as stringSimilarity from 'string-similarity';
import { memoryDb, knowledgeDb, logDb } from '../../db/database.js';
import { Memory } from '../../types/index.js';
import {
  searchCharacterKnowledgeWithFormat,
  getCurrentCharacterId
} from '../../character/knowledge.js';

interface SearchParams {
  query: string;
  keywords?: {
    direct?: string[];  // 直接关键词
  };
  timeRange?: {
    start?: string;
    end?: string;
  };
  limit?: number;
}

interface SearchResult {
  source: 'memory' | 'knowledge' | 'character_knowledge';
  granularity: string | null;
  category?: string;
  content: string;
  relevance: number;
  keywords_matched: {
    direct: string[];
  };
  period: {
    start: string | null;
    end: string | null;
  } | null;
  shouldRefine?: boolean;  // 是否需要细化
  refineKeywords?: string[];  // 细化建议关键词
  characterId?: string;  // 角色ID（仅当 source 为 character_knowledge 时）
}

// 粒度层级，从细到粗（用于判断哪些是更粗粒度）
const GRANULARITY_HIERARCHY: Record<string, string[]> = {
  'topic': ['day', 'week', 'month', 'season', 'year'],
  'day': ['week', 'month', 'season', 'year'],
  'week': ['month', 'season', 'year'],
  'month': ['season', 'year'],
  'season': ['year'],
  'year': []
};

/**
 * 执行分层检索
 * 返回值：直接返回格式化字符串，所有状态信息嵌入content中
 *
 * 参数格式兼容：
 * - 扁平结构：{query, keywords, timeRange, limit}
 * - 嵌套结构：{action, params} 其中 params 为扁平结构
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
    limit = 5
  } = actualParams;

  try {
    // 确保query是字符串
    const queryStr = typeof query === 'string' ? query : '';

    // 解析关键词
    const directKeywords = keywords?.direct || [];
    const allKeywords = directKeywords;

    // 如果没有提供关键词，从查询中提取
    const searchKeywords = allKeywords.length > 0
      ? allKeywords
      : (queryStr ? extractKeywordsFromQuery(queryStr) : []);

    // 解析时间范围
    const startDate = timeRange?.start ? new Date(timeRange.start) : undefined;
    const endDate = timeRange?.end ? new Date(timeRange.end) : undefined;

    const results: SearchResult[] = [];
    const memoryResults: SearchResult[] = [];

    // ========== 记忆检索（无差别粒度） ==========
    // 搜索所有粒度的记忆
    const allMemories = memoryDb.search(searchKeywords, startDate, endDate, 100);

    for (const mem of allMemories) {
      const result = buildResult(mem, searchKeywords);
      memoryResults.push(result);
    }

    // 对记忆按相关性排序
    memoryResults.sort((a, b) => b.relevance - a.relevance);

    // 取前3条记忆进行内容 enrichment
    const topMemories = memoryResults.slice(0, 3);
    const enrichedTopMemories: SearchResult[] = [];

    for (const memResult of topMemories) {
      const enrichedContent = enrichMemoryWithCoarser(memResult, startDate, endDate);
      enrichedTopMemories.push({
        ...memResult,
        content: enrichedContent
      });
    }

    // 将富化后的记忆加入结果（无条件保留前3条）
    results.push(...enrichedTopMemories);

    // ========== 资料库检索 ==========
    const knowledgeResults = knowledgeDb.search(directKeywords.length > 0 ? directKeywords : searchKeywords);

    for (const entry of knowledgeResults) {
      results.push({
        source: 'knowledge',
        granularity: null,
        category: entry.category,
        content: entry.content,
        relevance: entry.relevance || 0,
        keywords_matched: {
          direct: []
        },
        period: null
      });
    }

    // ========== 角色卡资料库检索 ==========
    const characterId = getCurrentCharacterId();
    if (searchKeywords.length > 0) {
      const characterResults = searchCharacterKnowledgeWithFormat(
        characterId,
        searchKeywords,
        limit
      );

      for (const cr of characterResults) {
        results.push({
          source: 'character_knowledge' as const,
          granularity: null,
          category: cr.category,
          content: cr.content,
          relevance: cr.relevance * 1.05,
          keywords_matched: {
            direct: cr.keywords_matched.filter(k => directKeywords.includes(k))
          },
          period: null,
          characterId: cr.characterId
        });
      }
    }

    // 按相关性排序（但前3条记忆已无条件保留）
    const nonMemoryResults = results.filter(r => r.source !== 'memory');
    nonMemoryResults.sort((a, b) => b.relevance - a.relevance);

    // 合并：前3条记忆 + 排序后的其他结果，取前limit条
    const sortedResults = [...enrichedTopMemories, ...nonMemoryResults.slice(0, limit - enrichedTopMemories.length)];

    const searchTime = Date.now() - startTime;

    // 格式化输出：所有信息嵌入字符串中
    const outputParts: string[] = [];
    outputParts.push(`[搜索结果] 查询: "${query}" | 找到: ${results.length} 条 | 耗时: ${searchTime}ms\n`);

    if (sortedResults.length === 0) {
      outputParts.push('未找到相关内容。');
    } else {
      for (let i = 0; i < Math.min(sortedResults.length, limit); i++) {
        const r = sortedResults[i];
        outputParts.push(`--- 结果 ${i + 1} [相关性: ${(r.relevance * 100).toFixed(1)}%] ---`);
        outputParts.push(`来源: ${r.source}${r.category ? ` | 分类: ${r.category}` : ''}`);
        if (r.granularity) {
          outputParts.push(`粒度: ${r.granularity}`);
        }
        if (r.period) {
          outputParts.push(`时间段: ${r.period.start ?? '未知'} ~ ${r.period.end ?? '未知'}`);
        }
        outputParts.push(`内容: ${r.content}`);
        if (r.keywords_matched.direct.length > 0) {
          outputParts.push(`匹配关键词: ${r.keywords_matched.direct.join(', ')}`);
        }
        outputParts.push('');
      }
    }

    const result = outputParts.join('\n');
    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'agent', content: `Search failed: ${error}`, createdAt: new Date() });
    return `[搜索出错] ${errorMsg}`;
  }
}

/**
 * 构建搜索结果
 */
function buildResult(
  mem: Memory,
  allKeywords: string[]
): SearchResult {
  // 相关性：基于内容匹配
  let relevance = 0;
  if (allKeywords.length > 0) {
    const matchedCount = allKeywords.filter(kw =>
      mem.content.includes(kw) || stringSimilarity.compareTwoStrings(kw, mem.content) > 0.3
    ).length;
    relevance = matchedCount / allKeywords.length;
  }

  // 检查是否需要细化：内容很概括
  const contentSpecificity = mem.content.length;
  const shouldRefine = contentSpecificity < 50 && relevance > 0;

  // 提取可能的细化关键词（从内容中识别）
  const refineKeywords = shouldRefine
    ? extractPotentialKeywords(mem.content, allKeywords)
    : undefined;

  return {
    source: 'memory',
    granularity: mem.granularity,
    content: mem.content,
    relevance,
    keywords_matched: {
      direct: []
    },
    period: {
      start: mem.periodStart.toISOString().split('T')[0],
      end: mem.periodEnd.toISOString().split('T')[0]
    },
    shouldRefine,
    refineKeywords
  };
}

/**
 * 根据记忆粒度获取更粗粒度的记忆，并将内容富化
 */
function enrichMemoryWithCoarser(
  memResult: SearchResult,
  startDate?: Date,
  endDate?: Date
): string {
  const mem = memoryDb.getAll().find(m => m.content === memResult.content && m.granularity === memResult.granularity);
  if (!mem) return memResult.content;

  const coarserLevels = GRANULARITY_HIERARCHY[mem.granularity];
  if (!coarserLevels || coarserLevels.length === 0) return memResult.content;

  const coarserMemories = memoryDb.getCoarserMemories(mem, startDate, endDate);
  if (coarserMemories.length === 0) return memResult.content;

  // 按从粗到细排序
  const order = ['year', 'season', 'month', 'week', 'day'];
  coarserMemories.sort((a, b) => order.indexOf(a.granularity) - order.indexOf(b.granularity));

  const enrichedParts: string[] = [memResult.content];

  for (const coarser of coarserMemories) {
    const granularityLabel: Record<string, string> = {
      'year': '年',
      'season': '季',
      'month': '月',
      'week': '周',
      'day': '天'
    };
    enrichedParts.push(`\n${granularityLabel[coarser.granularity] || coarser.granularity}记忆：${coarser.content}`);
  }

  return enrichedParts.join('');
}

/**
 * 从内容中提取潜在关键词（用于细化）
 */
function extractPotentialKeywords(content: string, existingKeywords: string[]): string[] {
  const words = content.split(/[,，\s、]+/).filter(w => w.length >= 2);
  return words
    .filter(w => !existingKeywords.some(k => k.includes(w) || w.includes(k)))
    .slice(0, 3);
}

/**
 * 从查询文本中提取关键词
 */
function extractKeywordsFromQuery(query: string): string[] {
  const stopWords = ['的', '了', '在', '是', '我', '你', '他', '她', '它', '这', '那', '有', '和', '与', '或', '上', '下', '前', '后', '里', '外'];

  return query
    .split(/[,，\s、]+/)
    .filter(word => word.length >= 2 && !stopWords.includes(word))
    .slice(0, 5);
}

// 导出类型供其他模块使用（仅 SearchParams 需要外部使用）
export type { SearchParams };
