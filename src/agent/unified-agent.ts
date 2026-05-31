/**
 * Unified Agent v6 — ReAct Agent（单 Agent + native function calling）
 *
 * v6 变更：
 * - Polisher+Analyzer 双 Agent 合并为单一 ReAct 循环
 * - 使用 OpenAI 原生 function calling 替代自研文本协议
 * - 简单对话 1 次 LLM 调用，复杂对话 2 次（tool call → text generation）
 * - 移除 needDeepThink / deep_think_pending / deep_think_progress
 */

import { stateManager } from '../state/manager.js';
import { memoryManager } from '../memory/manager.js';
import { dialogueDb, logDb, now } from '../db/database.js';
import { callLLMStream, callLLMWithTools, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import { Dialogue, SSEMessage } from '../types/index.js';
import { skillEngine } from '../skills/engine.js';
import { getAvailableEmotions } from '../tts/client.js';
import { loadDefaultCharacter, getAvailableActions, type CharacterConfig } from '../character/loader.js';
import { userProfileManager } from '../user/profile.js';

import { buildReActMessages, type ChatMessage } from './prompts.js';
import { parseSegment, emitSegment, extractAllSegments, extractCompleteJSONObjects } from './segment-utils.js';
import { getDialogueStats, getRecentDialoguesText } from './dialogue-stats.js';
import { toolRegistry } from './tool-registry.js';
import { discloseSkill } from './tools.js';

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
    const turnIndex = dialogueDb.getTurnCount(this.character.id) + 1;
    const turnId = uuidv4();

    logDb.insert({
      id: uuidv4(),
      level: 'info',
      category: 'agent',
      content: `[UnifiedAgent] User input: ${userInput}`,
      createdAt: now()
    });

    const config = getLLMConfig();
    const speechLanguage = this.character.speechLanguage || 'ja-JP';
    const subtitleLanguage = this.character.subtitleLanguage || 'zh-CN';
    const availableEmotions = getAvailableEmotions(this.character.id);
    const availableActions = getAvailableActions(this.character.id);
    const characterInfo = this.character.characterInfo || this.character.personality || '';
    const dialogueRequirements = this.character.dialogueRequirements || '';

    const allVoiceTexts: string[] = [];
    let sentenceIndex = 0;

    // ========== Phase 0: Pre-load skill cache (BEFORE Phase 1 to avoid cache pollution) ==========
    const recentSkillsContext = await skillEngine.getRecentSkillsContext();

    // ========== Phase 1: Pre-retrieval ==========
    const recentDialoguesForRetrieval = getRecentDialoguesText(4, 1, { userOnly: true });
    const retrievalQuery = recentDialoguesForRetrieval
      ? recentDialoguesForRetrieval + '\n' + userInput
      : userInput;
    const retrievalContext = await skillEngine.executeSkill('search', {
      query: retrievalQuery,
      limit: 10
    });

    if (signal?.aborted) {
      return this.finalizeTurn(userInput, allVoiceTexts, onSSE, turnId, turnIndex, true);
    }

    // ========== Phase 1.5: Trigger word matching ==========
    let visualContext = '';
    let triggerSkillsContext = '';
    const triggeredSkills = skillEngine.matchTriggerSkills(userInput);
    for (const skill of triggeredSkills) {
      // 动态注册 skill 附带的 tool + 预加载完整 README
      discloseSkill(skill.name);
      const fullSkill = await skillEngine.loadSkill(skill.name);
      if (fullSkill) {
        triggerSkillsContext += `[触发词预加载: ${skill.name}]\n${fullSkill.content}\n\n`;
      }
      if (skill.name === 'image-analysis') {
        visualContext = await skillEngine.executeSkill(skill.name, { query: userInput });
      }
    }
    // 合并触发词 skill README 到 visualContext（同属即时上下文）
    if (triggerSkillsContext) {
      visualContext = triggerSkillsContext + visualContext;
    }

    if (signal?.aborted) {
      return this.finalizeTurn(userInput, allVoiceTexts, onSSE, turnId, turnIndex, true);
    }

    // ========== Phase 2: Build messages ==========
    const currentTopic = memoryManager.getCurrentTopic();
    const recentText = getRecentDialoguesText(20, 6, {
      sinceDate: currentTopic?.startTime ?? undefined
    });
    const memoryContext = memoryManager.buildRecentContext();
    const combinedContext = [memoryContext, recentText].filter(Boolean).join('\n\n');

    const messages: ChatMessage[] = buildReActMessages({
      userInput,
      retrievalResults: retrievalContext,
      visualContext,
      characterInfo,
      characterName: this.character.name,
      dialogueRequirements,
      emotionDescription: stateManager.getEmotionDescription(),
      affinityDescription: stateManager.getAffinityDescription(),
      dialogueStats: getDialogueStats(),
      recentDialogues: combinedContext,
      recentSkillsContext,
      availableEmotions,
      availableActions,
      speechLanguage,
      subtitleLanguage,
      userProfile: userProfileManager.getProfileContext()
    });

    // ========== Phase 3: ReAct Loop ==========
    let round = 0;
    const maxRounds = 6;
    let totalToolCalls = 0;
    const maxToolCalls = 3;
    let buffer = '';

    while (round < maxRounds) {
      if (signal?.aborted) break;
      round++;

      const toolCallsThisRound = new Map<string, { name: string; arguments: string }>();
      let textDeltaThisRound = '';
      buffer = '';
      const preRoundVoiceCount = allVoiceTexts.length;

      // 温度分离：文本生成用 0.7，处理工具结果用 0.3（原 Analyzer 专用温度）
      const temperature = totalToolCalls > 0 ? 0.3 : 0.7;

      // 工具调用达上限后不再传 tools，强制文本输出
      const activeTools = totalToolCalls >= maxToolCalls ? undefined : toolRegistry.getDefinitions();

      const stream = callLLMWithTools(
        {
          model: config.model,
          messages,
          temperature,
          ...(activeTools ? { tools: activeTools, tool_choice: 'auto' as const } : {})
        },
        true,
        `react-round-${round}`,
        signal
      );

      for await (const chunk of stream) {
        if (signal?.aborted) break;

        switch (chunk.kind) {
          case 'text':
            textDeltaThisRound += chunk.delta;
            buffer += chunk.delta;

            {
              // 花括号深度追踪提取完整 JSON，兼容单行和多行 pretty-print
              const result = extractCompleteJSONObjects(buffer);
              buffer = result.remainder;
              for (const objStr of result.objects) {
                const seg = parseSegment(objStr);
                if (!seg) continue;
                sentenceIndex = await emitSegment(
                  seg, sentenceIndex, speechLanguage, subtitleLanguage,
                  this.character.id, onSSE
                );
                allVoiceTexts.push(seg.voice);
              }
            }
            break;

          case 'tool_call_start':
            toolCallsThisRound.set(chunk.id, { name: chunk.name, arguments: '' });
            break;

          case 'tool_call_delta': {
            const existing = toolCallsThisRound.get(chunk.id);
            if (existing) existing.arguments += chunk.delta;
            break;
          }

          case 'tool_call_end': {
            const existing = toolCallsThisRound.get(chunk.id);
            if (existing) {
              existing.arguments = chunk.arguments || existing.arguments;
            } else {
              toolCallsThisRound.set(chunk.id, { name: chunk.name, arguments: chunk.arguments });
            }
            break;
          }
        }
      }

      // 流结束后处理残留 buffer（同样兼容单行和多行 JSON）
      if (buffer.trim()) {
        const result = extractCompleteJSONObjects(buffer);
        for (const objStr of result.objects) {
          const seg = parseSegment(objStr);
          if (seg) {
            if (!signal?.aborted) {
              sentenceIndex = await emitSegment(
                seg, sentenceIndex, speechLanguage, subtitleLanguage,
                this.character.id, onSSE
              );
            }
            allVoiceTexts.push(seg.voice);
          }
        }
        // 如果流式解析完全失败且没有任何段落被提取，尝试对整个残留文本进行一次性提取（极端情况下模型可能一次性输出完整 JSON）
        if (result.objects.length === 0) {
          const seg = parseSegment(result.remainder || buffer.trim());
          if (seg) {
            if (!signal?.aborted) {
              sentenceIndex = await emitSegment(
                seg, sentenceIndex, speechLanguage, subtitleLanguage,
                this.character.id, onSSE
              );
            }
            allVoiceTexts.push(seg.voice);
          }
        }
      }

      // 安全检查：如果本轮没有任何段落被成功解析出来，尝试对本轮累计的文本增量进行一次性提取（极端情况下模型可能输出格式完全不符合预期，导致逐行解析失败）
      const segsAddedThisRound = allVoiceTexts.length - preRoundVoiceCount;
      if (segsAddedThisRound === 0 && textDeltaThisRound.trim()) {
        const fallbackSegs = extractAllSegments(textDeltaThisRound);
        for (const seg of fallbackSegs) {
          sentenceIndex = await emitSegment(
            seg, sentenceIndex, speechLanguage, subtitleLanguage,
            this.character.id, onSSE
          );
          allVoiceTexts.push(seg.voice);
        }
        if (fallbackSegs.length > 0) {
          logDb.insert({
            id: uuidv4(),
            level: 'warn',
            category: 'agent',
            content: `[Format fallback] Line-by-line parser yielded 0 segments, full-text extraction recovered ${fallbackSegs.length}. Raw text (first 500): ${textDeltaThisRound.slice(0, 500)}`,
            createdAt: now()
          });
        } else if (textDeltaThisRound.trim()) {
          logDb.insert({
            id: uuidv4(),
            level: 'error',
            category: 'agent',
            content: `[Format error] Model output zero parseable segments. Raw text (first 500): ${textDeltaThisRound.slice(0, 500)}`,
            createdAt: now()
          });
        }
      }

      // Append assistant message
      if (textDeltaThisRound || toolCallsThisRound.size > 0) {
        const assistantMsg: ChatMessage = { role: 'assistant' };

        if (textDeltaThisRound) {
          assistantMsg.content = textDeltaThisRound;
        }

        if (toolCallsThisRound.size > 0) {
          assistantMsg.tool_calls = Array.from(toolCallsThisRound.entries()).map(
            ([id, tc]) => ({
              id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.arguments }
            })
          );
        }

        messages.push(assistantMsg);
      }

      // If no tool calls, done
      if (toolCallsThisRound.size === 0) break;

      // Execute tools in parallel and append results
      const toolEntries = Array.from(toolCallsThisRound.entries());
      totalToolCalls += toolEntries.length;

      const executeAllTools = Promise.all(
        toolEntries.map(async ([toolCallId, toolCall]) => {
          let params: Record<string, unknown> = {};
          if (toolCall.arguments) {
            try { params = JSON.parse(toolCall.arguments); } catch { params = { query: toolCall.arguments }; }
          }
          const toolResult = await toolRegistry.execute(toolCall.name, params);
          logDb.insert({
            id: uuidv4(),
            level: 'debug',
            category: 'agent',
            content: `[ReAct tool: ${toolCall.name}]\n${toolResult.slice(0, 500)}`,
            createdAt: now()
          });
          return { toolCallId, toolResult };
        })
      );

      let toolResults: Array<{ toolCallId: string; toolResult: string }>;
      if (signal) {
        const abortPromise = new Promise<never>((_, reject) => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          if (signal.aborted) { reject(err); return; }
          signal.addEventListener('abort', () => reject(err), { once: true });
        });
        try {
          toolResults = await Promise.race([executeAllTools, abortPromise]);
        } catch (e: any) {
          if (e?.name === 'AbortError') break;
          throw e;
        }
      } else {
        toolResults = await executeAllTools;
      }

      for (const { toolCallId, toolResult } of toolResults) {
        messages.push({
          role: 'tool' as const,
          tool_call_id: toolCallId,
          content: toolResult
        } satisfies ChatMessage as ChatMessage);
      }
    }

    return this.finalizeTurn(userInput, allVoiceTexts, onSSE, turnId, turnIndex, !!signal?.aborted);
  }

  private finalizeTurn(
    userInput: string,
    allVoiceTexts: string[],
    onSSE: ((message: SSEMessage) => void) | undefined,
    turnId: string,
    turnIndex: number,
    skipPostProcessing = false
  ): string {
    const finalText = allVoiceTexts.join('');

    onSSE?.({ type: 'done', data: { text: finalText } });

    if (finalText) {
      const dialogue: Dialogue = {
        id: turnId,
        turnIndex,
        characterId: this.character.id,
        userContent: userInput,
        aiContent: finalText,
        createdAt: now()
      };
      dialogueDb.insert(dialogue);

      if (!skipPostProcessing) {
        memoryManager.ensureTopicTracking();
        memoryManager.shouldSwitchTopic(userInput).then(shouldSwitch => {
          if (shouldSwitch) {
            memoryManager.archiveCurrentTopic();
          }
        });
        this.updateStatesAsync(userInput, finalText);
      }
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
          createdAt: now()
        });
      }
    });
  }

  setCharacter(config: Partial<CharacterConfig>): void {
    this.character = { ...this.character, ...config } as CharacterConfig;
  }
}

export const unifiedAgent = new UnifiedAgent();
export default UnifiedAgent;
