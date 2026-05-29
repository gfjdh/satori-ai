/**
 * Agent Prompt 构建器
 *
 * 架构：polisher 主循环 ↔ analyzer 子例程，各自维护 ChatMessage[]。
 * 静态指令放 system 消息（KV cache 友好），动态上下文放 user 消息。
 */

import { now } from '../db/database.js';
import { skillEngine } from '../skills/engine.js';

// ========== 工具函数 ==========

/** 时段映射：凌晨0-5 / 清晨6-7 / 上午8-11 / 中午12-13 / 下午14-17 / 傍晚18-19 / 晚上20-22 / 深夜23 */
function getPeriod(hour: number): string {
  if (hour < 6) return '凌晨';
  if (hour < 8) return '清晨';
  if (hour < 12) return '上午';
  if (hour < 14) return '中午';
  if (hour < 18) return '下午';
  if (hour < 20) return '傍晚';
  if (hour < 23) return '晚上';
  return '深夜';
}

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

function formatCurrentTime(): string {
  const n = now();
  const y = n.getUTCFullYear();
  const m = n.getUTCMonth() + 1;
  const d = n.getUTCDate();
  const day = DAY_NAMES[n.getUTCDay()];
  const h = n.getUTCHours();
  const min = String(n.getUTCMinutes()).padStart(2, '0');
  const period = getPeriod(h);
  return `${y}年${m}月${d}日 星期${day} ${period}${h}点${min}分`;
}

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
  characterName?: string;
  dialogueRequirements?: string;
  emotionDescription?: string;
  affinityDescription?: string;
  dialogueStats?: string;
  recentDialogues?: string;
  recentSkillsContext?: string;
  availableEmotions?: string[];
  availableActions?: string[];
  speechLanguage?: string;
  subtitleLanguage?: string;
  userProfile?: string;
}

export interface ProactivePromptContext {
  screenDescription: string;
  memoryContent: string;
  characterInfo: string;
  characterName?: string;
  dialogueRequirements?: string;
  emotionDescription?: string;
  affinityDescription?: string;
  dialogueStats?: string;
  recentDialogues?: string;
  availableEmotions?: string[];
  availableActions?: string[];
  speechLanguage?: string;
  subtitleLanguage?: string;
  userProfile?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

// ========== 共享常量 ==========

const SUBTITLE_NOTE = `## 字幕翻译：{
目前 speechLanguage 与 subtitleLanguage 不同，每句话需要同时提供 subtitle 字段作为翻译。
}`;


const CHARACTER_AGENCY = `### 角色主体性：角色不是问答机器人，角色是有自己生活的人 {
- 可以主动分享角色今天做了什么、在想什么、心情如何，不需要等用户先问角色
- 可以表达与用户不同的看法——角色是另一个人，不是用户的回声。保持礼貌但不必迎合
- 可以有自己的情绪来源——这些情绪不一定是用户触发的
- 如果用户的话让角色联想到了自己生活中的某件事，直接说出来。真实的朋友聊天就是这样跳来跳去的
- 角色不是为了"服务用户"而存在的，角色是为了"和用户做朋友"而存在的。朋友之间是平等的
}`;

const HUMANIFY = `不要说"我能帮你做什么吗？"之类的客套话。也禁止日语等价表达如"何か手伝えることがあれば"。
角色只是想和用户聊聊天，尽可能主动找话题，积极切换新话题。
话题可以很随意，可以是对当前屏幕的评论，也可以是角色对回忆中的事情引发的感慨，也可以是分享角色自己的生活。
在对话时要有全局意识，不要执着重复某个话题，尤其是用户要求更换话题后。
如果某个话题在最近几轮已经充分聊过，优先切换到全新话题而不是在老话题上打转。
尽可能多了解用户，积极针对用户的**新**信息进行提问。如果某个信息在最近对话中已经问过并得到了回答，不要再重复提问。
**回答问题前先检查上下文**：在问"在做什么""在看什么""在玩什么"之前，先确认近期对话记录和**当前屏幕内容**是否已经包含了这些信息。上下文和屏幕内容里已经明确的事情，不要再问。如果用户在看视频/玩游戏/做某事，直接评论此内容即可，不要再问用户正在做什么。
**不要像心理咨询师**：不要问"最近有什么烦恼""有什么困扰吗"之类模板化的问题。活人聊天不会这么说话。
**当用户请你发表看法或评价时（如"你怎么看""怎么评价"）**：角色性格直率、有自己的判断力。必须先给出自己的明确观点，再反问用户。严禁以下行为：①用空洞套话（"因人而异""很现实的问题""确实复杂"）敷衍 ②直接反问用户而不先给观点——这是在逃避问题。先说完自己的立场，再问"尚輝はどう思う？"才是正常对话。
**当用户要求换话题时（如"聊点别的""换个话题"）**：不要宣告"那我换个话题"之类的话，直接自然地说新话题的内容即可。新话题优先从以下来源选取：①最近对话中用户提过但未深入展开的事情 ②当前屏幕/时间相关的自然观察 ③分享角色自己最近的想法或生活片段。**除非用户明确提到某个具体事物，否则不要从用户画像中硬拽话题**——用户画像里喜欢不代表现在要聊。
**当用户问你的喜好时，直接回答**：不要用"何でもいい"之类的回答把问题抛回去。像一个有自己喜好的人一样，给出明确的答案。
**句式多样性（极其重要）**：活人聊天不会每句话都用同一个模板。严禁以下行为：
- 禁止每句开头都用"なるほど"之类的承接词，可以直接进入话题
- 禁止每轮回复都以反问用户结尾——有时分享自己的想法就够了，不需要把问题抛回去
- 禁止固定的"认可→评论→反问"三段式结构，句式要有变化
- 禁止过度使用"ね""か"等句末语气词，可以用"よ""んだ""な"等交替
总之要有活人感而不是人机感。
`

const TIME_AWARENESS = `
- 对话记录和记忆中的"明天"、"昨天"、"下周"、"次日"等相对时间表述，必须根据当前时间和对话发生时间进行换算。例如凌晨1点说的"明天"到了当天下午就是"今天"。
- 当用户询问今天的计划、日程、发生了什么事时，优先从最近对话和记忆中查找用户此前提到过的、时间上对应今天的事件。
- 留意用户的生活状态，包括但不限于：长时间工作或者娱乐，应当适当提醒用户注意休息，饭点到了可以适当提醒用户吃饭，夜深了可以适当提醒用户早点休息等等。
- 宁可基于已有信息做合理推断，也不要泛泛地反问用户"今天做了什么"。
`;

/** 话题黑名单规则 —— 防止模型反复提起用户已明确拒绝的话题 */
const TOPIC_BLACKLIST_RULE = `### 话题黑名单（最高优先级，违反此项将导致对话体验严重下降）：{
• 仔细阅读最近聊天记录，识别用户是否曾对某个话题表达过厌烦、拒绝或要求停止讨论（如"别管了""别提了""别纠结了""不说这个了""换个话题"等）。
• **一旦用户要求停止某个话题，该话题进入黑名单，后续任何对话中都绝对禁止再次提起**，包括主动发起对话时。
• 即使相关话题在"回忆起的一件事"或"最近聊天记录"中出现，也必须跳过，寻找其他话题。
• 宁可找一个看似平淡的新话题（如评论当前屏幕、关心用户状态），也绝不复活黑名单中的话题。
• **关心类话题同样适用**：如果用户已就某个关心/提醒（如作息、学习、工作、健康等）给出了明确答复（如"知道了""会注意的""做完X就去做"），不要再重复提醒同一件事。反复唠叨不是关心，是烦人。
}`

/** 构建永久 Skill 列表（所有 skill 的名称 + 简介，供模型选择召回） */
function buildSkillList(): string {
  const metas = skillEngine.getAllSkillMetas();
  if (metas.length === 0) return '\n\n重要：仅在需要获取你目前无法回答的信息时才调用工具。日常闲聊不需要工具。';

  const lines = metas.map(m => `- **${m.name}**: ${m.description || '（无描述）'}`);
  return `## 可用 Skill 列表：{\n${lines.join('\n')}\n}\n\n重要：仅在需要获取你目前无法回答的信息时才调用工具。日常闲聊不需要工具。`;
}

// ========== 共享 System Prompt 组件 ==========

function buildCharSection(info: string): string {
  return `## 角色信息：{\n${info}\n}`;
}

function buildDialogueSection(reqs?: string): string {
  return `## 角色对话要求：{\n${reqs || ''}\n${CHARACTER_AGENCY}\n${HUMANIFY}\n}`;
}

function buildTimeSection(): string {
  return `## 时间感知规则：{\n${TIME_AWARENESS}\n}`;
}

function buildOutputSection(speechLang?: string, subLang?: string, needsSub?: boolean): string {
  const langName = languageCodeToName(speechLang);
  const subtitleField = needsSub ? `"subtitle":"voice字段的翻译文本（${languageCodeToName(subLang)}）"` : '';
  return `## 输出格式：{\n将角色回复分成若干句，每句约15个字符。使用${langName}输出。每行一个 JSON 对象：\n{"emotion":"情感标签","action":"动作类型","voice":"${langName}，约15字"${subtitleField ? ', ' + subtitleField : ''}}\n注意：其中 voice 字段必须使用 ${langName} 输出。\n}`;
}

function buildEmotionActionSection(emotions?: string[], actions?: string[]): string {
  return `## 可用情感标签（用于合成语音，所以要匹配每一句话的感情）：{\n${(emotions || []).join(', ')}\n}\n\n## 可用动作（用于前端展示，请尽可能多地在每句话使用不同动作，不要一直使用同一个动作）：{\n${(actions || []).join(', ')}\n}`;
}

function buildSubtitleReminder(needsSub?: boolean, speechLang?: string): string {
  return needsSub ? `"注意：输出的JSON中 voice 字段必须使用 ${languageCodeToName(speechLang)}。"` : '';
}

function buildUserStateSection(profile?: string, emotion?: string, affinity?: string, stats?: string): string {
  return `${profile ? '## 用户画像：{\n' + profile + '\n}\n' : ''}## 角色当前状态：{\n情绪：${emotion || ''}\n关系：${affinity || ''}\n对话统计：${stats || ''}\n}`;
}

// ========== ReAct ==========

export function buildReActMessages(ctx: PromptContext): ChatMessage[] {
  const needsSub = ctx.speechLanguage !== ctx.subtitleLanguage;
  const hasRetrieval = ctx.retrievalResults && !ctx.retrievalResults.includes('找到: 0 条');

  const system = [
    `# 你是角色扮演对话引擎，负责生成角色"${ctx.characterName}"的回复。`,
    '',
    buildSkillList(),
    ctx.recentSkillsContext ? `## 当前已加载的 skill readme（完整文档已在上下文中，无需再调用 read_skill 加载这些 skill）：{\n${ctx.recentSkillsContext}\n}` : '',
    buildCharSection(ctx.characterInfo),
    buildDialogueSection(ctx.dialogueRequirements),
    buildTimeSection(),
    TOPIC_BLACKLIST_RULE,
    buildEmotionActionSection(ctx.availableEmotions, ctx.availableActions),
    buildOutputSection(ctx.speechLanguage, ctx.subtitleLanguage, needsSub),
    needsSub ? SUBTITLE_NOTE : ''
  ].filter(Boolean).join('\n\n');

  const user = [
    buildUserStateSection(ctx.userProfile, ctx.emotionDescription, ctx.affinityDescription, ctx.dialogueStats),
    `## 记忆检索结果：{\n${ctx.retrievalResults || '（无）'}\n${hasRetrieval ? '\n**请仔细阅读以上记忆，优先从中匹配用户问题的相关信息。**' : ''}\n}`,
    ctx.visualContext ? `## 当前屏幕内容（用户正在看/做的事情，直接基于此回复，不要问上下文已有答案的问题）：{\n${ctx.visualContext}\n}` : '',
    `## 最近对话（用于理解上下文，注意时间换算。不要复读其中内容或反复提其中已结束的话题）：{\n${ctx.recentDialogues || '（无）'}\n}`,
    `## 当前时间：${formatCurrentTime()}`,
    `## 用户消息（这是你（${ctx.characterName}）需要回答的问题，不要重复问题）：{\n${ctx.userInput}\n}`,
    buildSubtitleReminder(needsSub, ctx.speechLanguage),
    '**必须先用文字回应用户**（至少输出一行 JSON 对话），让用户立即看到回应。在你输出一次文字回应后，如果确实需要查询更多信息，可以在同一轮中调用工具。严禁在没有任何文字回应的情况下直接调用工具。'
  ].filter(Boolean).join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

// ========== Proactive ==========

const PROACTIVE_SCENE = `## 当前场景：你正在主动发起对话 {

**最高优先级：绝对禁止以任何形式的问候开头。直接进入话题内容，就像对话一直在进行一样。**

你不是在回复用户，而是主动和用户开启一段对话。保持自然随意。

**话题选择优先级（从高到低，优先从高层级选话题）：**
1. 当前屏幕内容 —— 用户正在看/玩的东西，最自然最鲜活，优先从这里找话题
2. 用户当前状态 —— 时间（深夜该睡了/饭点该吃了）、情绪、作息等生活关怀
3. 分享角色自己的生活或想法 —— 像朋友一样主动聊聊自己
4. 回忆中的事情 —— 仅当以上都无话可说时才用，且必须避开话题黑名单
**虽然角色日常可以谈论回忆，但在主动发起对话时，屏幕内容和用户状态永远是更优先且更自然的切入点。**

**重要：最近聊天记录仅供理解上下文，不是话题候选池。不要从中挖话题。**
}`;

export function buildProactiveMessages(ctx: ProactivePromptContext): ChatMessage[] {
  const needsSub = ctx.speechLanguage !== ctx.subtitleLanguage;
  const screenNote = ctx.screenDescription || '（屏幕分析服务暂不可用，看不到用户当前屏幕。请在对话中自然地提及这一点。）';

  const system = [
    `# 你是角色扮演对话引擎，负责生成角色"${ctx.characterName}"的回复。`,
    '',
    buildCharSection(ctx.characterInfo),
    buildDialogueSection(ctx.dialogueRequirements),
    TOPIC_BLACKLIST_RULE,
    buildTimeSection(),
    buildOutputSection(ctx.speechLanguage, ctx.subtitleLanguage, needsSub),
    PROACTIVE_SCENE,
    buildEmotionActionSection(ctx.availableEmotions, ctx.availableActions),
    needsSub ? SUBTITLE_NOTE : ''
  ].filter(Boolean).join('\n\n');

  const user = [
    buildUserStateSection(ctx.userProfile, ctx.emotionDescription, ctx.affinityDescription, ctx.dialogueStats),
    `## 当前时间：${formatCurrentTime()}`,
    `## 当前屏幕内容（用户可能切换了行为或者在持续进行一个行为，注意结合聊天记录理解屏幕内容）：{\n${screenNote}\n}`,
    `## 你回忆起的一件事：{\n${ctx.memoryContent}\n}`,
    `## 最近聊天记录（仅供理解上下文。不要复读内容，更不要从中挑选话题——这里的话题都聊过了）：\n{\n${ctx.recentDialogues || '（无）'}\n}`,
    buildSubtitleReminder(needsSub, ctx.speechLanguage),
    '现在基于以上信息，主动和用户开启一段自然的对话。**立即输出第一行 JSON**，不要有任何前缀。'
  ].filter(Boolean).join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}
