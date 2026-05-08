/**
 * Agent 模块内部类型
 */

export interface Segment {
  emotion: string;
  action: string;
  voice: string;
  subtitle?: string;
  needDeepThink?: boolean;
}

export interface AnalysisResult {
  segments: Segment[];
}