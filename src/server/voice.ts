/**
 * Voice 配置 API + 转录代理
 */
import { Request, Response } from 'express';
import { stateDb } from '../db/database.js';
import { transcribe as asrTranscribe } from '../asr/client.js';
import { getCurrentCharacterId } from '../character/knowledge.js';

const DEFAULT_CONFIG = {
  enabled: false,
  autoSend: true,
  silenceTimeout: 1.5,
};

interface VoiceConfig {
  enabled: boolean;
  autoSend: boolean;
  silenceTimeout: number;
}

function getConfig(characterId: string): VoiceConfig {
  try {
    const raw = stateDb.get(characterId, 'voice_config');
    if (raw) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch { /* fall through to default */ }
  return { ...DEFAULT_CONFIG };
}

export function handleVoiceConfigGet(req: Request, res: Response): void {
  try {
    const characterId = getCurrentCharacterId();
    res.json(getConfig(characterId));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
}

export function handleVoiceConfigPut(req: Request, res: Response): void {
  try {
    const characterId = getCurrentCharacterId();
    const body = req.body || {};

    const current = getConfig(characterId);
    const merged: VoiceConfig = {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
      autoSend: typeof body.autoSend === 'boolean' ? body.autoSend : current.autoSend,
      silenceTimeout: typeof body.silenceTimeout === 'number' ? body.silenceTimeout : current.silenceTimeout,
    };

    // Validate
    if (merged.silenceTimeout < 0.5 || merged.silenceTimeout > 5.0) {
      res.status(400).json({ error: 'silenceTimeout must be between 0.5 and 5.0 seconds' });
      return;
    }

    stateDb.set(characterId, 'voice_config', JSON.stringify(merged));
    res.json(merged);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
}

export async function handleVoiceTranscribe(req: Request, res: Response): Promise<void> {
  try {
    const audioBuffer = req.body;
    if (!audioBuffer || (Buffer.isBuffer(audioBuffer) && audioBuffer.length === 0)) {
      res.status(400).json({ success: false, error: 'Audio data is required' });
      return;
    }

    const result = await asrTranscribe(
      Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer)
    );
    res.json({ success: true, ...result });
  } catch (error) {
    const msg = String(error);
    res.status(503).json({ success: false, error: msg });
  }
}
