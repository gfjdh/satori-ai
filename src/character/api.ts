import express, { Request, Response, Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { clearKnowledgeCache, getCurrentCharacterId, setCurrentCharacterId } from './knowledge.js';
import { CharacterConfig, getAvailableCharacters } from './loader.js';

const execFileAsync = promisify(execFile);

const CHARACTER_CARDS_DIR = path.join(process.cwd(), 'character-cards');
const RAW_ZIP_LIMIT = '500mb';
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface CharacterSummary {
  id: string;
  name: string;
  personality: string;
  hasLive2D: boolean;
  modelFile: string | null;
  hasTTS: boolean;
  ttsConfigFile: string | null;
  updatedAt: string | null;
  isCurrent: boolean;
}

function ensureCharacterRoot(): void {
  fs.mkdirSync(CHARACTER_CARDS_DIR, { recursive: true });
}

function assertSafeCharacterId(id: string): void {
  if (!id || !ID_PATTERN.test(id)) {
    throw new Error('角色 ID 只能包含字母、数字、下划线和短横线');
  }
}

function characterDir(characterId: string): string {
  assertSafeCharacterId(characterId);
  return path.join(CHARACTER_CARDS_DIR, characterId);
}

function assertInsideRoot(targetPath: string): void {
  const root = path.resolve(CHARACTER_CARDS_DIR);
  const resolved = path.resolve(targetPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('非法路径');
  }
}

function readCharacterConfig(characterId: string): CharacterConfig {
  const cardPath = path.join(characterDir(characterId), 'character.json');
  if (!fs.existsSync(cardPath)) {
    throw new Error(`角色不存在: ${characterId}`);
  }

  const config = JSON.parse(fs.readFileSync(cardPath, 'utf-8')) as CharacterConfig;
  if (!config.id || !config.name || !config.personality) {
    throw new Error(`角色配置无效: ${characterId}`);
  }

  return config;
}

function writeCharacterConfig(characterId: string, config: CharacterConfig): CharacterConfig {
  assertSafeCharacterId(characterId);

  const normalized = { ...config, id: characterId };
  if (!normalized.name?.trim()) throw new Error('角色名称不能为空');
  if (!normalized.personality?.trim()) throw new Error('角色性格不能为空');

  ensureCharacterRoot();

  const dir = characterDir(characterId);
  assertInsideRoot(dir);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'character.json'),
    JSON.stringify(normalized, null, 2),
    'utf-8'
  );
  clearKnowledgeCache(characterId);
  return normalized;
}

function findLive2DModelFile(live2dDir: string): string | null {
  if (!fs.existsSync(live2dDir)) return null;
  const files = fs.readdirSync(live2dDir);
  return files.find(f => f.endsWith('.model3.json') || f.endsWith('.model.json')) || null;
}

function findTTSConfigFile(ttsDir: string): string | null {
  if (!fs.existsSync(ttsDir)) return null;
  const files = fs.readdirSync(ttsDir);
  return files.find(f => f.toLowerCase().endsWith('.json') && f !== 'emotions.json') || null;
}

function summarizeCharacter(characterId: string): CharacterSummary | null {
  try {
    const config = readCharacterConfig(characterId);
    const dir = characterDir(characterId);
    const cardPath = path.join(dir, 'character.json');
    const live2dDir = path.join(dir, 'live2d');
    const modelFile = findLive2DModelFile(live2dDir);
    const ttsDir = path.join(dir, 'TTS');
    const ttsConfigFile = findTTSConfigFile(ttsDir);
    const stat = fs.existsSync(cardPath) ? fs.statSync(cardPath) : null;

    return {
      id: config.id,
      name: config.name,
      personality: config.personality,
      hasLive2D: modelFile !== null,
      modelFile,
      hasTTS: ttsConfigFile !== null,
      ttsConfigFile,
      updatedAt: stat ? stat.mtime.toISOString() : null,
      isCurrent: config.id === getCurrentCharacterId()
    };
  } catch {
    return null;
  }
}

function getRequestZipBuffer(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new Error('请上传 zip 压缩包');
  }
  return req.body;
}

async function expandZip(zipPath: string, destination: string): Promise<void> {
  fs.mkdirSync(destination, { recursive: true });
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    '& { param($zipPath, $destination) Expand-Archive -LiteralPath $zipPath -DestinationPath $destination -Force }',
    zipPath,
    destination
  ], { windowsHide: true, maxBuffer: 1024 * 1024 * 8 });
}

async function compressToZip(sourceDir: string, zipPath: string): Promise<void> {
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    '& { param($sourceDir, $zipPath) Compress-Archive -LiteralPath $sourceDir -DestinationPath $zipPath -Force }',
    sourceDir,
    zipPath
  ], { windowsHide: true, maxBuffer: 1024 * 1024 * 8 });
}

function chooseArchiveRoot(extractedDir: string, requiredFile: string): string {
  const direct = path.join(extractedDir, requiredFile);
  if (fs.existsSync(direct)) return extractedDir;

  const children = fs.readdirSync(extractedDir)
    .map(name => path.join(extractedDir, name))
    .filter(child => fs.statSync(child).isDirectory());

  if (children.length === 1 && fs.existsSync(path.join(children[0], requiredFile))) {
    return children[0];
  }

  throw new Error(`压缩包中未找到 ${requiredFile}`);
}

function chooseLive2DRoot(extractedDir: string): string {
  if (findLive2DModelFile(extractedDir)) return extractedDir;

  const children = fs.readdirSync(extractedDir)
    .map(name => path.join(extractedDir, name))
    .filter(child => fs.statSync(child).isDirectory());

  if (children.length === 1 && findLive2DModelFile(children[0])) {
    return children[0];
  }

  throw new Error('压缩包中未找到 .model.json 或 .model3.json 模型文件');
}

function chooseTTSRoot(extractedDir: string): string {
  if (findTTSConfigFile(extractedDir)) return extractedDir;

  const children = fs.readdirSync(extractedDir)
    .map(name => path.join(extractedDir, name))
    .filter(child => fs.statSync(child).isDirectory());

  if (children.length === 1 && findTTSConfigFile(children[0])) {
    return children[0];
  }

  throw new Error('压缩包中未找到 TTS 配置 JSON 文件');
}

function copyDirectoryContents(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const item of fs.readdirSync(source)) {
    fs.cpSync(path.join(source, item), path.join(destination, item), { recursive: true });
  }
}

function safeReplaceDirectory(source: string, destination: string): void {
  assertInsideRoot(destination);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  copyDirectoryContents(source, destination);
}

function isEmptyDirectory(dir: string): boolean {
  if (!fs.existsSync(dir)) return true;
  return fs.readdirSync(dir).every(item => {
    const itemPath = path.join(dir, item);
    return fs.statSync(itemPath).isDirectory() && isEmptyDirectory(itemPath);
  });
}

export function listCharacters(): CharacterSummary[] {
  return getAvailableCharacters()
    .map(summarizeCharacter)
    .filter((item): item is CharacterSummary => item !== null);
}

export function getCharacterDetail(characterId: string): CharacterConfig {
  return readCharacterConfig(characterId);
}

export function updateCharacter(characterId: string, updates: Partial<CharacterConfig>): CharacterConfig {
  const existing = readCharacterConfig(characterId);
  if (updates.id && updates.id !== characterId) {
    throw new Error('不支持通过更新接口修改角色 ID');
  }
  return writeCharacterConfig(characterId, { ...existing, ...updates, id: characterId });
}

export function createCharacter(config: CharacterConfig): CharacterConfig {
  assertSafeCharacterId(config.id);
  const dir = characterDir(config.id);

  if (fs.existsSync(dir)) {
    const cardPath = path.join(dir, 'character.json');
    if (!fs.existsSync(cardPath) && isEmptyDirectory(dir)) {
      assertInsideRoot(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    } else {
      throw new Error(`角色已存在: ${config.id}`);
    }
  }

  try {
    const created = writeCharacterConfig(config.id, config);
    fs.mkdirSync(path.join(dir, 'knowledge'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'live2d'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'TTS'), { recursive: true });
    return created;
  } catch (error) {
    if (fs.existsSync(dir)) {
      assertInsideRoot(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    throw error;
  }
}

export function deleteCharacter(characterId: string): void {
  const config = readCharacterConfig(characterId);
  if (config.id === getCurrentCharacterId()) {
    throw new Error('不能删除当前正在使用的角色，请先切换到其他角色');
  }

  const dir = characterDir(characterId);
  assertInsideRoot(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  clearKnowledgeCache(characterId);
}

export async function replaceLive2DModel(characterId: string, archiveBuffer: Buffer): Promise<CharacterSummary> {
  readCharacterConfig(characterId);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-live2d-'));
  try {
    const zipPath = path.join(tempDir, 'live2d.zip');
    const extractedDir = path.join(tempDir, 'extract');
    fs.writeFileSync(zipPath, archiveBuffer);
    await expandZip(zipPath, extractedDir);

    const live2dRoot = chooseLive2DRoot(extractedDir);
    const destination = path.join(characterDir(characterId), 'live2d');
    safeReplaceDirectory(live2dRoot, destination);

    const summary = summarizeCharacter(characterId);
    if (!summary) throw new Error('Live2D 已替换，但角色摘要读取失败');
    return summary;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function replaceTTSModel(characterId: string, archiveBuffer: Buffer): Promise<CharacterSummary> {
  readCharacterConfig(characterId);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-tts-'));
  try {
    const zipPath = path.join(tempDir, 'tts.zip');
    const extractedDir = path.join(tempDir, 'extract');
    fs.writeFileSync(zipPath, archiveBuffer);
    await expandZip(zipPath, extractedDir);

    const ttsRoot = chooseTTSRoot(extractedDir);
    const destination = path.join(characterDir(characterId), 'TTS');
    safeReplaceDirectory(ttsRoot, destination);

    const summary = summarizeCharacter(characterId);
    if (!summary) throw new Error('TTS 模型已替换，但角色摘要读取失败');
    return summary;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function importCharacterArchive(archiveBuffer: Buffer, overwrite: boolean): Promise<CharacterSummary> {
  ensureCharacterRoot();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-character-'));

  try {
    const zipPath = path.join(tempDir, 'character.zip');
    const extractedDir = path.join(tempDir, 'extract');
    fs.writeFileSync(zipPath, archiveBuffer);
    await expandZip(zipPath, extractedDir);

    const archiveRoot = chooseArchiveRoot(extractedDir, 'character.json');
    const raw = fs.readFileSync(path.join(archiveRoot, 'character.json'), 'utf-8');
    const config = JSON.parse(raw) as CharacterConfig;
    assertSafeCharacterId(config.id);

    const destination = characterDir(config.id);
    if (fs.existsSync(destination) && !overwrite) {
      throw new Error(`角色已存在: ${config.id}`);
    }
    safeReplaceDirectory(archiveRoot, destination);
    clearKnowledgeCache(config.id);

    const summary = summarizeCharacter(config.id);
    if (!summary) throw new Error('角色导入后读取失败');
    return summary;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function exportCharacterArchive(characterId: string): Promise<{ zipPath: string; fileName: string; cleanup: () => void }> {
  readCharacterConfig(characterId);
  const sourceDir = characterDir(characterId);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-export-'));
  const zipPath = path.join(tempDir, `${characterId}.zip`);
  await compressToZip(sourceDir, zipPath);

  return {
    zipPath,
    fileName: `${characterId}.zip`,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true })
  };
}

export function createCharacterRouter(
  onCharacterActivated?: (config: CharacterConfig) => void,
  onCharacterUpdated?: (config: CharacterConfig) => void
): Router {
  const router = Router();
  const zipParser = express.raw({
    type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
    limit: RAW_ZIP_LIMIT
  });

  const handleError = (res: Response, error: unknown, status = 400) => {
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  };

  router.get('/', (_req, res) => {
    try {
      res.json(listCharacters());
    } catch (error) {
      handleError(res, error, 500);
    }
  });

  router.get('/:id', (req, res) => {
    try {
      if (req.params.id === 'current') {
        const currentId = getCurrentCharacterId();
        if (!currentId) throw new Error('当前没有激活的角色');
        res.json(getCharacterDetail(currentId));
      } else {
        res.json(getCharacterDetail(req.params.id));
      }
    } catch (error) {
      handleError(res, error, 404);
    }
  });

  router.post('/', (req, res) => {
    try {
      res.status(201).json(createCharacter(req.body as CharacterConfig));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.put('/:id', (req, res) => {
    try {
      const updatedConfig = updateCharacter(req.params.id, req.body as Partial<CharacterConfig>);
      if (req.params.id === getCurrentCharacterId()) {
        onCharacterUpdated?.(updatedConfig);
      }
      res.json(updatedConfig);
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      deleteCharacter(req.params.id);
      res.json({ success: true });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/:id/activate', (req, res) => {
    try {
      const config = readCharacterConfig(req.params.id);
      setCurrentCharacterId(config.id);
      onCharacterActivated?.(config);
      res.json({ success: true, character: config });
    } catch (error) {
      handleError(res, error, 404);
    }
  });

  router.post('/:id/live2d', zipParser, async (req, res) => {
    try {
      const summary = await replaceLive2DModel(req.params.id, getRequestZipBuffer(req));
      res.json(summary);
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/:id/tts', zipParser, async (req, res) => {
    try {
      const summary = await replaceTTSModel(req.params.id, getRequestZipBuffer(req));
      res.json(summary);
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/import/archive', zipParser, async (req, res) => {
    try {
      const overwrite = req.query.overwrite === 'true';
      const summary = await importCharacterArchive(getRequestZipBuffer(req), overwrite);
      res.status(201).json(summary);
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get('/:id/export', async (req, res) => {
    let archive: Awaited<ReturnType<typeof exportCharacterArchive>> | null = null;
    try {
      archive = await exportCharacterArchive(req.params.id);
      res.download(archive.zipPath, archive.fileName, err => {
        archive?.cleanup();
        if (err && !res.headersSent) {
          handleError(res, err, 500);
        }
      });
    } catch (error) {
      archive?.cleanup();
      handleError(res, error, 404);
    }
  });

  return router;
}
