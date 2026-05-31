import { Request, Response, Express } from 'express';
import path from 'path';
import fs from 'fs';
import { stateManager } from '../state/manager.js';
import { dialogueDb, logDb, taskDb, now } from '../db/database.js';
import db from '../db/database.js';
import { skillEngine } from '../skills/engine.js';
import { getCurrentCharacterId } from '../character/knowledge.js';
import { loadDefaultCharacter } from '../character/loader.js';

export function registerRoutes(app: Express): void {
  // 健康检查
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: now().toISOString() });
  });

  // 获取当前状态
  app.get('/api/state', (_req: Request, res: Response) => {
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
  app.get('/api/skills', (_req: Request, res: Response) => {
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
  app.delete('/api/logs', (_req: Request, res: Response) => {
    try {
      db.exec('DELETE FROM logs');
      res.json({ success: true, message: 'Logs cleared' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // 清除对话
  app.delete('/api/dialogues', (_req: Request, res: Response) => {
    try {
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
  app.get('/api/tasks', (_req: Request, res: Response) => {
    try {
      const tasks = taskDb.getAll();
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Python 桌宠端写入日志
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

  // 获取当前角色的Live2D配置
  app.get('/api/character/live2d-config', (_req: Request, res: Response) => {
    try {
      const character = loadDefaultCharacter();
      const characterCardsDir = path.join(process.cwd(), 'character-cards');
      const live2dDir = path.join(characterCardsDir, character.id, 'live2d');

      if (!fs.existsSync(live2dDir)) {
        res.status(404).json({ error: `角色卡 "${character.name}" 中未配置 Live2D 模型。请检查角色卡目录是否存在 live2d 文件夹。` });
        return;
      }

      const modelFiles = fs.readdirSync(live2dDir).filter(f => f.endsWith('.model.json') || f.endsWith('.model3.json'));

      if (modelFiles.length === 0) {
        res.status(404).json({ error: `角色卡 "${character.name}" 的 live2d 目录中未找到模型文件 (.model.json 或 .model3.json)。` });
        return;
      }

      const modelFile = modelFiles[0];
      const modelPath = `character-cards/${character.id}/live2d/${modelFile}`;
      const modelUrl = `/${modelPath}`;
      const live2dUrl = `/live2d`;

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
}
