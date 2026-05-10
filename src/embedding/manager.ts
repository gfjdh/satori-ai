/**
 * Embedding 管理器
 * 通过 HTTP 调用 Python embedding 服务（bert-base-chinese）
 */

import { logDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';

const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || 'http://127.0.0.1:7860';

interface EmbeddingCache {
  [id: string]: number[];
}

class EmbeddingManager {
  private cache: EmbeddingCache = {};
  private ready: boolean = true;  // 服务就绪状态由健康检查决定
  private initPromise: Promise<void> | null = null;

  /**
   * 预加载：检查服务是否可用
   */
  async preload(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    try {
      logDb.insert({
        id: uuidv4(),
        level: 'info',
        category: 'embedding',
        content: '[EmbeddingManager] 检查 embedding 服务连接...',
        createdAt: new Date()
      });

      const response = await fetch(`${EMBEDDING_SERVICE_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        this.ready = true;
        logDb.insert({
          id: uuidv4(),
          level: 'info',
          category: 'embedding',
          content: '[EmbeddingManager] embedding 服务已就绪',
          createdAt: new Date()
        });
      } else {
        throw new Error(`Health check failed: ${response.status}`);
      }
    } catch (error) {
      logDb.insert({
        id: uuidv4(),
        level: 'warn',
        category: 'embedding',
        content: `[EmbeddingManager] embedding 服务连接失败: ${error}。将使用关键词检索。`,
        createdAt: new Date()
      });
      this.ready = false;
      // 不抛出错误，让系统降级到关键词检索
    }
  }

  /**
   * 等待服务就绪
   */
  async waitUntilReady(): Promise<void> {
    await this.preload();
  }

  /**
   * 编码单条文本为向量
   */
  async encode(text: string): Promise<number[]> {
    const start = Date.now();

    const response = await fetch(`${EMBEDDING_SERVICE_URL}/encode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: [text] }),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`Embedding service error: ${response.status}`);
    }

    const result = await response.json() as { embeddings: number[][] };
    const embedding = result.embeddings[0];
    const latency = Date.now() - start;

    logDb.insert({
      id: uuidv4(),
      level: 'debug',
      category: 'embedding',
      content: `[EmbeddingManager] encode 耗时: ${latency}ms, 文本长度: ${text.length}`,
      createdAt: new Date()
    });

    return embedding;
  }

  /**
   * 批量编码文本
   */
  async encodeBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const start = Date.now();

    const response = await fetch(`${EMBEDDING_SERVICE_URL}/encode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
      throw new Error(`Embedding service error: ${response.status}`);
    }

    const result = await response.json() as { embeddings: number[][] };
    const latency = Date.now() - start;

    logDb.insert({
      id: uuidv4(),
      level: 'info',
      category: 'embedding',
      content: `[EmbeddingManager] encodeBatch 批量: ${texts.length} 条, 耗时: ${latency}ms, 均耗时: ${(latency / texts.length).toFixed(2)}ms/条`,
      createdAt: new Date()
    });

    return result.embeddings;
  }

  /**
   * 向量检索
   */
  async search(
    query: string,
    items: Array<{ id: string; content: string }>,
    topK: number = 20
  ): Promise<Array<{ id: string; content: string; score: number }>> {
    const start = Date.now();

    const response = await fetch(`${EMBEDDING_SERVICE_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, items, top_k: topK }),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`Embedding search error: ${response.status}`);
    }

    const result = await response.json() as {
      results: Array<{ id: string; content: string; score: number }>;
    };

    const latency = Date.now() - start;
    logDb.insert({
      id: uuidv4(),
      level: 'debug',
      category: 'embedding',
      content: `[EmbeddingManager] search 耗时: ${latency}ms, 查询: "${query.substring(0, 30)}...", 结果: ${result.results.length}`,
      createdAt: new Date()
    });

    return result.results;
  }

  /**
   * 从缓存获取 embedding
   */
  getFromCache(id: string): number[] | undefined {
    return this.cache[id];
  }

  /**
   * 设置缓存
   */
  setCache(id: string, embedding: number[]): void {
    this.cache[id] = embedding;
  }

  /**
   * 批量设置缓存
   */
  setCacheBatch(items: Array<{ id: string; embedding: number[] }>): void {
    for (const item of items) {
      this.cache[item.id] = item.embedding;
    }
  }

  /**
   * 计算余弦相似度
   */
  cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;  // 防止零向量导致 NaN
    return dotProduct / denom;
  }

  /**
   * 计算余弦相似度（批量向量 vs 单向量）
   */
  cosineSimilarityBatch(vectors: number[][], queryEmbedding: number[]): number[] {
    return vectors.map(vec => this.cosineSimilarity(vec, queryEmbedding));
  }

  /**
   * 检查是否就绪
   */
  isReady(): boolean {
    return this.ready;
  }
}

// 导出单例
export const embeddingManager = new EmbeddingManager();
export default embeddingManager;