import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { loadDefaultCharacter } from './character/loader.js';
import { createCharacterRouter } from './character/api.js';
import { toolRegistry } from './agent/tool-registry.js';
import { embeddingManager } from './embedding/manager.js';
import { memoryManager } from './memory/manager.js';
import { skillEngine } from './skills/engine.js';
import { logDb, now } from './db/database.js';
import { registerRoutes } from './server/routes.js';
import { handleChat } from './server/chat.js';
import { applyCharacterRuntime, applyCharacterUpdate } from './server/character.js';
import {
  handleProactiveConfigGet,
  handleProactiveConfigPut,
  handleProactiveTrigger,
  handleLauncherState,
  handleProactiveStream,
  loadProactiveConfig,
  resetProactiveTimer,
  startHeartbeat,
  stopHeartbeat,
} from './server/proactive.js';

const app = express();
const PORT = process.env.PORT || 3682;

// 中间件
app.use(express.json());

// 静态文件
app.use('/live2d', express.static(path.join(process.cwd(), 'live2d-widget')));
const characterCardsPath = path.join(process.cwd(), 'character-cards');
console.log('[Static] character-cards path:', characterCardsPath);
app.use('/character-cards', express.static(characterCardsPath, {
  dotfiles: 'allow',
  maxAge: '1h'
}));

// CORS（开发用）
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// ========== 路由注册 ==========

app.use('/api/characters', createCharacterRouter(applyCharacterRuntime, applyCharacterUpdate));

// 通用 API 路由
registerRoutes(app);

// 对话 (SSE)
app.post('/api/chat', handleChat);

// 主动交互
app.get('/api/proactive/config', handleProactiveConfigGet);
app.put('/api/proactive/config', handleProactiveConfigPut);
app.post('/api/proactive/trigger', handleProactiveTrigger);
app.post('/api/launcher/state', handleLauncherState);
app.get('/api/proactive/stream', handleProactiveStream);

// ========== 启动 ==========

app.listen(PORT, async () => {
  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Running on http://localhost:${PORT}`, createdAt: now() });

  // 加载角色卡
  const character = loadDefaultCharacter();
  applyCharacterRuntime(character);

  // 初始化Skill引擎 + 注册为Tool
  const skillMetas = skillEngine.getAllSkillMetas();
  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Loaded ${skillMetas.length} skills`, createdAt: now() });

  const { initTools } = await import('./agent/tools.js');
  await initTools();
  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Registered ${toolRegistry.list().length} tools`, createdAt: now() });

  // 预加载 Embedding 模型（后台进行，不阻塞启动）
  embeddingManager.preload().then(async () => {
    logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'embedding', content: 'Embedding model ready', createdAt: now() });
    await memoryManager.repairNullEmbeddings();
  }).catch(err => {
    logDb.insert({ id: crypto.randomUUID(), level: 'warn', category: 'embedding', content: `Embedding model preload failed: ${err}`, createdAt: now() });
  });

  // 恢复未归档的对话并汇总为topic
  await memoryManager.recoverAndSummarizeUnarchived();

  // 启动心跳
  loadProactiveConfig();
  resetProactiveTimer();
  startHeartbeat();

  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: 'Ready', createdAt: now() });
});

// 优雅关闭
process.on('SIGTERM', () => {
  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: 'Shutting down...', createdAt: now() });
  stopHeartbeat();
  process.exit(0);
});
