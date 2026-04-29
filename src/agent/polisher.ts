/**
 * 润色器模块
 * 负责对分析Agent生成的回复进行语言润色，实现流式输出和Live2D动作触发
 */

import { getLLMConfig } from '../api/llm.js';
import { SSEMessage } from '../types/index.js';
import { logDb, dialogueDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import { getAvailableEmotions, synthesizeStream } from '../tts/client.js';
import { memoryManager } from '../memory/manager.js';

export interface PolisherConfig {
  characterInfo: string;
  dialogueRequirements: string;
  emotion: string;
  characterId: string;
  affinity?: string;
  speechLanguage?: string;
  subtitleLanguage?: string;
}

export interface PolishedResult {
  text: string;
  audioBuffer?: Buffer;
  sampleRate?: number;
  error?: boolean
}

interface Sentence {
  text: string;        // 纯文本（用于TTS）
  emotion: string;     // 情感标签
  subtitle: string;     // 字幕文本（可能包含[ACTION:xxx]标签）
  action?: string;     // 动作类型（从字幕中提取）
  sentenceIndex: number;
  mergeToNext?: boolean; // 是否合并到下一句（用于短填充音）
}

// ========== 工具函数 ==========

function parseAction(text: string): string | null {
  const actionMatch = text.match(/ACTION:([^\]]+)/);
  if (actionMatch) {
    return actionMatch[1].trim();
  }
  return null;
}

// ========== LLM调用 ==========

async function callPolishLLM(
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const config = getLLMConfig();

  if (!config.apiKey) {
    throw new Error('Polish LLM API key not configured');
  }

  let fullUrl: string;
  if (config.baseURL.includes('/v1') || config.baseURL.includes('/v3')) {
    fullUrl = `${config.baseURL}/chat/completions`;
  } else {
    fullUrl = config.baseURL;
  }

  const response = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.7,
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Polish LLM API error: ${response.status} ${errorText}`);
  }

  const parsed = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response content');
  }
  return content;
}

// ========== JSON解析器 ==========

interface ParsedResult {
  voice: string;
  subtitle: string;
}

function parsePolishResponse(content: string): ParsedResult {
  let jsonStr = content.trim();
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  const result = JSON.parse(jsonStr) as { voice?: string; subtitle?: string };
  return {
    voice: result.voice || '',
    subtitle: result.subtitle || ''
  };
}

// ========== 句子解析 ==========

// 支持中日文标点：句号、感叹号、问号、逗号、顿号、分号
const SENTENCE_DELIMITERS = /(?<=[。！？!?；;，,、)])/;

// 判断是否为短填充音（合并到下一句）
function isShortFillerText(text: string): boolean {
  // 移标点后字符数
  const chars = text.replace(/[。！？!?；;，,、\s]/g, '');
  return chars.length >= 0 && chars.length <= 3;
}

function parseSentences(
  voice: string,
  subtitle: string,
  availableEmotions: string[]
): { sentences: Sentence[]; remainingSubtitles: string[] } {
  const sentences: Sentence[] = [];

  // 按句子分割
  const voiceParts = voice.split(SENTENCE_DELIMITERS).filter(s => s.trim());
  const subtitleParts = subtitle.split(SENTENCE_DELIMITERS).filter(s => s.trim());

  // 修复：如果 subtitle 句子数 > voice 句子数，贪婪合并短句
  // 注意：必须将合并结果赋回 subtitleParts，否则合并不会生效
  if (subtitleParts.length > voiceParts.length) {
    const diff = subtitleParts.length - voiceParts.length;
    let mergesNeeded = diff;
    let idx = 0;
    while (mergesNeeded > 0 && idx < subtitleParts.length - 1) {
      const current = subtitleParts[idx];
      const currentChars = current.replace(/[。！？!?；;，,、\s]/g, '');
      if (currentChars.length <= 5) {
        // 将下一个句子合并到当前短句，并删除下一个句子
        subtitleParts[idx] = current + subtitleParts[idx + 1];
        subtitleParts.splice(idx + 1, 1);
        mergesNeeded--;
      } else {
        idx++;
      }
    }
  }

  let currentEmotion = 'normal';
  let sentenceIndex = 0;

  // 以voice为基准，智能匹配subtitle
  for (let i = 0; i < voiceParts.length; i++) {
    const voicePart = voiceParts[i].trim();
    if (!voicePart) continue;

    // 解析情感标签
    const pipeIndex = voicePart.indexOf('|');
    let text = voicePart;
    if (pipeIndex > 0) {
      const emotionPart = voicePart.substring(0, pipeIndex);
      const textPart = voicePart.substring(pipeIndex + 1);
      if (availableEmotions.includes(emotionPart)) {
        currentEmotion = emotionPart;
        text = textPart;
      }
    }

    // 获取对应的字幕：如果voice和subtitle句子数不一致，
    // 尝试找到最接近的未匹配字幕
    let subPart = subtitleParts[i]?.trim();
    if (!subPart && i < subtitleParts.length) {
      subPart = subtitleParts.slice(i).join('').trim();
    }
    if (!subPart) {
      // i >= subtitleParts.length 时，voice没有对应subtitle，不推送字幕但仍合成TTS
      subPart = i >= subtitleParts.length ? '' : text;
    }

    // 提取动作标签
    const action = parseAction(subPart);

    sentences.push({
      text: text,
      emotion: currentEmotion,
      subtitle: subPart,
      action: action || undefined,
      sentenceIndex: sentenceIndex++,
      mergeToNext: isShortFillerText(text)
    });
  }

  // 返回句子数组以及剩余未处理的字幕
  const processedCount = sentences.length;
  const remainingSubtitles = subtitleParts.slice(processedCount);

  return { sentences, remainingSubtitles };
}

// ========== 对话统计 ==========

function getDialogueStats(): string {
  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const totalCount = dialogueDb.getTurnCount();
  const yearCount = dialogueDb.getCountSince(oneYearAgo);
  const monthCount = dialogueDb.getCountSince(oneMonthAgo);
  const weekCount = dialogueDb.getCountSince(oneWeekAgo);
  const dayCount = dialogueDb.getCountSince(oneDayAgo);

  const lastDialogue = dialogueDb.getLastDialogueTime();
  const timeSinceLast = lastDialogue
    ? Math.floor((now.getTime() - lastDialogue.getTime()) / 60000)
    : null;

  let stats = `## 对话统计
对话统计记录了角色与用户的互动频次，如果近期互动相比之前较少，可以适当向用户表达对他们的思念和关心，鼓励他们多和角色交流。
- 总对话轮次：${totalCount}
- 最近一年：${yearCount}
- 最近一月：${monthCount}
- 最近一周：${weekCount}
- 最近一天：${dayCount}`;

  if (timeSinceLast !== null) {
    if (timeSinceLast < 1) {
      stats += `\n- 距离上次对话：刚刚`;
    } else if (timeSinceLast < 60) {
      stats += `\n- 距离上次对话：${timeSinceLast}分钟`;
    } else {
      const hours = Math.floor(timeSinceLast / 60);
      stats += `\n- 距离上次对话：${hours}小时`;
    }
  } else {
    stats += `\n- 距离上次对话：无记录`;
  }

  return stats;
}

// ========== 主函数 ==========

export async function polish(
  userInput: string,
  rawResponse: string,
  config: PolisherConfig,
  onSSE?: (message: SSEMessage) => void
): Promise<PolishedResult> {
  const {
    characterInfo,
    dialogueRequirements,
    emotion,
    characterId,
    affinity,
    speechLanguage = 'ja',
    subtitleLanguage = 'zh-CN'
  } = config;

  const availableEmotions = getAvailableEmotions(characterId);

  // 构建上下文信息
  const contextParts: string[] = [];
  
  // 最近对话（最近10轮）
  const recentDialogues = dialogueDb.getRecent(20);
  if (recentDialogues.length > 0) {
    for (const d of recentDialogues.reverse()) {
      contextParts.push(`用户：${d.userContent}`);
      contextParts.push(`角色：${d.aiContent}`);
    }
  }

  // 短期记忆
  const shortTermMemory = memoryManager.getCurrentShortTermMemory();
  if (shortTermMemory) {
    contextParts.push(`当前话题：${shortTermMemory.topic}`);
    contextParts.push(`话题总结：${shortTermMemory.summary}`);
  }


  const systemPrompt = `你是一个对话润色专家。根据角色设定和对话要求，润色原始回复并生成正确的语音和字幕。

## 角色信息{
${characterInfo}
}

## 对话要求{
${dialogueRequirements}
}

## 当前状态{
${emotion}
${affinity || ''}

${getDialogueStats()}
}

## 最近对话：{
${contextParts.length > 0 ? contextParts.join('\n') : ''}
}

## 分析Agent提供的资料{
${rawResponse}
}

## 语言配置
- speechLanguage: ${speechLanguage}（voice字段的语言）
- subtitleLanguage: ${subtitleLanguage}（subtitle字段的语言）

## 可用的情感标签
${availableEmotions.join(', ')}

## 用户输入:"${userInput}"

请根据当前聊天记录和资料润色一个回复，要求：
1. 如果用户问题涉及到了参考提供的资料，请务必在回复中体现资料内容和对资料的理解。
2. 回复应该简短、亲切、有趣，符合角色特点。
3. 根据好感和情绪状态调整回复语气和内容。
4. 如果回复需要插入动作表情，请用 [ACTION:type] 格式标注，例如：[ACTION:happy]
5. 除了规定格式之外不要使用任何其他形式的动作描写，尤其是不要使用类似于"（微笑）"这样的文本来描述动作，因为回复文本是会进行后处理的，必须是符合要求的文本。

重要：必须以JSON格式返回且仅返回此json，包含voice和subtitle两个字段：
{
  "voice": "情感标签|语音合成文本(${speechLanguage})",
  "subtitle": "字幕显示文本（${subtitleLanguage},可包含[ACTION:type]动作标签）"
}
重要：每个字段分别使用的语言必须符合上述配置，不允许使用规定以外的其他语言。

voice格式说明：
- 情感标签必须是以下之一：${availableEmotions.join(', ')}
- 情感标签和文本用“|”分隔，格式为"情感标签|文本"（注意只有一个“|”），以标点符号为分界，每一句话都必须带有情感标签
- 可使用的标点包括：{。！？!?；;，,、}
- 例如："normal|今天天气真好呢，happy|今天想出去玩"
- voice字段只包含情感标签|纯文本，用于语音合成，禁止包含其他标签或补充说明
- voice字段的语言必须使用${speechLanguage}，禁止使用其他语言

subtitle字段说明：
- subtitle的句子数量必须与voice完全一致，分句位置也要对齐，标点符号也要一致，确保每一句话都能正确匹配到对应的字幕
- 例如voice是"normal|你好、happy|你真棒"，subtitle对应应该是"你好、你真棒"

subtitle字段仅可包含动作标签[ACTION:type]，voice字段仅可包含情感标签|文本，禁止在voice中出现动作标签，在subtitle中出现情感标签。
`;

  try {
    // 调用LLM获取完整响应
    const content = await callPolishLLM(getLLMConfig().model, [
      { role: 'user', content: systemPrompt }
    ]);

    // 解析JSON响应
    const parsed = parsePolishResponse(content);
    const { voice, subtitle } = parsed;

    // 解析句子数组
    const { sentences, remainingSubtitles } = parseSentences(voice, subtitle, availableEmotions);

    let fullText = '';

    // 预处理：合并短句到下一句
    const mergedSentences: Sentence[] = [];
    let j = 0;
    while (j < sentences.length) {
      const current = sentences[j];

      if (current.mergeToNext && j + 1 < sentences.length) {
        // 短句：合并到下一句
        const next = sentences[j + 1];
        mergedSentences.push({
          text: current.text + next.text,
          emotion: next.emotion,
          subtitle: current.subtitle + next.subtitle,
          action: next.action || current.action,
          sentenceIndex: next.sentenceIndex,
          mergeToNext: false
        });
        j += 2;
      } else {
        mergedSentences.push(current);
        j++;
      }
    }

    // 阶段1：立即发送所有文本事件（不等待 TTS）
    for (const sentence of mergedSentences) {
      // 发送 voice 事件
      onSSE?.({
        type: 'voice',
        data: {
          text: sentence.text,
          emotion: sentence.emotion,
          sentenceIndex: sentence.sentenceIndex,
          totalSentences: mergedSentences.length,
          language: speechLanguage
        } as unknown as Record<string, unknown>
      });

      // 发送 subtitle 事件
      if (sentence.subtitle) {
        onSSE?.({
          type: 'subtitle',
          data: {
            text: sentence.subtitle,
            action: sentence.action,
            isFirst: sentence.sentenceIndex === 0,
            sentenceIndex: sentence.sentenceIndex,
            totalSentences: mergedSentences.length
          } as unknown as Record<string, unknown>
        });
      }
    }

    // 处理剩余字幕
    for (let i = 0; i < remainingSubtitles.length; i++) {
      const subText = remainingSubtitles[i];
      const action = parseAction(subText);
      logDb.insert({
        id: uuidv4(),
        level: 'debug',
        category: 'agent',
        content: `[Remaining Subtitle] text="${subText}", action="${action}"`,
        createdAt: new Date()
      });
      onSSE?.({
        type: 'subtitle_extra',
        data: {
          text: subText,
          action: action || undefined,
          isFirst: false,
          sentenceIndex: mergedSentences.length + i,
          totalSentences: mergedSentences.length
        } as unknown as Record<string, unknown>
      });
    }

    // 阶段2：串行 TTS 合成 + audio 事件
    for (const sentence of mergedSentences) {
      // 串行调用 TTS 合成
      try {
        logDb.insert({
          id: uuidv4(),
          level: 'debug',
          category: 'agent',
          content: `[TTS Request] text="${sentence.text}", emotion="${sentence.emotion}", characterId="${characterId}"`,
          createdAt: new Date()
        });

        const audioBuffer = await synthesizeStream(
          sentence.text,
          characterId,
          sentence.emotion
        );

        // 合成完成，发送 audio 事件
        onSSE?.({
          type: 'audio',
          data: {
            audio: audioBuffer.toString('base64'),
            sentenceIndex: sentence.sentenceIndex,
            totalSentences: mergedSentences.length,
            duration: 0
          } as unknown as Record<string, unknown>
        });
      } catch (ttsError) {
        // TTS 合成失败，记录日志但继续处理下一句
        logDb.insert({
          id: uuidv4(),
          level: 'error',
          category: 'agent',
          content: `TTS synthesis failed for sentence ${sentence.sentenceIndex}: ${ttsError}`,
          createdAt: new Date()
        });
      }

      fullText += sentence.subtitle;
    }

    // 发送完成事件
    onSSE?.({ type: 'done', data: { text: fullText } });

    // 记录日志
    logDb.insert({
      id: uuidv4(),
      level: 'debug',
      category: 'api_call',
      content: `[Polisher API Call]\n[System Prompt]\n${systemPrompt}\n\n[LLM Response]\n${content}\n\n[Parsed Voice]\n${voice}\n\n[Parsed Subtitle]\n${subtitle}\n\n[Sentences]\n${JSON.stringify(sentences, null, 2)}\n\n[Final Text]\n${fullText}`,
      createdAt: new Date()
    });

    return { text: fullText };
  } catch (error) {
    logDb.insert({
      id: uuidv4(),
      level: 'error',
      category: 'agent',
      content: `Polish failed: ${error}`,
      createdAt: new Date()
    });
    if (onSSE) {
      onSSE({ type: 'error', data: String(error) });
    }
    return { text: '润色失败，请检查api配置和网络连接。' , error: true };
  }
}

export default { polish };
