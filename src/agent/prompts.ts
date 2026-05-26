/**
 * Agent Prompt 构建器
 *
 * 架构：polisher 主循环 ↔ analyzer 子例程，各自维护 ChatMessage[]。
 * 静态指令放 system 消息（KV cache 友好），动态上下文放 user 消息。
 */

// ========== 工具函数 ==========

const LANGUAGE_EX_INFO_JA = `完全に日本語で出力する必要があり、英語の単語は必ずカタカナで綴りの読み方を表記する必要があります`;
const LANGUAGE_CODE_MAP: Record<string, string> = {
  'ja-JP': '日本語，' + LANGUAGE_EX_INFO_JA,  
  'ja': '日本語，' + LANGUAGE_EX_INFO_JA,  
  'zh-CN': '中文(简体)',  
  'zh-TW': '中文(繁體)',
  'zh': '中文(简体)',  
  'en-US': 'English',  'en': 'English',  'ko-KR': '한국어',
  'ko': '한국어',  'fr-FR': 'Français',  'fr': 'Français',  'de-DE': 'Deutsch',
  'de': 'Deutsch',  'es-ES': 'Español',  'es': 'Español',  'ru-RU': 'Русский',  'ru': 'Русский',};

function languageCodeToName(code?: string): string {
  if (!code) return '';
  if (LANGUAGE_CODE_MAP[code]) return LANGUAGE_CODE_MAP[code];
  const prefix = code.split('-')[0].toLowerCase();
  if (LANGUAGE_CODE_MAP[prefix]) return LANGUAGE_CODE_MAP[prefix];
  return code;
}

// ========== 类型 ==========

export interface PromptContext {
  userInput: string;
  retrievalResults?: string;
  visualContext?: string;
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

const SUBTITLE_NOTE = `## 字幕翻译：{
目前 speechLanguage 与 subtitleLanguage 不同，每句话需要同时提供 subtitle 字段作为翻译。
}`;

const AVAILABLE_ACTIONS = `## 可用动作：{
wave, nod, shake_head, happy, sad, angry, surprise, think, idle
}`;

// ========== Polisher ==========

/**
 * 构建 polisher 初始消息列表 [system, user]。
 * unified-agent 在此基础上一轮轮追加 assistant/user 消息。
 */
export function buildPolisherMessages(ctx: PromptContext): ChatMessage[] {
  const needsSubtitle = ctx.speechLanguage !== ctx.subtitleLanguage;
  const subtitleField = needsSubtitle ? `"subtitle":"voice字段的翻译文本（${languageCodeToName(ctx.subtitleLanguage)}）"` : '';
  const hasRetrieval = ctx.retrievalResults && !ctx.retrievalResults.includes('找到: 0 条');

  const system = `# 你是角色扮演对话引擎，负责生成角色的回复。

## 角色信息：{
${ctx.characterInfo}
}

## 角色对话要求：{
${ctx.dialogueRequirements || ''}
}

## 输出格式：{
将回复分成若干句，每句约15个字符。使用${languageCodeToName(ctx.speechLanguage)}输出。每行一个 JSON 对象：
{"emotion":"情感标签","action":"动作类型","voice":"${languageCodeToName(ctx.speechLanguage)}，约15字",${subtitleField},"needDeepThink":true/缺省}
注意：其中 voice 字段必须使用 ${languageCodeToName(ctx.speechLanguage)} 输出。
}

## needDeepThink 规则：{
- 若用户提到未知概念或者涉及未召回的记忆，或者需要执行复杂任务时，**仅在首个 JSON 对象**中添加一个字段 needDeepThink=true
- needDeepThink=true 时：先把目前有的信息说清楚，并且体现你正在处理问题的状态，本轮对话只需要说到一半，后续会补充步骤。
- 若当前仅简单对话/互动，则不需要深度分析，直接回答即可。（needDeepThink字段缺省即可，不需要添加 needDeepThink=false）
- needDeepThink 只在第一个 JSON 对象中输出，后续对象中禁止包含此字段
}

## 可用情感标签：{
${(ctx.availableEmotions || []).join(', ')}
}

${AVAILABLE_ACTIONS}

${needsSubtitle ? SUBTITLE_NOTE : ''}
`;

  const user = `## 当前状态：{
情绪：${ctx.emotionDescription || ''}
关系：${ctx.affinityDescription || ''}
对话统计：${ctx.dialogueStats || ''}
}

## 预检索结果（仅在用户提到未知概念或涉及未召回记忆时且信息不足时启用深度分析）：{
${ctx.retrievalResults || '（无）'}
${hasRetrieval ? '\n**以上是预检索信息，请先基于这些信息回答，如果信息已经足够使用则不需要深度分析。**' : ''}
}

${ctx.visualContext ? "## 当前屏幕内容（仅在识别的信息完全无法回答用户问题时启用深度分析）：{\n" + ctx.visualContext + "\n}" : ''}

## 最近对话：{
${ctx.recentDialogues || '（无）'}
}

## 用户消息：{
${ctx.userInput}
}

现在开始按照规则输出，**立即输出第一行 JSON**，不要有任何前缀。`;

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
    content: `## 分析结果（原始检索数据，请自行提炼关键信息并转化为角色语言）：{
${rawFindings || '（无）'}
}

请基于以上信息接续之前的输出继续回复（保持语义连贯成一段话）。如果信息已充足，不要再设置 needDeepThink。输出JSON的格式与最初要求保持统一。`
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

## 身份：{
你不是角色，不生成对话。你的唯一职责是把 Polisher 的信息需求参数化为工具调用并执行。
}

## 核心规则：{
1. 分析 Polisher 的信息需求，判断需要调用什么技能
2. 如果预检索已覆盖需求，直接输出 DONE
3. 禁止生成回答、分析或总结文本
4. 在使用技能前，若当前技能说明未加载，必须先输出 SKILL_README: skill_name 来加载技能说明
}

## 输出格式（只能输出以下之一）：{
- 需要加载技能说明：SKILL_README: skill_name
- 需要执行技能：SKILL_CALL: skill_name
{"param":"value"}
- 所有需求已满足：DONE

**除了以上三种输出，禁止输出任何其他内容。**
}`;

  const user = `## 角色信息：{
${ctx.characterInfo}
}

## 最近对话上下文：{
${ctx.recentDialogues || '（无）'}
}

## 用户消息：{
${ctx.userInput}
}

## Polisher 需要了解：{
${infoNeed}
}

## 预检索结果：{
${ctx.retrievalResults || '（无）'}
}

## 可用技能：{
${ctx.skillList || ''}
${ctx.recentSkillsContext ? `\n## 当前已加载的skill readme：{\n${ctx.recentSkillsContext}\n}` : ''}
}

请基于对话上下文判断是否需要调用技能。如果需要，输出 SKILL_README 或 SKILL_CALL。如果不需要，输出 DONE。`;

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
    content: `## Polisher 还需要了解：{
${infoNeed}
}

## 上一次分析结果：{
${previousFindings}
}

请判断是否还需要调用技能。如果不需要，输出 DONE。`
  };
}
