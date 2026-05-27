/**
 * Proactive Agent — 主动交互生成器
 *
 * 单轮 polisher 式生成：无 deep analysis、无 pre-retrieval、无 trigger 匹配。
 * 通过心跳触发，生成简短的主动对话并广播给所有 SSE 客户端。
 */

import { stateManager } from '../state/manager.js';
import { memoryManager } from '../memory/manager.js';
import { dialogueDb, logDb } from '../db/database.js';
import { callLLMStream, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import { Dialogue, SSEMessage, Memory } from '../types/index.js';
import { getAvailableEmotions } from '../tts/client.js';
import { loadDefaultCharacter, type CharacterConfig } from '../character/loader.js';

import { buildProactiveMessages, type ChatMessage } from './prompts.js';
import { parseSegment, emitSegment } from './segment-utils.js';
import { getDialogueStats, getRecentDialoguesText } from './dialogue-stats.js';

export class ProactiveAgent {
  private character: CharacterConfig;

  constructor() {
    this.character = loadDefaultCharacter();
  }

  setCharacter(config: Partial<CharacterConfig>): void {
    this.character = { ...this.character, ...config } as CharacterConfig;
  }

  async generate(
    screenDescription: string,
    onSSE: (message: SSEMessage) => void,
    signal?: AbortSignal,
    memory?: Memory
  ): Promise<string> {
    if (signal?.aborted) return '';

    const speechLanguage = this.character.speechLanguage || 'ja-JP';
    const subtitleLanguage = this.character.subtitleLanguage || 'zh-CN';
    const availableEmotions = getAvailableEmotions(this.character.id);
    const characterInfo = this.character.characterInfo || this.character.personality || '';
    const dialogueRequirements = this.character.dialogueRequirements || '';

    const allVoiceTexts: string[] = [];
    let sentenceIndex = 0;

    const recentText = getRecentDialoguesText(20);
    const memoryContext = memoryManager.buildRecentContext();
    const combinedContext = [memoryContext, recentText].filter(Boolean).join('\n\n');

    const memoryContent = memory
      ? `${memory.content}（此时段用户状态: ${memory.userState || '未知'}）`
      : '无';

    const messages: ChatMessage[] = buildProactiveMessages({
      screenDescription,
      memoryContent,
      characterInfo,
      characterName: this.character.name,
      dialogueRequirements,
      emotionDescription: stateManager.getEmotionDescription(),
      affinityDescription: stateManager.getAffinityDescription(),
      dialogueStats: getDialogueStats(),
      recentDialogues: combinedContext,
      availableEmotions,
      speechLanguage,
      subtitleLanguage
    });

    if (signal?.aborted) return '';

    const config = getLLMConfig();

    let fullResponse = '';
    let buffer = '';

    const stream = callLLMStream(
      { model: config.model, messages, temperature: 0.8 },
      true,
      'proactive',
      signal
    );

    for await (const chunk of stream) {
      if (signal?.aborted) break;
      buffer += chunk;

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('{')) continue;

        const seg = parseSegment(trimmed);
        if (!seg) continue;

        fullResponse += trimmed + '\n';

        sentenceIndex = await emitSegment(
          seg, sentenceIndex, speechLanguage, subtitleLanguage,
          this.character.id, onSSE
        );
        allVoiceTexts.push(seg.voice);
      }
    }

    // 处理流结束后的残留 buffer
    if (!signal?.aborted && buffer.trim()) {
      const seg = parseSegment(buffer.trim());
      if (seg) {
        fullResponse += buffer.trim();
        sentenceIndex = await emitSegment(
          seg, sentenceIndex, speechLanguage, subtitleLanguage,
          this.character.id, onSSE
        );
        allVoiceTexts.push(seg.voice);
      }
    }

    if (signal?.aborted) return '';

    // finalize
    const finalText = allVoiceTexts.join('');

    onSSE({ type: 'done', data: { text: finalText } });

    if (finalText) {
      const turnIndex = dialogueDb.getTurnCount() + 1;
      const dialogue: Dialogue = {
        id: uuidv4(),
        turnIndex,
        userContent: '[Proactive]',
        aiContent: finalText,
        createdAt: new Date()
      };
      dialogueDb.insert(dialogue);

      memoryManager.ensureTopicTracking();
      this.updateStatesForProactive(memory?.content || '无', finalText);
    }

    return finalText;
  }

  private updateStatesForProactive(memoryContent: string, proactiveText: string): void {
    setImmediate(async () => {
      try {
        const config = getLLMConfig();
        const emotionState = stateManager.getEmotion();
        const affinityState = stateManager.getAffinity();
        const emotionDimensionNames = Object.keys(emotionState.dimensions);
        const affinityDimensionNames = Object.keys(affinityState.dimensions);

        const emotionDimensionDesc = emotionDimensionNames
          .map(name => `"${name}": 数字（正数=向右增加，负数=向左减少）`)
          .join(',\n    ');

        const affinityDimensionDesc = affinityDimensionNames
          .map(name => `"${name}": 数字（正数=增加，负数=减少）`)
          .join(',\n    ');

        const updatePrompt = `角色基于对过往记忆的回忆，主动发起了以下对话：

角色的回忆内容：
${memoryContent}

角色说：
${proactiveText}

请以JSON格式返回这次主动互动对角色情绪和好感度的影响（数值范围 -5 到 +5）：
{
  "emotion": {
    ${emotionDimensionDesc}
  },
  "affinity": {
    ${affinityDimensionDesc}
  }
}
仅给出json即可，不需要任何补充内容`;

        const response = callLLMStream({
          model: config.model,
          messages: [{ role: 'user', content: updatePrompt }],
          temperature: 0
        });

        let fullResponse = '';
        for await (const chunk of response) {
          fullResponse += chunk;
        }

        const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.emotion) stateManager.updateEmotion(parsed.emotion);
          if (parsed.affinity) stateManager.updateAffinity(parsed.affinity);
        }
      } catch (error) {
        logDb.insert({
          id: crypto.randomUUID(),
          level: 'error',
          category: 'agent',
          content: `Proactive state update error: ${error}`,
          createdAt: new Date()
        });
      }
    });
  }
}

export const proactiveAgent = new ProactiveAgent();
export default ProactiveAgent;
