/**
 * 向量检索模块
 * 从数据库获取已存储的 embedding，在本地计算余弦相似度
 */

import { embeddingManager } from '../embedding/manager.js';
import { memoryDb, knowledgeDb, logDb, now } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';

export interface VectorSearchResult {
  id: string;
  content: string;
  source: 'memory' | 'knowledge';
  score: number;
}

/**
 * 向量检索入口
 * 使用数据库中预存储的 embedding，本地计算余弦相似度
 */
export async function vectorSearch(
  query: string,
  topK: number = 20
): Promise<VectorSearchResult[]> {
  const start = Date.now();

  // 收集有 embedding 的 memories 和 knowledge_base 条目
  const memoriesWithEmbedding = memoryDb.getAllWithEmbedding();
  const knowledgeWithEmbedding = knowledgeDb.getAllWithEmbedding();

  // 构建检索项（带 embedding）
  const items: Array<{ id: string; content: string; embedding: number[]; source: 'memory' | 'knowledge' }> = [];

  for (const m of memoriesWithEmbedding) {
    if (m.embedding) {
      // 重要：Buffer 从 DB 检索后 length=字节数，但 new Float32Array(buffer) 会把 length 当元素数
      // 正确方式：使用 buffer, byteOffset, length/4
      const embedding = new Float32Array(
        m.embedding.buffer,
        m.embedding.byteOffset,
        m.embedding.length / 4
      );
      items.push({
        id: m.id,
        content: m.content,
        embedding: Array.from(embedding),
        source: 'memory'
      });
    }
  }

  for (const k of knowledgeWithEmbedding) {
    if (k.embedding) {
      const embedding = new Float32Array(
        k.embedding.buffer,
        k.embedding.byteOffset,
        k.embedding.length / 4
      );
      items.push({
        id: k.id,
        content: k.content,
        embedding: Array.from(embedding),
        source: 'knowledge'
      });
    }
  }

  if (items.length === 0) {
    logDb.insert({
      id: uuidv4(),
      level: 'debug',
      category: 'retrieval',
      content: `[VectorSearch] 无已存储 embedding 的条目，跳过向量检索`,
      createdAt: now()
    });
    return [];
  }

  // 调用 Python 服务编码查询向量
  const queryEmbedding = await embeddingManager.encode(query);

  // 本地计算余弦相似度
  const scored = items.map(item => ({
    id: item.id,
    content: item.content,
    source: item.source,
    score: embeddingManager.cosineSimilarity(queryEmbedding, item.embedding)
  }));

  // 按相似度降序排列，取 topK
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, topK);

  const latency = Date.now() - start;
  logDb.insert({
    id: uuidv4(),
    level: 'debug',
    category: 'retrieval',
    content: `[VectorSearch] 查询: "${query.substring(0, 30)}...", 有embedding条目: ${items.length}, 结果: ${results.length}, 耗时: ${latency}ms`,
    createdAt: now()
  });

  return results;
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
  // 注意：Buffer.from(TypedArray) 会按 length（元素数）拷贝，而不是 byteLength
  // 必须用 .buffer 来拷贝完整的底层 ArrayBuffer
  const f32 = new Float32Array(embedding);
  const buffer = Buffer.from(f32.buffer, 0, f32.byteLength);

  if (type === 'memory') {
    memoryDb.updateEmbedding(id, buffer);
  } else {
    knowledgeDb.updateEmbedding(id, buffer);
  }
}

export default { vectorSearch, generateAndStoreEmbedding };