import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { unifiedAgent } from './agent/unified-agent.js';
import { embeddingManager } from './embedding/manager.js';
import { stateManager } from './state/manager.js';
import { memoryManager } from './memory/manager.js';
import { skillEngine } from './skills/engine.js';
import { taskDb, logDb, stateDb, dialogueDb, now } from './db/database.js';
import { loadDefaultCharacter, type CharacterConfig } from './character/loader.js';
import { createCharacterRouter } from './character/api.js';
import { getCurrentCharacterId } from './character/knowledge.js';
import { proactiveAgent } from './agent/proactive-agent.js';
import { imageAnalysis } from './skills/image-analysis/index.js';
import { switchTTSModel } from './tts/client.js';
import { SSEMessage } from './types/index.js';
import cron from 'node-cron';

const app = express();
const PORT = process.env.PORT || 3682;

// 中间件
app.use(express.json());

// 静态文件 - 桌宠widget页面
app.use('/live2d', express.static(path.join(process.cwd(), 'live2d-widget')));

// 静态文件 - 角色卡目录（供Live2D模型加载）
const characterCardsPath = path.join(process.cwd(), 'character-cards');
console.log('[Static] character-cards path:', characterCardsPath);
app.use('/character-cards', express.static(characterCardsPath, {
  dotfiles: 'allow',
  maxAge: '1h'
}));

// CORS（开发用）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// 角色切换处理
function applyCharacterRuntime(character: CharacterConfig): void {
  unifiedAgent.setCharacter(character);
  proactiveAgent.setCharacter(character);
  stateManager.configureDimensions({
    emotionRegressionRate: character.emotionRegressionRate,
    affinityStages: character.affinityStages,
    emotionStages: character.emotionStages
  });
  // 通知终端：TTS服务更新角色
  switchTTSModel(character.id).catch(err => {
    logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'tts', content: `Failed to switch TTS model for character ${character.name} (ID: ${character.id}): ${err}`, createdAt: now() });
  });
  
  // 广播重载事件给Live2D组件
  broadcastProactiveMessage({
    type: 'reload',
    data: { characterId: character.id }
  });
  
  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Character loaded: ${character.name} (ID: ${character.id})`, createdAt: now() });
  resetProactiveTimer();
}

// 角色信息更新处理
function applyCharacterUpdate(character: CharacterConfig): void {
  unifiedAgent.setCharacter(character);
  proactiveAgent.setCharacter(character);
  stateManager.configureDimensions({
    emotionRegressionRate: character.emotionRegressionRate,
    affinityStages: character.affinityStages,
    emotionStages: character.emotionStages
  });
  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Character config updated locally without reload: ${character.name} (ID: ${character.id})`, createdAt: now() });
}

// ========== 角色管理路由 ==========

app.use('/api/characters', createCharacterRouter(applyCharacterRuntime, applyCharacterUpdate));

// ========== API路由 ==========

// 健康检查
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: now().toISOString() });
});

// 获取当前状态
app.get('/api/state', (req: Request, res: Response) => {
  try {
    const state = stateManager.getState();
    res.json(state);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 获取对话历史
app.get('/api/dialogues', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const dialogues = dialogueDb.getRecent(limit, getCurrentCharacterId());
    res.json(dialogues);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 获取Skills列表
app.get('/api/skills', (req: Request, res: Response) => {
  try {
    const skills = skillEngine.getAllSkillMetas();
    res.json(skills);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 获取日志
app.get('/api/logs', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const category = req.query.category as string | undefined;
    const logs = logDb.getRecent(limit, category);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 立即将日志输出到文件
app.post('/api/logs/flush', async (_req: Request, res: Response) => {
  try {
    await logDb.flushToFile(true);
    res.json({ success: true, message: 'Logs flushed to file' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 清除日志
app.delete('/api/logs', (req: Request, res: Response) => {
  try {
    // 直接清空日志表
    const { default: db } = require('./db/database.js');
    db.exec('DELETE FROM logs');
    res.json({ success: true, message: 'Logs cleared' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 清除对话
app.delete('/api/dialogues', (_req: Request, res: Response) => {
  try {
    const { default: db } = require('./db/database.js');
    db.exec('DELETE FROM dialogues');
    res.json({ success: true, message: 'Dialogues cleared' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ========== 数据库管理 API ==========

// 获取所有表名
app.get('/api/db/tables', (_req: Request, res: Response) => {
  try {
    const { default: db } = require('./db/database.js');
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as { name: string }[];
    res.json(tables.map(t => t.name));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 获取表结构和数据
app.get('/api/db/table/:name', (req: Request, res: Response) => {
  try {
    const { default: db } = require('./db/database.js');
    const tableName = req.params.name;

    // 验证表名（防止SQL注入）
    const validTables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all() as { name: string }[];
    if (!validTables.find(t => t.name === tableName)) {
      res.status(400).json({ error: 'Invalid table name' });
      return;
    }

    // 获取列信息
    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as {
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];

    // 分页参数
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(10, parseInt(req.query.pageSize as string) || 20));
    const offset = (page - 1) * pageSize;
    const sortColumn = (req.query.sort as string) || null;
    const sortOrder = req.query.order === 'desc' ? 'DESC' : 'ASC';
    const filter = (req.query.filter as string) || '';

    // 获取总数
    let countSql = `SELECT COUNT(*) as count FROM "${tableName}"`;
    let dataSql = `SELECT * FROM "${tableName}"`;
    const params: any[] = [];

    // 添加筛选
    if (filter && columns.length > 0) {
      const conditions = columns.map(col => {
        if (col.type === 'TEXT' || col.type === '') {
          return `"${col.name}" LIKE ?`;
        }
        return `"${col.name}" LIKE ?`;
      });
      const filterPattern = `%${filter}%`;
      const filterConditions = conditions.map(() => filterPattern);
      countSql += ` WHERE ${filterConditions.join(' OR ')}`;
      dataSql += ` WHERE ${conditions.join(' OR ')}`;
      params.push(...columns.map(() => filterPattern));
    }

    // 添加排序
    if (sortColumn && columns.find(c => c.name === sortColumn)) {
      dataSql += ` ORDER BY "${sortColumn}" ${sortOrder}`;
    } else {
      // 默认按主键或第一条排序
      const pkCol = columns.find(c => c.pk);
      if (pkCol) {
        dataSql += ` ORDER BY "${pkCol.name}" ${sortOrder}`;
      }
    }

    // 添加分页
    dataSql += ` LIMIT ? OFFSET ?`;
    params.push(pageSize, offset);

    const countResult = db.prepare(countSql).get(...(filter ? columns.map(() => `%${filter}%`) : [])) as { count: number };
    const rows = db.prepare(dataSql).all(...params);

    res.json({
      columns: columns.map(c => ({
        name: c.name,
        type: c.type,
        primaryKey: c.pk === 1,
        nullable: c.notnull === 0,
        defaultValue: c.dflt_value
      })),
      data: rows,
      pagination: {
        page,
        pageSize,
        total: countResult.count,
        totalPages: Math.ceil(countResult.count / pageSize)
      }
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 更新表记录
app.put('/api/db/table/:name/:id', (req: Request, res: Response) => {
  try {
    const { default: db } = require('./db/database.js');
    const tableName = req.params.name;
    const rowId = req.params.id;
    const updates = req.body as Record<string, unknown>;

    // 验证表名
    const validTables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all() as { name: string }[];
    if (!validTables.find(t => t.name === tableName)) {
      res.status(400).json({ error: 'Invalid table name' });
      return;
    }

    // 获取主键列
    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as { name: string; pk: number }[];
    const pkColumn = columns.find(c => c.pk)?.name;
    if (!pkColumn) {
      res.status(400).json({ error: 'No primary key found' });
      return;
    }

    // 构建更新语句
    const setClauses = Object.keys(updates).map(k => `"${k}" = ?`).join(', ');
    const values = [...Object.values(updates), rowId];

    const sql = `UPDATE "${tableName}" SET ${setClauses} WHERE "${pkColumn}" = ?`;
    db.prepare(sql).run(...values);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 删除表记录
app.delete('/api/db/table/:name/:id', (req: Request, res: Response) => {
  try {
    const { default: db } = require('./db/database.js');
    const tableName = req.params.name;
    const rowId = req.params.id;

    // 验证表名
    const validTables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all() as { name: string }[];
    if (!validTables.find(t => t.name === tableName)) {
      res.status(400).json({ error: 'Invalid table name' });
      return;
    }

    // 获取主键列
    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as { name: string; pk: number }[];
    const pkColumn = columns.find(c => c.pk)?.name;
    if (!pkColumn) {
      res.status(400).json({ error: 'No primary key found' });
      return;
    }

    db.prepare(`DELETE FROM "${tableName}" WHERE "${pkColumn}" = ?`).run(rowId);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 获取定时任务
app.get('/api/tasks', (req: Request, res: Response) => {
  try {
    const tasks = taskDb.getAll();
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ========== 对话接口 (SSE流式) ==========

let currentChatAbortController: AbortController | null = null;
let currentProactiveAbortController: AbortController | null = null;
let proactiveTimer = { nextTriggerAt: 0 };
let proactiveConfig = { enabled: true, minMs: 480_000, maxMs: 1_200_000 };
let launcherWindowVisible = true;

app.post('/api/chat', async (req: Request, res: Response) => {
  const { message } = req.body;

  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  // 中断进行中的主动交互
  if (currentProactiveAbortController) {
    currentProactiveAbortController.abort();
    currentProactiveAbortController = null;
  }

  // 中断当前正在进行的对话（视为正常结束，后处理由 unifiedAgent.finalizeTurn 完成）
  if (currentChatAbortController) {
    currentChatAbortController.abort();
  }
  currentChatAbortController = new AbortController();
  const signal = currentChatAbortController.signal;

  // 设置SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendSSE = (type: string, data: string | object) => {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${type}\ndata: ${payload}\n\n`);
  };

  try {
    await unifiedAgent.process(message, (msg) => {
      sendSSE(msg.type, msg.data as unknown as string);
    }, signal);

    // done 事件已由 unifiedAgent.finalizeTurn() 发送，这里只需关闭连接
    res.end();
    resetProactiveTimer();
  } catch (error) {
    logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'agent', content: `Chat API Error: ${error}`, createdAt: now() });
    sendSSE('error', { message: String(error) });
    res.end();
  } finally {
    // 清理（仅当仍是当前 controller 时）
    if (currentChatAbortController && currentChatAbortController.signal === signal) {
      currentChatAbortController = null;
    }
  }
});

// Python 桌宠端写入日志（含菜单操作诊断）
app.post('/api/log', (req: Request, res: Response) => {
  try {
    const { level, category, content } = req.body;
    logDb.insert({
      id: crypto.randomUUID(),
      level: level || 'info',
      category: category || 'launcher',
      content: content || '',
      createdAt: now()
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 获取主动交互配置
app.get('/api/proactive/config', (_req: Request, res: Response) => {
  try {
    const character = loadDefaultCharacter();
    const raw = stateDb.get(character.id, 'proactive_config');
    if (raw) {
      res.json(JSON.parse(raw));
    } else {
      res.json({ enabled: true, minIntervalMinutes: 8, maxIntervalMinutes: 20 });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 更新主动交互配置
app.put('/api/proactive/config', (req: Request, res: Response) => {
  try {
    const character = loadDefaultCharacter();
    const { enabled, minIntervalMinutes, maxIntervalMinutes } = req.body;

    if (minIntervalMinutes !== undefined && maxIntervalMinutes !== undefined && minIntervalMinutes > maxIntervalMinutes) {
      res.status(400).json({ error: '最小间隔不能大于最大间隔' });
      return;
    }

    const raw = stateDb.get(character.id, 'proactive_config');
    const existing = raw ? JSON.parse(raw) : { enabled: true, minIntervalMinutes: 8, maxIntervalMinutes: 20 };

    if (enabled !== undefined) existing.enabled = enabled;
    if (minIntervalMinutes !== undefined) existing.minIntervalMinutes = minIntervalMinutes;
    if (maxIntervalMinutes !== undefined) existing.maxIntervalMinutes = maxIntervalMinutes;

    stateDb.set(character.id, 'proactive_config', JSON.stringify(existing));

    // 同步到运行时
    proactiveConfig.enabled = existing.enabled;
    proactiveConfig.minMs = existing.minIntervalMinutes * 60_000;
    proactiveConfig.maxMs = existing.maxIntervalMinutes * 60_000;
    resetProactiveTimer();

    logDb.insert({
      id: crypto.randomUUID(),
      level: 'info',
      category: 'proactive',
      content: `Config updated: enabled=${existing.enabled}, min=${existing.minIntervalMinutes}min, max=${existing.maxIntervalMinutes}min`,
      createdAt: now()
    });

    res.json({ success: true, config: existing });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 手动触发主动交互（右键菜单"互动"）
app.post('/api/proactive/trigger', async (_req: Request, res: Response) => {
  logDb.insert({
    id: crypto.randomUUID(),
    level: 'info',
    category: 'proactive',
    content: `Manual trigger requested (clients=${proactiveSSEClients.length}, chatActive=${currentChatAbortController !== null})`,
    createdAt: now()
  });

  if (proactiveSSEClients.length === 0) {
    logDb.insert({
      id: crypto.randomUUID(),
      level: 'warn',
      category: 'proactive',
      content: 'Manual trigger rejected: no connected clients',
      createdAt: now()
    });
    res.status(400).json({ error: '没有已连接的桌宠客户端' });
    return;
  }

  if (currentProactiveAbortController) {
    logDb.insert({
      id: crypto.randomUUID(),
      level: 'info',
      category: 'proactive',
      content: 'Aborting previous proactive interaction',
      createdAt: now()
    });
    currentProactiveAbortController.abort();
    currentProactiveAbortController = null;
  }

  if (currentChatAbortController) {
    logDb.insert({
      id: crypto.randomUUID(),
      level: 'warn',
      category: 'proactive',
      content: 'Manual trigger rejected: chat in progress',
      createdAt: now()
    });
    res.status(409).json({ error: '当前正在进行对话，请稍后再试' });
    return;
  }

  currentProactiveAbortController = new AbortController();
  const signal = currentProactiveAbortController.signal;

  logDb.insert({
    id: crypto.randomUUID(),
    level: 'info',
    category: 'proactive',
    content: 'Manual trigger accepted, executing...',
    createdAt: now()
  });

  res.json({ success: true, message: '主动对话已触发' });

  try {
    await executeProactiveInteraction(signal);
  } catch (error) {
    if (signal.aborted) return;
    logDb.insert({
      id: crypto.randomUUID(),
      level: 'error',
      category: 'proactive',
      content: `Manual proactive trigger failed: ${error}`,
      createdAt: now()
    });
    broadcastProactiveMessage({ type: 'error', data: { message: String(error) } });
  } finally {
    if (currentProactiveAbortController?.signal === signal) {
      currentProactiveAbortController = null;
    }
    resetProactiveTimer();
  }
});

// Launcher窗口可见性状态同步（桌面端隐藏时暂停主动互动）
app.post('/api/launcher/state', (req: Request, res: Response) => {
  const { visible } = req.body;
  if (typeof visible !== 'boolean') {
    res.status(400).json({ error: 'missing "visible" boolean field' });
    return;
  }
  launcherWindowVisible = visible;
  logDb.insert({
    id: crypto.randomUUID(),
    level: 'info',
    category: 'launcher',
    content: `Window visibility: ${visible ? 'visible' : 'hidden'}`,
    createdAt: now()
  });
  res.json({ ok: true, visible: launcherWindowVisible });
});

// 获取当前角色的Live2D配置
app.get('/api/character/live2d-config', (req: Request, res: Response) => {
  try {
    const character = loadDefaultCharacter();
    const characterCardsDir = path.join(process.cwd(), 'character-cards');
    const live2dDir = path.join(characterCardsDir, character.id, 'live2d');

    // 检查live2d目录是否存在
    if (!fs.existsSync(live2dDir)) {
      res.status(404).json({ error: `角色卡 "${character.name}" 中未配置 Live2D 模型。请检查角色卡目录是否存在 live2d 文件夹。` });
      return;
    }

    // 查找model文件
    const modelFiles = fs.readdirSync(live2dDir).filter(f => f.endsWith('.model.json') || f.endsWith('.model3.json'));

    if (modelFiles.length === 0) {
      res.status(404).json({ error: `角色卡 "${character.name}" 的 live2d 目录中未找到模型文件 (.model.json 或 .model3.json)。` });
      return;
    }

    // 使用第一个找到的模型文件
    const modelFile = modelFiles[0];
    const modelPath = `character-cards/${character.id}/live2d/${modelFile}`;

    // 构建相对URL供前端使用
    const modelUrl = `/${modelPath}`;
    const live2dUrl = `/live2d`;

    // 读取模型偏移配置
    const live2dConfig = character.live2d || {};
    const modelOffsetX = live2dConfig.modelOffsetX || 0;
    const modelOffsetY = live2dConfig.modelOffsetY || 0;

    res.json({
      characterId: character.id,
      characterName: character.name,
      modelPath: modelPath,
      modelUrl: modelUrl,
      live2dUrl: live2dUrl,
      modelFile: modelFile,
      live2dDir: live2dDir,
      modelOffsetX: modelOffsetX,
      modelOffsetY: modelOffsetY,
      actions: live2dConfig.actions || {}
    });
  } catch (error) {
    res.status(500).json({ error: `获取Live2D配置失败: ${String(error)}` });
  }
});

// 主动交互 SSE 长连接（widget 页面加载时连接，接收主动推送）
app.get('/api/proactive/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendSSE = (msg: SSEMessage) => {
    const payload = typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data);
    res.write(`event: ${msg.type}\ndata: ${payload}\n\n`);
  };

  registerProactiveClient(sendSSE);
  logDb.insert({
    id: crypto.randomUUID(),
    level: 'info',
    category: 'proactive',
    content: `Proactive SSE client connected (total=${proactiveSSEClients.length})`,
    createdAt: now()
  });

  req.on('close', () => {
    unregisterProactiveClient(sendSSE);
    logDb.insert({
      id: crypto.randomUUID(),
      level: 'info',
      category: 'proactive',
      content: `Proactive SSE client disconnected (total=${proactiveSSEClients.length})`,
      createdAt: now()
    });
  });
});

// ========== 心跳任务 ==========

let heartbeatTask: cron.ScheduledTask | null = null;
let proactiveSSEClients: Array<(message: SSEMessage) => void> = [];

// 注册主动交互SSE客户端
function registerProactiveClient(callback: (message: SSEMessage) => void): void {
  proactiveSSEClients.push(callback);
}

// 取消注册
function unregisterProactiveClient(callback: (message: SSEMessage) => void): void {
  proactiveSSEClients = proactiveSSEClients.filter(c => c !== callback);
}

// 发送主动交互消息给所有客户端
function broadcastProactiveMessage(message: SSEMessage): void {
  for (const client of proactiveSSEClients) {
    try {
      client(message);
    } catch (error) {
      logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'heartbeat', content: `Failed to send to client: ${error}`, createdAt: now() });
    }
  }
}

function startHeartbeat() {
  // 每分钟执行一次
  heartbeatTask = cron.schedule('* * * * *', async () => {

    try {
      // 1. 情绪回归
      stateManager.tick();

      // 2. 检查定时任务
      const dueTasks = taskDb.getDueTasks();
      for (const task of dueTasks) {
        logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'heartbeat', content: `Executing task: ${task.name}`, createdAt: now() });
        taskDb.update(task.id, {
          lastRun: now(),
          nextRun: calculateNextRun(task.cron)
        });
      }

      // 3. 定时记忆总结（动细到粗逐级检查）
      await memoryManager.checkAndSummarizeAll();

      // 4. 日志清理
      await logDb.flushToFile();

      // 5. 主动交互检查（根据频率配置）
      await checkProactiveInteraction();

    } catch (error) {
      logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'heartbeat', content: `Heartbeat error: ${error}`, createdAt: now() });
    }
  });
}

// 加载主动交互配置（从 system_state 表）
function loadProactiveConfig(): void {
  try {
    const character = loadDefaultCharacter();
    const raw = stateDb.get(character.id, 'proactive_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      proactiveConfig.enabled = parsed.enabled ?? true;
      proactiveConfig.minMs = (parsed.minIntervalMinutes ?? 8) * 60_000;
      proactiveConfig.maxMs = (parsed.maxIntervalMinutes ?? 20) * 60_000;
    } else {
      const defaults = { enabled: true, minIntervalMinutes: 8, maxIntervalMinutes: 20 };
      stateDb.set(character.id, 'proactive_config', JSON.stringify(defaults));
      proactiveConfig.minMs = defaults.minIntervalMinutes * 60_000;
      proactiveConfig.maxMs = defaults.maxIntervalMinutes * 60_000;
    }
  } catch (error) {
    logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'heartbeat', content: `Failed to load proactive config: ${error}`, createdAt: now() });
  }
}

// 重置主动交互计时器
function resetProactiveTimer(): void {
  const delay = proactiveConfig.minMs +
    Math.random() * (proactiveConfig.maxMs - proactiveConfig.minMs);
  proactiveTimer.nextTriggerAt = Date.now() + delay;
}

// 主动交互检查（心跳触发，有门控条件）
async function checkProactiveInteraction(): Promise<void> {
  if (!proactiveConfig.enabled) return;
  if (!launcherWindowVisible) return;
  if (proactiveSSEClients.length === 0) return;
  if (Date.now() < proactiveTimer.nextTriggerAt) return;
  if (currentChatAbortController !== null) return;

  currentProactiveAbortController = new AbortController();
  const signal = currentProactiveAbortController.signal;

  try {
    await executeProactiveInteraction(signal);
  } finally {
    if (currentProactiveAbortController?.signal === signal) {
      currentProactiveAbortController = null;
    }
    resetProactiveTimer();
  }
}

// 执行主动交互核心逻辑（屏幕分析 → 记忆召回 → LLM生成 → SSE广播）
async function executeProactiveInteraction(signal: AbortSignal): Promise<void> {
  // 1. 屏幕分析
  let screenDescription = '';
  try {
    screenDescription = await imageAnalysis({ query: '图中有什么值得讨论的东西？' });
    // screenDescription = await imageAnalysis({ vllmMode: 'detailed' });
  } catch (e) {
    logDb.insert({
      id: crypto.randomUUID(),
      level: 'error',
      category: 'proactive',
      content: `Screen capture failed: ${e}`,
      createdAt: now()
    });
    broadcastProactiveMessage({
      type: 'error',
      data: { message: '屏幕分析服务连接失败，请检查 Python 图像服务是否运行（端口 8742）' }
    });
  }

  if (signal.aborted) return;

  // 2. 随机 day 记忆
  const memory = await memoryManager.recallRandomDayMemory();

  if (signal.aborted) return;

  // 3. 运行 ProactiveAgent
  const sendSSE = (msg: SSEMessage) => broadcastProactiveMessage(msg);
  if (memory) {
    await proactiveAgent.generate(screenDescription, sendSSE, signal, memory);
  } else {
    await proactiveAgent.generate(screenDescription, sendSSE, signal);
  }

  logDb.insert({
    id: crypto.randomUUID(),
    level: 'info',
    category: 'proactive',
    content: 'Proactive interaction completed',
    createdAt: now()
  });
}

function calculateNextRun(cronExpr: string): Date {
  // 简化实现：每分钟检查一次
  return new Date(now().getTime() + 60 * 1000);
}

// ========== 启动 ==========

app.listen(PORT, async () => {
  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Running on http://localhost:${PORT}`, createdAt: now() });

  // 加载角色卡
  const character = loadDefaultCharacter();
  applyCharacterRuntime(character);

  // 配置状态管理器使用角色卡的阶段定义
  // 初始化Skill引擎
  const skillMetas = skillEngine.getAllSkillMetas();
  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Loaded ${skillMetas.length} skills`, createdAt: now() });

  // 预加载 Embedding 模型（后台进行，不阻塞启动）
  embeddingManager.preload().then(() => {
    logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'embedding', content: 'Embedding model ready', createdAt: now() });
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
  if (heartbeatTask) {
    heartbeatTask.stop();
  }
  process.exit(0);
});
