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

import { buildFirstTurnPrompt, buildSubtitleTranslatePrompt } from './prompts.js';
import { parseSegment } from './segment-utils.js';
import { runAnalysisLoop } from './analysis-loop.js';
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
      speechLanguage
    });

    const streamResponse = callLLMStream({
      model: config.model,
      messages: [{ role: 'user', content: firstTurnPrompt }],
      temperature: 0.7
    });

    logDb.insert({
      id: uuidv4(),
      level: 'debug',
      category: 'agent',
      content: `[LLM Request] firstTurnPrompt:\n${firstTurnPrompt}`,
      createdAt: new Date()
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
            language: speechLanguage
          }
        });

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
          data: { text: seg.voice, emotion: seg.emotion, action: seg.action, language: speechLanguage }
        });
        try {
          const audioBuffer = await synthesizeStream(seg.voice, this.character.id, seg.emotion);
          onSSE?.({ type: 'audio', data: { audio: audioBuffer.toString('base64'), sentenceIndex: sentenceIndex++ } });
        } catch {}
        allVoiceTexts.push(seg.voice);
      }
    }

    // ========== 阶段3：字幕翻译 ==========
    const fullVoiceText = allVoiceTexts.join('');
    if (speechLanguage !== subtitleLanguage && fullVoiceText) {
      try {
        const translatePrompt = buildSubtitleTranslatePrompt(fullVoiceText, subtitleLanguage);
        logDb.insert({
          id: uuidv4(),
          level: 'debug',
          category: 'agent',
          content: `[LLM Request] subtitleTranslatePrompt:\n${translatePrompt}`,
          createdAt: new Date()
        });
        const translateResponse = callLLMStream({
          model: config.model,
          messages: [{ role: 'user', content: translatePrompt }],
          temperature: 0
        });

        let subtitleText = '';
        for await (const chunk of translateResponse) {
          subtitleText += chunk;
        }

        // 去掉可能的 JSON 标记，只保留纯文本
        subtitleText = subtitleText.replace(/^```[\s\S]*?```/gm, '').trim();

        onSSE?.({ type: 'subtitle', data: { text: subtitleText } });
      } catch (err) {
        logDb.insert({
          id: uuidv4(),
          level: 'error',
          category: 'agent',
          content: `Subtitle translation failed: ${err}`,
          createdAt: new Date()
        });
        throw err; // 出错抛异常
      }
    }

    // ========== 阶段4：深度分析（needDeepThink=true 时） ==========
    if (needDeepThinkFlag) {
      // 通知前端开始深度思考
      onSSE?.({ type: 'deep_think_pending', data: { value: true } });

      const analysisResult = await runAnalysisLoop({
        userInput,
        retrievalResults: retrievalContext,
        characterInfo,
        dialogueRequirements,
        availableEmotions,
        speechLanguage
      });

      // 发送分析结果的 segments
      for (const seg of analysisResult.segments) {
        onSSE?.({
          type: 'voice',
          data: { text: seg.voice, emotion: seg.emotion, action: seg.action, language: speechLanguage }
        });

        try {
          const audioBuffer = await synthesizeStream(seg.voice, this.character.id, seg.emotion);
          onSSE?.({ type: 'audio', data: { audio: audioBuffer.toString('base64'), sentenceIndex: sentenceIndex++ } });
        } catch {}

        allVoiceTexts.push(seg.voice);
      }

      // 翻译追加内容的字幕
      if (speechLanguage !== subtitleLanguage) {
        const additionalText = analysisResult.segments.map(s => s.voice).join('');
        logDb.insert({
          id: uuidv4(),
          level: 'debug',
          category: 'agent',
          content: `[LLM Request] subtitleTranslatePrompt (append):\n${buildSubtitleTranslatePrompt(additionalText, subtitleLanguage)}`,
          createdAt: new Date()
        });
        try {
          const translatePrompt = buildSubtitleTranslatePrompt(additionalText, subtitleLanguage);
          const translateResponse = callLLMStream({
            model: config.model,
            messages: [{ role: 'user', content: translatePrompt }],
            temperature: 0
          });

          let subtitleText = '';
          for await (const chunk of translateResponse) {
            subtitleText += chunk;
          }
          subtitleText = subtitleText.replace(/^```[\s\S]*?```/gm, '').trim();
          onSSE?.({ type: 'subtitle_append', data: { text: subtitleText } });
        } catch (err) {
          logDb.insert({
            id: uuidv4(),
            level: 'error',
            category: 'agent',
            content: `Subtitle translation (append) failed: ${err}`,
            createdAt: new Date()
          });
        }
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

当前状态：
${stateManager.getEmotionDescription()}
${stateManager.getAffinityDescription()}

请以JSON格式返回状态变化（数值范围 -5 到 +5）：
{
  "emotion": {
    ${emotionDimensionDesc}
  },
  "affinity": {
    ${affinityDimensionDesc}
  }
}`;

        logDb.insert({
          id: crypto.randomUUID(),
          level: 'debug',
          category: 'agent',
          content: `[LLM Request] stateUpdatePrompt:\n${updatePrompt}`,
          createdAt: new Date()
        });

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