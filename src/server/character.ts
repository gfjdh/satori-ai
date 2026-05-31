import { unifiedAgent } from '../agent/unified-agent.js';
import { proactiveAgent } from '../agent/proactive-agent.js';
import { stateManager } from '../state/manager.js';
import { switchTTSModel } from '../tts/client.js';
import { logDb, now } from '../db/database.js';
import { type CharacterConfig } from '../character/loader.js';
import { broadcastProactiveMessage, resetProactiveTimer } from './proactive.js';

export function applyCharacterRuntime(character: CharacterConfig): void {
  unifiedAgent.setCharacter(character);
  proactiveAgent.setCharacter(character);
  stateManager.configureDimensions({
    emotionRegressionRate: character.emotionRegressionRate,
    affinityStages: character.affinityStages,
    emotionStages: character.emotionStages
  });
  switchTTSModel(character.id).catch(err => {
    logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'tts', content: `Failed to switch TTS model for character ${character.name} (ID: ${character.id}): ${err}`, createdAt: now() });
  });

  broadcastProactiveMessage({
    type: 'reload',
    data: { characterId: character.id }
  });

  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Character loaded: ${character.name} (ID: ${character.id})`, createdAt: now() });
  resetProactiveTimer();
}

export function applyCharacterUpdate(character: CharacterConfig): void {
  unifiedAgent.setCharacter(character);
  proactiveAgent.setCharacter(character);
  stateManager.configureDimensions({
    emotionRegressionRate: character.emotionRegressionRate,
    affinityStages: character.affinityStages,
    emotionStages: character.emotionStages
  });
  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Character config updated locally without reload: ${character.name} (ID: ${character.id})`, createdAt: now() });
}
