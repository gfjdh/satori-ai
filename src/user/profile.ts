import { stateDb, logDb } from '../db/database.js';
import { callLLM, getLLMConfig } from '../api/llm.js';
import { getCurrentCharacterId } from '../character/knowledge.js';
import type { UserProfile, UserProfileEntry, Memory } from '../types/index.js';

const PROFILE_KEY = 'user_profile';
const MAX_ENTRIES = 60;
const MAX_CONTEXT_ENTRIES = 30;

const CATEGORIES = ['identity', 'preference', 'aversion', 'requirement', 'habit', 'fact'] as const;

const SUMMARIZE_PROMPT = `你是一个用户画像分析器。根据最近一天的对话记忆，更新用户画像。

## 类别
- identity: 身份信息（姓名、年龄、职业、性别）
- preference: 喜好
- aversion: 厌恶/禁忌
- requirement: 长期要求
- habit: 习惯
- fact: 其他事实

## 重要性评分标准（0-50）
45-50: 核心身份（姓名、年龄、性别、职业）
35-44: 重要个人特征（生日、家庭成员、过敏信息）
25-34: 长期稳定偏好/禁忌（宗教饮食限制、根深蒂固的好恶）
15-24: 一般偏好/习惯（喜欢的食物、日常作息）
5-14: 临时/变化中信息（近期兴趣、短期目标）
1-4: 琐碎信息（随口提的小事）

## key 命名规则
- 使用简短的标题
- 要有语义，能一眼看出是什么信息
- 示例：名字，年龄，工作，生日，喜爱食物

## 规则
1. 每条信息必须独立、原子化。不要在一个条目里堆砌多种信息，也不要把同一类信息分多个条目，如果出现这种情况，尝试拆分或合并成合理的条目。
2. 只输出与现有画像相比有变化的条目。没有变化的条目不输出。
3. 如果某条旧信息被新信息覆盖/矛盾，放入 modified；如果某条信息已过时或用户明确否定了，放入 deleted。

## 输出格式（严格JSON，不要其他内容）
{
  "added": [
    { "key": "字段名", "category": "类别", "content": "内容描述", "importance": 数字 }
  ],
  "modified": [
    { "key": "已有字段名", "content": "更新后的内容", "importance": 数字 }
  ],
  "deleted": ["要删除的字段名"]
}`;

class UserProfileManager {
  getProfile(): UserProfile {
    const characterId = getCurrentCharacterId();
    const raw = stateDb.get(characterId, PROFILE_KEY);
    if (!raw) {
      return { entries: [], lastSummarizedAt: '' };
    }
    try {
      return JSON.parse(raw);
    } catch {
      return { entries: [], lastSummarizedAt: '' };
    }
  }

  private saveProfile(profile: UserProfile): void {
    const characterId = getCurrentCharacterId();
    stateDb.set(characterId, PROFILE_KEY, JSON.stringify(profile));
  }

  async summarizeFromMemories(
    daySummaryContent: string,
    topicMemories: Memory[]
  ): Promise<void> {
    const profile = this.getProfile();
    const now = new Date().toISOString();

    const topicsText = topicMemories
      .map(m => {
        const base = `[${m.periodStart?.toString() || ''}] ${m.content}`;
        return m.userState ? `${base}\n用户状态: ${m.userState}` : base;
      })
      .join('\n---\n');

    const prompt = `## 现有用户画像
${JSON.stringify(profile.entries, null, 2)}

## 最近一天的对话总结
${daySummaryContent}

## 该时段内的详细话题记忆
${topicsText}

请根据以上信息，输出画像的增删改（JSON格式）：`;

    try {
      const config = getLLMConfig();
      const response = await callLLM({
        model: config.model,
        messages: [
          { role: 'system', content: SUMMARIZE_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        thinking: true
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logDb.insert({
          id: crypto.randomUUID(),
          level: 'warn',
          category: 'user_profile',
          content: `Failed to parse LLM response as JSON: ${response.content.slice(0, 200)}`,
          createdAt: new Date()
        });
        return;
      }

      const delta = JSON.parse(jsonMatch[0]);
      this.applyDelta(profile, delta, now);
      profile.lastSummarizedAt = now;
      this.saveProfile(profile);

      const addedCount = delta.added?.length ?? 0;
      const modifiedCount = delta.modified?.length ?? 0;
      const deletedCount = delta.deleted?.length ?? 0;
      logDb.insert({
        id: crypto.randomUUID(),
        level: 'info',
        category: 'user_profile',
        content: `Profile updated: +${addedCount} ~${modifiedCount} -${deletedCount}, total ${profile.entries.length} entries`,
        createdAt: new Date()
      });
    } catch (error) {
      logDb.insert({
        id: crypto.randomUUID(),
        level: 'error',
        category: 'user_profile',
        content: `Failed to summarize profile: ${error}`,
        createdAt: new Date()
      });
    }
  }

  private applyDelta(
    profile: UserProfile,
    delta: { added?: Array<{ key: string; category: string; content: string; importance: number }>; modified?: Array<{ key: string; content?: string; importance?: number }>; deleted?: string[] },
    now: string
  ): void {
    // 新增
    for (const item of delta.added ?? []) {
      if (!item.key || !item.content) continue;
      const category = CATEGORIES.includes(item.category as typeof CATEGORIES[number]) ? item.category : 'fact';
      profile.entries.push({
        key: item.key,
        category,
        content: item.content,
        importance: Math.max(0, Math.min(50, Math.round(item.importance ?? 10))),
        createdAt: now,
        updatedAt: now
      });
    }

    // 修改
    for (const item of delta.modified ?? []) {
      if (!item.key) continue;
      const existing = profile.entries.find(e => e.key === item.key);
      if (existing) {
        if (item.content !== undefined) existing.content = item.content;
        if (item.importance !== undefined) existing.importance = Math.max(0, Math.min(50, Math.round(item.importance)));
        existing.updatedAt = now;
      } else if (item.content) {
        // key 不存在，视为新增
        profile.entries.push({
          key: item.key,
          category: 'fact',
          content: item.content,
          importance: Math.max(0, Math.min(50, Math.round(item.importance ?? 10))),
          createdAt: now,
          updatedAt: now
        });
      }
    }

    // 删除
    if (delta.deleted) {
      const deleteSet = new Set(delta.deleted);
      profile.entries = profile.entries.filter(e => !deleteSet.has(e.key));
    }

    // 去重：同 key 保留最新的
    const seen = new Map<string, UserProfileEntry>();
    for (const e of profile.entries) {
      const existing = seen.get(e.key);
      if (!existing || e.updatedAt > existing.updatedAt) {
        seen.set(e.key, e);
      }
    }
    profile.entries = Array.from(seen.values());

    // 淘汰：超出上限按 importance ASC, updatedAt ASC 删除
    if (profile.entries.length > MAX_ENTRIES) {
      profile.entries.sort((a, b) => {
        const impDiff = a.importance - b.importance;
        if (impDiff !== 0) return impDiff;
        return a.updatedAt.localeCompare(b.updatedAt);
      });
      profile.entries = profile.entries.slice(profile.entries.length - MAX_ENTRIES);
    }
  }

  getProfileContext(): string {
    const profile = this.getProfile();
    if (profile.entries.length === 0) return '';

    // 按 importance 降序
    const sorted = [...profile.entries].sort((a, b) => b.importance - a.importance);
    const topEntries = sorted.slice(0, MAX_CONTEXT_ENTRIES);

    // 按 category 分组
    const categoryLabels: Record<string, string> = {
      identity: '身份信息',
      preference: '喜好',
      aversion: '厌恶',
      requirement: '长期要求',
      habit: '习惯',
      fact: '其他'
    };

    const groups = new Map<string, UserProfileEntry[]>();
    for (const e of topEntries) {
      const existing = groups.get(e.category);
      if (existing) {
        existing.push(e);
      } else {
        groups.set(e.category, [e]);
      }
    }

    // 按固定顺序输出类别
    const lines: string[] = [];
    for (const cat of CATEGORIES) {
      const entries = groups.get(cat);
      if (!entries || entries.length === 0) continue;
      lines.push(`[用户画像 - ${categoryLabels[cat] || cat}]`);
      for (const e of entries) {
        lines.push(`- ${e.key}: ${e.content}`);
      }
    }

    return lines.join('\n');
  }
}

export const userProfileManager = new UserProfileManager();
export default UserProfileManager;
