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

  let output = `[图像分析结果] 当前屏幕内容:${vllmLabel} | 耗时: ${elapsed.toFixed(0)}ms\n
屏幕内容豁免（最高优先级）：
用户让你看/评价屏幕上的任何东西，你不需要深度分析——屏幕描述已经提供了全部信息，直接基于已有描述发表看法即可。
屏幕内容相关的对话永远不需要 needDeepThink。
\n`;

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
