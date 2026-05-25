/**
 * Unified Agent v5 — Polisher 主循环 + Analyzer 子例程
 *
 * 架构：polisher 驱动，analyzer 作为其"万能助手"子例程。
 * 各自维护 ChatMessage[] 消息列表，交替协作。
 *
 * v5 变更：
 * - polisher 作为主循环，当 needDeepThink=true 时调用 analyzer 子例程
 * - polisher 在 voice/subtitle 中表达信息需求，analyzer 参数化为工具调用
 * - analyzer 只输出 SKILL_README/SKILL_CALL/DONE，结果原样传递给 polisher
 * - 两套 ChatMessage[] 分别持久化，跨轮次增长
 */

import { stateManager } from '../state/manager.js';
import { memoryManager } from '../memory/manager.js';
import { dialogueDb, logDb } from '../db/database.js';
import { callLLMStream, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import { Dialogue, SSEMessage } from '../types/index.js';
import { skillEngine } from '../skills/engine.js';
import { synthesizeStream } from '../tts/client.js';
import { getAvailableEmotions } from '../tts/client.js';
import { loadDefaultCharacter, type CharacterConfig } from '../character/loader.js';

import { buildPolisherMessages, buildPolisherResultUser, buildAnalyzerMessages, buildAnalyzerContinuationUser, type ChatMessage } from './prompts.js';
import { parseSegment } from './segment-utils.js';
import { createAnalysisSession } from './analysis-loop.js';
import { getDialogueStats, getRecentDialoguesText } from './dialogue-stats.js';

class UnifiedAgent {
  private character: CharacterConfig;

  constructor() {
    this.character = loadDefaultCharacter();
  }

  async process(
    userInput: string,
    onSSE?: (message: SSEMessage) => void,
    signal?: AbortSignal
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
    const speechLanguage = this.character.speechLanguage || 'ja-JP';
    const subtitleLanguage = this.character.subtitleLanguage || 'zh-CN';
    const availableEmotions = getAvailableEmotions(this.character.id);
    const characterInfo = this.character.characterInfo || this.character.personality || '';
    const dialogueRequirements = this.character.dialogueRequirements || '';

    const allVoiceTexts: string[] = [];
    let sentenceIndex = 0;

    // ========== 阶段1：预检索 ==========
    const retrievalContext = await skillEngine.executeSkill('search', {
      query: userInput,
      limit: 10
    });

    if (signal?.aborted) {
      return this.finalizeTurn(userInput, allVoiceTexts, onSSE, turnId, turnIndex);
    }

    // ========== 阶段1.5：触发词匹配 ==========
    let visualContext = '';
    const triggeredSkills = skillEngine.matchTriggerSkills(userInput);
    for (const skill of triggeredSkills) {
      const result = await skillEngine.executeSkill(skill.name, {});
      if (result && skill.name === 'image-analysis') {
        visualContext = result;
      }
    }

    if (signal?.aborted) {
      return this.finalizeTurn(userInput, allVoiceTexts, onSSE, turnId, turnIndex);
    }

    // ========== 阶段2：构建 polisher 初始消息列表 ==========
    const recentText = getRecentDialoguesText(20);
    const memoryContext = memoryManager.buildRecentContext();
    const combinedContext = [memoryContext, recentText].filter(Boolean).join('\n\n');
    const polisherMessages: ChatMessage[] = buildPolisherMessages({
      userInput,
      retrievalResults: retrievalContext,
      visualContext,
      characterInfo,
      dialogueRequirements,
      emotionDescription: stateManager.getEmotionDescription(),
      affinityDescription: stateManager.getAffinityDescription(),
      dialogueStats: getDialogueStats(),
      recentDialogues: combinedContext,
      availableEmotions,
      speechLanguage,
      subtitleLanguage
    });

    // ========== 阶段3：Polisher 驱动的主循环 ==========
    let polisherRound = 0;
    const maxPolisherRounds = 3;
    let analyzerMessages: ChatMessage[] = [];
    let allRawFindings = '';

    const skillList = skillEngine.getAllSkillMetas()
      .map(s => `- ${s.name}: ${s.description}`).join('\n');

    while (polisherRound < maxPolisherRounds) {
      if (signal?.aborted) break;
      polisherRound++;

      // --- 流式调用 polisher ---
      let fullResponse = '';
      let buffer = '';
      let roundNeedDeepThink = false;
      let infoNeed = '';

      const stream = callLLMStream(
        { model: config.model, messages: polisherMessages, temperature: 0.7 },
        true,
        `polisher-round-${polisherRound}`,
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

          if (seg.needDeepThink && !roundNeedDeepThink) {
            roundNeedDeepThink = true;
            infoNeed = seg.subtitle || seg.voice;
          }

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
          if (seg.needDeepThink && !roundNeedDeepThink) {
            roundNeedDeepThink = true;
            infoNeed = seg.subtitle || seg.voice;
          }
          sentenceIndex = await emitSegment(
            seg, sentenceIndex, speechLanguage, subtitleLanguage,
            this.character.id, onSSE
          );
          allVoiceTexts.push(seg.voice);
        }
      }

      // 追加 assistant 回复到 polisher 消息列表
      polisherMessages.push({ role: 'assistant', content: fullResponse });

      // 本轮没有 needDeepThink → 结束
      if (!roundNeedDeepThink) break;

      // 首次进入深度分析时通知前端
      if (polisherRound === 1) {
        onSSE?.({ type: 'deep_think_pending', data: { value: true } });
      }

      // ========== 阶段4：构建/续接 analyzer 消息列表并执行子循环 ==========
      if (analyzerMessages.length === 0) {
        const recentSkillsContext = await skillEngine.getRecentSkillsContext();
        analyzerMessages = buildAnalyzerMessages(infoNeed, {
          userInput,
          retrievalResults: retrievalContext,
          characterInfo,
          skillList,
          recentSkillsContext,
          recentDialogues: combinedContext,
          speechLanguage,
          subtitleLanguage
        });
      } else {
        analyzerMessages.push(
          buildAnalyzerContinuationUser(infoNeed, allRawFindings)
        );
      }

      const session = createAnalysisSession(analyzerMessages, signal);

      while (true) {
        if (signal?.aborted) break;
        const result = await session.next();
        if (signal?.aborted) break;

        analyzerMessages = session.getMessages();

        if (result.status === 'in_progress') {
          onSSE?.({
            type: 'deep_think_progress',
            data: { description: result.actionDescription }
          });
          continue;
        }

        // complete 或 max_rounds
        allRawFindings = allRawFindings + result.rawFindings;
        break;
      }

      if (signal?.aborted) break;

      // 将原始检索结果喂给 polisher 进行下一轮合成
      polisherMessages.push(
        buildPolisherResultUser(allRawFindings)
      );
    }

    return this.finalizeTurn(userInput, allVoiceTexts, onSSE, turnId, turnIndex);
  }

  private finalizeTurn(
    userInput: string,
    allVoiceTexts: string[],
    onSSE: ((message: SSEMessage) => void) | undefined,
    turnId: string,
    turnIndex: number
  ): string {
    const finalText = allVoiceTexts.join('');

    onSSE?.({ type: 'done', data: { text: finalText } });

    if (finalText) {
      const dialogue: Dialogue = {
        id: turnId,
        turnIndex,
        userContent: userInput,
        aiContent: finalText,
        createdAt: new Date()
      };
      dialogueDb.insert(dialogue);

      memoryManager.ensureTopicTracking();
      memoryManager.shouldSwitchTopic(userInput).then(shouldSwitch => {
        if (shouldSwitch) {
          memoryManager.archiveCurrentTopic();
        }
      });
      this.updateStatesAsync(userInput, finalText);
    }

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

// ========== 辅助 ==========

async function emitSegment(
  seg: { voice: string; emotion: string; action: string; subtitle?: string },
  sentenceIndex: number,
  speechLanguage: string,
  subtitleLanguage: string,
  characterId: string,
  onSSE?: (message: SSEMessage) => void
): Promise<number> {
  onSSE?.({
    type: 'voice',
    data: {
      text: seg.voice,
      emotion: seg.emotion,
      action: seg.action,
      language: speechLanguage,
      sentenceIndex
    }
  });

  if (seg.subtitle && speechLanguage !== subtitleLanguage) {
    onSSE?.({
      type: 'subtitle',
      data: { text: seg.subtitle, sentenceIndex }
    });
  }

  try {
    const audioBuffer = await synthesizeStream(seg.voice, characterId, seg.emotion);
    onSSE?.({
      type: 'audio',
      data: { audio: audioBuffer.toString('base64'), sentenceIndex }
    });
  } catch {
    // TTS 失败不阻塞
  }

  return sentenceIndex + 1;
}

export const unifiedAgent = new UnifiedAgent();
export default UnifiedAgent;
