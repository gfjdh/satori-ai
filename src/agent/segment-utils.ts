/**
 * 公共工具函数
 */

import { Segment } from './types.js';
import { SSEMessage } from '../types/index.js';
import { synthesizeStream } from '../tts/client.js';

/**
 * 解析单行 JSON 为 Segment
 */
export function parseSegment(line: string): Segment | null {
  try {
    const obj = JSON.parse(line);
    if (obj.emotion && obj.voice !== undefined) {
      const action = obj.action || '';
      return {
        emotion: obj.emotion,
        action: action,
        voice: obj.voice,
        subtitle: obj.subtitle,
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

export async function emitSegment(
  seg: { voice: string; emotion: string; action: string; subtitle?: string },
  sentenceIndex: number,
  speechLanguage: string,
  subtitleLanguage: string,
  characterId: string,
  onSSE?: (message: SSEMessage) => void
): Promise<number> {
  onSSE?.({
    type: 'voice',
    data: {
      text: seg.voice,
      emotion: seg.emotion,
      action: seg.action,
      language: speechLanguage,
      sentenceIndex
    }
  });

  if (seg.subtitle && speechLanguage !== subtitleLanguage) {
    onSSE?.({
      type: 'subtitle',
      data: { text: seg.subtitle, sentenceIndex }
    });
  }

  try {
    const audioBuffer = await synthesizeStream(seg.voice, characterId, seg.emotion);
    onSSE?.({
      type: 'audio',
      data: { audio: audioBuffer.toString('base64'), sentenceIndex }
    });
  } catch {
    // TTS 失败不阻塞
  }

  return sentenceIndex + 1;
}