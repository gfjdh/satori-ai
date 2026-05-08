// ========== 类型定义 ==========

// 好高度状态
export interface AffinityState {
  characterId: string;
  dimensions: Record<string, number>; // 维度名 -> 数值
}

// 情绪状态（多维自定义）
export interface EmotionState {
  characterId: string;
  dimensions: Record<string, number>; // 维度名 -> 数值 (-100 ~ 100)
  regressionRate: number; // 情绪回归速度 (0~1)
}

// 系统状态
export interface SystemState {
  characterId: string;
  affinity: AffinityState;
  emotion: EmotionState;
  updatedAt: Date;
}

// 对话记录
export interface Dialogue {
  id: string;
  turnIndex: number;
  userContent: string;
  aiContent: string;
  createdAt: Date;
}

// 记忆记录
export interface Memory {
  id: string;
  granularity: 'year' | 'season' | 'month' | 'week' | 'day' | 'topic';
  content: string;
  relevance?: number; // 相关性得分
  embedding?: Buffer | null;
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
}

// 定时任务
export interface Task {
  id: string;
  name: string;
  cron: string;
  actionType: 'reminder' | 'notification';
  params: Record<string, unknown>;
  enabled: boolean;
  lastRun: Date | null;
  nextRun: Date;
  createdAt: Date;
}

// 资料库条目
export interface KnowledgeEntry {
  id: string;
  category: string;
  content: string;
  relevance?: number; // 相关性得分
  embedding?: Buffer | null;
  source: 'character_card' | 'user';
  createdAt: Date;
}

// 日志条目
export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  category: string;
  content: string;
  createdAt: Date;
}

// Skill元信息
export interface SkillMeta {
  name: string;
  description: string;
  version?: string;
  author?: string;
}

// Skill加载后的完整信息
export interface Skill extends SkillMeta {
  rootPath: string;
  content: string; // SKILL.md 内容
  scriptsPath: string;
  referencesPath: string;
  assetsPath: string;
}

// SSE事件类型
export type SSEEventType =
  | 'voice' | 'audio' | 'subtitle' | 'subtitle_append'
  | 'deep_think_pending' | 'done' | 'error' | 'proactive';

// SSEMessage data 类型
export interface VoiceEventData {
  text: string;
  emotion: string;
  action: string;
  language: string;
}

export interface AudioEventData {
  audio: string;  // base64
}

export interface SubtitleEventData {
  text: string;
  sentenceIndex: number;
}

export interface DeepThinkPendingData {
  value: boolean;
}

export interface ErrorEventData {
  message: string;
}

export interface ProactiveEventData {
  text: string;
  source: string;
  memoryId?: string;
}

export interface SSEMessage {
  type: SSEEventType;
  data: VoiceEventData | AudioEventData | SubtitleEventData | DeepThinkPendingData | ErrorEventData | ProactiveEventData | Record<string, unknown>;
}

// SSE事件载荷
export interface VoiceSentenceEvent {
  text: string;
  sentenceIndex: number;
  language: string;
}

export interface SubtitleCharEvent {
  char: string;
  isFirst: boolean;
}

export interface ActionEvent {
  type: string;
  params: Record<string, unknown>;
}

export interface DoneEvent {
  text: string;
}

// 分析Agent决策
export interface AgentDecision {
  type: 'continue' | 'skill' | 'respond';
  skill?: string;
  reasoning?: string;
}

// LLM请求
export interface LLMRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  stream?: boolean;
  thinking?: boolean; // 开启思考模式（用于o1等模型）
}

// LLM响应
export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
