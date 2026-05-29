/**
 * Image Analysis Skill — 图像分析入口
 *
 * 分析路径：
 * - 若提供 imageBase64：直接调用 /analyze 接口
 * - 否则：调用 /capture 接口（由 Python 服务通过 mss 截图）
 *
 * 结果由 Vision LLM 生成（快速/详细两种模式，仅提示词不同）
 */

import { analyzeImage, captureAndAnalyze } from './client.js';
import { logDb, now } from '../../db/database.js';

interface ImageAnalysisParams {
  vllmMode?: string;
  query?: string;
  imageBase64?: string;
}

export async function imageAnalysis(params: ImageAnalysisParams): Promise<string> {
  const vllmMode = params.vllmMode ?? 'fast';
  const query = params.query;
  const startTime = Date.now();

  let result;
  if (params.imageBase64) {
    result = await analyzeImage(params.imageBase64, vllmMode, query);
  } else {
    result = await captureAndAnalyze(vllmMode, query);
  }

  const elapsed = Date.now() - startTime;

  if (!result.success) {
    logDb.insert({
      id: crypto.randomUUID(),
      level: 'error',
      category: 'image_analysis',
      content: JSON.stringify({ input: query ?? '', elapsed_ms: elapsed, error: result.error }),
      createdAt: now(),
    });
    throw new Error(`Image analysis failed: ${result.error || 'unknown error'}`);
  }

  const vllmLabel = vllmMode === 'detailed' ? '详细' : '快速';

  let output = `[图像分析结果] 当前屏幕内容:${vllmLabel} | 耗时: ${elapsed.toFixed(0)}ms\n\n`;

  if (result.vllm_result) {
    output += `--- 当前屏幕内容（${vllmLabel}） ---\n${result.vllm_result}\n`;
  } else {
    output += '--- 未获取到 当前屏幕内容 结果 ---\n';
  }

  logDb.insert({
    id: crypto.randomUUID(),
    level: 'info',
    category: 'image_analysis',
    content: JSON.stringify({ input: query ?? '', elapsed_ms: elapsed, output: output }),
    createdAt: now(),
  });

  return output;
}

export default imageAnalysis;
export type { ImageAnalysisParams };

// ========== Tool 注册（由 read_skill 动态加载） ==========

import type { ToolDef } from '../../types/index.js';

export const toolDefs: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'image_analysis',
      description: '通过Vision LLM分析当前屏幕截图。主动调用时优先使用detailed模式。不要在同一轮对话中重复调用。',
      parameters: {
        type: 'object',
        properties: {
          vllmMode: { type: 'string', enum: ['fast', 'detailed', 'none'], description: '分析模式：fast=快速简述，detailed=详细描述，none=不启用VLLM。默认fast，主动调用优先detailed' },
          query: { type: 'string', description: '需要在图像中查找的信息（可选）' }
        },
        required: []
      }
    }
  }
];

export const toolHandlers: Record<string, (params: Record<string, unknown>) => Promise<string>> = {
  image_analysis: async (params: Record<string, unknown>) => {
    return await imageAnalysis(params as unknown as ImageAnalysisParams);
  }
};
