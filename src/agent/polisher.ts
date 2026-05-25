/**
 * Polisher Agent
 *
 * 结合深度分析结果和初次回复，流式生成续接内容。
 * 输出为 AsyncGenerator<Segment>，由 unified-agent 负责 SSE/TTS 包装。
 *
 * v5: 接受 ChatMessage[] 直接调用，消息构建由 unified-agent 负责。
 */

import { logDb } from '../db/database.js';
import { callLLMStream, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import { parseSegment } from './segment-utils.js';
import { Segment } from './types.js';
import type { ChatMessage } from './prompts.js';

/**
 * 流式生成 Polisher segments。
 * unified-agent 用 for-await-of 消费，逐段推送到前端。
 */
export async function* streamPolisherSegments(
  messages: ChatMessage[],
  signal?: AbortSignal,
  logLabel?: string
): AsyncGenerator<Segment, void, unknown> {
  const config = getLLMConfig();

  const response = callLLMStream(
    { model: config.model, messages, temperature: 0.7 },
    true,
    logLabel || 'polisher',
    signal
  );

  let fullResponse = '';
  let buffer = '';

  for await (const chunk of response) {
    if (signal?.aborted) break;
    buffer += chunk;

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;

      const seg = parseSegment(trimmed);
      if (seg) {
        fullResponse += trimmed + '\n';
        yield seg;
      }
    }
  }

  const remaining = buffer.trim();
  if (remaining && remaining.startsWith('{')) {
    const seg = parseSegment(remaining);
    if (seg) {
      fullResponse += remaining;
      yield seg;
    }
  }

  logDb.insert({
    id: uuidv4(),
    level: 'debug',
    category: 'agent',
    content: `[Polisher ${logLabel || ''}]:\n${fullResponse}`,
    createdAt: new Date()
  });
}
