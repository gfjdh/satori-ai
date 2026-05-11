/**
 * 深度分析 Loop
 * 纯粹的信息检索/工具执行器，只负责解决问题，返回分析结果供 polisher 使用
 */

import { skillEngine } from '../skills/engine.js';
import { logDb } from '../db/database.js';
import { callLLMStream, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import { buildAnalysisPrompt } from './prompts.js';

export interface AnalysisResult {
  /** 回答内容（未分段的完整文本） */
  answerText: string;
}

export interface AnalysisContext {
  userInput: string;
  retrievalResults: string;
  characterInfo: string;
}

export async function runAnalysisLoop(ctx: AnalysisContext): Promise<AnalysisResult> {
  const config = getLLMConfig();
  const allSkills = skillEngine.getAllSkillMetas();
  const skillList = allSkills.map(s => `- ${s.name}: ${s.description}`).join('\n');
  const recentSkillsContext = await skillEngine.getRecentSkillsContext();

  let currentMessage = buildAnalysisPrompt({
    userInput: ctx.userInput,
    retrievalResults: ctx.retrievalResults,
    characterInfo: ctx.characterInfo,
    skillList,
    recentSkillsContext
  });

  let iteration = 0;
  const maxIterations = 6;

  while (iteration < maxIterations) {
    iteration++;

    const response = callLLMStream({
      model: config.model,
      messages: [{ role: 'user', content: currentMessage }],
      temperature: 0.3
    });

    let fullResponse = '';
    for await (const chunk of response) {
      fullResponse += chunk;
    }

    logDb.insert({
      id: uuidv4(),
      level: 'debug',
      category: 'agent',
      content: `[Analysis Loop #${iteration}]:\n${fullResponse}`,
      createdAt: new Date()
    });

    // 检查是否需要 SKILL_README
    const readmeMatch = fullResponse.match(/SKILL_README:\s*(\w+)/);
    if (readmeMatch) {
      const skillName = readmeMatch[1];
      const skill = await skillEngine.loadSkill(skillName);
      if (skill) {
        currentMessage += `\n\n[已插入 ${skillName} README]\n${skill.content}\n\n请继续执行。`;
      }
      continue;
    }

    // 检查是否需要 SKILL_CALL
    const skillCallMatch = fullResponse.match(/SKILL_CALL:\s*(\w+)\s*\n([\s\S]*?)(?=SKILL_CALL:|SKILL_README:|$)/);
    if (skillCallMatch) {
      const skillName = skillCallMatch[1];
      const jsonMatch = skillCallMatch[2].match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const params = JSON.parse(jsonMatch[0]);
          const result = await skillEngine.executeSkill(skillName, { ...params, timestamp: new Date().toISOString() });
          currentMessage += `\n\n[SKILL_RESULT: ${skillName}]\n${result}\n\n请基于以上结果继续或回复。`;
        } catch (e) {
          logDb.insert({
            id: uuidv4(),
            level: 'error',
            category: 'agent',
            content: `Skill execution failed: ${e}`,
            createdAt: new Date()
          });
        }
      }
      continue;
    }

    // 没有技能调用，提取纯文本回答
    const answerText = extractAnswerText(fullResponse);
    if (answerText) {
      return { answerText };
    }

    break;
  }

  return { answerText: '没有找到相关信息' };
}

function extractAnswerText(text: string): string | null {
  // 移除 SKILL_README / SKILL_CALL 等指令行，提取纯文本回答
  const lines = text.split('\n');
  const answerLines: string[] = [];
  let inJsonBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('SKILL_README:') || trimmed.startsWith('SKILL_CALL:')) {
      inJsonBlock = true;
      continue;
    }
    if (inJsonBlock && (trimmed.startsWith('{') || trimmed === '')) {
      inJsonBlock = false;
    }
    if (!inJsonBlock && trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('```')) {
      answerLines.push(trimmed);
    }
  }

  const result = answerLines.join('\n').trim();
  return result.length > 0 ? result : null;
}