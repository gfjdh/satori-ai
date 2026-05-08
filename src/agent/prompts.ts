/**
 * Prompt 构建函数
 */

export interface PromptContext {
  userInput: string;
  retrievalResults: string;
  characterInfo: string;
  dialogueRequirements: string;
  emotionDescription: string;
  affinityDescription: string;
  dialogueStats: string;
  recentDialogues: string;
  availableEmotions: string[];
  skillList?: string;
  speechLanguage: string;
}

export function buildFirstTurnPrompt(ctx: PromptContext): string {
  return `## 角色
你是角色扮演对话引擎，负责生成角色的回复。

## 当前状态
角色信息：${ctx.characterInfo}
对话要求：${ctx.dialogueRequirements}
情绪：${ctx.emotionDescription}
好感度：${ctx.affinityDescription}
对话统计：${ctx.dialogueStats}

## 预检索结果
${ctx.retrievalResults}

## 最近对话
${ctx.recentDialogues}

## 用户消息
${ctx.userInput}

## 输出要求
将回复分成若干短句，每句约10个字符。这些句子将用于语音合成，所以需要恰当切分且长度适中，并且使用${ctx.speechLanguage}输出

**输出格式**：JSON Lines，每行一个 JSON 对象，字段如下：

{"emotion":"情感标签","action":"动作类型","voice":"文本（${ctx.speechLanguage}，约10字）","needDeepThink":true/false}

## 可用情感标签
${ctx.availableEmotions.join(', ')}

## 可用动作标签
可用动作：wave, nod, shake_head, happy, sad, angry, surprise, think, idle

## needDeepThink 判断
- needDeepThink=true（仅在第一个对象内输出）：问题需要复杂推理、需要调用技能、需要较长回复、或需要按时间检索记忆等情况
- needDeepThink=false（默认，不需要输出）：简单问候、直接回答、闲聊

现在开始输出，**立即输出第一行 JSON**，不要有任何前缀。`;
}

export function buildSubtitleTranslatePrompt(voiceText: string, subtitleLanguage: string): string {
  return `将以下语音文本翻译成 ${subtitleLanguage}。

${voiceText}

直接输出翻译结果，不要解释。`;
}

export function buildAnalysisPrompt(ctx: PromptContext): string {
  return `## 你的角色
你是对话智能体信息检索模块的中枢控制器，负责分析用户问题并决定是否调用技能收集信息。

## 执行顺序
1. 分析用户问题，判断是否需要调用技能获取信息
2. 如果需要技能且上下文没有对应 README：输出 SKILL_README: skill_name
3. 上下文已有 README 时：输出 SKILL_CALL: skill_name\n{json参数}（不添加解释）
4. 执行完技能后分析返回结果，判断是否需要更多技能
5. **直接基于已获取的信息回答，不要重复总结已获取内容**

## 上下文信息
角色信息：${ctx.characterInfo}
对话要求：${ctx.dialogueRequirements}
当前状态：${ctx.emotionDescription}\n${ctx.affinityDescription}\n${ctx.dialogueStats}
最近对话：${ctx.recentDialogues}

## 预检索结果
${ctx.retrievalResults}

## 用户消息
${ctx.userInput}

## 可用技能
${ctx.skillList || ''}

## 输出格式（需要技能时）
SKILL_README: skill_name
或
SKILL_CALL: skill_name
{"param": "value"}

## 输出格式（不需要技能时）
JSON Lines，每行一个 JSON 对象：
{"emotion":"情感标签","action":"动作类型","voice":"文本（${ctx.speechLanguage}，约10字）"}

## 情感标签
${ctx.availableEmotions.join(', ')}`;
}