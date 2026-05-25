import { LLMRequest, LLMResponse } from '../types/index.js';
import { logDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

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
  const startTime = new Date();

  // 构建API路径
  let fullUrl: string;
  if (config.baseURL.endsWith('/v1') || config.baseURL.endsWith('/v3') || config.baseURL.includes('/v1/')) {
    fullUrl = `${config.baseURL}/chat/completions`;
  } else {
    fullUrl = config.baseURL;
  }

  logDb.insert({ id: uuidv4(), level: 'debug', category: 'api_call', content: `Request URL: ${fullUrl}`, createdAt: new Date() });

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
        const role = m.role === 'system' ? '【系统】' : m.role === 'user' ? '【用户】' : '【角色】';
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
  const startTime = new Date();

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
  } finally {
    reader.releaseLock();
  }

  // 流结束后写入统一日志
  if (logRequest) {
    const messagesContent = request.messages.map(m => {
      const role = m.role === 'system' ? '【系统】' : m.role === 'user' ? '【用户】' : '【角色】';
      const content = typeof m.content === 'string' ? m.content : '[多模态内容]';
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
