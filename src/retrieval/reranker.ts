/**
 * RRF (Reciprocal Rank Fusion) 融合器
 * 将多路检索结果合并并进行重排
 */

import StringSimilarity from 'string-similarity';
import { logDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import jieba from 'nodejieba';

export interface RetrievalItem {
  id: string;
  content: string;
  source: 'memory' | 'knowledge' | 'character_knowledge';
  score: number;  // 初筛阶段原始分数
}

export interface RerankedResult extends RetrievalItem {
  finalScore: number;
}

/**
 * 融合多路检索结果
 */
export function fuseResults(items: RetrievalItem[]): RetrievalItem[] {
  if (items.length === 0) return [];

  // 按 id 去重，保留最高分
  const seen = new Map<string, RetrievalItem>();
  for (const item of items) {
    const existing = seen.get(item.id);
    if (!existing || item.score > existing.score) {
      seen.set(item.id, item);
    }
  }

  return Array.from(seen.values());
}

/**
 * 使用 jieba 分词 + string-similarity 对候选集重排
 * 替代需要预计算 IDF 的 BM25
 */
export function rerankWithJieba(
  query: string,
  candidates: RetrievalItem[],
  topK: number = 10,
  characterKnowledgeBoost: number = 1.05
): RerankedResult[] {
  if (candidates.length === 0) return [];

  const start = Date.now();
  const queryLower = query.toLowerCase();

  // 分词查询
  const queryTerms = jieba.cutForSearch(query);

  // 计算每个候选的重排分数
  const results: RerankedResult[] = candidates.map(candidate => {
    // 1. 词项匹配得分
    const contentLower = candidate.content.toLowerCase();
    const contentTerms = jieba.cutForSearch(candidate.content);

    let termScore = 0;
    let matchedTerms = 0;
    for (const qt of queryTerms) {
      for (const ct of contentTerms) {
        if (ct.includes(qt) || qt.includes(ct) || ct === qt) {
          termScore += 1;
        }
      }
    }
    matchedTerms = termScore / Math.max(queryTerms.length, 1);

    // 2. string-similarity 语义相似度
    const similarityScore = StringSimilarity.compareTwoStrings(queryLower, contentLower);

    // 3. 关键词精确匹配（从现有 keywords 字段）
    // 注意：这里假设 keywords 是从数据库中取的，但已经移除了 keyword 列
    // 所以我们跳过这个步骤，只用 1 和 2

    // 综合得分：0.6 语义相似度 + 0.4 词项匹配
    const combinedScore = 0.6 * similarityScore + 0.4 * Math.min(matchedTerms, 1);

    // 加上初筛分数的加权
    const finalScore = candidate.score * 0.4 + combinedScore * 0.6;

    return {
      ...candidate,
      finalScore
    };
  });

  // 应用 character_knowledge 权重
  for (const r of results) {
    if (r.source === 'character_knowledge') {
      r.finalScore *= characterKnowledgeBoost;
    }
  }

  // 按最终分数降序排列
  results.sort((a, b) => b.finalScore - a.finalScore);

  const latency = Date.now() - start;
  logDb.insert({
    id: uuidv4(),
    level: 'debug',
    category: 'retrieval',
    content: `[Reranker] 重排: "${query.substring(0, 30)}...", 候选: ${candidates.length}, 耗时: ${latency}ms, top${topK}`,
    createdAt: new Date()
  });

  return results.slice(0, topK);
}

/**
 * 关键词检索（string-similarity）
 */
export function keywordSearch(
  query: string,
  items: Array<{ id: string; content: string; source: 'memory' | 'knowledge' | 'character_knowledge' }>,
  topK: number = 10
): RetrievalItem[] {
  if (items.length === 0) return [];

  const start = Date.now();
  const queryLower = query.toLowerCase();

  const results = items.map(item => {
    const contentLower = item.content.toLowerCase();

    // 提取中文字符和英文单词
    const queryChars = queryLower.replace(/[^一-龥a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean);
    const contentChars = contentLower.replace(/[^一-龥a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean);

    // 关键词匹配得分
    let keywordScore = 0;
    let weight = 1.5;
    for (const q of queryChars) {
      for (const c of contentChars) {
        if (c.includes(q) || q.includes(c)) {
          keywordScore += weight;
        }
      }
      weight = Math.max(0.5, weight - 0.1);
    }

    // string-similarity 得分
    const similarityScore = StringSimilarity.compareTwoStrings(queryLower, contentLower);

    // 综合得分
    const score = similarityScore * 0.5 + (keywordScore / Math.max(queryChars.length, 1)) * 0.5;

    return {
      id: item.id,
      content: item.content,
      source: item.source,
      score
    };
  });

  results.sort((a, b) => b.score - a.score);

  const latency = Date.now() - start;
  logDb.insert({
    id: uuidv4(),
    level: 'debug',
    category: 'retrieval',
    content: `[Reranker] 关键词检索: "${query.substring(0, 30)}...", 候选: ${items.length}, 耗时: ${latency}ms`,
    createdAt: new Date()
  });

  return results.slice(0, topK);
}

export default { fuseResults, rerankWithJieba, keywordSearch };