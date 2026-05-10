/**
 * Unified Agent v2 — 流式分段响应
 * 预检索 → 流式LLM分段输出 → TTS实时合成 → 字幕翻译 → (可选)深度分析
 */

import { stateManager } from '../state/manager.js';
import { memoryManager } from '../memory/manager.js';
import { dialogueDb, logDb } from '../db/database.js';
import { callLLMStream, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import { Dialogue, SSEMessage } from '../types/index.js';
import { jointSearch, formatRetrievalContext } from '../retrieval/joint-search.js';
import { synthesizeStream } from '../tts/client.js';
import { getAvailableEmotions } from '../tts/client.js';
import { loadDefaultCharacter, type CharacterConfig } from '../character/loader.js';

import { buildFirstTurnPrompt } from './prompts.js';
import { parseSegment } from './segment-utils.js';
import { runAnalysisLoop } from './analysis-loop.js';
import { runPolisherLoop } from './polisher.js';
import { getDialogueStats, getRecentDialoguesText } from './dialogue-stats.js';

// ========== UnifiedAgent 主类 ==========

class UnifiedAgent {
  private character: CharacterConfig;

  constructor() {
    this.character = loadDefaultCharacter();
  }

  async process(
    userInput: string,
    onSSE?: (message: SSEMessage) => void
  ): Promise<string> {
    const turnIndex = dialogueDb.getTurnCount() + 1;
    const turnId = uuidv4();

    logDb.insert({
      id: uuidv4(),
      level: 'info',
      category: 'agent',
      content: `[UnifiedAgent] User input: ${userInput}`,
      createdAt: new Date()
    });

    const config = getLLMConfig();
    const speechLanguage = this.character.speechLanguage || 'ja';
    const subtitleLanguage = this.character.subtitleLanguage || 'zh-CN';
    const availableEmotions = getAvailableEmotions(this.character.id);
    const characterInfo = this.character.characterInfo || this.character.personality || '';
    const dialogueRequirements = this.character.dialogueRequirements || '';

    // ========== 阶段1：预检索 ==========
    const shortTermMemory = memoryManager.getCurrentShortTermMemory();
    const retrievalResults = await jointSearch(userInput, shortTermMemory);
    const retrievalContext = formatRetrievalContext(retrievalResults);

    const recentText = getRecentDialoguesText(20);

    // ========== 阶段2：流式 LLM 调用 ==========
    const firstTurnPrompt = buildFirstTurnPrompt({
      userInput,
      retrievalResults: retrievalContext,
      characterInfo,
      dialogueRequirements,
      emotionDescription: stateManager.getEmotionDescription(),
      affinityDescription: stateManager.getAffinityDescription(),
      dialogueStats: getDialogueStats(),
      recentDialogues: recentText,
      availableEmotions,
      speechLanguage,
      subtitleLanguage
    });

    const streamResponse = callLLMStream({
      model: config.model,
      messages: [{ role: 'user', content: firstTurnPrompt }],
      temperature: 0.7
    });

    let allVoiceTexts: string[] = [];
    let needDeepThinkFlag = false;
    let buffer = '';
    let sentenceIndex = 0;

    // 并行处理流式输出
    for await (const chunk of streamResponse) {
      buffer += chunk;

      // 尝试解析完整的 JSON Lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('{')) continue;

        const seg = parseSegment(trimmed);
        if (!seg) continue;

        // 检查 needDeepThink
        if (seg.needDeepThink && !needDeepThinkFlag) {
          needDeepThinkFlag = true;
        }

        // 发送 voice 事件
        onSSE?.({
          type: 'voice',
          data: {
            text: seg.voice,
            emotion: seg.emotion,
            action: seg.action,
            language: speechLanguage,
            sentenceIndex: sentenceIndex
          }
        });

        // 发送 subtitle 事件（仅当语言不同时且有subtitle内容）
        if (seg.subtitle && speechLanguage !== subtitleLanguage) {
          onSSE?.({
            type: 'subtitle',
            data: { text: seg.subtitle, sentenceIndex: sentenceIndex }
          });
        }

        // 立即 TTS 合成并发送 audio
        try {
          const audioBuffer = await synthesizeStream(seg.voice, this.character.id, seg.emotion);
          onSSE?.({
            type: 'audio',
            data: { audio: audioBuffer.toString('base64'), sentenceIndex: sentenceIndex++ }
          });
        } catch (ttsError) {
          logDb.insert({
            id: uuidv4(),
            level: 'error',
            category: 'agent',
            content: `[UnifiedAgent] TTS failed: ${ttsError}`,
            createdAt: new Date()
          });
        }

        allVoiceTexts.push(seg.voice);
      }
    }

    // 处理剩余 buffer
    if (buffer.trim()) {
      const seg = parseSegment(buffer.trim());
      if (seg) {
        if (seg.needDeepThink && !needDeepThinkFlag) {
          needDeepThinkFlag = true;
        }
        onSSE?.({
          type: 'voice',
          data: { text: seg.voice, emotion: seg.emotion, action: seg.action, language: speechLanguage, sentenceIndex: sentenceIndex }
        });
        if (seg.subtitle && speechLanguage !== subtitleLanguage) {
          onSSE?.({ type: 'subtitle', data: { text: seg.subtitle, sentenceIndex: sentenceIndex } });
        }
        try {
          const audioBuffer = await synthesizeStream(seg.voice, this.character.id, seg.emotion);
          onSSE?.({ type: 'audio', data: { audio: audioBuffer.toString('base64'), sentenceIndex: sentenceIndex++ } });
        } catch {}
        allVoiceTexts.push(seg.voice);
      }
    }

    // ========== 阶段4：深度分析（needDeepThink=true 时） ==========
    if (needDeepThinkFlag) {
      // 通知前端开始深度思考
      onSSE?.({ type: 'deep_think_pending', data: { value: true } });

      // 保存初次回复内容
      const firstTurnText = allVoiceTexts.join('');

      // 深度分析（纯信息检索，不负责对话）
      const analysisResult = await runAnalysisLoop({
        userInput,
        retrievalResults: retrievalContext,
        characterInfo
      });

      // Polisher 负责整合初次回复 + 分析结果，生成续接内容
      const polisherSegments = await runPolisherLoop({
        userInput,
        analysisResult: analysisResult.answerText,
        firstTurnReply: firstTurnText,
        characterInfo,
        dialogueRequirements,
        availableEmotions,
        speechLanguage,
        subtitleLanguage
      });

      // 发送 polisher 生成的 segments
      for (const seg of polisherSegments) {
        onSSE?.({
          type: 'voice',
          data: { text: seg.voice, emotion: seg.emotion, action: seg.action, language: speechLanguage, sentenceIndex: sentenceIndex }
        });

        if (seg.subtitle && speechLanguage !== subtitleLanguage) {
          onSSE?.({ type: 'subtitle', data: { text: seg.subtitle, sentenceIndex: sentenceIndex } });
        }

        try {
          const audioBuffer = await synthesizeStream(seg.voice, this.character.id, seg.emotion);
          onSSE?.({ type: 'audio', data: { audio: audioBuffer.toString('base64'), sentenceIndex: sentenceIndex++ } });
        } catch {}

        allVoiceTexts.push(seg.voice);
      }
    }

    // ========== 完成 ==========
    onSSE?.({ type: 'done', data: {} });

    // 写入对话记录
    const finalText = allVoiceTexts.join('');
    const dialogue: Dialogue = {
      id: turnId,
      turnIndex,
      userContent: userInput,
      aiContent: finalText,
      createdAt: new Date()
    };
    dialogueDb.insert(dialogue);

    // 更新记忆
    const shouldSwitch = await memoryManager.shouldSwitchTopic(userInput);
    if (shouldSwitch) {
      await memoryManager.archiveCurrentTopic();
    }
    await memoryManager.updateShortTermMemory(userInput, finalText);
    this.updateStatesAsync(userInput, finalText);

    return finalText;
  }

  private updateStatesAsync(userInput: string, aiResponse: string): void {
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

        const updatePrompt = `分析以下对话，判断对角色情绪和好感度的影响：

用户说：${userInput}
角色说：${aiResponse}

请以JSON格式返回状态变化（数值范围 -5 到 +5）：
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
          content: `State update error: ${error}`,
          createdAt: new Date()
        });
      }
    });
  }

  setCharacter(config: Partial<CharacterConfig>): void {
    this.character = { ...this.character, ...config } as CharacterConfig;
  }
}

// 导出单例
export const unifiedAgent = new UnifiedAgent();
export default UnifiedAgent;