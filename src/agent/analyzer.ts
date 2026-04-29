import { stateManager } from '../state/manager.js';
import { memoryManager } from '../memory/manager.js';
import { skillEngine } from '../skills/engine.js';
import { dialogueDb, logDb } from '../db/database.js';
import { callLLM, getLLMConfig } from '../api/llm.js';
import { v4 as uuidv4 } from 'uuid';
import { Dialogue, SSEMessage } from '../types/index.js';
import { polish } from './polisher.js';
import { loadDefaultCharacter, type CharacterConfig } from '../character/loader.js';

const systemPrompt = `## 你的角色
你是一个智能体信息检索模块的中枢控制器，负责分析用户问题并决定是否需要调用skill来收集信息。

## 执行顺序（你需要根据上下文判断当前该执行哪一步）
1. **第一步**：分析用户问题，判断是否需要调用skill获取信息，如果不需要，直接输出最终回复（第五步）；如果需要，进入第二步。
2. **第二步**：如果要使用某个skill且当前上下文中没有对应readme，输出 SKILL_README: skill_name 来获取该skill的README内容。
3. **第三步**：上下文中存在需要的README时，按照README中的参数格式输出 SKILL_CALL: skill_name，并附上JSON格式的参数（参数必须符合README要求，否则可能调用失败），不要添加其他任何解释或文本，**只输出SKILL_CALL指令**（如果有多个skill需要调用，必须分开多次输出，每次一条SKILL_CALL指令）
4. **第四步**：执行完skill后，分析返回结果，判断是否需要调用更多skill，如果需要，继续重复第二步和第三步；如果不需要，进入下一步
5. **第五步**：只有确认已经收集到需要的信息后，才能输出最终回复。你的最终回复会自动携带每个skill的最后一次调用时的返回结果，所以不需要你在回复中重复输出或总结最后一轮查询到的结果（反例：如果需要同时用到前几次搜索得到的信息，则需要在回复中重复或概括需要的信息），**尽量简短**，不要有任何多余的解释。

**警告**：绝对不能在没有README时盲目调用SKILL_CALL。也不需要在上下文已经有README时进行重复请求。只需要请求你需要的README。

## 调用格式
**请求README（第二步）：**
SKILL_README: skill_name

**调用skill（第三步，参数格式以对应readme为准）：**
SKILL_CALL: skill_name
{"param1": "value1", "param2": "value2"}

**最终回复（第五步）**：收集到需要的信息后，为了加快处理速度，在大部分情况下直接输出“信息检索完成”即可，不要加任何其他内容。
`

// ========== 分析Agent ==========
class AnalysisAgent {
  private character: CharacterConfig;
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  constructor(characterConfig?: CharacterConfig) {
    // 优先使用传入的配置，否则从角色卡加载
    if (characterConfig) {
      this.character = characterConfig;
    } else {
      this.character = loadDefaultCharacter();
    }
  }

  // 核心Loop：处理用户输入并生成回复
  async process(
    userInput: string,
    onSSE?: (message: SSEMessage) => void
  ): Promise<string> {
    const turnIndex = dialogueDb.getTurnCount() + 1;
    const turnId = uuidv4();

    // 1. 记录日志
    logDb.insert({
      id: uuidv4(),
      level: 'info',
      category: 'agent',
      content: `User input: ${userInput.substring(0, 100)}`,
      createdAt: new Date()
    });

    // 2. 构建上下文
    // const context = await this.buildContext(userInput);

    // 3. 循环检索：分析Agent收集信息，返回检索结果和最终回复
    const { skillResults, finalResponse } = await this.loopRetrieval(userInput);

    // 4. 构建完整上下文传给Polisher
    let fullContext = finalResponse;
    if (skillResults.size > 0) {
      fullContext += '\n\n[检索结果]\n';
      for (const [skillName, result] of skillResults.entries()) {
        fullContext += `[${skillName}] ${result}\n`;
      }
    }

    // 5. 调用Polisher进行润色（Polisher负责SSE输出）
    const polishResult = await polish(
      userInput,
      fullContext || '请回复用户',
      {
        characterInfo: this.character.characterInfo || this.character.personality,
        dialogueRequirements: this.character.dialogueRequirements || '',
        emotion: stateManager.getEmotionDescription(),
        affinity: stateManager.getAffinityDescription(),
        characterId: this.character.id,
        speechLanguage: this.character.speechLanguage,
        subtitleLanguage: this.character.subtitleLanguage
      },
      onSSE
    );
    if (polishResult.error) {
      return polishResult.text;
    }

    // 6. 写入原始对话
    const dialogue: Dialogue = {
      id: turnId,
      turnIndex,
      userContent: userInput,
      aiContent: polishResult.text,
      createdAt: new Date()
    };
    dialogueDb.insert(dialogue);

    // 更新对话历史
    this.conversationHistory.push({ role: 'user', content: userInput });
    this.conversationHistory.push({ role: 'assistant', content: polishResult.text });

    // 7. 判断话题切换
    const shouldSwitch = await memoryManager.shouldSwitchTopic(userInput);
    if (shouldSwitch) {
      await memoryManager.archiveCurrentTopic();
    }

    // 8. 更新短期记忆
    await memoryManager.updateShortTermMemory(userInput, polishResult.text);

    // 9. 异步更新状态（好感度/情绪）
    this.updateStatesAsync(userInput, polishResult.text);

    return polishResult.text;
  }

  // 构建上下文（用于分析agent）
  private async buildContext(skillResults: string): Promise<string> {
    const shortTermMemory = memoryManager.getCurrentShortTermMemory();

    const contextParts: string[] = [];
    // 短期记忆
    if (shortTermMemory) {
      contextParts.push(`当前话题：${shortTermMemory.topic}`);
      contextParts.push(`话题总结：${shortTermMemory.summary}`);
    }

    // 最近对话（最近10轮）
    const recentDialogues = dialogueDb.getRecent(20);
    if (recentDialogues.length > 0) {
      contextParts.push('最近对话：');
      for (const d of recentDialogues.reverse()) {
        contextParts.push(`用户：${d.userContent}`);
        contextParts.push(`角色：${d.aiContent}`);
      }
    }

    // 预检索结果（如果有）
    const preSearchResult = skillResults ? `\n\n[预检索结果：为了加快处理速度，如果这些信息已经能回答问题，直接输出“信息检索完成”即可]\n${skillResults}` : '';
    if (preSearchResult) {
      contextParts.push(preSearchResult);
    }

    // 最近使用的skill缓存（最多3个）
    const recentSkillsContext = skillEngine.getRecentSkillsContext();
    if (recentSkillsContext) {
      contextParts.push(await recentSkillsContext);
    }

    return contextParts.join('\n');
  }

  // 循环检索：LLM决定是否需要调用工具
  // 返回：skillResults（检索结果Map）和 finalResponse（分析完成后的回复内容）
  private async loopRetrieval(
    userInput: string
  ): Promise<{ skillResults: Map<string, string>; finalResponse: string }> {
    const skillResults = new Map<string, string>();
    const maxIterations = 6;
    const config = getLLMConfig();

    // 获取所有skill的元信息（仅名称和描述）
    const allSkills = skillEngine.getAllSkillMetas();
    const skillList = allSkills
      .map(s => `- ${s.name}: ${s.description}`)
      .join('\n');

    let iteration = 0;
    let continueLoop = true;
    let lastAnalysisContent = ''; // 最后一次LLM分析内容（当没有skill调用时）

    // 预检索：在首次LLM调用前直接执行search skill
    let preSearchResult = '';
    try {
      preSearchResult = await this.executeSkill('search', { query: userInput, limit: 10 });
      skillResults.set('search', preSearchResult);
      logDb.insert({
        id: uuidv4(),
        level: 'debug',
        category: 'agent',
        content: `[Pre-search] query="${userInput.substring(0, 50)}..." result length=${preSearchResult.length}`,
        createdAt: new Date()
      });
    } catch (error) {
      logDb.insert({
        id: uuidv4(),
        level: 'warn',
        category: 'agent',
        content: `[Pre-search] failed: ${error instanceof Error ? error.message : String(error)}`,
        createdAt: new Date()
      });
    }
    
    // 初始用户消息
    let currentUserMessage = `
${systemPrompt}

## 可用skill列表
${skillList || '（无）'}

## 角色信息{
${this.character.characterInfo || this.character.personality}
}

## 当前上下文
${await this.buildContext(skillResults.get('search') || '')}

## 用户消息
${userInput}
}
`;

    while (continueLoop && iteration < maxIterations) {
      if (iteration > 0) {
        currentUserMessage += `\n${systemPrompt}\n`; // 每轮都重复系统提示，增强LLM注意力
      }
      iteration++;

      try {
        // 只使用user角色进行对话
        const response = await callLLM({
          model: config.model,
          messages: [{ role: 'user', content: currentUserMessage }],
          temperature: 0.3,
          thinking: iteration > 2 // 仅在第2轮之后开启思考
        });

        const content = response.content;

        // 记录日志
        logDb.insert({
          id: uuidv4(),
          level: 'debug',
          category: 'agent',
          content: `[AnalysisAgent LLM Response #${iteration}]\n${content}`,
          createdAt: new Date()
        });

        // 解析SKILL_README指令（请求插入skill README）
        const readmeRequests = this.parseSkillReadmeRequests(content);
        for (const skillName of readmeRequests) {
          const skill = await skillEngine.loadSkill(skillName);
          if (skill) {
            // 在下一条消息中插入README
            currentUserMessage += `\n\n[AnalysisAgent] Inserted README for skill: ${skillName}`;
            currentUserMessage += `\n\n[SKILL_README: ${skillName}]\n${skill.content}\n[/SKILL_README]\n\n请继续根据以上README执行之前的操作。`;
            // 跳过SKILL_CALL解析，直接进入下一次循环
            break;
          }
        }

        // 只有在没有SKILL_README请求时才解析SKILL_CALL
        if (readmeRequests.length > 0) {
          continue; // 有README请求但加载失败，也继续循环
        }

        // 解析SKILL_CALL指令（实际调用skill）
        const skillCalls = this.parseSkillCalls(content);

        if (skillCalls.length === 0) {
          // 没有更多skill调用，保存分析内容并结束循环
          lastAnalysisContent = content;
          continueLoop = false;
          continue;
        }

        // 执行每个skill调用
        for (const call of skillCalls) {
          const { skillName, params } = call;
          currentUserMessage += `\n\n[AnalysisAgent] Calling skill: ${skillName} with params: ${JSON.stringify(params)}`;

          const result = await this.executeSkill(skillName, params);
          skillResults.set(skillName, result);
          // 将skill结果加入下一轮对话上下文（即使是空结果也要告知LLM）
          const resultForLog = result || '(无结果)';
          currentUserMessage += `\n\n[SKILL_RESULT: ${skillName}]\n${resultForLog}\n[/SKILL_RESULT]\n\n请基于以上检索结果继续分析或回复。`;
          // 写入数据库日志
          logDb.insert({
            id: uuidv4(),
            level: 'debug',
            category: 'agent',
            content: `[SKILL_RESULT: ${skillName}] length=${result?.length ?? 0}`,
            createdAt: new Date()
          });
        }
      } catch (error) {
        console.error('[AnalysisAgent] Loop retrieval error:', error);
        logDb.insert({
          id: uuidv4(),
          level: 'error',
          category: 'agent',
          content: `[Loop retrieval error] ${error instanceof Error ? error.message : String(error)}`,
          createdAt: new Date()
        });
        break;
      }
    }

    // 超过最大迭代次数，强制结束循环并且说明当前信息不一定可靠
    if (iteration >= maxIterations) {
      lastAnalysisContent = "信息检索可能不完整或不准确。请基于已有信息尽可能提供回复。";
      logDb.insert({
        id: uuidv4(),
        level: 'warn',
        category: 'agent',
        content: `Reached max iterations (${maxIterations}) in loop retrieval. Forcing completion.`,
        createdAt: new Date()
      });
    }

    return { skillResults, finalResponse: lastAnalysisContent };
  }

  // 解析LLM返回中的SKILL_CALL指令
  private parseSkillCalls(content: string): Array<{ skillName: string; params: Record<string, unknown> }> {
    const calls: Array<{ skillName: string; params: Record<string, unknown> }> = [];

    // 匹配 SKILL_CALL: skill_name
    const callRegex = /SKILL_CALL:\s*(\w+)/g;
    let callMatch;

    while ((callMatch = callRegex.exec(content)) !== null) {
      const skillName = callMatch[1];
      const jsonStart = callMatch.index + callMatch[0].length;

      // 查找第一个 { 开始JSON块
      const bracePos = content.indexOf('{', jsonStart);
      if (bracePos === -1) continue;

      // 从 { 位置开始尝试解析完整JSON（处理嵌套）
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

  // 解析LLM返回中的SKILL_README指令（请求插入skill README到上下文）
  private parseSkillReadmeRequests(content: string): string[] {
    const requests: string[] = [];
    // 匹配 SKILL_README: skill_name 格式
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

  // 执行单个Skill
  // 返回值：直接返回字符串，出错时返回错误描述字符串
  private async executeSkill(skillName: string, params: Record<string, unknown>): Promise<string> {
    try {
      const skill = await skillEngine.loadSkill(skillName);
      if (!skill) {
        return `[错误] Skill不存在: ${skillName}`;
      }

      // 添加时间戳
      const skillParams = {
        ...params,
        timestamp: new Date().toISOString()
      };

      // 通过skillEngine执行，预期返回字符串
      const result = await skillEngine.executeSkill(skillName, skillParams);

      // Skill必须返回字符串
      if (typeof result === 'string') {
        return result;
      }

      // 如果返回非字符串，尝试转换
      return result ? String(result) : '[空结果]';

    } catch (error) {
      logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'agent', content: `Skill execution failed for ${skillName}: ${error}`, createdAt: new Date() });
      return `[Skill执行出错] ${skillName}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // 异步更新状态
  private async updateStatesAsync(userInput: string, aiResponse: string): Promise<void> {
    // 异步执行，不阻塞主流程
    setImmediate(async () => {
      try {
        const config = getLLMConfig();
        const emotionState = stateManager.getEmotion();
        const affinityState = stateManager.getAffinity();
        const emotionDimensionNames = Object.keys(emotionState.dimensions);
        const affinityDimensionNames = Object.keys(affinityState.dimensions);

        // 动态构建情绪维度描述
        const emotionDimensionDesc = emotionDimensionNames
          .map(name => `"${name}": 数字（正数=向右增加，负数=向左减少）`)
          .join(',\n    ');

        // 动态构建好感度维度描述
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

          // 更新情绪
          if (parsed.emotion) {
            stateManager.updateEmotion(parsed.emotion);
          }

          // 更新好感度
          if (parsed.affinity) {
            stateManager.updateAffinity(parsed.affinity);
          }
        }
      } catch (error) {
        logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'agent', content: `State update error: ${error}`, createdAt: new Date() });
      }
    });
  }

  // 获取对话历史
  getConversationHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return [...this.conversationHistory];
  }

  // 设置角色配置
  setCharacter(config: Partial<CharacterConfig>): void {
    this.character = { ...this.character, ...config } as CharacterConfig;
  }
}

// 导出单例
export const analysisAgent = new AnalysisAgent();
export default AnalysisAgent;
