/**
 * 对话统计
 */

import { dialogueDb, now } from '../db/database.js';
import { getCharacterName } from '../character/loader.js';
import { getCurrentCharacterId } from '../character/knowledge.js';

function formatDailyAvg(count: number, periodDays: number, since: Date, firstTime: Date | null): string {
  if (firstTime === null) return '';
  const effectiveStart = since > firstTime ? since : firstTime;
  const days = Math.max(1, Math.ceil((now().getTime() - effectiveStart.getTime()) / 86400000));
  const divisor = Math.min(days, periodDays);
  const avg = count / divisor;
  return ` (日均${avg.toFixed(1)}轮)`;
}

export function getDialogueStats(): string {
  const characterId = getCurrentCharacterId();
  const nowTime = now();
  const oneYearAgo = new Date(nowTime.getTime() - 365 * 24 * 60 * 60 * 1000);
  const oneSeasonAgo = new Date(nowTime.getTime() - 90 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(nowTime.getTime() - 30 * 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(nowTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(nowTime.getTime() - 24 * 60 * 60 * 1000);

  const totalCount = dialogueDb.getUserTurnCount(characterId);
  const yearCount = dialogueDb.getDialogueCountSince(oneYearAgo, characterId);
  const seasonCount = dialogueDb.getDialogueCountSince(oneSeasonAgo, characterId);
  const monthCount = dialogueDb.getDialogueCountSince(oneMonthAgo, characterId);
  const weekCount = dialogueDb.getDialogueCountSince(oneWeekAgo, characterId);
  const dayCount = dialogueDb.getDialogueCountSince(oneDayAgo, characterId);

  const firstTime = dialogueDb.getFirstDialogueTime(characterId);
  const lastDialogue = dialogueDb.getLastDialogueTime(characterId);
  const timeSinceLast = lastDialogue
    ? Math.floor((nowTime.getTime() - lastDialogue.getTime()) / 60000)
    : null;

  const elapsedDays = firstTime
    ? Math.ceil((nowTime.getTime() - firstTime.getTime()) / 86400000)
    : 0;

  let stats = `## 对话统计
对话统计记录了${getCharacterName()}与用户的互动频次，如果近期互动相比之前较少，可以适当向用户表达对他们的思念和关心。`;

  if (elapsedDays >= 365) {
    stats += `\n- 总对话轮次：${totalCount}${formatDailyAvg(totalCount, Infinity, firstTime ?? nowTime, firstTime)}`;
  }
  if (elapsedDays >= 90) {
    stats += `\n- 最近一年：${yearCount}${formatDailyAvg(yearCount, 365, oneYearAgo, firstTime)}`;
  }
  if (elapsedDays >= 30) {
    stats += `\n- 最近一季：${seasonCount}${formatDailyAvg(seasonCount, 90, oneSeasonAgo, firstTime)}`;
  }
  if (elapsedDays >= 7) {
    stats += `\n- 最近一月：${monthCount}${formatDailyAvg(monthCount, 30, oneMonthAgo, firstTime)}`;
  }
  if (elapsedDays >= 1) {
    stats += `\n- 最近一周：${weekCount}${formatDailyAvg(weekCount, 7, oneWeekAgo, firstTime)}`;
  }
  stats += `\n- 最近一天：${dayCount}`;

  if (timeSinceLast !== null) {
    if (timeSinceLast < 1) stats += `\n- 距离上次对话：刚刚`;
    else if (timeSinceLast < 60) stats += `\n- 距离上次对话：${timeSinceLast}分钟`;
    else {
      const hours = Math.floor(timeSinceLast / 60);
      stats += `\n- 距离上次对话：${hours}小时`;
    }
  } else {
    stats += `\n- 距离上次对话：无记录`;
  }

  return stats;
}

export interface RecentDialoguesOptions {
  /** 过滤掉 [Proactive] 条目并单独归入"已说过的话"section */
  excludeProactive?: boolean;
  /** 只返回此时间之后的对话（用于和 memory 金字塔去重） */
  sinceDate?: Date;
  /** 仅返回用户发言，每条一行（用于预检索 keyword 提取） */
  userOnly?: boolean;
}

export function getRecentDialoguesText(
  limit: number = 20,
  timeLimitHours: number = 1,
  options?: RecentDialoguesOptions
): string {
  const characterId = getCurrentCharacterId();
  let recentDialogues = dialogueDb.getRecent(limit, characterId);
  const cutoff = new Date(now().getTime() - timeLimitHours * 60 * 60 * 1000);

  const sinceDate = options?.sinceDate;
  if (sinceDate) {
    recentDialogues = recentDialogues.filter(d => d.createdAt >= sinceDate!);
  }

  const proactiveLabel = '## 你最近主动说过的话（绝对不要重复这些话题）：';
  const dialogueLabel = '## 最近对话：';

  if (options?.userOnly) {
    return recentDialogues
      .filter(d => d.createdAt >= cutoff && d.userContent !== '[Proactive]')
      .reverse()
      .map(d => d.userContent)
      .join('\n');
  }

  if (options?.excludeProactive) {
    const proactiveLines: string[] = [];
    const dialogueLines: string[] = [];

    recentDialogues.filter(d => d.createdAt >= cutoff).reverse().forEach(d => {
      const time = d.createdAt.toISOString().replace('T', ' ').slice(0, 16);
      if (d.userContent === '[Proactive]') {
        proactiveLines.push(`[${time}] ${getCharacterName()}：${d.aiContent}`);
      } else {
        dialogueLines.push(`[${time}] 用户：${d.userContent}\n[${time}] ${getCharacterName()}：${d.aiContent}`);
      }
    });

    const parts: string[] = [];
    if (proactiveLines.length > 0) {
      parts.push(proactiveLabel + '\n' + proactiveLines.join('\n'));
    }
    if (dialogueLines.length > 0) {
      parts.push(dialogueLabel + '\n' + dialogueLines.join('\n'));
    }
    return parts.join('\n\n');
  }

  return "### 最近对话\n" +
    recentDialogues.filter(d => d.createdAt >= cutoff).reverse().map(d => {
    const time = d.createdAt.toISOString().replace('T', ' ').slice(0, 16);
    return d.userContent === '[Proactive]'
      ? `[${time}] ${getCharacterName()}主动发起对话\n[${time}] ${getCharacterName()}：${d.aiContent}`
      : `[${time}] 用户：${d.userContent}\n[${time}] ${getCharacterName()}：${d.aiContent}`;
  }).join('\n');
}