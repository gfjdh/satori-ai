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

// 调用LLM API
export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  const config = getLLMConfig();

  if (!config.apiKey) {
    throw new Error('LLM API key not configured');
  }

  const logId = uuidv4();
  const startTime = new Date();

  // 构建API路径
  // 情况1: baseURL 包含 /v1 或 /v3 → 加 /chat/completions
  // 情况2: baseURL 是其他格式（如 /anthropic）→ 直接使用 baseURL（无额外路径）
  let fullUrl: string;
  if (config.baseURL.endsWith('/v1') || config.baseURL.endsWith('/v3') || config.baseURL.includes('/v1/')) {
    fullUrl = `${config.baseURL}/chat/completions`;
  } else {
    // 非 v1/v3 格式，baseURL 本身就是完整端点
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
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    // 提取消息内容用于日志（限制长度，避免数据库过大）
    const messagesContent = request.messages.map(m => {
      const role = m.role === 'system' ? '【系统】' : m.role === 'user' ? '【用户】' : '【角色】';
      const content = typeof m.content === 'string' ? m.content : '[多模态内容]';
      return `${role}: ${content.substring(0, 5000)}`;
    }).join('\n');

    const responseContent = data.choices[0]?.message?.content || '';

    // 记录详细日志（响应截断到4000字符，保证能看到完整的skill结果）
    logDb.insert({
      id: logId,
      level: 'debug',
      category: 'api_call',
      content: `[Request]\n${messagesContent}\n\n[Response]\n${responseContent.substring(0, 4000)}`,
      createdAt: startTime
    });

    return {
      content: responseContent,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined
    };

  } catch (error) {
    // 记录错误日志
    logDb.insert({
      id: uuidv4(),
      level: 'error',
      category: 'api_call',
      content: `LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
      createdAt: startTime
    });

    throw error;
  }
}

// 流式调用LLM
export async function* callLLMStream(
  request: LLMRequest
): AsyncGenerator<string, void, unknown> {
  const config = getLLMConfig();

  if (!config.apiKey) {
    throw new Error('LLM API key not configured');
  }

  // 构建API路径
  let fullUrl: string;
  if (config.baseURL.includes('/v1')) {
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
    body: JSON.stringify(requestBody)
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

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.substring(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
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
}
