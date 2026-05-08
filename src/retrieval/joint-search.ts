/**
 * 联合检索入口
 * 两阶段检索：初筛（向量+关键词并行） → 重排（jieba分词+BM25）
 */

import { vectorSearch } from './vector-search.js';
import { rerankWithJieba, keywordSearch, fuseResults, type RetrievalItem } from './reranker.js';
import { memoryDb, knowledgeDb } from '../db/database.js';
import { searchCharacterKnowledge } from '../character/knowledge.js';
import { logDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import jieba from 'node-jieba';

export interface JointSearchResult {
  id: string;
  content: string;
  source: 'memory' | 'knowledge' | 'character_knowledge';
  score: number;
}

/**
 * 联合检索入口
 * @param query 用户问题
 * @param shortTermMemory 当前短期记忆（话题总结）
 * @param vectorTopK 向量检索返回条数，默认20
 * @param keywordTopK 关键词检索返回条数，默认10
 * @param rerankTopK 重排后返回条数，默认10
 */
export async function jointSearch(
  query: string,
  shortTermMemory?: { topic: string; summary: string } | null,
  vectorTopK: number = 20,
  keywordTopK: number = 10,
  rerankTopK: number = 10
): Promise<JointSearchResult[]> {
  const start = Date.now();

  // 构建检索查询（短期记忆总结 + 当前问题）
  const searchQuery = shortTermMemory
    ? `${shortTermMemory.summary}\n当前问题：${query}`
    : query;

  // 分词用于 character_knowledge 检索
  const queryTerms = jieba.cutForSearch(query).filter((t: string) => t.length > 1);

  // ========== 阶段1：初筛（并行） ==========

  // 1.1 向量检索（仅 memories、knowledge_base）
  let vectorResults: RetrievalItem[] = [];
  try {
    const vectorRaw = await vectorSearch(searchQuery, vectorTopK);
    vectorResults = vectorRaw.map(r => ({
      id: r.id,
      content: r.content,
      source: r.source,
      score: r.score  // 向量相似度分数
    }));
  } catch (error) {
    logDb.insert({
      id: uuidv4(),
      level: 'warn',
      category: 'retrieval',
      content: `[JointSearch] 向量检索失败: ${error}`,
      createdAt: new Date()
    });
  }

  // 1.2 关键词检索（memories、knowledge_base、character_knowledge）
  const allItems: Array<{ id: string; content: string; source: 'memory' | 'knowledge' | 'character_knowledge' }> = [];

  // memories
  const memories = memoryDb.getAll();
  for (const m of memories) {
    allItems.push({ id: m.id, content: m.content, source: 'memory' });
  }

  // knowledge_base
  const knowledgeEntries = knowledgeDb.getAll();
  for (const k of knowledgeEntries) {
    allItems.push({ id: k.id, content: k.content, source: 'knowledge' });
  }

  // character_knowledge（不做向量化，只走关键词）
  try {
    const charResults = searchCharacterKnowledge('', queryTerms, keywordTopK * 2);
    for (const r of charResults) {
      allItems.push({ id: r.id || crypto.randomUUID(), content: r.content, source: 'character_knowledge' });
    }
  } catch (error) {
    logDb.insert({
      id: uuidv4(),
      level: 'warn',
      category: 'retrieval',
      content: `[JointSearch] character_knowledge 检索失败: ${error}`,
      createdAt: new Date()
    });
  }

  // 关键词检索
  const keywordResults = keywordSearch(query, allItems, keywordTopK);

  // 1.3 候选集合并（去重）
  const candidates = fuseResults([...vectorResults, ...keywordResults]);

  // ========== 阶段2：重排 ==========

  // 使用 jieba 分词 + string-similarity 重排
  const reranked = rerankWithJieba(query, candidates, rerankTopK);

  const totalLatency = Date.now() - start;
  logDb.insert({
    id: uuidv4(),
    level: 'info',
    category: 'retrieval',
    content: `[JointSearch] 总耗时: ${totalLatency}ms, 向量结果: ${vectorResults.length}, 关键词结果: ${keywordResults.length}, 最终: ${reranked.length}`,
    createdAt: new Date()
  });

  return reranked.map(r => ({
    id: r.id,
    content: r.content,
    source: r.source,
    score: r.finalScore
  }));
}

/**
 * 获取联合检索结果（用于 prompt 填充）
 */
export function formatRetrievalContext(results: JointSearchResult[]): string {
  if (results.length === 0) return '（无相关检索结果）';

  return results
    .map(r => `[${r.source}] ${r.content}`)
    .join('\n');
}

export default { jointSearch, formatRetrievalContext };