/**
 * Polisher Agent
 * 负责结合深度分析结果和初次回复，生成续接内容
 */

import { stateManager } from '../state/manager.js';
import { logDb } from '../db/database.js';
import { callLLMStream, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import { buildPolisherPrompt } from './prompts.js';
import { extractJSONLines, parseSegment } from './segment-utils.js';
import { Segment } from './types.js';
import { getDialogueStats, getRecentDialoguesText } from './dialogue-stats.js';
import { getAvailableEmotions } from '../tts/client.js';

export interface PolisherContext {
  userInput: string;
  analysisResult: string;
  firstTurnReply: string;
  characterInfo: string;
  dialogueRequirements: string;
  availableEmotions: string[];
  speechLanguage: string;
  subtitleLanguage: string;
}

export async function runPolisherLoop(ctx: PolisherContext): Promise<Segment[]> {
  const config = getLLMConfig();
  const emotionDesc = stateManager.getEmotionDescription();
  const affinityDesc = stateManager.getAffinityDescription();
  const recentText = getRecentDialoguesText(20);

  const prompt = buildPolisherPrompt({
    userInput: ctx.userInput,
    analysisResult: ctx.analysisResult,
    firstTurnReply: ctx.firstTurnReply,
    characterInfo: ctx.characterInfo,
    dialogueRequirements: ctx.dialogueRequirements,
    emotionDescription: emotionDesc,
    affinityDescription: affinityDesc,
    dialogueStats: getDialogueStats(),
    recentDialogues: recentText,
    availableEmotions: ctx.availableEmotions,
    speechLanguage: ctx.speechLanguage,
    subtitleLanguage: ctx.subtitleLanguage
  });

  const response = callLLMStream({
    model: config.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7
  });

  let fullResponse = '';
  for await (const chunk of response) {
    fullResponse += chunk;
  }

  logDb.insert({
    id: uuidv4(),
    level: 'debug',
    category: 'agent',
    content: `[Polisher Loop]:\n${fullResponse}`,
    createdAt: new Date()
  });

  // 解析 JSON Lines
  const lines = extractJSONLines(fullResponse);
  const segments: Segment[] = [];
  for (const line of lines) {
    const seg = parseSegment(line);
    if (seg) segments.push(seg);
  }

  if (segments.length === 0) {
    segments.push({ emotion: 'normal', action: 'idle', voice: '', subtitle: '回复生成失败' });
  }

  return segments;
}