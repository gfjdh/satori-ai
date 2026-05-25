/**
 * Image Analysis Skill — 图像分析入口
 *
 * 分析路径：
 * - 若提供 imageBase64：直接调用 /analyze 接口
 * - 否则：调用 /capture 接口（由 Python 服务通过 mss 截图）
 *
 * 结果包含 OCR 文本提取 + YOLO26n 物体检测 + 可选 VLLM 增强
 */

import { analyzeImage, captureAndAnalyze } from './client.js';

interface ImageAnalysisParams {
  useVLLM?: boolean;
  preciseOCR?: boolean;
  query?: string;
  imageBase64?: string;
}

export async function imageAnalysis(params: ImageAnalysisParams): Promise<string> {
  const useVllm = params.useVLLM ?? false;
  const preciseOCR = params.preciseOCR ?? false;
  const query = params.query;

  let result;
  if (params.imageBase64) {
    result = await analyzeImage(params.imageBase64, useVllm, preciseOCR, query);
  } else {
    result = await captureAndAnalyze(useVllm, preciseOCR, query);
  }

  if (!result.success) {
    throw new Error(`Image analysis failed: ${result.error || 'unknown error'}`);
  }

  const ocrCount = result.ocr_results.length;
  const detCount = result.detection_results.length;
  const elapsed = result.elapsed_ms;
  const modeLabel = preciseOCR ? '精确' : '快速';

  let output = `[图像分析结果] [${modeLabel}模式] OCR: ${ocrCount}条 | 检测: ${detCount}个 | 耗时: ${elapsed.toFixed(0)}ms\n\n`;

  if (ocrCount > 0) {
    output += '--- OCR 识别（置信度+文本） ---\n';
    for (const item of result.ocr_results) {
      output += `  [${(item.confidence * 100).toFixed(0)}%] ${item.text}\n`;
    }
    output += '\n';
  } else {
    output += '--- OCR 未识别到文本 ---\n\n';
  }

  if (detCount > 0) {
    output += '--- 物体检测 ---\n';
    for (const item of result.detection_results) {
      output += `  [${(item.confidence * 100).toFixed(0)}%] ${item.class_name}\n`;
    }
    output += '\n';
  } else {
    output += '--- 未检测到物体 ---\n\n';
  }

  if (result.vllm_result) {
    output += `--- VLLM 描述 ---\n${result.vllm_result}\n`;
  }

  return output;
}

export default imageAnalysis;
export type { ImageAnalysisParams };
