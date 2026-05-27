import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Dialogue, Memory, Task, KnowledgeEntry, LogEntry } from '../types/index.js';

// 使用process.cwd()代替__dirname以兼容ESM/CJS
const DB_PATH = path.join(process.cwd(), 'data', 'database.sqlite');

// 确保data目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db: DatabaseType = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ========== 东八区时间体系 ==========
const TZ_OFFSET = 8 * 60 * 60 * 1000;

/** 东八区"现在" — 所有入库/比较用时间统一走这个工厂 */
export function now(): Date {
  return new Date(Date.now() + TZ_OFFSET);
}

/** 一次性迁移：将数据库中所有UTC时间字段偏移+8h */
function migrateToUTC8(): void {
  const row = db.prepare(
    "SELECT value FROM system_state WHERE id = 'db_tz_migrated' AND character_id = '__system__'"
  ).get() as { value: string } | undefined;
  if (row?.value === 'utc8') return;

  const shift = (iso: string) => new Date(new Date(iso).getTime() + TZ_OFFSET).toISOString();

  const tables: [string, string[]][] = [
    ['dialogues', ['created_at']],
    ['memories', ['period_start', 'period_end', 'created_at']],
    ['tasks', ['last_run', 'next_run', 'created_at']],
    ['system_state', ['updated_at']],
    ['knowledge_base', ['created_at']],
    ['logs', ['created_at']],
  ];

  const migrate = db.transaction(() => {
    for (const [table, cols] of tables) {
      for (const col of cols) {
        const rows = db.prepare(
          `SELECT rowid, ${col} FROM ${table} WHERE ${col} IS NOT NULL`
        ).all() as any[];
        const update = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`);
        for (const r of rows) {
          if (r[col]) update.run(shift(r[col]), r.rowid);
        }
      }
    }
    db.prepare(
      `INSERT OR REPLACE INTO system_state (id, character_id, value, updated_at) VALUES ('db_tz_migrated', '__system__', 'utc8', ?)`
    ).run(new Date().toISOString());
  });

  migrate();
  console.log('[DB] Timezone migrated to UTC+8.');
}

migrateToUTC8();

// ========== 初始化表结构 ==========
db.exec(`
  -- 对话原始记录表
  CREATE TABLE IF NOT EXISTS dialogues (
    id TEXT PRIMARY KEY,
    turn_index INTEGER NOT NULL,
    user_content TEXT NOT NULL,
    ai_content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- 记忆表
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    granularity TEXT NOT NULL CHECK(granularity IN ('year', 'season', 'month', 'week', 'day', 'topic')),
    content TEXT NOT NULL,
    embedding BLOB,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- 定时任务表
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cron TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN ('reminder', 'notification')),
    params TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run TEXT,
    next_run TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- 系统状态表
  CREATE TABLE IF NOT EXISTS system_state (
    id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (id, character_id)
  );

  -- 资料库表
  CREATE TABLE IF NOT EXISTS knowledge_base (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB,
    source TEXT NOT NULL CHECK(source IN ('character_card', 'user')),
    created_at TEXT NOT NULL
  );

  -- 日志表
  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL CHECK(level IN ('info', 'warn', 'error', 'debug')),
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- 创建索引
  CREATE INDEX IF NOT EXISTS idx_dialogues_created ON dialogues(created_at);
  CREATE INDEX IF NOT EXISTS idx_memories_granularity ON memories(granularity);
  CREATE INDEX IF NOT EXISTS idx_memories_period ON memories(period_start, period_end);
  CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON tasks(next_run);
  CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_category ON logs(category);
`);

// 迁移：添加 user_state 列
try { db.exec(`ALTER TABLE memories ADD COLUMN user_state TEXT`);} catch { /* 列已存在，忽略 */ }

// 迁移：添加 character_id 列
try { db.exec(`ALTER TABLE dialogues ADD COLUMN character_id TEXT`);} catch { /* 列已存在，忽略 */ }

// ========== 对话操作 ==========
export const dialogueDb = {
  insert(dialogue: Dialogue): void {
    const stmt = db.prepare(`
      INSERT INTO dialogues (id, turn_index, character_id, user_content, ai_content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      dialogue.id,
      dialogue.turnIndex,
      dialogue.characterId,
      dialogue.userContent,
      dialogue.aiContent,
      dialogue.createdAt.toISOString()
    );
  },

  getRecent(limit: number, characterId: string): Dialogue[] {
    const stmt = db.prepare(`
      SELECT * FROM dialogues WHERE character_id = ? ORDER BY created_at DESC LIMIT ?
    `);
    const rows = stmt.all(characterId, limit) as any[];
    return rows.map(row => ({
      id: row.id,
      turnIndex: row.turn_index,
      characterId: row.character_id,
      userContent: row.user_content,
      aiContent: row.ai_content,
      createdAt: new Date(row.created_at)
    }));
  },

  getTurnCount(characterId: string): number {
    const stmt = db.prepare('SELECT MAX(turn_index) as max_turn FROM dialogues WHERE character_id = ?');
    const result = stmt.get(characterId) as { max_turn: number | null };
    return result.max_turn ?? 0;
  },

  getDialogueCountSince(date: Date, characterId: string): number {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM dialogues WHERE character_id = ? AND created_at >= ?
    `);
    const result = stmt.get(characterId, date.toISOString()) as { count: number };
    return result.count;
  },

  getLastDialogueTime(characterId: string): Date | null {
    const stmt = db.prepare('SELECT created_at FROM dialogues WHERE character_id = ? ORDER BY created_at DESC LIMIT 1');
    const row = stmt.get(characterId) as { created_at: string } | undefined;
    return row ? new Date(row.created_at) : null;
  },

  getCharacterDialogueSince(date: Date, characterId: string): Dialogue[] {
    const stmt = db.prepare(`
      SELECT * FROM dialogues WHERE character_id = ? AND created_at > ? ORDER BY turn_index ASC
    `);
    const rows = stmt.all(characterId, date.toISOString()) as any[];
    return rows.map(row => ({
      id: row.id,
      turnIndex: row.turn_index,
      characterId: row.character_id,
      userContent: row.user_content,
      aiContent: row.ai_content,
      createdAt: new Date(row.created_at)
    }));
  },

  getAllDialogueSince(date: Date): Dialogue[] {
    const stmt = db.prepare(`
      SELECT * FROM dialogues WHERE created_at > ? ORDER BY turn_index ASC
    `);
    const rows = stmt.all(date.toISOString()) as any[];
    return rows.map(row => ({
      id: row.id,
      turnIndex: row.turn_index,
      characterId: row.character_id,
      userContent: row.user_content,
      aiContent: row.ai_content,
      createdAt: new Date(row.created_at)
    }));
  }
};

// ========== 记忆操作 ==========
export const memoryDb = {
  insert(memory: Memory): void {
    const stmt = db.prepare(`
      INSERT INTO memories (id, granularity, content, user_state, embedding, period_start, period_end, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      memory.id,
      memory.granularity,
      memory.content,
      memory.userState ?? null,
      memory.embedding ?? null,
      memory.periodStart.toISOString(),
      memory.periodEnd.toISOString(),
      memory.createdAt.toISOString()
    );
  },

  search(startTime?: Date, endTime?: Date, limit: number = 10, granularity?: string): Memory[] {
    let allMemories = this.getAll();

    // 按粒度过滤
    if (granularity) {
      allMemories = allMemories.filter(mem => mem.granularity === granularity);
    }

    // 时间范围过滤
    const results = allMemories.filter(mem => {
      const timeMatched = (!startTime || mem.periodEnd >= startTime) &&
                         (!endTime || mem.periodStart <= endTime);
      return timeMatched;
    });

    // 按 period_start 降序排列
    results.sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime());
    return results.slice(0, limit);
  },

  // 获取比指定记忆更粗粒度的所有记忆
  getCoarserMemories(mem: Memory, startTime?: Date, endTime?: Date): Memory[] {
    const hierarchy: Record<string, string[]> = {
      'topic': ['day', 'week', 'month', 'season', 'year'],
      'day': ['week', 'month', 'season', 'year'],
      'week': ['month', 'season', 'year'],
      'month': ['season', 'year'],
      'season': ['year'],
      'year': []
    };

    const coarserLevels = hierarchy[mem.granularity] || [];
    if (coarserLevels.length === 0) return [];

    const coarserMemories: Memory[] = [];
    for (const level of coarserLevels) {
      const candidates = this.getByGranularity(level, 100);
      for (const candidate of candidates) {
        // 检查时间范围约束
        if (startTime && candidate.periodEnd < startTime) continue;
        if (endTime && candidate.periodStart > endTime) continue;
        // 检查时间重叠
        if (candidate.periodStart <= mem.periodEnd && candidate.periodEnd >= mem.periodStart) {
          coarserMemories.push(candidate);
        }
      }
    }
    return coarserMemories;
  },

  getByGranularity(granularity: string, limit: number = 10): Memory[] {
    const stmt = db.prepare(`
      SELECT * FROM memories WHERE granularity = ? ORDER BY period_start DESC LIMIT ?
    `);
    const rows = stmt.all(granularity, limit) as any[];
    return rows.map(row => ({
      id: row.id,
      granularity: row.granularity,
      content: row.content,
      userState: row.user_state ?? null,
      periodStart: new Date(row.period_start),
      periodEnd: new Date(row.period_end),
      createdAt: new Date(row.created_at)
    }));
  },

  getAll(): Memory[] {
    const stmt = db.prepare('SELECT * FROM memories ORDER BY period_start DESC');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      granularity: row.granularity,
      content: row.content,
      userState: row.user_state ?? null,
      embedding: row.embedding,
      periodStart: new Date(row.period_start),
      periodEnd: new Date(row.period_end),
      createdAt: new Date(row.created_at)
    }));
  },

  getAllWithEmbedding(): Array<Memory & { embedding: Buffer | null }> {
    const stmt = db.prepare('SELECT * FROM memories WHERE embedding IS NOT NULL');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      granularity: row.granularity,
      content: row.content,
      userState: row.user_state ?? null,
      embedding: row.embedding ? Buffer.from(row.embedding) : null,
      periodStart: new Date(row.period_start),
      periodEnd: new Date(row.period_end),
      createdAt: new Date(row.created_at)
    }));
  },

  updateEmbedding(id: string, embedding: Buffer): void {
    const stmt = db.prepare('UPDATE memories SET embedding = ? WHERE id = ?');
    stmt.run(embedding, id);
  },

  getByUserState(searchTerm: string, limit: number = 20): Memory[] {
    const stmt = db.prepare(`
      SELECT * FROM memories WHERE user_state IS NOT NULL AND user_state LIKE ? ORDER BY period_start DESC LIMIT ?
    `);
    const rows = stmt.all(`%${searchTerm}%`, limit) as any[];
    return rows.map(row => ({
      id: row.id,
      granularity: row.granularity,
      content: row.content,
      userState: row.user_state ?? null,
      periodStart: new Date(row.period_start),
      periodEnd: new Date(row.period_end),
      createdAt: new Date(row.created_at)
    }));
  }
};

// ========== 任务操作 ==========
export const taskDb = {
  insert(task: Task): void {
    const stmt = db.prepare(`
      INSERT INTO tasks (id, name, cron, action_type, params, enabled, last_run, next_run, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.id,
      task.name,
      task.cron,
      task.actionType,
      JSON.stringify(task.params),
      task.enabled ? 1 : 0,
      task.lastRun?.toISOString() ?? null,
      task.nextRun.toISOString(),
      task.createdAt.toISOString()
    );
  },

  update(id: string, updates: Partial<Task>): void {
    const sets: string[] = [];
    const params: any[] = [];

    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
    if (updates.cron !== undefined) { sets.push('cron = ?'); params.push(updates.cron); }
    if (updates.params !== undefined) { sets.push('params = ?'); params.push(JSON.stringify(updates.params)); }
    if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }
    if (updates.lastRun !== undefined) { sets.push('last_run = ?'); params.push(updates.lastRun?.toISOString() ?? null); }
    if (updates.nextRun !== undefined) { sets.push('next_run = ?'); params.push(updates.nextRun.toISOString()); }

    if (sets.length > 0) {
      params.push(id);
      const stmt = db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`);
      stmt.run(...params);
    }
  },

  getDueTasks(): Task[] {
    const nowISO = now().toISOString();
    const stmt = db.prepare(`
      SELECT * FROM tasks WHERE enabled = 1 AND next_run <= ? ORDER BY next_run ASC
    `);
    const rows = stmt.all(nowISO) as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      cron: row.cron,
      actionType: row.action_type,
      params: JSON.parse(row.params),
      enabled: row.enabled === 1,
      lastRun: row.last_run ? new Date(row.last_run) : null,
      nextRun: new Date(row.next_run),
      createdAt: new Date(row.created_at)
    }));
  },

  getAll(): Task[] {
    const stmt = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      cron: row.cron,
      actionType: row.action_type,
      params: JSON.parse(row.params),
      enabled: row.enabled === 1,
      lastRun: row.last_run ? new Date(row.last_run) : null,
      nextRun: new Date(row.next_run),
      createdAt: new Date(row.created_at)
    }));
  }
};

// ========== 系统状态操作 ==========
export const stateDb = {
  get(characterId: string, key: string): string | null {
    const stmt = db.prepare(`
      SELECT value FROM system_state WHERE id = ? AND character_id = ?
    `);
    const result = stmt.get(key, characterId) as { value: string } | undefined;
    return result?.value ?? null;
  },

  set(characterId: string, key: string, value: string): void {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO system_state (id, character_id, value, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(key, characterId, value, now().toISOString());
  },

  getAffinity(characterId: string): AffinityState | null {
    const value = stateDb.get(characterId, 'affinity');
    return value ? JSON.parse(value) : null;
  },

  setAffinity(characterId: string, affinity: AffinityState): void {
    stateDb.set(characterId, 'affinity', JSON.stringify(affinity));
  },

  getEmotion(characterId: string): EmotionState | null {
    const value = stateDb.get(characterId, 'emotion');
    return value ? JSON.parse(value) : null;
  },

  setEmotion(characterId: string, emotion: EmotionState): void {
    stateDb.set(characterId, 'emotion', JSON.stringify(emotion));
  },

  getUserProfile(characterId: string): string | null {
    return stateDb.get(characterId, 'user_profile');
  },

  setUserProfile(characterId: string, profile: string): void {
    stateDb.set(characterId, 'user_profile', profile);
  }
};

// ========== 资料库操作 ==========
export const knowledgeDb = {
  insert(entry: KnowledgeEntry): void {
    const stmt = db.prepare(`
      INSERT INTO knowledge_base (id, category, content, embedding, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.id,
      entry.category,
      entry.content,
      entry.embedding ?? null,
      entry.source,
      entry.createdAt.toISOString()
    );
  },

  search(category?: string, limit: number = 20): KnowledgeEntry[] {
    let allEntries = this.getAll();

    // 按分类过滤
    if (category) {
      allEntries = allEntries.filter(e => e.category === category);
    }

    // 按 created_at 降序排列
    allEntries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return allEntries.slice(0, limit);
  },

  getAll(): KnowledgeEntry[] {
    const stmt = db.prepare('SELECT * FROM knowledge_base ORDER BY created_at DESC');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      category: row.category,
      content: row.content,
      embedding: row.embedding,
      source: row.source,
      createdAt: new Date(row.created_at)
    }));
  },

  getAllWithEmbedding(): Array<KnowledgeEntry & { embedding: Buffer | null }> {
    const stmt = db.prepare('SELECT * FROM knowledge_base WHERE embedding IS NOT NULL');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      category: row.category,
      content: row.content,
      embedding: row.embedding ? Buffer.from(row.embedding) : null,
      source: row.source,
      createdAt: new Date(row.created_at)
    }));
  },

  updateEmbedding(id: string, embedding: Buffer): void {
    const stmt = db.prepare('UPDATE knowledge_base SET embedding = ? WHERE id = ?');
    stmt.run(embedding, id);
  },

  delete(id: string): void {
    const stmt = db.prepare('DELETE FROM knowledge_base WHERE id = ?');
    stmt.run(id);
  },

  batchImport(entries: Omit<KnowledgeEntry, 'id' | 'createdAt'>[]): number {
    const stmt = db.prepare(`
      INSERT INTO knowledge_base (id, category, content, embedding, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    // 使用内置crypto生成UUID
    const generateId = () => crypto.randomUUID();
    let count = 0;

    const insertMany = db.transaction((entries: any[]) => {
      for (const entry of entries) {
        stmt.run(
          generateId(),
          entry.category,
          entry.content,
          entry.embedding ?? null,
          entry.source,
          now().toISOString()
        );
        count++;
      }
    });

    insertMany(entries);
    return count;
  }
};

// ========== 日志操作 ==========
export const logDb = {
  insert(entry: LogEntry): void {
    const stmt = db.prepare(`
      INSERT INTO logs (id, level, category, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.id,
      entry.level,
      entry.category,
      entry.content,
      entry.createdAt.toISOString()
    );
  },

  getRecent(limit: number = 100, category?: string): LogEntry[] {
    let sql = 'SELECT * FROM logs';
    const params: any[] = [];

    if (category) {
      sql += ' WHERE category = ?';
      params.push(category);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as any[];
    return rows.map(row => ({
      id: row.id,
      level: row.level,
      category: row.category,
      content: row.content,
      createdAt: new Date(row.created_at)
    }));
  },

  // 日志输出到文件并清空。force=true 时忽略500条阈值
  async flushToFile(force: boolean = false): Promise<void> {
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM logs');
    const result = countStmt.get() as { count: number };

    if (force || result.count >= 500) {
      const logDir = path.join(dataDir, 'logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const date = now().toISOString().slice(0, 16).replace(/:/g, '-');
      const logFile = path.join(logDir, `${date}.txt`);

      const stmt = db.prepare('SELECT * FROM logs ORDER BY created_at ASC');
      const rows = stmt.all() as any[];
      const logContent = rows.map(l =>
        `[${new Date(l.created_at).toISOString()}] [${l.level.toUpperCase()}] [${l.category}] ${l.content}`
      ).join('\n');

      fs.appendFileSync(logFile, logContent + '\n');

      // 清空日志表
      const deleteStmt = db.prepare('DELETE FROM logs');
      deleteStmt.run();
    }
  }
};

// 辅助类型
interface AffinityState {
  characterId: string;
  dimensions: Record<string, number>;
}

interface EmotionState {
  characterId: string;
  dimensions: Record<string, number>;
  regressionRate: number;
}

// 导出类型供外部使用
export type { Memory, KnowledgeEntry, Dialogue, Task, LogEntry };

export default db;
