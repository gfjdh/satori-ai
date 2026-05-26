/**
 * 对话统计
 */

import { dialogueDb } from '../db/database.js';

export function getDialogueStats(): string {
  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const totalCount = dialogueDb.getTurnCount();
  const yearCount = dialogueDb.getCountSince(oneYearAgo);
  const monthCount = dialogueDb.getCountSince(oneMonthAgo);
  const weekCount = dialogueDb.getCountSince(oneWeekAgo);
  const dayCount = dialogueDb.getCountSince(oneDayAgo);

  const lastDialogue = dialogueDb.getLastDialogueTime();
  const timeSinceLast = lastDialogue
    ? Math.floor((now.getTime() - lastDialogue.getTime()) / 60000)
    : null;

  let stats = `## 对话统计
对话统计记录了角色与用户的互动频次，如果近期互动相比之前较少，可以适当向用户表达对他们的思念和关心。
- 总对话轮次：${totalCount}
- 最近一年：${yearCount}
- 最近一月：${monthCount}
- 最近一周：${weekCount}
- 最近一天：${dayCount}`;

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

export function getRecentDialoguesText(limit: number = 20): string {
  const recentDialogues = dialogueDb.getRecent(limit);
  return recentDialogues.reverse().map(d => {
    const time = d.createdAt.toISOString().replace('T', ' ').slice(0, 16);
    return d.userContent === '[Proactive]'
      ? `[${time}] 角色主动发起对话\n[${time}] 角色：${d.aiContent}`
      : `[${time}] 用户：${d.userContent}\n[${time}] 角色：${d.aiContent}`;
  }).join('\n');
}