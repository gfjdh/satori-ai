/**
 * Agent Prompt 构建器
 *
 * 架构：polisher 主循环 ↔ analyzer 子例程，各自维护 ChatMessage[]。
 * 静态指令放 system 消息（KV cache 友好），动态上下文放 user 消息。
 */

// ========== 类型 ==========

export interface PromptContext {
  userInput: string;
  retrievalResults?: string;
  characterInfo: string;
  dialogueRequirements?: string;
  emotionDescription?: string;
  affinityDescription?: string;
  dialogueStats?: string;
  recentDialogues?: string;
  availableEmotions?: string[];
  skillList?: string;
  recentSkillsContext?: string;
  speechLanguage?: string;
  subtitleLanguage?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ========== 共享常量 ==========

const SUBTITLE_NOTE = `## 字幕翻译
当 speechLanguage 与 subtitleLanguage 不同时，每句话需要同时提供 subtitle 字段作为翻译。`;

const AVAILABLE_ACTIONS = `可用动作：wave, nod, shake_head, happy, sad, angry, surprise, think, idle`;

// ========== Polisher ==========

/**
 * 构建 polisher 初始消息列表 [system, user]。
 * unified-agent 在此基础上一轮轮追加 assistant/user 消息。
 */
export function buildPolisherMessages(ctx: PromptContext): ChatMessage[] {
  const needsSubtitle = ctx.speechLanguage !== ctx.subtitleLanguage;
  const subtitleField = needsSubtitle ? `,"subtitle":"翻译文本（${ctx.subtitleLanguage}）"` : '';
  const hasRetrieval = ctx.retrievalResults && !ctx.retrievalResults.includes('找到: 0 条');

  const system = `# 你是角色扮演对话引擎，负责生成角色的回复。

## 角色信息
${ctx.characterInfo}

## 对话要求
${ctx.dialogueRequirements || ''}

## 输出格式
将回复分成若干句，每句约15个字符。使用${ctx.speechLanguage}输出。每行一个 JSON 对象：

{"emotion":"情感标签","action":"动作类型","voice":"文本（${ctx.speechLanguage}，约15字）${subtitleField}}

## needDeepThink 规则
- 当你的角色知识不足以回答用户问题时，**仅在首个 JSON 对象**中添加一个字段 needDeepThink=true
- needDeepThink=true 时：用 voice/subtitle **直接说出你需要查找/回忆什么信息**
- 接下来你的回复应该只是过渡性的，后续会补充完整
- 如果预检索已有充足信息或你已有足够知识，直接回答（不需要添加 needDeepThink=false ）
- needDeepThink 只在第一个 JSON 对象中输出，后续对象中禁止包含此字段

${AVAILABLE_ACTIONS}

${needsSubtitle ? SUBTITLE_NOTE : ''}

现在开始输出，**立即输出第一行 JSON**，不要有任何前缀。`;

  const user = `## 当前状态
情绪：${ctx.emotionDescription || ''}
好感度：${ctx.affinityDescription || ''}
对话统计：${ctx.dialogueStats || ''}

## 预检索结果
${ctx.retrievalResults || '（无）'}
${hasRetrieval ? '\n**以上是预检索信息，请先基于这些信息回答，如果信息已经足够使用则不需要深度分析。**' : ''}

## 最近对话
${ctx.recentDialogues || '（无）'}

## 用户消息
${ctx.userInput}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

/**
 * 构建追加到 polisher 消息列表的 user 消息（analyzer 返回结果后）。
 */
export function buildPolisherResultUser(rawFindings: string): ChatMessage {
  return {
    role: 'user',
    content: `## 分析结果（原始检索数据，请自行提炼关键信息并转化为角色语言）
${rawFindings}

请基于以上信息继续回复。如果信息已充足，不要再设置 needDeepThink。输出JSON的格式与最初要求保持统一。`
  };
}

// ========== Analyzer ==========

/**
 * 构建 analyzer 初始消息列表 [system, user]。
 * infoNeed 来自 polisher 的 subtitle（优先）或 voice 文本。
 */
export function buildAnalyzerMessages(
  infoNeed: string,
  ctx: PromptContext
): ChatMessage[] {
  const system = `# 你是无感情的信息检索工具执行器。

## 身份
你不是角色，不生成对话。你的唯一职责是把 Polisher 的信息需求参数化为工具调用并执行。

## 核心规则
1. 分析 Polisher 的信息需求，判断需要调用什么技能
2. 如果预检索已覆盖需求，直接输出 DONE
3. 最多执行 3 次技能调用，每次调用后判断是否已满足需求
4. 禁止生成回答、分析或总结文本

## 输出格式（只能输出以下之一）
- 需要加载技能说明：SKILL_README: skill_name
- 需要执行技能：SKILL_CALL: skill_name\\n{"param":"value"}
- 所有需求已满足：DONE

**除了以上三种输出，禁止输出任何其他内容。**`;

  const user = `## Polisher 需要了解
${infoNeed}

## 角色信息
${ctx.characterInfo}

## 预检索结果
${ctx.retrievalResults || '（无）'}

## 可用技能
${ctx.skillList || ''}
${ctx.recentSkillsContext ? `\n## 最近使用的技能参考\n${ctx.recentSkillsContext}` : ''}

请判断是否需要调用技能。如果需要，输出 SKILL_README 或 SKILL_CALL。如果不需要，输出 DONE。`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

/**
 * 构建追加到 analyzer 消息列表的 user 消息（新一轮 polisher 信息需求）。
 */
export function buildAnalyzerContinuationUser(
  infoNeed: string,
  previousFindings: string
): ChatMessage {
  return {
    role: 'user',
    content: `## Polisher 还需要了解
${infoNeed}

## 上一次分析结果
${previousFindings}

请判断是否还需要调用技能。如果不需要，输出 DONE。`
  };
}
