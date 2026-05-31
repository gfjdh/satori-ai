/**
 * 公共工具函数
 */

import { Segment } from './types.js';
import { SSEMessage } from '../types/index.js';
import { synthesizeStream } from '../tts/client.js';

/**
 * 尝试修复常见的 LLM JSON 格式错误
 */
function repairJSON(text: string): string {
  let s = text.trim();

  // 1. 去掉 markdown 代码块包裹
  if (s.startsWith('```')) {
    s = s.replace(/^```\w*\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // 2. 去掉 JSON 前后的非 JSON 文本（找到第一个 { 和最后一个 }）
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    s = s.slice(firstBrace, lastBrace + 1);
  }

  // 3. 修复尾逗号
  s = s.replace(/,(\s*[}\]])/g, '$1');

  return s;
}

/**
 * 从任意文本中提取所有 JSON 对象（非行级，支持混合文本）
 */
function extractJSONObjects(text: string): string[] {
  const result: string[] = [];
  // 先去掉 markdown 代码块
  const cleaned = text.replace(/```\w*\n?/g, '').replace(/```/g, '');
  // 用栈匹配 { } 提取完整 JSON 对象
  let i = 0;
  while (i < cleaned.length) {
    if (cleaned[i] !== '{') { i++; continue; }
    let depth = 0;
    let inString = false;
    let escaped = false;
    const start = i;
    for (; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') { depth++; continue; }
      if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    if (depth === 0) {
      result.push(cleaned.slice(start, i));
    }
  }
  return result;
}

/**
 * 解析单行 JSON 为 Segment
 */
export function parseSegment(line: string): Segment | null {
  let repaired = repairJSON(line);
  if (!repaired || !repaired.startsWith('{')) return null;

  const candidates = extractJSONObjects(repaired);
  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate);
      if (obj.emotion && obj.voice !== undefined) {
        return {
          emotion: obj.emotion,
          action: obj.action || '',
          voice: obj.voice,
          subtitle: obj.subtitle
        };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * 流式提取完整 JSON 对象 — 花括号深度追踪
 * 返回已完成的 JSON 字符串数组 + 未闭合的剩余文本
 * 同时兼容单行 JSON 和多行 pretty-print JSON
 */
export function extractCompleteJSONObjects(text: string): { objects: string[]; remainder: string } {
  const objects: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  // 剩余：从最后一个完整对象之后，或从最后一个未闭合的 { 开始
  const remainder = start >= 0 ? text.slice(start) : '';

  return { objects, remainder };
}

/**
 * 从一段完整文本中提取所有 Segment（兜底用）
 */
export function extractAllSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const objects = extractJSONObjects(text);
  for (const objStr of objects) {
    const seg = parseSegment(objStr);
    if (seg) segments.push(seg);
  }
  return segments;
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
  const subtitle = seg.subtitle
    ? /[，。！？、；：…—,\.!\?;:\-]$/.test(seg.subtitle)
      ? seg.subtitle
      : seg.subtitle + '，'
    : undefined;

  onSSE?.({
    type: 'voice',
    data: {
      text: seg.voice,
      emotion: seg.emotion,
      language: speechLanguage,
      sentenceIndex
    }
  });

  try {
    const audioBuffer = await synthesizeStream(seg.voice, characterId, seg.emotion);
    onSSE?.({
      type: 'audio',
      data: { audio: audioBuffer.toString('base64'), action: seg.action, sentenceIndex }
    });

    if (subtitle && speechLanguage !== subtitleLanguage) {
      onSSE?.({
        type: 'subtitle',
        data: { text: subtitle, sentenceIndex }
      });
    }
  } catch {
    // TTS 失败不阻塞，字幕仍需发送
    if (subtitle && speechLanguage !== subtitleLanguage) {
      onSSE?.({
        type: 'subtitle',
        data: { text: subtitle, sentenceIndex }
      });
    }
  }

  return sentenceIndex + 1;
}