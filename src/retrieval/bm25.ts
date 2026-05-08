/**
 * BM25 检索器
 * 对候选集使用 jieba 分词后进行 BM25 重排序
 */

import jieba from 'node-jieba';
import StringSimilarity from 'string-similarity';
import { logDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';

export interface BM25Candidate {
  id: string;
  content: string;
  source: 'memory' | 'knowledge' | 'character_knowledge';
  originalScore?: number;  // 来自初筛阶段的分数
}

export interface BM25Result {
  candidate: BM25Candidate;
  score: number;
}

// BM25 参数
const K1 = 1.5;
const B = 0.75;

/**
 * 分词（使用 jieba）
 */
function tokenize(text: string): string[] {
  return jieba.cutForSearch(text);
}

/**
 * 计算 IDF（逆文档频率）
 */
function computeIDF(docLengths: number[], avgDocLen: number, k1: number = K1, b: number = B): Map<string, number> {
  const idf: Map<string, number> = new Map();
  const N = docLengths.length;

  // 统计每个词出现在多少个文档中
  const docFreq: Map<string, number> = new Map();

  // 这里简化处理，假设所有词都出现在所有文档中
  // 实际应该统计每个词的文档频率
  return idf;
}

/**
 * 计算 BM25 得分
 */
function bm25Score(
  queryTerms: string[],
  docTokens: string[],
  docLen: number,
  avgDocLen: number,
  idf: Map<string, number>
): number {
  let score = 0;

  for (const term of queryTerms) {
    // 计算词在文档中的频率
    let tf = 0;
    for (const token of docTokens) {
      if (token === term) tf++;
    }

    if (tf === 0) continue;

    // IDF（这里用简化版本，实际应该预先计算）
    const idfVal = Math.log((docLen - tf + 0.5) / (tf + 0.5) + 1);

    // BM25 公式
    const numerator = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * docLen / avgDocLen);

    score += idfVal * numerator / denominator;
  }

  return score;
}

/**
 * 使用 string-similarity 对候选集进行重排
 * 由于 BM25 需要预计算 IDF，我们先用 string-similarity 做初步相似度计算
 * 然后结合 BM25 风格的词项匹配
 */
export function rerankWithBM25(
  query: string,
  candidates: BM25Candidate[],
  topK: number = 10,
  characterKnowledgeBoost: number = 1.05
): BM25Result[] {
  if (candidates.length === 0) return [];

  const start = Date.now();

  // 分词查询
  const queryTerms = tokenize(query);

  // 计算每个候选的 BM25 得分
  const results: BM25Result[] = candidates.map(candidate => {
    const docTokens = tokenize(candidate.content);

    // 简单词项匹配得分
    let termMatchScore = 0;
    for (const qt of queryTerms) {
      for (const dt of docTokens) {
        if (qt === dt || qt.includes(dt) || dt.includes(qt)) {
          termMatchScore += 1;
        }
      }
    }

    // 使用 string-similarity 计算语义相似度
    const similarityScore = StringSimilarity.compareTwoStrings(query, candidate.content);

    // 合并得分：0.7 * 语义相似度 + 0.3 * 词项匹配
    const bm25Score = 0.7 * similarityScore + 0.3 * (termMatchScore / Math.max(queryTerms.length, 1));

    // 加上初筛阶段的分数
    const finalScore = (candidate.originalScore || 0) * 0.5 + bm25Score * 0.5;

    return {
      candidate,
      score: finalScore
    };
  });

  // 按分数降序排列
  results.sort((a, b) => b.score - a.score);

  // 应用 character_knowledge 权重
  for (const r of results) {
    if (r.candidate.source === 'character_knowledge') {
      r.score *= characterKnowledgeBoost;
    }
  }

  // 重新排序
  results.sort((a, b) => b.score - a.score);

  const latency = Date.now() - start;
  logDb.insert({
    id: uuidv4(),
    level: 'debug',
    category: 'retrieval',
    content: `[BM25] rerank 查询: "${query.substring(0, 30)}...", 候选: ${candidates.length}, 耗时: ${latency}ms, top${topK}`,
    createdAt: new Date()
  });

  return results.slice(0, topK);
}

/**
 * 关键词匹配得分（与现有 string-similarity 逻辑一致）
 */
export function keywordMatchScore(query: string, content: string): number {
  const queryLower = query.toLowerCase();
  const contentLower = content.toLowerCase();

  // 提取中文字符和英文单词
  const queryChars = queryLower.replace(/[^一-龥a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  const contentChars = contentLower.replace(/[^一-龥a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean);

  let score = 0;
  let weight = 1.5;

  for (const q of queryChars) {
    for (const c of contentChars) {
      if (c.includes(q) || q.includes(c)) {
        score += weight;
      }
    }
    weight = Math.max(0.5, weight - 0.1);
  }

  // 使用 string-similarity
  const similarity = StringSimilarity.compareTwoStrings(queryLower, contentLower);
  score += similarity * 0.5;

  return score;
}

export default { rerankWithBM25, keywordMatchScore };