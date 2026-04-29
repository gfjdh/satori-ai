/**
 * 图像分析脚本
 *
 * 功能：分析图片内容，支持本地路径或屏幕截图
 * 配置：通过环境变量 SKILL_IMAGE_ANALYSIS_* 传递
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logDb } from '../../../db/database.js';

// 从环境变量获取 Vision LLM 配置
function getVisionConfig() {
  return {
    baseURL: process.env.SKILL_IMAGE_ANALYSIS_BASE_URL || process.env.VISION_LLM_BASE_URL || '',
    apiKey: process.env.SKILL_IMAGE_ANALYSIS_API_KEY || process.env.VISION_LLM_API_KEY || '',
    model: process.env.SKILL_IMAGE_ANALYSIS_MODEL || process.env.VISION_LLM_MODEL || 'gpt-4-vision-preview'
  };
}

// 调用 Vision LLM
async function callVisionLLM(imageBase64: string, prompt: string): Promise<string> {
  const config = getVisionConfig();

  if (!config.apiKey) {
    throw new Error('Vision LLM API key not configured');
  }

  // 构建 API 路径
  let fullUrl: string;
  if (config.baseURL.includes('/v1') || config.baseURL.includes('/v3')) {
    fullUrl = `${config.baseURL}/chat/completions`;
  } else {
    fullUrl = config.baseURL;
  }

  logDb.insert({ id: uuidv4(), level: 'debug', category: 'screen_analysis', content: `Calling Vision LLM: ${config.model}`, createdAt: new Date() });

  const response = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${imageBase64}`
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vision LLM API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content || '';
}

// 读取图片为 base64
function readImageAsBase64(imagePath: string): string | null {
  try {
    const ext = path.extname(imagePath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)) {
      logDb.insert({ id: uuidv4(), level: 'error', category: 'screen_analysis', content: `Unsupported image format: ${ext}`, createdAt: new Date() });
      return null;
    }

    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
  } catch (error) {
    logDb.insert({ id: uuidv4(), level: 'error', category: 'screen_analysis', content: `Failed to read image: ${imagePath}: ${error}`, createdAt: new Date() });
    return null;
  }
}

// 截图功能（需要 Electron 环境）
function captureScreen(): string | null {
  logDb.insert({ id: uuidv4(), level: 'info', category: 'screen_analysis', content: 'Screen capture not implemented (needs Electron)', createdAt: new Date() });
  return null;
}

// 构建分析提示词
function buildPrompt(query?: string): string {
  const basePrompt = '请详细描述这张图片的内容，包括：\n1. 图片中的主要对象/人物\n2. 场景/背景\n3. 如果有的话，描述正在进行的活动';

  if (query) {
    return `${basePrompt}\n4. 用户特别关注的问题：${query}`;
  }
  return basePrompt;
}

// 解析描述结果
function parseDescription(rawDescription: string): { description: string; objects: string[]; activity: string } {
  const lines = rawDescription.split('\n').filter(l => l.trim());

  return {
    description: rawDescription,
    objects: lines.filter(l => l.includes('对象') || l.includes('人物') || l.includes('物品'))
      .map(l => l.replace(/^[^\w]+/, '').trim()),
    activity: lines.find(l => l.includes('活动') || l.includes('正在')) || '未知活动'
  };
}

/**
 * 图像分析入口
 */
export async function imageAnalysis(input: {
  imagePaths?: string[];
  query?: string;
}): Promise<{
  success: boolean;
  description: string;
  objects: string[];
  activity: string;
  source: 'screen' | 'file';
  timestamp: string;
  error?: string;
}> {
  const { imagePaths, query } = input;
  const timestamp = new Date().toISOString();

  try {
    let imageBase64: string;
    let source: 'screen' | 'file';

    if (!imagePaths || imagePaths.length === 0) {
      const screenCapture = captureScreen();
      if (!screenCapture) {
        return {
          success: false,
          description: '',
          objects: [],
          activity: '',
          source: 'screen',
          timestamp,
          error: '屏幕截图功能不可用，请提供图片路径'
        };
      }
      imageBase64 = screenCapture;
      source = 'screen';
    } else {
      const imagePath = imagePaths[0];
      if (!fs.existsSync(imagePath)) {
        return {
          success: false,
          description: '',
          objects: [],
          activity: '',
          source: 'file',
          timestamp,
          error: `图片文件不存在: ${imagePath}`
        };
      }

      const base64 = readImageAsBase64(imagePath);
      if (!base64) {
        return {
          success: false,
          description: '',
          objects: [],
          activity: '',
          source: 'file',
          timestamp,
          error: '无法读取图片文件'
        };
      }
      imageBase64 = base64;
      source = 'file';
    }

    const prompt = buildPrompt(query);
    const rawDescription = await callVisionLLM(imageBase64, prompt);
    const parsed = parseDescription(rawDescription);

    return {
      success: true,
      description: parsed.description,
      objects: parsed.objects,
      activity: parsed.activity,
      source,
      timestamp
    };

  } catch (error) {
    logDb.insert({ id: uuidv4(), level: 'error', category: 'screen_analysis', content: `Analysis failed: ${error}`, createdAt: new Date() });
    return {
      success: false,
      description: '',
      objects: [],
      activity: '',
      source: 'file',
      timestamp,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export default imageAnalysis;
