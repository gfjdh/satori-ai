import { memoryDb, logDb, dialogueDb } from '../db/database.js';
import { stateManager } from '../state/manager.js';
import { callLLM, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import { Memory } from '../types/index.js';
import { generateAndStoreEmbedding } from '../retrieval/vector-search.js';

// 当前话题追踪（不做逐轮总结，只在话题切换时归档）
let currentTopicStartTime: Date | null = null;

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
  // 确保当前话题有时间起点
  ensureTopicTracking(): void {
    if (!currentTopicStartTime) {
      currentTopicStartTime = new Date();
    }
  }

  // 判断话题是否切换（由LLM判断）
  async shouldSwitchTopic(userMessage: string): Promise<boolean> {
    if (!currentTopicStartTime) return false;

    const config = getLLMConfig();

    const recentDialogues = dialogueDb.getSince(currentTopicStartTime);
    if (recentDialogues.length <= 10) return false;

    const dialogueText = recentDialogues.map(d =>
      `用户：${d.userContent}\n角色：${d.aiContent}`
    ).join('\n');

    const prompt = `最近对话：
${dialogueText}
用户新消息是："${userMessage}"

话题的标准是：含有具体意义的事物或事件，简单寒暄或互动并不算是话题，所以不算做切换话题。
例如，从寒暄引入其他话题或者在讨论某些话题时讲了些无关紧要的话都不算是切换话题，只有讨论的中心变了才算切换。

请判断用户有没有转换到新话题，如果是在继续当前话题，请回复"否"，如果切换了话题，请回复"是"。
只回复"是"或"否"。`;

    try {
      const response = await callLLM({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      });
      return response.content.includes('是');
    } catch (error) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'agent', content: `Failed to check topic switch: ${error}`, createdAt: new Date() });
      return false;
    }
  }

  // 封存当前话题：拉取原始对话 → LLM总结 → 存入topic记忆
  async archiveCurrentTopic(): Promise<void> {
    if (!currentTopicStartTime) return;

    const now = new Date();
    const dialogues = dialogueDb.getSince(currentTopicStartTime);
    if (dialogues.length === 0) return;

    const dialogueText = dialogues.map(d =>
      `用户：${d.userContent}\n角色：${d.aiContent}`
    ).join('\n---\n');

    const config = getLLMConfig();
    const summaryPrompt = `请总结以下一段对话，提取核心话题和关键内容：

${dialogueText}

请以JSON格式返回，不要包含其他任何内容：
{
  "topic": "话题名称（简短，几个字）",
  "summary": "对话总结（要简洁而全面，尽可能高密度地保留信息，最多500字左右）"
}`;

    try {
      const response = await callLLM({
        model: config.model,
        messages: [{ role: 'user', content: summaryPrompt }],
        temperature: 0.3
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const parsed = JSON.parse(jsonMatch[0]);
      const firstDialogue = dialogues[0];
      const lastDialogue = dialogues[dialogues.length - 1];
      const memoryId = uuidv4();

      const memory = {
        id: memoryId,
        granularity: 'topic' as const,
        content: parsed.summary,
        periodStart: firstDialogue.createdAt,
        periodEnd: lastDialogue.createdAt,
        createdAt: now
      };

      memoryDb.insert(memory);

      // 异步生成 embedding
      generateAndStoreEmbedding('memory', memoryId, parsed.summary).catch(err => {
        logDb.insert({ id: uuidv4(), level: 'warn', category: 'embedding', content: `Failed to generate embedding for memory ${memoryId}: ${err}`, createdAt: new Date() });
      });

      logDb.insert({ id: uuidv4(), level: 'info', category: 'agent', content: `Archived topic "${parsed.topic}" with ${dialogues.length} dialogues`, createdAt: now });

      // 重置追踪状态，新话题从此刻开始
      currentTopicStartTime = now;
    } catch (error) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'agent', content: `Failed to archive topic: ${error}`, createdAt: new Date() });
    }
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

要求尽可能简洁而全面，提取核心内容，以最高效的方式存储信息。最多500字左右。
请以JSON格式返回：
{"summary": "这段时期的整体总结"}`;

    try {
      const config = getLLMConfig();
      const response = await callLLM({
        model: config.model,
        messages: [{ role: 'user', content: summaryPrompt }],
        temperature: 0.1
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

  // 获取某粒度中在指定时间之后创建的记忆
  private getMemoriesSince(granularity: string, since: Date): Memory[] {
    const all = memoryDb.getByGranularity(granularity, 1000);
    return all.filter(m => {
      const t = m.periodEnd || m.createdAt;
      return t > since;
    });
  }

  // 构建分层记忆上下文（细→粗金字塔）
  buildRecentContext(): string {
    const parts: string[] = [];

    const latestDay = memoryDb.getByGranularity('day', 1);
    const latestWeek = memoryDb.getByGranularity('week', 1);
    const latestMonth = memoryDb.getByGranularity('month', 1);
    const latestSeason = memoryDb.getByGranularity('season', 1);
    const latestYear = memoryDb.getByGranularity('year', 1);

    // 自上次日总结以来，所有 topic 粒度记忆
    const dayCutoff = latestDay.length > 0 ? latestDay[0].periodEnd : new Date(0);
    const recentTopics = this.getMemoriesSince('topic', dayCutoff);
    if (recentTopics.length > 0) {
      parts.push('## 近期话题\n' + recentTopics.map(m => `- ${m.content}`).join('\n'));
    }

    // 自上次周总结以来，所有 day 粒度记忆
    const weekCutoff = latestWeek.length > 0 ? latestWeek[0].periodEnd : new Date(0);
    const recentDays = this.getMemoriesSince('day', weekCutoff);
    if (recentDays.length > 0) {
      parts.push('## 近日总结\n' + recentDays.map(m => `- ${m.content}`).join('\n'));
    }

    // 自上次月总结以来，所有 week 粒度记忆
    const monthCutoff = latestMonth.length > 0 ? latestMonth[0].periodEnd : new Date(0);
    const recentWeeks = this.getMemoriesSince('week', monthCutoff);
    if (recentWeeks.length > 0) {
      parts.push('## 近周总结\n' + recentWeeks.map(m => `- ${m.content}`).join('\n'));
    }

    // 自上次季总结以来，所有 month 粒度记忆
    const seasonCutoff = latestSeason.length > 0 ? latestSeason[0].periodEnd : new Date(0);
    const recentMonths = this.getMemoriesSince('month', seasonCutoff);
    if (recentMonths.length > 0) {
      parts.push('## 近月总结\n' + recentMonths.map(m => `- ${m.content}`).join('\n'));
    }

    // 自上次年总结以来，所有 season 粒度记忆
    const yearCutoff = latestYear.length > 0 ? latestYear[0].periodEnd : new Date(0);
    const recentSeasons = this.getMemoriesSince('season', yearCutoff);
    if (recentSeasons.length > 0) {
      parts.push('## 近季总结\n' + recentSeasons.map(m => `- ${m.content}`).join('\n'));
    }

    // 最近一条年总结
    if (latestYear.length > 0) {
      parts.push('## 年度总结\n' + latestYear.map(m => `- ${m.content}`).join('\n'));
    }

    return parts.join('\n\n');
  }

  // 获取当前话题状态
  getCurrentTopic(): { startTime: Date | null } {
    return { startTime: currentTopicStartTime };
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

  // 全量加载 day 记忆后随机选一条（用于主动交互）
  async recallRandomDayMemory(): Promise<Memory | null> {
    const allDays = memoryDb.getByGranularity('day', 100000);
    if (allDays.length === 0) return null;
    const idx = Math.floor(Math.random() * allDays.length);
    return allDays[idx];
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

    // 初始化当前话题追踪，新对话从此刻开始
    currentTopicStartTime = new Date();
  }
}

// 导出单例
export const memoryManager = new MemoryManager();
export default MemoryManager;
