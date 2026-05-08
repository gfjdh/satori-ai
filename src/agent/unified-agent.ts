/**
 * 统一 Agent（合并 Analyzer + Polisher）
 * 联合检索 + Skill Loop + SSE 流式输出
 */

import { stateManager } from '../state/manager.js';
import { memoryManager } from '../memory/manager.js';
import { skillEngine } from '../skills/engine.js';
import { dialogueDb, logDb } from '../db/database.js';
import { callLLM, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import { Dialogue, SSEMessage } from '../types/index.js';
import { jointSearch, formatRetrievalContext, type JointSearchResult } from '../retrieval/joint-search.js';
import { embeddingManager } from '../embedding/manager.js';
import { synthesizeStream } from '../tts/client.js';
import { getAvailableEmotions } from '../tts/client.js';
import { loadDefaultCharacter, type CharacterConfig } from '../character/loader.js';
import jieba from 'node-jieba';

const systemPrompt = `## 你的角色
你是对话智能体信息检索模块的中枢控制器，负责分析用户问题并决定是否调用skill收集信息。

## 执行顺序
1. 分析用户问题，判断是否需要调用skill获取信息，不需要则直接输出最终回复（第5步）
2. 如果需要skill且上下文没有对应readme，输出：SKILL_README: skill_name
3. 上下文已有README时，输出：SKILL_CALL: skill_name\n{json参数}（不添加任何解释）
4. 执行完skill后分析返回结果，判断是否需要更多skill
5. **直接基于已获取的信息回答，不要重复总结已获取内容**

## 调用格式
**请求README（第二步）：**
SKILL_README: skill_name

**调用skill（第三步）：**
SKILL_CALL: skill_name
{"param1": "value1", "param2": "value2"}

**最终回复（第五步）**：收集到需要的信息后，直接输出回复内容，不要重复总结已获取的信息。
`;

// ========== 句子解析（从 polisher.ts 迁移） ==========

interface Sentence {
  text: string;
  emotion: string;
  subtitle: string;
  action?: string;
  sentenceIndex: number;
  mergeToNext?: boolean;
}

const SENTENCE_DELIMITERS = /(?<=[。！？!?；;，,、])/;

function parseAction(text: string): string | null {
  const actionMatch = text.match(/ACTION:([^\]]+)/);
  if (actionMatch) {
    return actionMatch[1].trim();
  }
  return null;
}

function isShortFillerText(text: string): boolean {
  const chars = text.replace(/[。！？!?；;，,、\s]/g, '');
  return chars.length >= 0 && chars.length <= 3;
}

function parseSentences(
  voice: string,
  subtitle: string,
  availableEmotions: string[]
): { sentences: Sentence[]; remainingSubtitles: string[] } {
  const sentences: Sentence[] = [];

  const voiceParts = voice.split(SENTENCE_DELIMITERS).filter(s => s.trim());
  const subtitleParts = subtitle.split(SENTENCE_DELIMITERS).filter(s => s.trim());

  if (subtitleParts.length > voiceParts.length) {
    const diff = subtitleParts.length - voiceParts.length;
    let mergesNeeded = diff;
    let idx = 0;
    while (mergesNeeded > 0 && idx < subtitleParts.length - 1) {
      const current = subtitleParts[idx];
      const currentChars = current.replace(/[。！？!?；;，,、\s]/g, '');
      if (currentChars.length <= 5) {
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

  for (let i = 0; i < voiceParts.length; i++) {
    const voicePart = voiceParts[i].trim();
    if (!voicePart) continue;

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

    let subPart = subtitleParts[i]?.trim();
    if (!subPart && i < subtitleParts.length) {
      subPart = subtitleParts.slice(i).join('').trim();
    }
    if (!subPart) {
      subPart = i >= subtitleParts.length ? '' : text;
    }

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

// ========== UnifiedAgent ==========

class UnifiedAgent {
  private character: CharacterConfig;
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  constructor(characterConfig?: CharacterConfig) {
    if (characterConfig) {
      this.character = characterConfig;
    } else {
      this.character = loadDefaultCharacter();
    }
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
      content: `[UnifiedAgent] User input: ${userInput.substring(0, 100)}`,
      createdAt: new Date()
    });

    // ========== 1. 联合检索 ==========
    const shortTermMemory = memoryManager.getCurrentShortTermMemory();
    let retrievalResults: JointSearchResult[] = [];
    try {
      retrievalResults = await jointSearch(userInput, shortTermMemory);
    } catch (error) {
      logDb.insert({
        id: uuidv4(),
        level: 'warn',
        category: 'agent',
        content: `[UnifiedAgent] Joint search failed: ${error}`,
        createdAt: new Date()
      });
    }

    // ========== 2. Skill Loop（最多6轮）==========
    const { skillResults, finalResponse } = await this.loopRetrieval(userInput, retrievalResults);

    // ========== 3. 构建回复上下文 ==========
    let fullContext = finalResponse;
    if (skillResults.size > 0) {
      fullContext += '\n\n[检索结果]\n';
      for (const [skillName, result] of skillResults.entries()) {
        fullContext += `[${skillName}] ${result}\n`;
      }
    }

    // ========== 4. 生成最终回复（JSON格式）==========
    const availableEmotions = getAvailableEmotions(this.character.id);
    const recentDialogues = dialogueDb.getRecent(20);

    // 获取已缓存的 skill README
    const cachedSkillReadmes = this.getCachedSkillReadmes();

    const responseText = await this.generateResponse(
      userInput,
      retrievalResults,
      skillResults,
      availableEmotions,
      recentDialogues,
      shortTermMemory,
      cachedSkillReadmes
    );

    // ========== 5. 解析并发送 SSE 事件 ==========
    const parsed = this.parsePolishResponse(responseText);
    const { voice, subtitle } = parsed;

    const { sentences, remainingSubtitles } = parseSentences(voice, subtitle, availableEmotions);

    // 预处理：合并短句
    const mergedSentences = this.mergeSentences(sentences);

    // 阶段1：立即发送 voice/subtitle（不等待 TTS）
    for (const sentence of mergedSentences) {
      onSSE?.({
        type: 'voice',
        data: {
          text: sentence.text,
          emotion: sentence.emotion,
          sentenceIndex: sentence.sentenceIndex,
          totalSentences: mergedSentences.length,
          language: this.character.speechLanguage
        } as unknown as Record<string, unknown>
      });

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
    let fullText = '';
    for (const sentence of mergedSentences) {
      try {
        const audioBuffer = await synthesizeStream(
          sentence.text,
          this.character.id,
          sentence.emotion
        );

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
        logDb.insert({
          id: uuidv4(),
          level: 'error',
          category: 'agent',
          content: `[UnifiedAgent] TTS synthesis failed: ${ttsError}`,
          createdAt: new Date()
        });
      }

      fullText += sentence.subtitle;
    }

    onSSE?.({ type: 'done', data: { text: fullText } });

    // ========== 6. 写入对话记录 ==========
    const dialogue: Dialogue = {
      id: turnId,
      turnIndex,
      userContent: userInput,
      aiContent: fullText,
      createdAt: new Date()
    };
    dialogueDb.insert(dialogue);

    this.conversationHistory.push({ role: 'user', content: userInput });
    this.conversationHistory.push({ role: 'assistant', content: fullText });

    // ========== 7. 更新记忆和状态 ==========
    const shouldSwitch = await memoryManager.shouldSwitchTopic(userInput);
    if (shouldSwitch) {
      await memoryManager.archiveCurrentTopic();
    }
    await memoryManager.updateShortTermMemory(userInput, fullText);
    this.updateStatesAsync(userInput, fullText);

    return fullText;
  }

  private mergeSentences(sentences: Sentence[]): Sentence[] {
    const merged: Sentence[] = [];
    let j = 0;
    while (j < sentences.length) {
      const current = sentences[j];
      if (current.mergeToNext && j + 1 < sentences.length) {
        const next = sentences[j + 1];
        merged.push({
          text: current.text + next.text,
          emotion: next.emotion,
          subtitle: current.subtitle + next.subtitle,
          action: next.action || current.action,
          sentenceIndex: next.sentenceIndex,
          mergeToNext: false
        });
        j += 2;
      } else {
        merged.push(current);
        j++;
      }
    }
    return merged;
  }

  private getCachedSkillReadmes(): Array<{ name: string; content: string }> {
    const result: Array<{ name: string; content: string }> = [];
    // skillEngine 有 skillCache Map，但 recentSkills 是 private
    // 直接访问 skillCache（也是 private，但可以通过断言访问）
    const cache = (skillEngine as any).skillCache;
    if (cache) {
      for (const [name, content] of cache) {
        result.push({ name, content: content as string });
      }
    }
    return result;
  }

  private parsePolishResponse(content: string): { voice: string; subtitle: string } {
    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    try {
      const result = JSON.parse(jsonStr) as { voice?: string; subtitle?: string };
      return {
        voice: result.voice || '',
        subtitle: result.subtitle || ''
      };
    } catch {
      return { voice: 'normal|好的', subtitle: '好的' };
    }
  }

  private async generateResponse(
    userInput: string,
    retrievalResults: JointSearchResult[],
    skillResults: Map<string, string>,
    availableEmotions: string[],
    recentDialogues: Dialogue[],
    shortTermMemory: { topic: string; summary: string } | null,
    cachedSkillReadmes: Array<{ name: string; content: string }>
  ): Promise<string> {
    const retrievalContext = formatRetrievalContext(retrievalResults);
    const config = getLLMConfig();

    const characterInfo = this.character.characterInfo || this.character.personality || '';
    const dialogueRequirements = this.character.dialogueRequirements || '';

    const recentDialoguesText = recentDialogues.reverse().map(d =>
      `用户：${d.userContent}\n角色：${d.aiContent}`
    ).join('\n');

    const skillResultsText = skillResults.size > 0
      ? Array.from(skillResults.entries()).map(([k, v]) => `[${k}] ${v}`).join('\n')
      : '';

    const cachedReadmesText = cachedSkillReadmes.length > 0
      ? cachedSkillReadmes.map(r => `[SKILL_README: ${r.name}]\n${r.content}`).join('\n\n')
      : '（无）';

    const userMessage = `## 角色信息
${characterInfo}

## 角色对话要求
${dialogueRequirements}

## 知识库+长期记忆检索结果
${retrievalContext}

## 当前状态
${stateManager.getEmotionDescription()}
${stateManager.getAffinityDescription()}
${getDialogueStats()}

## 最近对话
${recentDialoguesText}

## 已缓存的Skill README（如有）
${cachedReadmesText}

${skillResultsText ? `## Skill检索结果\n${skillResultsText}\n` : ''}

## 用户消息
${userInput}

## 可用情感标签
${availableEmotions.join(', ')}

## 输出格式
- 需要skill：按上述第2-4步输出 SKILL_README/SKILL_CALL
- 不需要skill：{"voice": "情感标签|文本", "subtitle": "字幕文本（可含[ACTION:type]）"}
- voice和subtitle句子数量必须完全一致
- 情感标签必须是可用情感标签之一`;

    const response = await callLLM({
      model: config.model,
      messages: [{ role: 'user', content: userMessage }],
      temperature: 0.7
    });

    logDb.insert({
      id: uuidv4(),
      level: 'debug',
      category: 'agent',
      content: `[UnifiedAgent] LLM Response:\n${response.content.substring(0, 500)}`,
      createdAt: new Date()
    });

    return response.content;
  }

  private async loopRetrieval(
    userInput: string,
    retrievalResults: JointSearchResult[]
  ): Promise<{ skillResults: Map<string, string>; finalResponse: string }> {
    const skillResults = new Map<string, string>();
    const maxIterations = 6;
    const config = getLLMConfig();

    const allSkills = skillEngine.getAllSkillMetas();
    const skillList = allSkills.map(s => `- ${s.name}: ${s.description}`).join('\n');

    let iteration = 0;
    let continueLoop = true;
    let lastAnalysisContent = '';

    const retrievalContext = formatRetrievalContext(retrievalResults);

    let currentUserMessage = `
${systemPrompt}

## 可用skill列表
${skillList || '（无）'}

## 角色信息
${this.character.characterInfo || this.character.personality}

## 知识库+长期记忆检索结果
${retrievalContext}

## 用户消息
${userInput}
`;

    while (continueLoop && iteration < maxIterations) {
      if (iteration > 0) {
        currentUserMessage += `\n${systemPrompt}\n`;
      }
      iteration++;

      try {
        const response = await callLLM({
          model: config.model,
          messages: [{ role: 'user', content: currentUserMessage }],
          temperature: 0.3,
          thinking: iteration > 2
        });

        const content = response.content;

        logDb.insert({
          id: uuidv4(),
          level: 'debug',
          category: 'agent',
          content: `[UnifiedAgent LLM Response #${iteration}]:\n${content.substring(0, 300)}`,
          createdAt: new Date()
        });

        // 解析 SKILL_README
        const readmeRequests = this.parseSkillReadmeRequests(content);
        for (const skillName of readmeRequests) {
          const skill = await skillEngine.loadSkill(skillName);
          if (skill) {
            currentUserMessage += `\n\n[已插入 ${skillName} 的README]\n${skill.content}\n\n请继续根据以上README执行之前的操作。`;
            break;
          }
        }

        if (readmeRequests.length > 0) {
          continue;
        }

        // 解析 SKILL_CALL
        const skillCalls = this.parseSkillCalls(content);

        if (skillCalls.length === 0) {
          lastAnalysisContent = content;
          continueLoop = false;
          continue;
        }

        // 执行 skill 调用
        for (const call of skillCalls) {
          const { skillName, params } = call;
          currentUserMessage += `\n\n[调用 skill: ${skillName}, 参数: ${JSON.stringify(params)}]`;

          const result = await this.executeSkill(skillName, params);
          skillResults.set(skillName, result);

          const resultForLog = result || '(无结果)';
          currentUserMessage += `\n\n[SKILL_RESULT: ${skillName}]\n${resultForLog}\n\n请基于以上检索结果继续分析或回复。`;

          logDb.insert({
            id: uuidv4(),
            level: 'debug',
            category: 'agent',
            content: `[SKILL_RESULT: ${skillName}] length=${result?.length ?? 0}`,
            createdAt: new Date()
          });
        }
      } catch (error) {
        logDb.insert({
          id: uuidv4(),
          level: 'error',
          category: 'agent',
          content: `[UnifiedAgent loop error] ${error instanceof Error ? error.message : String(error)}`,
          createdAt: new Date()
        });
        break;
      }
    }

    if (iteration >= maxIterations) {
      lastAnalysisContent = "信息检索可能不完整或不准确。请基于已有信息尽可能提供回复。";
      logDb.insert({
        id: uuidv4(),
        level: 'warn',
        category: 'agent',
        content: `Reached max iterations (${maxIterations}) in loop retrieval.`,
        createdAt: new Date()
      });
    }

    return { skillResults, finalResponse: lastAnalysisContent };
  }

  private parseSkillCalls(content: string): Array<{ skillName: string; params: Record<string, unknown> }> {
    const calls: Array<{ skillName: string; params: Record<string, unknown> }> = [];
    const callRegex = /SKILL_CALL:\s*(\w+)/g;
    let callMatch;

    while ((callMatch = callRegex.exec(content)) !== null) {
      const skillName = callMatch[1];
      const jsonStart = callMatch.index + callMatch[0].length;

      const bracePos = content.indexOf('{', jsonStart);
      if (bracePos === -1) continue;

      let depth = 0;
      let jsonEnd = -1;
      for (let i = bracePos; i < content.length; i++) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') {
          depth--;
          if (depth === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }

      if (jsonEnd === -1) continue;

      const jsonStr = content.slice(bracePos, jsonEnd);
      try {
        const params = JSON.parse(jsonStr);
        calls.push({ skillName, params });
      } catch (e) {
        logDb.insert({ id: crypto.randomUUID(), level: 'warn', category: 'agent', content: `Failed to parse skill params for ${skillName}: ${e}`, createdAt: new Date() });
      }
    }
    return calls;
  }

  private parseSkillReadmeRequests(content: string): string[] {
    const requests: string[] = [];
    const regex = /SKILL_README:\s*(\w+)/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      const skillName = match[1];
      if (!requests.includes(skillName)) {
        requests.push(skillName);
      }
    }

    return requests;
  }

  private async executeSkill(skillName: string, params: Record<string, unknown>): Promise<string> {
    try {
      const skill = await skillEngine.loadSkill(skillName);
      if (!skill) {
        return `[错误] Skill不存在: ${skillName}`;
      }

      const skillParams = { ...params, timestamp: new Date().toISOString() };
      const result = await skillEngine.executeSkill(skillName, skillParams);

      if (typeof result === 'string') {
        return result;
      }

      return result ? String(result) : '[空结果]';
    } catch (error) {
      logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'agent', content: `Skill execution failed for ${skillName}: ${error}`, createdAt: new Date() });
      return `[Skill执行出错] ${skillName}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async updateStatesAsync(userInput: string, aiResponse: string): Promise<void> {
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

请以JSON格式返回状态变化（数值范围 -5 到 +5，不需要其他任何补充内容）：
{
  "emotion": {
    ${emotionDimensionDesc}
  },
  "affinity": {
    ${affinityDimensionDesc}
  }
}`;

        const response = await callLLM({
          model: config.model,
          messages: [{ role: 'user', content: updatePrompt }],
          temperature: 0
        });

        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);

          if (parsed.emotion) {
            stateManager.updateEmotion(parsed.emotion);
          }

          if (parsed.affinity) {
            stateManager.updateAffinity(parsed.affinity);
          }
        }
      } catch (error) {
        logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'agent', content: `State update error: ${error}`, createdAt: new Date() });
      }
    });
  }

  getConversationHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return [...this.conversationHistory];
  }

  setCharacter(config: Partial<CharacterConfig>): void {
    this.character = { ...this.character, ...config } as CharacterConfig;
  }
}

// 导出单例
export const unifiedAgent = new UnifiedAgent();
export default UnifiedAgent;