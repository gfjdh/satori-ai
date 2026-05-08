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
import { taskDb, logDb } from './db/database.js';
import { dialogueDb } from './db/database.js';
import { loadDefaultCharacter } from './character/loader.js';
import { SSEMessage } from './types/index.js';
import cron from 'node-cron';

const app = express();
const PORT = process.env.PORT || 3000;

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

// ========== API路由 ==========

// 健康检查
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
    const dialogues = dialogueDb.getRecent(limit);
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

app.post('/api/chat', async (req: Request, res: Response) => {
  const { message } = req.body;

  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  // 设置SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendSSE = (type: string, data: string | object) => {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${type}\ndata: ${payload}\n\n`);
  };

  try {
    // 处理对话
    const response = await unifiedAgent.process(message, (msg) => {
      sendSSE(msg.type, msg.data as string);
    });

    // 发送完成信号
    sendSSE('done', { response });

    res.end();
  } catch (error) {
    logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'agent', content: `Chat API Error: ${error}`, createdAt: new Date() });
    sendSSE('error', { message: String(error) });
    res.end();
  }
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
    const live2dConfig = (character as any).live2d || {};
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
      modelOffsetY: modelOffsetY
    });
  } catch (error) {
    res.status(500).json({ error: `获取Live2D配置失败: ${String(error)}` });
  }
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
      logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'heartbeat', content: `Failed to send to client: ${error}`, createdAt: new Date() });
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
        logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'heartbeat', content: `Executing task: ${task.name}`, createdAt: new Date() });
        taskDb.update(task.id, {
          lastRun: new Date(),
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
      logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'heartbeat', content: `Heartbeat error: ${error}`, createdAt: new Date() });
    }
  });
}

// 主动交互检查
async function checkProactiveInteraction(): Promise<void> {
  if (proactiveSSEClients.length === 0) {
    return; // 没有客户端连接，跳过
  }

  // TODO: 从配置中读取主动交互频率
  // 目前简化处理：每10分钟可能触发一次主动交互
  const now = new Date();
  const minuteOfHour = now.getMinutes();

  // 只在特定分钟检查（控制频率）
  if (minuteOfHour % 10 !== 0) {
    return;
  }

  // 随机决定是否主动交互（50%概率）
  if (Math.random() > 0.5) {
    return;
  }

  try {
    // 随机召回一段记忆
    const recalledMemories = await memoryManager.recallRandomMemory();
    if (recalledMemories.length > 0) {
      const memory = recalledMemories[0];

      // 生成主动交互内容
      const proactivePrompt = `基于以下记忆，以角色身份主动发起对话：
记忆：${memory.content}

要求：
- 简短自然，像是在回忆过去
- 不超过两句话
- 符合角色性格`;

      const config = await import('./api/llm.js').then(m => m.getLLMConfig());
      const { callLLM } = await import('./api/llm.js');

      const response = await callLLM({
        model: config.model,
        messages: [{ role: 'user', content: proactivePrompt }],
        temperature: 0.8
      });

      // 发送主动交互消息
      broadcastProactiveMessage({
        type: 'proactive',
        data: {
          text: response.content,
          source: 'memory_recall',
          memoryId: memory.id
        }
      });

      logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'heartbeat', content: 'Proactive interaction triggered', createdAt: new Date() });
    }
  } catch (error) {
    logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'heartbeat', content: `Proactive interaction failed: ${error}`, createdAt: new Date() });
  }
}

function calculateNextRun(cronExpr: string): Date {
  // 简化实现：每分钟检查一次
  return new Date(Date.now() + 60 * 1000);
}

// ========== 启动 ==========

app.listen(PORT, async () => {
  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Running on http://localhost:${PORT}`, createdAt: new Date() });

  // 加载角色卡
  const character = loadDefaultCharacter();
  unifiedAgent.setCharacter(character);

  // 配置状态管理器使用角色卡的阶段定义
  stateManager.configureDimensions({
    emotionRegressionRate: character.emotionRegressionRate,
    affinityStages: character.affinityStages,
    emotionStages: character.emotionStages
  });

  // 初始化Skill引擎
  const skillMetas = skillEngine.getAllSkillMetas();
  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Loaded ${skillMetas.length} skills`, createdAt: new Date() });

  // 预加载 Embedding 模型（后台进行，不阻塞启动）
  embeddingManager.preload().then(() => {
    logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'embedding', content: 'Embedding model ready', createdAt: new Date() });
  }).catch(err => {
    logDb.insert({ id: crypto.randomUUID(), level: 'warn', category: 'embedding', content: `Embedding model preload failed: ${err}`, createdAt: new Date() });
  });

  // 恢复未归档的对话并汇总为topic
  await memoryManager.recoverAndSummarizeUnarchived();

  // 启动心跳
  startHeartbeat();

  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: 'Ready', createdAt: new Date() });
});

// 优雅关闭
process.on('SIGTERM', () => {
  logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: 'Shutting down...', createdAt: new Date() });
  if (heartbeatTask) {
    heartbeatTask.stop();
  }
  process.exit(0);
});
