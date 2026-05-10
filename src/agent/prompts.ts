/**
 * Prompt 构建函数
 */

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
  /** 最近使用的 Skill README 缓存（用于上下文注入） */
  recentSkillsContext?: string;
  speechLanguage?: string;
  subtitleLanguage?: string;
  /** 初次回复内容（用于续接） */
  firstTurnReply?: string;
  /** 深度分析结果（用于 polisher） */
  analysisResult?: string;
}

export function buildFirstTurnPrompt(ctx: PromptContext): string {
  const needsSubtitle = ctx.speechLanguage !== ctx.subtitleLanguage;
  const subtitleField = needsSubtitle
    ? `,"subtitle":"翻译文本（${ctx.subtitleLanguage}）"`
    : '';

  return `#你是角色扮演对话引擎，负责生成角色的回复。

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
将回复分成若干句，每句约15个字符，短句应当和前后句合并。这些句子将用于语音合成，所以需要恰当切分且长度适中，并且使用${ctx.speechLanguage}输出

**输出格式**：JSON Lines，每行一个 JSON 对象，字段如下：

{"emotion":"情感标签","action":"动作类型","voice":"文本（${ctx.speechLanguage}，约15字）${subtitleField},"needDeepThink":true/false}

## 可用情感标签
${(ctx.availableEmotions || []).join(', ')}

## 可用动作标签
可用动作：wave, nod, shake_head, happy, sad, angry, surprise, think, idle

## 其中 needDeepThink 是可选项，具体判断依据：
- needDeepThink=true（仅在第一个对象内输出，后续不需要输出）：问题需要复杂推理、需要调用技能、需要较长回复、或需要按时间检索记忆等情况
- needDeepThink=false（默认，为false时不需要输出）：简单问候、直接回答、闲聊
- 如果needDeepThink=true，则本次对话的回复应当先讲一些可有可无的废话，同时必须在回答中表明你需要思考一下怎么回答。你的回复应当只是一个开头，后续会有其他程序生成最终回复。

${needsSubtitle ? `## 字幕翻译
目前 speechLanguage 与 subtitleLanguage 不同，每句话需要同时提供 subtitle 字段作为翻译。` : ''}

现在开始输出，**立即输出第一行 JSON**，不要有任何前缀。`;
}

export function buildAnalysisPrompt(ctx: PromptContext): string {
  return `# 你是角色扮演智能体的信息检索+任务执行模块的中枢控制器，负责分析用户问题并决定是否调用技能。

## 执行顺序
1. 分析用户问题，判断是否需要调用技能获取信息
2. 如果需要技能且上下文没有对应 README：输出 SKILL_README: skill_name
3. 上下文已有 README 时：输出 SKILL_CALL: skill_name\n{json参数}（不添加解释）
4. 执行完技能后分析返回结果，判断是否需要更多技能
5. **直接基于已获取的信息回答，不要重复总结已获取内容**

## 上下文信息
角色信息：${ctx.characterInfo}

${ctx.recentSkillsContext ? `${ctx.recentSkillsContext}\n` : ''}

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
直接输出回答文本即可，不需要 JSON 格式，不要输出情感和动作标签。

现在开始输出，**调用skill时直接输出json**，不要有任何前缀。`;
}

export function buildPolisherPrompt(ctx: PromptContext): string {
  const needsSubtitle = ctx.speechLanguage !== ctx.subtitleLanguage;
  const subtitleField = needsSubtitle
    ? `,"subtitle":"翻译文本（${ctx.subtitleLanguage}）"`
    : '';

  return `# 你是角色扮演对话引擎，负责生成角色的回复。目前已经有了前半段回复内容和深度分析结果，你需要根据深度分析结果续写已有回复。

## 当前状态
角色信息：${ctx.characterInfo}
对话要求：${ctx.dialogueRequirements || ''}
情绪：${ctx.emotionDescription || ''}
好感度：${ctx.affinityDescription || ''}
对话统计：${ctx.dialogueStats || ''}

## 最近对话
${ctx.recentDialogues || ''}

## 用户消息
${ctx.userInput}

## 目前已有回复（需要续写的内容）
${ctx.firstTurnReply || ''}

## 深度分析结果（需要整合到回复中的内容）
${ctx.analysisResult || ''}

## 输出要求
将回复分成若干句，每句约15个字符，短句应当和前后句合并。这些句子将用于语音合成，所以需要恰当切分且长度适中，并且使用${ctx.speechLanguage}输出。
**回复需要续写"目前已有回复"，不要重复目前已有回复的内容。**

**输出格式**：JSON Lines，每行一个 JSON 对象，字段如下：

{"emotion":"情感标签","action":"动作类型","voice":"文本（${ctx.speechLanguage}，约15字）${subtitleField}}

## 可用情感标签
${(ctx.availableEmotions || []).join(', ')}

## 可用动作标签
可用动作：wave, nod, shake_head, happy, sad, angry, surprise, think, idle

${needsSubtitle ? `## 字幕翻译
目前 speechLanguage 与 subtitleLanguage 不同，每句话需要同时提供 subtitle 字段作为翻译。` : ''}

现在开始输出，**立即输出第一行 JSON**，不要有任何前缀。`;
}