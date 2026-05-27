/**
 * TTS 客户端 - 调用 Python TTS 服务 (Standalone 模式)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { logDb } from '../db/database.js';

const CHARACTER_CARDS_DIR = path.join(process.cwd(), 'character-cards');

// Python TTS 服务配置
const TTS_SERVICE_HOST = process.env.TTS_SERVICE_HOST || '127.0.0.1';
const TTS_SERVICE_PORT = parseInt(process.env.TTS_SERVICE_PORT || '5030');

// 缓存
const configCache = new Map<string, TTSConfig>();
const emotionTextCache = new Map<string, Record<string, string>>();

interface TTSConfig {
  characterId: string;
  ttsFolder: string;
  rate: number;
  numLayers: number;
  embeddingDim: number;
  dict: string;
  bertPath: string;
  symbol: string[];
  addBlank: boolean;
}

export interface TTSResult {
  audio: Buffer;
  sampleRate: number;
  duration: number;
}

interface HttpResponse {
  data: unknown;
  statusCode: number;
}

/**
 * HTTP POST 请求
 */
function httpPost(host: string, port: number, pathStr: string, body: Record<string, unknown>, timeout = 120000): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: host,
      port,
      path: pathStr,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout,
    };

    const req = (port === 443 ? https : http).request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        try {
          const json = JSON.parse(data.toString());
          resolve({ data: json, statusCode: res.statusCode || 0 });
        } catch {
          resolve({ data: data.toString(), statusCode: res.statusCode || 0 });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * HTTP POST 请求（流式响应，直接返回 Buffer）
 */
function httpPostStream(host: string, port: number, pathStr: string, body: Record<string, unknown>, timeout = 120000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: host,
      port,
      path: pathStr,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout,
    };

    const req = (port === 443 ? https : http).request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * 加载角色卡 TTS 配置
 */
export function loadTTSConfig(characterId: string): TTSConfig {
  if (configCache.has(characterId)) {
    return configCache.get(characterId)!;
  }

  const ttsDir = path.join(CHARACTER_CARDS_DIR, characterId, 'TTS');
  const configFiles = fs.readdirSync(ttsDir)
    .filter(f => f.endsWith('.json') && f !== 'ONNX_USAGE.md' && f !== 'emotions.json');

  if (configFiles.length === 0) {
    logDb.insert({
      'id': crypto.randomUUID(),
      level: 'warn',
      category: 'TTS',
      content: `No TTS config found for character: ${characterId}`,
      createdAt: new Date()
    });
    throw new Error(`No TTS config found for character: ${characterId}`);
  }

  const configPath = path.join(ttsDir, configFiles[0]);
  const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  const config: TTSConfig = {
    characterId,
    ttsFolder: configData.Folder || '',
    rate: configData.Rate || 32000,
    numLayers: configData.NumLayers || 24,
    embeddingDim: configData.EmbeddingDim || 512,
    dict: configData.Dict || 'BasicDict',
    bertPath: configData.BertPath || 'chinese-roberta-wwm-ext-large',
    symbol: configData.Symbol || [],
    addBlank: configData.AddBlank || false
  };

  configCache.set(characterId, config);
  return config;
}

/**
 * 切换Python后端的TTS模型
 */
export async function switchTTSModel(characterId: string): Promise<boolean> {
  // 清理Node端缓存
  configCache.delete(characterId);
  emotionTextCache.delete(characterId);
  
  try {
    const { data, statusCode } = await httpPost(TTS_SERVICE_HOST, TTS_SERVICE_PORT, '/api/switch_model', { character_id: characterId });
    if (statusCode === 200 && (data as any)?.success) {
      return true;
    }
    return false;
  } catch (error) {
    logDb.insert({
      id: crypto.randomUUID(),
      level: 'error',
      category: 'TTS',
      content: `Failed to switch TTS model for character ${characterId}: ${(error as Error).message}`,
      createdAt: new Date()
    });
    
    return false;
  }
}

/**
 * 加载情感文本映射
 */
function loadEmotionTextMapping(characterId: string): Record<string, string> {
  if (emotionTextCache.has(characterId)) {
    return emotionTextCache.get(characterId)!;
  }

  const emotionsPath = path.join(CHARACTER_CARDS_DIR, characterId, 'TTS', 'example', 'emotions.json');

  if (fs.existsSync(emotionsPath)) {
    const data = JSON.parse(fs.readFileSync(emotionsPath, 'utf-8'));
    emotionTextCache.set(characterId, data);
    return data;
  }

  return {};
}

/**
 * 获取可用情感列表
 */
export function getAvailableEmotions(characterId: string): string[] {
  const exampleDir = path.join(CHARACTER_CARDS_DIR, characterId, 'TTS', 'example');
  if (!fs.existsSync(exampleDir)) {
    return ['normal'];
  }

  const files = fs.readdirSync(exampleDir)
    .filter(f => f.endsWith('.wav'))
    .map(f => f.replace('.wav', ''));

  return files.length > 0 ? files : ['normal'];
}

/**
 * 获取情感对应的参考音频路径和文本
 */
export function getEmotionAudioInfo(characterId: string, emotion?: string): { refAudioPath: string; promptText: string } {
  const exampleDir = path.join(CHARACTER_CARDS_DIR, characterId, 'TTS', 'example');
  const emotions = loadEmotionTextMapping(characterId);

  // 1. 优先使用情感对应的音频
  if (emotion) {
    const emotionPath = path.join(exampleDir, `${emotion}.wav`);
    if (fs.existsSync(emotionPath)) {
      return {
        refAudioPath: emotionPath,
        promptText: emotions[emotion] || ''
      };
    }
  }

  // 2. 降级使用 normal.wav
  const normalPath = path.join(exampleDir, 'normal.wav');
  if (fs.existsSync(normalPath)) {
    return {
      refAudioPath: normalPath,
      promptText: emotions['normal'] || ''
    };
  }

  // 3. 查找任意 .wav
  const files = fs.readdirSync(exampleDir).filter(f => f.endsWith('.wav'));
  if (files.length > 0) {
    const audioName = files[0].replace('.wav', '');
    return {
      refAudioPath: path.join(exampleDir, files[0]),
      promptText: emotions[audioName] || ''
    };
  }

  throw new Error(`No example audio found for character: ${characterId}`);
}

/**
 * 调用 Python TTS 服务进行语音合成
 */
export async function synthesize(
  text: string,
  characterId: string,
  emotion?: string,
  promptText?: string
): Promise<Buffer> {
  const { refAudioPath } = getEmotionAudioInfo(characterId, emotion);
  const refText = promptText || '';

  const body = {
    ref_audio_path: refAudioPath,
    prompt_text: refText,
    text,
    ref_language: 'ja',
    text_language: 'ja'
  };

  try {
    const { data, statusCode } = await httpPost(TTS_SERVICE_HOST, TTS_SERVICE_PORT, '/api/synthesize', body);

    if (statusCode >= 400) {
      throw new Error(`TTS API error: ${statusCode}`);
    }

    const response = data as { success: boolean; audio_base64?: string; sample_rate?: number; duration?: number; error?: string };

    if (!response.success) {
      throw new Error(response.error || 'TTS synthesis failed');
    }

    // 解码 base64 音频
    return Buffer.from(response.audio_base64!, 'base64');
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string; errno?: string };
    const errMsg = err.message || err.code || err.errno || 'unknown';
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
      throw new Error(`TTS service is not running at ${TTS_SERVICE_HOST}:${TTS_SERVICE_PORT} (${errMsg})`);
    }
    throw error;
  }
}

/**
 * 调用 Python TTS 服务进行语音合成（流式，直接返回音频Buffer）
 */
export async function synthesizeStream(
  text: string,
  characterId: string,
  emotion?: string,
  promptText?: string
): Promise<Buffer> {
  const { refAudioPath, promptText: emotionPromptText } = getEmotionAudioInfo(characterId, emotion);
  const refText = promptText || emotionPromptText || '';

  const body = {
    ref_audio_path: refAudioPath,
    prompt_text: refText,
    text,
    ref_language: 'ja',
    text_language: 'ja'
  };

  try {
    const { data, statusCode } = await httpPost(TTS_SERVICE_HOST, TTS_SERVICE_PORT, '/api/synthesize', body);

    if (statusCode >= 400) {
      throw new Error(`TTS API error: ${statusCode}`);
    }

    const response = data as { success: boolean; audio_base64?: string; sample_rate?: number; duration?: number; error?: string };

    if (!response.success) {
      throw new Error(response.error || 'TTS synthesis failed');
    }

    // 解码 base64 音频
    return Buffer.from(response.audio_base64!, 'base64');
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string; errno?: string };
    const errMsg = err.message || err.code || err.errno || 'unknown';
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
      throw new Error(`TTS service is not running at ${TTS_SERVICE_HOST}:${TTS_SERVICE_PORT} (${errMsg})`);
    }
    throw error;
  }
}

/**
 * 预加载模型（避免首次请求延迟）
 */
export async function preloadModel(characterId: string): Promise<void> {
  // Standalone 模式下模型在首次合成时自动加载，无需预加载
  // 这里预留接口兼容性
}

/**
 * 健康检查
 */
export async function healthCheck(): Promise<{ status: string; mode: string }> {
  try {
    const { data } = await httpPost(TTS_SERVICE_HOST, TTS_SERVICE_PORT, '/api/health', {});
    const response = data as { status: string; service: string; mode: string };
    return {
      status: response.status,
      mode: response.mode
    };
  } catch {
    return {
      status: 'disconnected',
      mode: 'unknown'
    };
  }
}
