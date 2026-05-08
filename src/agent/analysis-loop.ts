/**
 * 深度分析 Loop
 */

import { stateManager } from '../state/manager.js';
import { skillEngine } from '../skills/engine.js';
import { logDb } from '../db/database.js';
import { callLLMStream, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import { Segment } from './types.js';
import { buildAnalysisPrompt } from './prompts.js';
import { extractJSONLines, parseSegment } from './segment-utils.js';
import { getDialogueStats, getRecentDialoguesText } from './dialogue-stats.js';

export interface AnalysisContext {
  userInput: string;
  retrievalResults: string;
  characterInfo: string;
  dialogueRequirements: string;
  availableEmotions: string[];
  speechLanguage: string;
}

export async function runAnalysisLoop(ctx: AnalysisContext): Promise<{ segments: Segment[] }> {
  const config = getLLMConfig();
  const allSkills = skillEngine.getAllSkillMetas();
  const skillList = allSkills.map(s => `- ${s.name}: ${s.description}`).join('\n');

  const recentText = getRecentDialoguesText(20);
  const emotionDesc = stateManager.getEmotionDescription();
  const affinityDesc = stateManager.getAffinityDescription();

  let currentMessage = buildAnalysisPrompt({
    userInput: ctx.userInput,
    retrievalResults: ctx.retrievalResults,
    characterInfo: ctx.characterInfo,
    dialogueRequirements: ctx.dialogueRequirements,
    emotionDescription: emotionDesc,
    affinityDescription: affinityDesc,
    dialogueStats: getDialogueStats(),
    recentDialogues: recentText,
    availableEmotions: ctx.availableEmotions,
    skillList,
    speechLanguage: ctx.speechLanguage
  });

  let iteration = 0;
  const maxIterations = 6;
  let finalSegments: Segment[] = [];

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

    // 没有技能调用，解析 segment 输出
    const lines = extractJSONLines(fullResponse);
    for (const line of lines) {
      const seg = parseSegment(line);
      if (seg) finalSegments.push(seg);
    }
    break;
  }

  if (finalSegments.length === 0) {
    // fallback
    finalSegments.push({ emotion: 'normal', action: 'idle', voice: '嗯，让我想想...' });
  }

  return { segments: finalSegments };
}