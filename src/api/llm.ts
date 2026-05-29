import { LLMRequest, LLMResponse, StreamChunk } from '../types/index.js';
import { logDb, now } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { getCharacterName } from '../character/loader.js';

dotenv.config();

// LLM配置接口
interface LLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
}

// 从环境变量获取配置
export function getLLMConfig(): LLMConfig {
  return {
    baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gpt-4',
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7')
  };
}

// 调用LLM API（统一日志记录）
export async function callLLM(request: LLMRequest, logRequest = true, signal?: AbortSignal): Promise<LLMResponse> {
  const config = getLLMConfig();

  if (!config.apiKey) {
    throw new Error('LLM API key not configured');
  }

  const logId = uuidv4();
  const startTime = now();

  // 构建API路径
  let fullUrl: string;
  if (config.baseURL.endsWith('/v1') || config.baseURL.endsWith('/v3') || config.baseURL.includes('/v1/')) {
    fullUrl = `${config.baseURL}/chat/completions`;
  } else {
    fullUrl = config.baseURL;
  }

  logDb.insert({ id: uuidv4(), level: 'debug', category: 'api_call', content: `Request URL: ${fullUrl}`, createdAt: now() });

  try {
    const requestBody: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      stream: false,
      thinking: request.thinking ? { type: 'enabled' } : { type: 'disabled' }
    };

    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const responseContent = data.choices[0]?.message?.content || '';

    // 统一日志记录：包含请求上下文和完整回复
    if (logRequest) {
      const messagesContent = request.messages.map(m => {
        const role = m.role === 'system' ? '【系统】' : m.role === 'user' ? '【用户】' : `【${getCharacterName()}】`;
        const content = typeof m.content === 'string' ? m.content : '[多模态内容]';
        return `${role}: ${content}`;
      }).join('\n');

      logDb.insert({
        id: logId,
        level: 'debug',
        category: 'llm_api',
        content: `[Request]\n${messagesContent}\n\n[Response]\n${responseContent}`,
        createdAt: startTime
      });
    }

    return {
      content: responseContent,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined
    };

  } catch (error) {
    logDb.insert({
      id: uuidv4(),
      level: 'error',
      category: 'llm_api',
      content: `LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
      createdAt: startTime
    });
    throw error;
  }
}

// 流式调用LLM（统一日志记录）
export async function* callLLMStream(
  request: LLMRequest,
  logRequest = true,
  purpose = '',
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const config = getLLMConfig();

  if (!config.apiKey) {
    throw new Error('LLM API key not configured');
  }

  const logId = uuidv4();
  const startTime = now();

  // 构建API路径
  let fullUrl: string;
  if (config.baseURL.endsWith('/v1') || config.baseURL.endsWith('/v3') || config.baseURL.includes('/v1/') || config.baseURL.includes('/v3/')) {
    fullUrl = `${config.baseURL}/chat/completions`;
  } else {
    fullUrl = config.baseURL;
  }

  const requestBody: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature ?? 0.7,
    stream: true,
    thinking: request.thinking ? { type: 'enabled' } : { type: 'disabled' }
  };

  const response = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(requestBody),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error: ${response.status} ${errorText}`);
  }

  if (!response.body) {
    throw new Error('Empty response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.substring(6);
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullContent += content;
              yield content;
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    }
  } catch (e: any) {
    // AbortError 是用户主动中断的正常行为，不应该抛出
    if (e?.name !== 'AbortError') throw e;
  } finally {
    reader.releaseLock();
  }

  // 流结束后写入统一日志
  if (logRequest) {
    const messagesContent = request.messages.map(m => {
      const role = m.role === 'system' ? '【系统】' : m.role === 'user' ? '【用户】' : `【${getCharacterName()}】`;
      const content = typeof m.content === 'string' ? m.content : (m.tool_calls ? `[tool_calls: ${m.tool_calls.length}]` : '[多模态内容]');
      return `${role}: ${content}`;
    }).join('\n');

    logDb.insert({
      id: logId,
      level: 'debug',
      category: 'llm_api',
      content: `[Request${purpose ? ` (${purpose})` : ''}]\n${messagesContent}\n\n[Response]\n${fullContent}`,
      createdAt: startTime
    });
  }
}

// 带 function calling 的流式调用
export async function* callLLMWithTools(
  request: LLMRequest,
  logRequest = true,
  purpose = '',
  signal?: AbortSignal
): AsyncGenerator<StreamChunk, void, unknown> {
  const config = getLLMConfig();

  if (!config.apiKey) {
    throw new Error('LLM API key not configured');
  }

  const logId = uuidv4();
  const startTime = now();

  let fullUrl: string;
  if (config.baseURL.endsWith('/v1') || config.baseURL.endsWith('/v3') || config.baseURL.includes('/v1/') || config.baseURL.includes('/v3/')) {
    fullUrl = `${config.baseURL}/chat/completions`;
  } else {
    fullUrl = config.baseURL;
  }

  const requestBody: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature ?? 0.7,
    stream: true,
    thinking: request.thinking ? { type: 'enabled' } : { type: 'disabled' }
  };

  if (request.tools && request.tools.length > 0) {
    requestBody.tools = request.tools;
    requestBody.tool_choice = request.tool_choice || 'auto';
  }

  const response = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(requestBody),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error: ${response.status} ${errorText}`);
  }

  if (!response.body) {
    throw new Error('Empty response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  const toolCallAccum: { id: string; name: string; arguments: string }[] = [];
  const seenIds = new Set<string>();

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.substring(6);
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            // text delta
            if (delta?.content) {
              fullContent += delta.content;
              yield { kind: 'text', delta: delta.content };
            }

            // tool call delta
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index: number = tc.index ?? 0;
                if (!toolCallAccum[index]) {
                  toolCallAccum[index] = { id: '', name: '', arguments: '' };
                }
                const acc = toolCallAccum[index];

                if (tc.id) {
                  acc.id = tc.id;
                  acc.name = tc.function?.name || acc.name;
                  if (!seenIds.has(tc.id)) {
                    seenIds.add(tc.id);
                    yield { kind: 'tool_call_start', id: tc.id, name: acc.name };
                  }
                }
                if (tc.function?.arguments) {
                  acc.arguments += tc.function.arguments;
                  yield { kind: 'tool_call_delta', id: acc.id, delta: tc.function.arguments };
                }
              }
            }

            // flush completed tool calls on finish_reason
            if (parsed.choices?.[0]?.finish_reason === 'tool_calls') {
              for (const acc of toolCallAccum) {
                if (acc.id) {
                  yield { kind: 'tool_call_end', id: acc.id, name: acc.name, arguments: acc.arguments };
                }
              }
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError') throw e;
  } finally {
    reader.releaseLock();
  }

  if (logRequest) {
    const messagesContent = request.messages.map(m => {
      const role = m.role === 'system' ? '【系统】' : m.role === 'user' ? '【用户】' : m.role === 'tool' ? '【工具】' : `【${getCharacterName()}】`;
      const content = typeof m.content === 'string' ? m.content : (m.tool_calls ? `[tool_calls: ${m.tool_calls.length}]` : '[多模态内容]');
      return `${role}: ${content}`;
    }).join('\n');

    logDb.insert({
      id: logId,
      level: 'debug',
      category: 'llm_api',
      content: `[Request${purpose ? ` (${purpose})` : ''}]\n${messagesContent}\n\n[Response]\n${fullContent}${toolCallAccum.length ? '\n[tool_calls: ' + toolCallAccum.filter(a => a.id).map(a => `${a.name}(${a.arguments.slice(0, 200)})`).join(', ') + ']' : ''}`,
      createdAt: startTime
    });
  }
}
