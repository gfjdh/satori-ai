/**
 * 向量检索模块
 * 通过 Python embedding 服务进行向量检索（仅 memories、knowledge_base）
 */

import { embeddingManager } from '../embedding/manager.js';
import { memoryDb, knowledgeDb } from '../db/database.js';
import { logDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';

export interface VectorSearchResult {
  id: string;
  content: string;
  source: 'memory' | 'knowledge';
  score: number;
}

/**
 * 向量检索入口（通过 Python 服务）
 */
export async function vectorSearch(
  query: string,
  topK: number = 20
): Promise<VectorSearchResult[]> {
  const start = Date.now();

  // 收集 memories 和 knowledge_base 的所有条目
  const memories = memoryDb.getAll();
  const knowledgeEntries = knowledgeDb.getAll();

  // 构建检索项
  const items: Array<{ id: string; content: string }> = [];

  for (const m of memories) {
    items.push({ id: m.id, content: m.content });
  }

  for (const k of knowledgeEntries) {
    items.push({ id: k.id, content: k.content });
  }

  if (items.length === 0) {
    return [];
  }

  // 调用 Python embedding 服务进行向量检索
  const results = await embeddingManager.search(query, items, topK);

  // 转换结果，区分 source
  const sourceMap = new Map<string, 'memory' | 'knowledge'>();
  for (const m of memories) {
    sourceMap.set(m.id, 'memory');
  }
  for (const k of knowledgeEntries) {
    sourceMap.set(k.id, 'knowledge');
  }

  const vectorResults: VectorSearchResult[] = results.map(r => ({
    id: r.id,
    content: r.content,
    source: sourceMap.get(r.id) || 'memory',
    score: r.score
  }));

  const latency = Date.now() - start;
  logDb.insert({
    id: uuidv4(),
    level: 'debug',
    category: 'retrieval',
    content: `[VectorSearch] 查询: "${query.substring(0, 30)}...", 结果: ${vectorResults.length}, 耗时: ${latency}ms`,
    createdAt: new Date()
  });

  return vectorResults;
}

/**
 * 为已有数据生成并存储 embedding
 * 注意：Python 服务负责生成 embedding，我们只存储结果
 */
export async function generateAndStoreEmbedding(
  type: 'memory' | 'knowledge',
  id: string,
  content: string
): Promise<void> {
  const embeddings = await embeddingManager.encodeBatch([content]);
  const embedding = embeddings[0];

  // 存储为 Blob
  const buffer = Buffer.from(new Float32Array(embedding));

  if (type === 'memory') {
    memoryDb.updateEmbedding(id, buffer);
  } else {
    knowledgeDb.updateEmbedding(id, buffer);
  }
}

export default { vectorSearch, generateAndStoreEmbedding };