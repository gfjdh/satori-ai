import { stateDb } from '../db/database.js';
import { AffinityState, EmotionState } from '../types/index.js';
import type { StageDefinition } from '../character/loader.js';

const CURRENT_CHARACTER_ID = process.env.CURRENT_CHARACTER_ID!;
const DEFAULT_EMOTION_REGRESSION_RATE = 0.05;

class StateManager {
  private characterId: string;
  private affinity: AffinityState | null = null;
  private emotion: EmotionState | null = null;
  private customRegressionRate: number | null = null;
  private customAffinityStages: Record<string, StageDefinition[]> | null = null;
  private customEmotionStages: Record<string, StageDefinition[]> | null = null;

  constructor(characterId: string = CURRENT_CHARACTER_ID) {
    this.characterId = characterId;
    this.load();
  }

  configureDimensions(config: {
    emotionRegressionRate?: number;
    affinityStages?: Record<string, StageDefinition[]>;
    emotionStages?: Record<string, StageDefinition[]>;
  }): void {
    if (config.emotionRegressionRate !== undefined) {
      this.customRegressionRate = config.emotionRegressionRate;
    }
    if (config.affinityStages) {
      this.customAffinityStages = config.affinityStages;
    }
    if (config.emotionStages) {
      this.customEmotionStages = config.emotionStages;
    }

    // load() 在此之前已执行，若那时 stages 尚未设置则 dimensions 为空
    // 此处用 stages 重新初始化 affinity
    if (this.affinity && Object.keys(this.affinity.dimensions).length === 0 && this.customAffinityStages) {
      this.affinity.dimensions = this.getAffinityDimensionDefaults();
      this.saveAffinity();
    }
    if (this.emotion && Object.keys(this.emotion.dimensions).length === 0 && this.customEmotionStages) {
      this.emotion.dimensions = this.getEmotionDimensionDefaults();
      this.emotion.regressionRate = this.getEmotionRegressionRate();
      this.saveEmotion();
    }
  }

  private getAffinityDimensionDefaults(): Record<string, number> {
    const stages = this.customAffinityStages;
    if (!stages) return {};
    return Object.fromEntries(Object.keys(stages).map(k => [k, 0]));
  }

  private getEmotionDimensionDefaults(): Record<string, number> {
    const stages = this.customEmotionStages;
    if (!stages) return {};
    return Object.fromEntries(Object.keys(stages).map(k => [k, 0]));
  }

  getEmotionRegressionRate(): number {
    return this.customRegressionRate ?? DEFAULT_EMOTION_REGRESSION_RATE;
  }

  getAffinityStages(): Record<string, StageDefinition[]> {
    return this.customAffinityStages!;
  }

  getEmotionStages(): Record<string, StageDefinition[]> {
    return this.customEmotionStages!;
  }

  matchStage(value: number, stages: StageDefinition[]): StageDefinition | null {
    for (const stage of stages) {
      if (value >= stage.min && value < stage.max) {
        return stage;
      }
    }
    return null;
  }

  getAffinityStagePrompts(): string {
    const stages = this.getAffinityStages();
    const affinity = this.affinity!;
    const prompts: string[] = [];

    for (const [dimension, value] of Object.entries(affinity.dimensions)) {
      const dimensionStages = stages[dimension];
      if (dimensionStages) {
        const matchedStage = this.matchStage(value, dimensionStages);
        if (matchedStage) {
          prompts.push(`【好感维度：${dimension}】当前阶段：${matchedStage.name}\n${matchedStage.prompt}`);
        }
      }
    }

    return prompts.length > 0 ? `\n## 好感度状态\n${prompts.join('\n\n')}` : '';
  }

  getEmotionStagePrompts(): string {
    const stages = this.getEmotionStages();
    const emotion = this.emotion!;
    const prompts: string[] = [];

    for (const [dimension, value] of Object.entries(emotion.dimensions)) {
      const dimensionStages = stages[dimension];
      if (dimensionStages) {
        const matchedStage = this.matchStage(value, dimensionStages);
        if (matchedStage) {
          prompts.push(`【情绪维度：${dimension}】当前阶段：${matchedStage.name}\n${matchedStage.prompt}`);
        }
      }
    }

    return prompts.length > 0 ? `\n## 情绪状态\n${prompts.join('\n\n')}` : '';
  }

  private load(): void {
    this.affinity = stateDb.getAffinity(this.characterId);
    this.emotion = stateDb.getEmotion(this.characterId);

    if (!this.affinity) {
      this.affinity = {
        characterId: this.characterId,
        dimensions: { ...this.getAffinityDimensionDefaults() }
      };
      this.saveAffinity();
    }

    if (!this.emotion || !this.emotion.dimensions) {
      this.emotion = {
        characterId: this.characterId,
        dimensions: { ...this.getEmotionDimensionDefaults() },
        regressionRate: this.getEmotionRegressionRate()
      };
      this.saveEmotion();
    }
  }

  private saveAffinity(): void {
    if (this.affinity) {
      stateDb.setAffinity(this.characterId, this.affinity);
    }
  }

  private saveEmotion(): void {
    if (this.emotion) {
      stateDb.setEmotion(this.characterId, this.emotion);
    }
  }

  getState(): { affinity: AffinityState; emotion: EmotionState } {
    return {
      affinity: this.affinity!,
      emotion: this.emotion!
    };
  }

  getAffinity(): AffinityState {
    return this.affinity!;
  }

  getEmotion(): EmotionState {
    return this.emotion!;
  }

  getEmotionDimensionNames(): string[] {
    return Object.keys(this.emotion!.dimensions);
  }

  updateAffinity(changes: Record<string, number>): void {
    for (const [dimension, delta] of Object.entries(changes)) {
      if (this.affinity!.dimensions[dimension] !== undefined) {
        const newValue = this.affinity!.dimensions[dimension] + delta;
        this.affinity!.dimensions[dimension] = Math.max(-1000000, Math.min(1000000000, newValue));
      }
    }
    this.saveAffinity();
  }

  setAffinityDimension(dimension: string, value: number): void {
    this.affinity!.dimensions[dimension] = Math.max(-1000000, Math.min(1000000000, value));
    this.saveAffinity();
  }

  addAffinityDimension(name: string, initialValue: number = 50): void {
    if (!this.affinity!.dimensions[name]) {
      this.affinity!.dimensions[name] = Math.max(-1000000, Math.min(1000000000, initialValue));
      this.saveAffinity();
    }
  }

  updateEmotion(changes: Record<string, number>): void {
    for (const [dimension, delta] of Object.entries(changes)) {
      if (this.emotion!.dimensions[dimension] !== undefined) {
        const newValue = this.emotion!.dimensions[dimension] + delta;
        this.emotion!.dimensions[dimension] = Math.max(-100, Math.min(100, newValue));
      }
    }
    this.saveEmotion();
  }

  setEmotionDimension(dimension: string, value: number): void {
    if (this.emotion!.dimensions[dimension] !== undefined) {
      this.emotion!.dimensions[dimension] = Math.max(-100, Math.min(100, value));
      this.saveEmotion();
    }
  }

  addEmotionDimension(name: string, regressionRate?: number): void {
    if (!this.emotion!.dimensions[name]) {
      this.emotion!.dimensions[name] = 0;
      if (regressionRate !== undefined) {
        this.emotion!.regressionRate = regressionRate;
      }
      this.saveEmotion();
    }
  }

  tick(): void {
    const rate = this.emotion!.regressionRate;

    for (const dimension of Object.keys(this.emotion!.dimensions)) {
      this.emotion!.dimensions[dimension] *= (1 - rate);
      if (Math.abs(this.emotion!.dimensions[dimension]) < 0.5) {
        this.emotion!.dimensions[dimension] = 0;
      }
    }

    this.saveEmotion();
  }

  getEmotionDescription(): string {
    return this.getEmotionStagePrompts();
  }

  getAffinityDescription(): string {
    return this.getAffinityStagePrompts();
  }

  setEmotionDimensions(dimensions: Record<string, number>, regressionRate?: number): void {
    this.emotion!.dimensions = { ...dimensions };
    if (regressionRate !== undefined) {
      this.emotion!.regressionRate = regressionRate;
    }
    this.saveEmotion();
  }
}

export const stateManager = new StateManager();
export default StateManager;
