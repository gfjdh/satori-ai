import fs from 'fs';
import path from 'path';
import { logDb } from '../db/database.js';
import { setCurrentCharacterId } from './knowledge.js';

export interface StageDefinition {
  min: number;
  max: number;
  name: string;
  prompt: string;
}

export interface CharacterConfig {
  id: string;
  name: string;
  personality: string;
  speechLanguage?: string;
  subtitleLanguage?: string;
  characterInfo?: string;
  dialogueRequirements?: string;
  emotionRegressionRate?: number;
  affinityStages?: Record<string, StageDefinition[]>;
  emotionStages?: Record<string, StageDefinition[]>;
}

const CHARACTER_CARDS_DIR = path.join(process.cwd(), 'character-cards');

export function getAvailableCharacters(): string[] {
  if (!fs.existsSync(CHARACTER_CARDS_DIR)) {
    return [];
  }
  return fs.readdirSync(CHARACTER_CARDS_DIR)
    .filter(name => {
      const cardPath = path.join(CHARACTER_CARDS_DIR, name, 'character.json');
      return fs.existsSync(cardPath);
    });
}

export function loadCharacter(characterId: string): CharacterConfig | null {
  const cardPath = path.join(CHARACTER_CARDS_DIR, characterId, 'character.json');

  if (!fs.existsSync(cardPath)) {
    logDb.insert({ id: crypto.randomUUID(), level: 'warn', category: 'agent', content: `Character card not found: ${characterId}`, createdAt: new Date() });
    return null;
  }

  try {
    const content = fs.readFileSync(cardPath, 'utf-8');
    const config = JSON.parse(content);

    if (!config.id || !config.name || !config.personality) {
      logDb.insert({ id: crypto.randomUUID(), level: 'warn', category: 'agent', content: `Invalid character card: ${characterId}, missing required fields`, createdAt: new Date() });
      return null;
    }

    setCurrentCharacterId(config.id);
    logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Loaded character: ${config.name}`, createdAt: new Date() });
    return config as CharacterConfig;
  } catch (error) {
    logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'agent', content: `Failed to load character ${characterId}: ${error}`, createdAt: new Date() });
    return null;
  }
}

export function loadDefaultCharacter(): CharacterConfig {
  const envCharacterId = process.env.CURRENT_CHARACTER_ID;
  if (envCharacterId) {
    const loaded = loadCharacter(envCharacterId);
    if (loaded) {
      return loaded;
    }
  }

  logDb.insert({ id: crypto.randomUUID(), level: 'warn', category: 'agent', content: 'No character card found, using built-in defaults', createdAt: new Date() });
  const defaultConfig = {
    id: 'default',
    name: '助手',
    personality: '助手'
  };
  setCurrentCharacterId(defaultConfig.id);
  return defaultConfig;
}
