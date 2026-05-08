import { memoryDb, logDb, dialogueDb } from '../db/database.js';
import { stateManager } from '../state/manager.js';
import { callLLM, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import { Memory } from '../types/index.js';
import { generateAndStoreEmbedding } from '../retrieval/vector-search.js';

// 短期记忆（当前话题的对话总结）
interface ShortTermMemory {
  topic: string;
  summary: string;
  startTime: Date;
  lastUpdateTime: Date;
}

// 当前对话的短期记忆
let currentShortTermMemory: ShortTermMemory | null = null;

// 记忆层级配置
interface GranularityConfig {
  name: 'topic' | 'day' | 'week' | 'month' | 'year';
  childGranularity: 'topic' | 'day' | 'week' | 'month' | null;
  summaryThresholdMs: number;  // 触发总结的时间阈值
}

const GRANULARITY_CONFIGS: GranularityConfig[] = [
  { name: 'day', childGranularity: 'topic', summaryThresholdMs: 24 * 60 * 60 * 1000 },
  { name: 'week', childGranularity: 'day', summaryThresholdMs: 7 * 24 * 60 * 60 * 1000 },
  { name: 'month', childGranularity: 'week', summaryThresholdMs: 4 * 7 * 24 * 60 * 60 * 1000 },
  { name: 'year', childGranularity: 'month', summaryThresholdMs: 365 * 24 * 60 * 60 * 1000 },
];

// ========== 记忆管理器 ==========
class MemoryManager {
  // 更新短期记忆（对话总结）
  async updateShortTermMemory(userMessage: string, aiResponse: string): Promise<void> {
    const config = getLLMConfig();

    // 构建总结prompt
    const summaryPrompt = `请总结以下对话，重点在于将已有总结和新消息结合起来：

${currentShortTermMemory ? `当前话题：${currentShortTermMemory.topic}\n已有总结：${currentShortTermMemory.summary}` : ''}
新一轮消息：
用户：${userMessage}
角色：${aiResponse}

请以JSON格式返回，不要包含其他任何内容以免影响解析：
{
  "topic": "话题名称（简短，几个字）",
  "summary": "对话总结（要简洁而全面，尽可能高密度地保留信息，最多500字左右，优先删除与新消息关联最小的内容）"
}`;

    try {
      const response = await callLLM({
        model: config.model,
        messages: [{ role: 'user', content: summaryPrompt }],
        temperature: 0.3
      });

      // 解析JSON响应
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        if (currentShortTermMemory && currentShortTermMemory.topic === parsed.topic) {
          // 同一话题，追加更新
          currentShortTermMemory.summary = parsed.summary;
          currentShortTermMemory.lastUpdateTime = new Date();
        } else {
          // 新话题，重置记忆
          currentShortTermMemory = {
            topic: parsed.topic,
            summary: parsed.summary,
            startTime: new Date(),
            lastUpdateTime: new Date()
          };
        }
      }
    } catch (error) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'agent', content: `Failed to update short-term memory: ${error}`, createdAt: new Date() });
    }
  }

  // 判断话题是否切换（由LLM判断）
  async shouldSwitchTopic(userMessage: string): Promise<boolean> {
    if (!currentShortTermMemory) {
      return false;
    }

    const config = getLLMConfig();

    const prompt = `当前对话话题是："${currentShortTermMemory.topic}"
当前话题内容是："${currentShortTermMemory.summary}"
用户新消息是："${userMessage}"

请判断用户有没有转换到新话题，如果是在继续当前话题，请回复"否"，如果切换了话题，请回复"是"。
只回复"是"或"否"。`;

    try {
      const response = await callLLM({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      });
      logDb.insert({ id: uuidv4(), level: 'debug', category: 'agent', content: `[Topic Switch Check]\nPrompt:\n${prompt}\nLLM Response:\n${response.content}`, createdAt: new Date() });
      return response.content.includes('是');
    } catch (error) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'agent', content: `Failed to check topic switch: ${error}`, createdAt: new Date() });
      return false;
    }
  }

  // 封存当前话题记忆
  async archiveCurrentTopic(): Promise<void> {
    if (!currentShortTermMemory) return;

    const memoryId = uuidv4();

    // 存入长期记忆
    const memory = {
      id: memoryId,
      granularity: 'topic' as const,
      content: currentShortTermMemory.summary,
      periodStart: currentShortTermMemory.startTime,
      periodEnd: currentShortTermMemory.lastUpdateTime,
      createdAt: new Date()
    };

    memoryDb.insert(memory);

    // 异步生成 embedding，不阻塞主进程
    generateAndStoreEmbedding('memory', memoryId, currentShortTermMemory.summary).catch(err => {
      logDb.insert({ id: uuidv4(), level: 'warn', category: 'embedding', content: `Failed to generate embedding for memory ${memoryId}: ${err}`, createdAt: new Date() });
    });
  }

  // 获取某粒度的最新总结时间
  private getLatestSummaryTime(granularity: string): Date | null {
    const memories = memoryDb.getByGranularity(granularity, 1);
    if (memories.length === 0) return null;
    return memories[0].periodEnd || memories[0].createdAt;
  }

  // 获取子粒度的最早记忆时间
  private getEarliestMemoryTime(granularity: string): Date | null {
    const memories = memoryDb.getByGranularity(granularity, 1000);
    if (memories.length === 0) return null;
    // 找最早的记忆
    let earliest = memories[0].periodStart || memories[0].createdAt;
    for (const m of memories) {
      const time = m.periodStart || m.createdAt;
      if (time < earliest) earliest = time;
    }
    return earliest;
  }

  // 检查并执行各级别总结（每次心跳时调用）
  async checkAndSummarizeAll(): Promise<void> {
    const now = new Date();

    for (const config of GRANULARITY_CONFIGS) {
      // 只处理day/week/month/year，不处理topic（topic是被汇总的下级）
      if (config.name === 'topic' || !config.childGranularity) continue;

      // 获取上一次总结的时间起点
      const lastSummary = this.getLatestSummaryTime(config.name);

      let summaryStart: Date;

      if (lastSummary) {
        // 有历史总结，从上次总结点开始检查
        summaryStart = lastSummary;
      } else {
        // 首次总结：检查子粒度的最早记忆是否已达到当前粒度的阈值要求
        // 例如：最早的day记忆是7天前的，才进行第一次week总结
        const earliestChild = this.getEarliestMemoryTime(config.childGranularity);
        if (!earliestChild) continue; // 没有子粒度记忆，不总结

        const elapsed = now.getTime() - earliestChild.getTime();
        if (elapsed < config.summaryThresholdMs) continue; // 子粒度时间未达阈值，不总结

        summaryStart = earliestChild;
      }

      // 检查是否达到总结条件（已过去足够时间）
      const elapsed = now.getTime() - summaryStart.getTime();
      if (elapsed >= config.summaryThresholdMs) {
        const gran = config.name as 'day' | 'week' | 'month' | 'year';
        await this.performSummaryFor(gran, config.childGranularity as 'topic' | 'day' | 'week' | 'month', summaryStart, now);
      }
    }
  }

  // 执行指定粒度的总结
  private async performSummaryFor(
    granularity: 'day' | 'week' | 'month' | 'year',
    subGranularity: 'topic' | 'day' | 'week' | 'month',
    startDate: Date,
    endDate: Date
  ): Promise<void> {
    // 召回子粒度级别的记忆
    const allSubMemories = memoryDb.getByGranularity(subGranularity, 1000);

    // 筛选在总结时间范围内的记忆
    const relevantMemories = allSubMemories.filter(m => {
      const periodEnd = m.periodEnd || m.createdAt;
      return periodEnd >= startDate && periodEnd <= endDate;
    });

    if (relevantMemories.length < 1) {
      return;
    }

    // 构建总结内容
    const memoryText = relevantMemories
      .map(m => `[${m.granularity}] ${this.formatTimeRange(m.periodStart, m.periodEnd)}: ${m.content}`)
      .join('\n---\n');

    const summaryPrompt = `请对以下一段时期的记忆进行汇总总结：

${memoryText}

请以JSON格式返回：
{"summary": "这段时期的整体总结"}`;

    try {
      const config = getLLMConfig();
      const response = await callLLM({
        model: config.model,
        messages: [{ role: 'user', content: summaryPrompt }],
        temperature: 0.3
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        const memoryId = uuidv4();

        // 存入长期记忆
        const memory = {
          id: memoryId,
          granularity,
          content: parsed.summary,
          periodStart: startDate,
          periodEnd: endDate,
          createdAt: endDate
        };

        memoryDb.insert(memory);

        // 异步生成 embedding，不阻塞主进程
        generateAndStoreEmbedding('memory', memoryId, parsed.summary).catch(err => {
          logDb.insert({ id: uuidv4(), level: 'warn', category: 'embedding', content: `Failed to generate embedding for summary ${memoryId}: ${err}`, createdAt: new Date() });
        });

        logDb.insert({ id: uuidv4(), level: 'info', category: 'agent', content: `Created ${granularity} summary with ${relevantMemories.length} sub-memories`, createdAt: endDate });
      }
    } catch (error) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'agent', content: `Failed to create ${granularity} summary: ${error}`, createdAt: new Date() });
    }
  }

  // 格式化时间范围
  private formatTimeRange(start: Date, end: Date | null): string {
    const endTime = end ? end.toLocaleString('zh-CN') : '现在';
    return `${start.toLocaleString('zh-CN')} - ${endTime}`;
  }

  // 获取当前短期记忆
  getCurrentShortTermMemory(): ShortTermMemory | null {
    return currentShortTermMemory;
  }

  // 随机召回一段记忆（用于主动交互）
  async recallRandomMemory(): Promise<Memory[]> {
    // 获取最近的话题记忆
    const memories = memoryDb.getByGranularity('topic', 10);
    if (memories.length === 0) {
      // 如果没有话题记忆，尝试获取日记忆
      const dayMemories = memoryDb.getByGranularity('day', 10);
      return dayMemories.slice(0, 1);
    }
    // 随机选择一个
    const randomIndex = Math.floor(Math.random() * memories.length);
    return [memories[randomIndex]];
  }

  // 启动时恢复未归档的对话并汇总为topic
  async recoverAndSummarizeUnarchived(): Promise<void> {
    // 1. 获取最后一个topic记忆的periodEnd作为分界线
    const lastTopicMemories = memoryDb.getByGranularity('topic', 1);
    const cutoffDate = lastTopicMemories.length > 0
      ? lastTopicMemories[0].periodEnd
      : new Date(0); // 1970-01-01 表示全量汇总

    // 2. 查询分界线后的所有对话
    const unarchivedDialogues = dialogueDb.getSince(cutoffDate);
    if (unarchivedDialogues.length === 0) {
      return;
    }

    // 3. 构建对话摘要prompt
    const dialogueText = unarchivedDialogues
      .map(d => `用户：${d.userContent}\n角色：${d.aiContent}`)
      .join('\n---\n');

    const summaryPrompt = `请总结以下一段时期的对话，提取核心话题和关键内容：

${dialogueText}

请以JSON格式返回，不要包含其他任何内容：
{
  "topic": "话题名称（简短，几个字）",
  "summary": "对话总结（要简洁而全面，尽可能高密度地保留信息，最多500字左右，优先删除与核心话题关联最小的内容）"
}`;

    // 4. 调用LLM生成总结
    const config = getLLMConfig();
    const response = await callLLM({
      model: config.model,
      messages: [{ role: 'user', content: summaryPrompt }],
      temperature: 0.3
    });

    // 5. 解析JSON响应
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'agent', content: `recoverAndSummarizeUnarchived: failed to parse LLM response`, createdAt: new Date() });
      return;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // 6. 存入memoryDb，granularity='topic'
    const firstDialogue = unarchivedDialogues[0];
    const lastDialogue = unarchivedDialogues[unarchivedDialogues.length - 1];

    const memoryId = uuidv4();

    const memory = {
      id: memoryId,
      granularity: 'topic' as const,
      content: parsed.summary,
      periodStart: firstDialogue.createdAt,
      periodEnd: lastDialogue.createdAt,
      createdAt: new Date()
    };

    memoryDb.insert(memory);

    // 异步生成 embedding，不阻塞主进程
    generateAndStoreEmbedding('memory', memoryId, parsed.summary).catch(err => {
      logDb.insert({ id: uuidv4(), level: 'warn', category: 'embedding', content: `Failed to generate embedding for recovered memory ${memoryId}: ${err}`, createdAt: new Date() });
    });

    logDb.insert({ id: uuidv4(), level: 'info', category: 'agent', content: `Recovered and summarized ${unarchivedDialogues.length} unarchived dialogues into topic: ${parsed.topic}`, createdAt: new Date() });
  }
}

// 导出单例
export const memoryManager = new MemoryManager();
export default MemoryManager;
