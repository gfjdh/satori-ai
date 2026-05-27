/**
 * 深度分析 Session — 纯工具执行器
 *
 * 每轮 LLM 调用只输出：SKILL_README / SKILL_CALL / DONE。
 * 不生成任何回答文本、分析文本或总结文本。
 * 工具结果直接累积为 rawFindings，传给 polisher 合成。
 *
 * v5: 接受外部构建的初始 ChatMessage[]，暴露 getMessages() 供持久化。
 */

import { skillEngine } from '../skills/engine.js';
import { logDb, now } from '../db/database.js';
import { callLLMStream, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage } from './prompts.js';

export interface AnalysisRoundResult {
  status: 'in_progress' | 'complete' | 'max_rounds';
  roundIndex: number;
  actionDescription: string;
  /** 累积的原始工具执行结果（非总结/非回答） */
  rawFindings: string;
}

export interface AnalysisSession {
  next(): Promise<AnalysisRoundResult>;
  getMessages(): ChatMessage[];
}

const DONE_RE = /^DONE\b/im;

export function createAnalysisSession(
  initialMessages: ChatMessage[],
  signal?: AbortSignal
): AnalysisSession {
  const config = getLLMConfig();
  const messages = [...initialMessages];
  let iteration = 0;
  const maxIterations = 6;
  let searchCount = 0;
  let allRawFindings = '';

  function maxRoundsResult(): AnalysisRoundResult {
    return {
      status: 'max_rounds',
      roundIndex: iteration,
      actionDescription: '达到最大分析轮次',
      rawFindings: allRawFindings
    };
  }

  function abortResult(): AnalysisRoundResult {
    return {
      status: 'max_rounds',
      roundIndex: iteration,
      actionDescription: '对话已中断',
      rawFindings: allRawFindings
    };
  }

  return {
    getMessages(): ChatMessage[] {
      return messages;
    },

    async next() {
      if (signal?.aborted) return abortResult();
      if (iteration >= maxIterations) return maxRoundsResult();

      iteration++;

      const response = callLLMStream(
        { model: config.model, messages, temperature: 0.3 },
        true,
        `analysis-round-${iteration}`,
        signal
      );

      let fullResponse = '';
      for await (const chunk of response) {
        if (signal?.aborted) break;
        fullResponse += chunk;
      }

      if (signal?.aborted) return abortResult();

      logDb.insert({
        id: uuidv4(),
        level: 'debug',
        category: 'agent',
        content: `[Analysis Round #${iteration}]:\n${fullResponse}`,
        createdAt: now()
      });

      // DONE
      if (DONE_RE.test(fullResponse)) {
        messages.push({ role: 'assistant', content: fullResponse });
        return {
          status: 'complete',
          roundIndex: iteration,
          actionDescription: '分析完成',
          rawFindings: allRawFindings
        };
      }

      // SKILL_README
      const readmeMatch = fullResponse.match(/SKILL_README:\s*([\w-]+)/);
      if (readmeMatch) {
        const skillName = readmeMatch[1];
        const skill = await skillEngine.loadSkill(skillName);
        messages.push({ role: 'assistant', content: fullResponse });
        if (skill) {
          messages.push({
            role: 'user',
            content: `[已插入 ${skillName} README]\n${skill.content}\n\n请判断是否需要调用 ${skillName} 技能。如果不需要，输出 DONE。`
          });
        }
        return {
          status: 'in_progress',
          roundIndex: iteration,
          actionDescription: `已加载 ${skillName} 技能说明`,
          rawFindings: allRawFindings
        };
      }

      // SKILL_CALL
      const skillCallMatch = fullResponse.match(
        /SKILL_CALL:\s*([\w-]+)\s*\n([\s\S]*?)(?=SKILL_CALL:|SKILL_README:|DONE|$)/
      );
      if (skillCallMatch) {
        const skillName = skillCallMatch[1];
        searchCount++;

        const forceStop = searchCount >= 3
          ? '\n\n[系统提示] 已执行多次搜索。禁止再次调用技能，请输出 DONE。'
          : '\n\n请判断是否还需要调用技能。如果不需要，输出 DONE。';

        const jsonMatch = skillCallMatch[2].match(/\{[\s\S]*\}/);
        messages.push({ role: 'assistant', content: fullResponse });
        if (jsonMatch) {
          try {
            const params = JSON.parse(jsonMatch[0]);
            const result = await skillEngine.executeSkill(skillName, {
              ...params,
              timestamp: now().toISOString()
            });
            const resultText = typeof result === 'string' ? result : JSON.stringify(result);
            allRawFindings += `\n[${skillName} 执行结果]\n${resultText}\n`;
            messages.push({
              role: 'user',
              content: `[SKILL_RESULT: ${skillName}]\n${resultText}\n${forceStop}`
            });
          } catch (e) {
            logDb.insert({
              id: uuidv4(),
              level: 'error',
              category: 'agent',
              content: `Skill execution failed: ${e}`,
              createdAt: now()
            });
          }
        }
        return {
          status: 'in_progress',
          roundIndex: iteration,
          actionDescription: `已执行 ${skillName} 技能${searchCount >= 3 ? '（已达搜索上限）' : ''}`,
          rawFindings: allRawFindings
        };
      }

      // LLM 输出了非指令内容 → 格式纠正，继续下一轮
      messages.push({ role: 'assistant', content: fullResponse });
      messages.push({
        role: 'user',
        content: '请严格遵循输出格式。只能输出 SKILL_README、SKILL_CALL 或 DONE。禁止输出其他任何内容。'
      });
      return {
        status: 'in_progress',
        roundIndex: iteration,
        actionDescription: '格式纠正中…',
        rawFindings: allRawFindings
      };
    }
  };
}
