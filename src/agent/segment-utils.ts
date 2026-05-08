/**
 * 公共工具函数
 */

import { Segment } from './types.js';

/**
 * 解析单行 JSON 为 Segment
 */
export function parseSegment(line: string): Segment | null {
  try {
    const obj = JSON.parse(line);
    if (obj.emotion && obj.action && obj.voice !== undefined) {
      return {
        emotion: obj.emotion,
        action: obj.action,
        voice: obj.voice,
        needDeepThink: obj.needDeepThink === true
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 从文本中提取所有 JSON Lines
 */
export function extractJSONLines(text: string): string[] {
  const lines = text.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && trimmed.startsWith('{') && trimmed.endsWith('}')) {
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * 通知前端 deep_think_pending
 */
export function sendDeepThinkPending(onSSE?: (message: any) => void): void {
  onSSE?.({ type: 'deep_think_pending', data: { value: true } });
}

/**
 * 发送 done 信号
 */
export function sendDone(onSSE?: (message: any) => void): void {
  onSSE?.({ type: 'done', data: {} });
}