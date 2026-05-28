import { memoryDb, logDb, dialogueDb, now } from '../db/database.js';
import { stateManager } from '../state/manager.js';
import { callLLM, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import { Memory, Dialogue } from '../types/index.js';
import { generateAndStoreEmbedding } from '../retrieval/vector-search.js';
import { getCharacterName } from '../character/loader.js';
import { getCurrentCharacterId } from '../character/knowledge.js';
import { userProfileManager } from '../user/profile.js';

// 当前话题追踪（不做逐轮总结，只在话题切换时归档）
let currentTopicStartTime: Date | null = null;

// 记忆层级配置
interface GranularityConfig {
  name: 'topic' | 'day' | 'week' | 'month' | 'season' | 'year';
  childGranularity: 'topic' | 'day' | 'week' | 'month' | 'season' | null;
  summaryThresholdMs: number;  // 触发总结的时间阈值
}

const GRANULARITY_CONFIGS: GranularityConfig[] = [
  { name: 'day', childGranularity: 'topic', summaryThresholdMs: 24 * 60 * 60 * 1000 },
  { name: 'week', childGranularity: 'day', summaryThresholdMs: 7 * 24 * 60 * 60 * 1000 },
  { name: 'month', childGranularity: 'week', summaryThresholdMs: 4 * 7 * 24 * 60 * 60 * 1000 },
  { name: 'season', childGranularity: 'month', summaryThresholdMs: 90 * 24 * 60 * 60 * 1000 },
  { name: 'year', childGranularity: 'season', summaryThresholdMs: 365 * 24 * 60 * 60 * 1000 },
];

const ARCHIVE_PROMPT = `总结要求：综合考虑此段记忆未来被调用的场景和目的，无状态地去存储信息，例如把“明天”替换成具体日期，把“最近”替换成具体时间范围等。
请以JSON格式返回，不要包含其他任何内容：
{
  "topic": "话题名称（简短，几个字）",
  "summary": "对话总结（要简洁而全面，尽可能高密度地保留信息，最多200字左右）",
  "user_state": "从对话推断用户当前状态：在做什么、工作/生活节奏、情绪状态等。无信息则填'未知'。50字内。"
}`;

// ========== 记忆管理器 ==========
class MemoryManager {
  // 确保当前话题有时间起点
  ensureTopicTracking(): void {
    if (!currentTopicStartTime) {
      currentTopicStartTime = now();
    }
  }

  // 判断话题是否切换（由LLM判断）
  async shouldSwitchTopic(userMessage: string): Promise<boolean> {
    if (!currentTopicStartTime) return false;

    const config = getLLMConfig();

    const recentDialogues = dialogueDb.getCharacterDialogueSince(currentTopicStartTime, getCurrentCharacterId());
    if (recentDialogues.length <= 5) return false;
    if (recentDialogues.length >= 20) return true;

    const dialogueText = recentDialogues.map(d =>
      d.userContent === '[Proactive]' ? `${getCharacterName()}：${d.aiContent}` : `用户：${d.userContent}\n${getCharacterName()}：${d.aiContent}`
    ).join('\n');

    const prompt = `最近对话：
${dialogueText}
用户新消息是："${userMessage}"

话题的标准是：一件含有具体意义的事物或事件，简单寒暄或互动并不算是话题，所以不算做切换话题。
例如，从寒暄引入其他话题或者在讨论某些话题时讲了些无关紧要的话都不算是切换话题，只有引入了新事物并且转移了讨论中心才能算是切换话题。
如果当前对话较长（8轮对话以上）且用户消息与之前的对话内容没有明显关联，或者引入了新的事物/事件/活动等，也可以判断为切换了话题。

请判断用户有没有转换到新话题，如果是在继续当前话题，请回复"没有切换话题"，如果切换了话题，请回复"切换了话题"。
只回复"切换了话题"或"没有切换话题"。`;

    try {
      const response = await callLLM({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      });
      return response.content.includes('切换了话题');
    } catch (error) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'agent', content: `Failed to check topic switch: ${error}`, createdAt: now() });
      return false;
    }
  }

  // 将对话列表格式化为文本，带时间信息
  private buildDialogueText(dialogues: Dialogue[]): string {
    return dialogues.map(d => {
      const time = this.formatTimestamp(d.createdAt);
      return d.userContent === '[Proactive]'
        ? `[${time}] ${getCharacterName()}：${d.aiContent}`
        : `[${time}] 用户：${d.userContent}\n[${time}] ${getCharacterName()}：${d.aiContent}`;
    }).join('\n---\n');
  }

  // 构建归档总结 prompt
  private buildArchivePrompt(dialogueText: string): string {
    return `请总结以下一段对话，提取核心话题和关键内容：

${dialogueText}

${ARCHIVE_PROMPT}`;
  }

  // 调用LLM生成总结并存入topic记忆
  private async summarizeAndStoreTopic(dialogues: Dialogue[], logAction: string): Promise<void> {
    const dialogueText = this.buildDialogueText(dialogues);
    const summaryPrompt = this.buildArchivePrompt(dialogueText);

    const config = getLLMConfig();
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
      userState: parsed.user_state || null,
      periodStart: firstDialogue.createdAt,
      periodEnd: lastDialogue.createdAt,
      createdAt: now()
    };

    memoryDb.insert(memory);

    generateAndStoreEmbedding('memory', memoryId, parsed.summary).catch(err => {
      logDb.insert({ id: uuidv4(), level: 'warn', category: 'embedding', content: `Failed to generate embedding for memory ${memoryId}: ${err}`, createdAt: now() });
    });

    logDb.insert({ id: uuidv4(), level: 'info', category: 'agent', content: `${logAction} "${parsed.topic}" with ${dialogues.length} dialogues`, createdAt: now() });
  }

  // 封存当前话题：拉取原始对话 → LLM总结 → 存入topic记忆
  async archiveCurrentTopic(): Promise<void> {
    if (!currentTopicStartTime) return;

    const dialogues = dialogueDb.getCharacterDialogueSince(currentTopicStartTime, getCurrentCharacterId());
    if (dialogues.length === 0) return;

    try {
      await this.summarizeAndStoreTopic(dialogues, 'Archived topic');
      currentTopicStartTime = now();
    } catch (error) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'agent', content: `Failed to archive topic: ${error}`, createdAt: now() });
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
    const nowTime = now();

    for (const config of GRANULARITY_CONFIGS) {
      // 只处理day/week/month/year，不处理topic（topic是被汇总的下级）
      if (config.name === 'topic' || !config.childGranularity) continue;

      // Day 使用凌晨4点日界线逻辑，避免"两个半天拼成一天"的问题
      if (config.name === 'day') {
        const today4AM = new Date(nowTime);
        today4AM.setUTCHours(4, 0, 0, 0);
        if (nowTime < today4AM) continue;

        const lastSummary = this.getLatestSummaryTime('day');
        if (lastSummary && lastSummary >= today4AM) continue;

        let summaryStart: Date;
        if (lastSummary) {
          summaryStart = lastSummary;
        } else {
          const earliestChild = this.getEarliestMemoryTime(config.childGranularity);
          if (!earliestChild) continue;
          summaryStart = earliestChild;
        }

        const result = await this.performSummaryFor('day', 'topic', summaryStart, today4AM);
        if (result) {
          await userProfileManager.summarizeFromMemories(result.summaryContent, result.relevantMemories);
        }
        continue;
      }

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

        const elapsed = nowTime.getTime() - earliestChild.getTime();
        if (elapsed < config.summaryThresholdMs) continue; // 子粒度时间未达阈值，不总结

        summaryStart = earliestChild;
      }

      // 检查是否达到总结条件（已过去足够时间）
      const elapsed = nowTime.getTime() - summaryStart.getTime();
      if (elapsed >= config.summaryThresholdMs) {
        const gran = config.name as 'day' | 'week' | 'month' | 'season' | 'year';
        const result = await this.performSummaryFor(gran, config.childGranularity as 'topic' | 'day' | 'week' | 'month', summaryStart, nowTime);
        if (result && gran === 'day') {
          await userProfileManager.summarizeFromMemories(result.summaryContent, result.relevantMemories);
        }
      }
    }
  }

  // 执行指定粒度的总结
  private async performSummaryFor(
    granularity: 'day' | 'week' | 'month' | 'season' | 'year',
    subGranularity: 'topic' | 'day' | 'week' | 'month' | 'season',
    startDate: Date,
    endDate: Date
  ): Promise<{ summaryContent: string; relevantMemories: Memory[] } | null> {
    // 召回子粒度级别的记忆
    const allSubMemories = memoryDb.getByGranularity(subGranularity, 1000);

    // 筛选在总结时间范围内的记忆
    const relevantMemories = allSubMemories.filter(m => {
      const periodEnd = m.periodEnd || m.createdAt;
      return periodEnd >= startDate && periodEnd <= endDate;
    });

    if (relevantMemories.length < 1) {
      return null;
    }

    // 构建总结内容（包含此时段用户状态）
    const memoryText = relevantMemories
      .map(m => {
        const base = `[${m.granularity}] ${this.formatTimeRange(m.periodStart, m.periodEnd)}: ${m.content}`;
        return m.userState ? `${base}\n此时段用户状态: ${m.userState}` : base;
      })
      .join('\n---\n');

    const summaryPrompt = `请对以下一段时期的记忆进行汇总总结：

${memoryText}
总结要求：综合考虑此段记忆未来被调用的场景和目的，无状态地去存储信息，例如把“明天”替换成具体日期，把“最近”替换成具体时间范围等。
在保留主要内容的同时尽可能简洁，提取核心内容，以最高效的方式存储信息。500字以内。
请以JSON格式返回：
{"summary": "这段时期对话内容的整体总结", "user_state": "根据对话分析这段时间用户的状态，要考虑包括但不限于时间、作息、行为、目标、变化趋势等因素，尽可能完整反映这段时间用户的日程和状态。100字内。"}`;

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
          userState: parsed.user_state || null,
          periodStart: startDate,
          periodEnd: endDate,
          createdAt: endDate
        };

        memoryDb.insert(memory);

        // 异步生成 embedding，不阻塞主进程
        generateAndStoreEmbedding('memory', memoryId, parsed.summary).catch(err => {
          logDb.insert({ id: uuidv4(), level: 'warn', category: 'embedding', content: `Failed to generate embedding for summary ${memoryId}: ${err}`, createdAt: now() });
        });

        logDb.insert({ id: uuidv4(), level: 'info', category: 'agent', content: `Created ${granularity} summary with ${relevantMemories.length} sub-memories`, createdAt: endDate });

        return { summaryContent: parsed.summary, relevantMemories };
      }
    } catch (error) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'agent', content: `Failed to create ${granularity} summary: ${error}`, createdAt: now() });
    }
    return null;
  }

  // 格式化单个时间戳（DB 时间已迁移到 UTC+8，直接用 getUTC*() 取墙面时钟）
  private formatTimestamp(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return `${y}/${m}/${day} ${h}:${min}`;
  }

  // 格式化时间范围
  private formatTimeRange(start: Date, end: Date | null): string {
    const endTime = end ? this.formatTimestamp(end) : '现在';
    return `${this.formatTimestamp(start)} - ${endTime}`;
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

    const fmt = (m: Memory): string => m.userState ? `- ${m.content}（此时段用户状态: ${m.userState}）` : `- ${m.content}`;

    // 自上次日总结以来，所有 topic 粒度记忆
    const dayCutoff = latestDay.length > 0 ? latestDay[0].periodEnd : new Date(0);
    const recentTopics = this.getMemoriesSince('topic', dayCutoff);
    if (recentTopics.length > 0) {
      parts.push('### 近期话题\n' + recentTopics.map(fmt).join('\n'));
    }

    // 自上次周总结以来，所有 day 粒度记忆
    const weekCutoff = latestWeek.length > 0 ? latestWeek[0].periodEnd : new Date(0);
    const recentDays = this.getMemoriesSince('day', weekCutoff);
    if (recentDays.length > 0) {
      parts.push('### 近日总结\n' + recentDays.map(fmt).join('\n'));
    }

    // 自上次月总结以来，所有 week 粒度记忆
    const monthCutoff = latestMonth.length > 0 ? latestMonth[0].periodEnd : new Date(0);
    const recentWeeks = this.getMemoriesSince('week', monthCutoff);
    if (recentWeeks.length > 0) {
      parts.push('### 近周总结\n' + recentWeeks.map(fmt).join('\n'));
    }

    // 自上次季总结以来，所有 month 粒度记忆
    const seasonCutoff = latestSeason.length > 0 ? latestSeason[0].periodEnd : new Date(0);
    const recentMonths = this.getMemoriesSince('month', seasonCutoff);
    if (recentMonths.length > 0) {
      parts.push('### 近月总结\n' + recentMonths.map(fmt).join('\n'));
    }

    // 自上次年总结以来，所有 season 粒度记忆
    const yearCutoff = latestYear.length > 0 ? latestYear[0].periodEnd : new Date(0);
    const recentSeasons = this.getMemoriesSince('season', yearCutoff);
    if (recentSeasons.length > 0) {
      parts.push('### 近季总结\n' + recentSeasons.map(fmt).join('\n'));
    }

    // 最近一条年总结
    if (latestYear.length > 0) {
      parts.push('### 年度总结\n' + latestYear.map(fmt).join('\n'));
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

  // 加权随机选择 day 记忆（排除最近一周，新近度加权，用于主动交互）
  async recallRandomDayMemory(): Promise<Memory | null> {
    const allDays = memoryDb.getByGranularity('day', 100000);
    if (allDays.length === 0) return null;

    const nowTime = now();

    // 过滤：排除最近7天内的记忆
    const candidates = allDays
      .map(m => ({ memory: m, daysAgo: (nowTime.getTime() - (m.periodStart || m.createdAt).getTime()) / 86400000 }))
      .filter(c => c.daysAgo >= 7);

    if (candidates.length === 0) return null;

    const scored = candidates.map(c => ({
      memory: c.memory,
      weight: 1 / (1 + c.daysAgo * 0.1)
    }));

    const totalWeight = scored.reduce((sum, s) => sum + s.weight, 0);
    let threshold = Math.random() * totalWeight;
    for (const s of scored) {
      threshold -= s.weight;
      if (threshold <= 0) return s.memory;
    }
    return scored[scored.length - 1].memory;
  }

  // 启动时恢复未归档的对话并汇总为topic
  async recoverAndSummarizeUnarchived(): Promise<void> {
    const lastTopicMemories = memoryDb.getByGranularity('topic', 1);
    const cutoffDate = lastTopicMemories.length > 0
      ? lastTopicMemories[0].periodEnd
      : new Date(0);

    const unarchivedDialogues = dialogueDb.getAllDialogueSince(cutoffDate);
    if (unarchivedDialogues.length === 0) return;

    try {
      await this.summarizeAndStoreTopic(unarchivedDialogues, 'Recovered and summarized');
      currentTopicStartTime = now();
    } catch (error) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'agent', content: `Failed to recover unarchived dialogues: ${error}`, createdAt: now() });
    }
  }
}

// 导出单例
export const memoryManager = new MemoryManager();
export default MemoryManager;
