/**
 * Web Surfing Skill — 浏览器上网
 *
 * 通过 HTTP 调用 browser 微服务（Python/Playwright，端口 8743），
 * 提供网页导航、内容阅读、JS 执行和页面交互能力。
 */

import type { ToolDef } from '../../types/index.js';

const BROWSER_SERVICE = 'http://127.0.0.1:8743';

async function browserFetch(endpoint: string, body: Record<string, unknown>): Promise<string> {
  const resp = await fetch(`${BROWSER_SERVICE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000)
  });
  const data = await resp.json() as Record<string, unknown>;
  if (!resp.ok) {
    return `Browser error: ${data.error || `HTTP ${resp.status}`}`;
  }
  return JSON.stringify(data);
}

// ========== Tool Handlers ==========

async function handleNavigate(params: Record<string, unknown>): Promise<string> {
  const url = (params.url as string)?.trim();
  if (!url) return 'url 参数为空';
  try {
    return await browserFetch('/navigate', { url });
  } catch (e) {
    return `Browser service unavailable: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function handleObserve(params: Record<string, unknown>): Promise<string> {
  const page = (params.page as number) ?? 0;
  try {
    return await browserFetch('/observe', { page });
  } catch (e) {
    return `Browser service unavailable: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function handleExecuteJs(params: Record<string, unknown>): Promise<string> {
  const script = (params.script as string)?.trim();
  if (!script) return 'script 参数为空';
  try {
    return await browserFetch('/execute_js', { script });
  } catch (e) {
    return `Browser service unavailable: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function handleClick(params: Record<string, unknown>): Promise<string> {
  const selector = (params.selector as string)?.trim();
  if (!selector) return 'selector 参数为空';
  try {
    return await browserFetch('/click', { selector });
  } catch (e) {
    return `Browser service unavailable: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function handleType(params: Record<string, unknown>): Promise<string> {
  const selector = (params.selector as string)?.trim();
  const text = (params.text as string) ?? '';
  if (!selector) return 'selector 参数为空';
  try {
    return await browserFetch('/type', { selector, text });
  } catch (e) {
    return `Browser service unavailable: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ========== Tool 注册 ==========

export const toolDefs: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'web_navigate',
      description: '联网搜索/浏览网页。打开指定 URL 获取互联网上的实时信息，为后续 observe/click/type 操作做准备。当用户要求搜索、查询网上信息时使用此工具。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要访问的网址' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_observe',
      description: '阅读当前页面的内容。返回分页的文本内容、可交互按钮列表和输入框列表。首次调用(page=0)会标记所有可交互元素并分配 data-alife-id。可指定页码翻阅更多内容。',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: '页码，默认0。翻页时递增' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_execute_js',
      description: '在当前页面执行任意 JavaScript 代码。常用于操作页面元素（如 document.querySelector(\'[data-alife-id="el-X"]\').click()）。返回脚本执行结果和 console 输出。',
      parameters: {
        type: 'object',
        properties: {
          script: { type: 'string', description: '要执行的 JavaScript 代码' }
        },
        required: ['script']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_click',
      description: '点击页面上的可交互元素。selector 可以是 data-alife-id（如 el-5）或 CSS 选择器。',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: '元素选择器（data-alife-id 或 CSS selector）' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_type',
      description: '在输入框元素中输入文本。selector 可以是 data-alife-id 或 CSS 选择器。',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: '输入框选择器' },
          text: { type: 'string', description: '要输入的文本' }
        },
        required: ['selector', 'text']
      }
    }
  }
];

export const toolHandlers: Record<string, (params: Record<string, unknown>) => Promise<string>> = {
  web_navigate: handleNavigate,
  web_observe: handleObserve,
  web_execute_js: handleExecuteJs,
  web_click: handleClick,
  web_type: handleType,
};
