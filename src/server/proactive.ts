import cron from 'node-cron';
import { Request, Response } from 'express';
import { unifiedAgent } from '../agent/unified-agent.js';
import { proactiveAgent } from '../agent/proactive-agent.js';
import { stateManager } from '../state/manager.js';
import { memoryManager } from '../memory/manager.js';
import { logDb, stateDb, taskDb, dialogueDb, now } from '../db/database.js';
import { loadDefaultCharacter } from '../character/loader.js';
import { getRecentDialoguesText } from '../agent/dialogue-stats.js';
import { imageAnalysis } from '../skills/image-analysis/index.js';
import { SSEMessage } from '../types/index.js';

// ========== Shared conversation state (read/written by chat.ts) ==========

export const chatState = {
  currentChatAbortController: null as AbortController | null,
  currentChatCompletion: null as Promise<void> | null,
  currentProactiveAbortController: null as AbortController | null,
};

// ========== Proactive state ==========

export let launcherWindowVisible = true;
let proactiveSSEClients: Array<(message: SSEMessage) => void> = [];
let proactiveTimer = { nextTriggerAt: 0 };
let proactiveConfig = { enabled: true, minMs: 480_000, maxMs: 1_200_000, startupGreeting: true };
let proactiveBackoffMultiplier = 1;
let heartbeatTask: cron.ScheduledTask | null = null;
let startupGreetingSent = false;

// ========== SSE client management ==========

export function registerProactiveClient(callback: (message: SSEMessage) => void): void {
  proactiveSSEClients.push(callback);
}

export function unregisterProactiveClient(callback: (message: SSEMessage) => void): void {
  proactiveSSEClients = proactiveSSEClients.filter(c => c !== callback);
}

export function broadcastProactiveMessage(message: SSEMessage): void {
  for (const client of proactiveSSEClients) {
    try {
      client(message);
    } catch (error) {
      logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'heartbeat', content: `Failed to send to client: ${error}`, createdAt: now() });
    }
  }
}

export function getProactiveClientCount(): number {
  return proactiveSSEClients.length;
}

// ========== Config ==========

export function loadProactiveConfig(): void {
  try {
    const character = loadDefaultCharacter();
    const raw = stateDb.get(character.id, 'proactive_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      proactiveConfig.enabled = parsed.enabled ?? true;
      proactiveConfig.minMs = (parsed.minIntervalMinutes ?? 8) * 60_000;
      proactiveConfig.maxMs = (parsed.maxIntervalMinutes ?? 20) * 60_000;
      proactiveConfig.startupGreeting = parsed.startupGreeting ?? true;
    } else {
      const defaults = { enabled: true, minIntervalMinutes: 8, maxIntervalMinutes: 20, startupGreeting: true };
      stateDb.set(character.id, 'proactive_config', JSON.stringify(defaults));
      proactiveConfig.minMs = defaults.minIntervalMinutes * 60_000;
      proactiveConfig.maxMs = defaults.maxIntervalMinutes * 60_000;
      proactiveConfig.startupGreeting = defaults.startupGreeting;
    }
  } catch (error) {
    logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'heartbeat', content: `Failed to load proactive config: ${error}`, createdAt: now() });
  }
}

// ========== Timer ==========

export function resetProactiveTimer(fromUserInteraction = false): void {
  if (fromUserInteraction) {
    proactiveBackoffMultiplier = 1;
  }
  const baseDelay = proactiveConfig.minMs +
    Math.random() * (proactiveConfig.maxMs - proactiveConfig.minMs);
  proactiveTimer.nextTriggerAt = Date.now() + baseDelay * proactiveBackoffMultiplier;
}

// ========== Core proactive interaction ==========

async function executeProactiveInteraction(signal: AbortSignal): Promise<void> {
  let screenDescription = '';
  try {
    const recentForVllm = getRecentDialoguesText(5, 1);
    const vllmQuery = recentForVllm && recentForVllm.length > 20
      ? `图中有什么值得讨论的东西？我们最近在聊：${recentForVllm}。请基于这些对话内容，分析当前屏幕，告诉我有什么新的、相关的、有趣的东西值得我们讨论？`
      : '图中有什么值得讨论的东西？';
    screenDescription = await imageAnalysis({ query: vllmQuery, vllmMode: 'fast' });
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

  const memory = await memoryManager.recallRandomDayMemory();

  if (signal.aborted) return;

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

// ========== Heartbeat check ==========

async function checkProactiveInteraction(): Promise<void> {
  if (!proactiveConfig.enabled) return;
  if (!launcherWindowVisible) return;
  if (proactiveSSEClients.length === 0) return;
  if (Date.now() < proactiveTimer.nextTriggerAt) return;
  if (chatState.currentChatAbortController !== null) return;

  chatState.currentProactiveAbortController = new AbortController();
  const signal = chatState.currentProactiveAbortController.signal;

  try {
    await executeProactiveInteraction(signal);
  } finally {
    if (chatState.currentProactiveAbortController?.signal === signal) {
      chatState.currentProactiveAbortController = null;
    }
    proactiveBackoffMultiplier = Math.min(proactiveBackoffMultiplier * 3, 81);
    resetProactiveTimer();
  }
}

// ========== Heartbeat ==========

function calculateNextRun(_cronExpr: string): Date {
  return new Date(now().getTime() + 60 * 1000);
}

// ========== Startup greeting ==========

async function executeStartupGreeting(): Promise<void> {
  const character = loadDefaultCharacter();
  const turnCount = dialogueDb.getTurnCount(character.id);

  if (turnCount === 0) {
    // 首次启动：角色主动打招呼
    const greetingPrompt = '程序刚刚启动，这是你和用户的初次见面。请自然地打个招呼，介绍自己，表达友好。';
    await proactiveAgent.generate(greetingPrompt, broadcastProactiveMessage);
  } else {
    // 重启：角色知道程序刚重启
    const greetingPrompt = '程序刚刚重启了。你之前和用户聊过天（有历史记录），现在又回来了。请自然地跟用户打个招呼，表示你回来了。';
    await proactiveAgent.generate(greetingPrompt, broadcastProactiveMessage);
  }

  logDb.insert({
    id: crypto.randomUUID(),
    level: 'info',
    category: 'proactive',
    content: `Startup greeting sent (turnCount=${turnCount})`,
    createdAt: now()
  });
}

export function startHeartbeat(): void {
  heartbeatTask = cron.schedule('* * * * *', async () => {
    try {
      stateManager.tick();

      const dueTasks = taskDb.getDueTasks();
      for (const task of dueTasks) {
        logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'heartbeat', content: `Executing task: ${task.name}`, createdAt: now() });
        taskDb.update(task.id, {
          lastRun: now(),
          nextRun: calculateNextRun(task.cron)
        });
      }

      await memoryManager.checkAndSummarizeAll();
      await logDb.flushToFile();
      await checkProactiveInteraction();
    } catch (error) {
      logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'heartbeat', content: `Heartbeat error: ${error}`, createdAt: now() });
    }
  });

  // 启动问候：延迟 3 秒等 SSE 客户端连接
  setTimeout(async () => {
    if (startupGreetingSent) return;
    if (proactiveConfig.startupGreeting !== true) {
      logDb.insert({
        id: crypto.randomUUID(),
        level: 'info',
        category: 'proactive',
        content: `Startup greeting skipped (config.startupGreeting=${proactiveConfig.startupGreeting})`,
        createdAt: now()
      });
      return;
    }
    if (proactiveSSEClients.length === 0) {
      logDb.insert({
        id: crypto.randomUUID(),
        level: 'info',
        category: 'proactive',
        content: 'Startup greeting skipped (no SSE clients connected)',
        createdAt: now()
      });
      return;
    }
    startupGreetingSent = true;
    try {
      await executeStartupGreeting();
    } catch (error) {
      logDb.insert({
        id: crypto.randomUUID(),
        level: 'error',
        category: 'proactive',
        content: `Startup greeting failed: ${error}`,
        createdAt: now()
      });
    }
  }, 3000);
}

export function stopHeartbeat(): void {
  if (heartbeatTask) {
    heartbeatTask.stop();
    heartbeatTask = null;
  }
}

// ========== Route handlers ==========

export function handleProactiveConfigGet(_req: Request, res: Response): void {
  try {
    const character = loadDefaultCharacter();
    const raw = stateDb.get(character.id, 'proactive_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      res.json({ ...parsed, startupGreeting: parsed.startupGreeting ?? true });
    } else {
      res.json({ enabled: true, minIntervalMinutes: 8, maxIntervalMinutes: 20, startupGreeting: true });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
}

export function handleProactiveConfigPut(req: Request, res: Response): void {
  try {
    const character = loadDefaultCharacter();
    const { enabled, minIntervalMinutes, maxIntervalMinutes, startupGreeting } = req.body;

    if (minIntervalMinutes !== undefined && maxIntervalMinutes !== undefined && minIntervalMinutes > maxIntervalMinutes) {
      res.status(400).json({ error: '最小间隔不能大于最大间隔' });
      return;
    }

    const raw = stateDb.get(character.id, 'proactive_config');
    const existing = raw ? JSON.parse(raw) : { enabled: true, minIntervalMinutes: 8, maxIntervalMinutes: 20, startupGreeting: true };

    if (enabled !== undefined) existing.enabled = enabled;
    if (minIntervalMinutes !== undefined) existing.minIntervalMinutes = minIntervalMinutes;
    if (maxIntervalMinutes !== undefined) existing.maxIntervalMinutes = maxIntervalMinutes;
    if (startupGreeting !== undefined) existing.startupGreeting = startupGreeting;

    stateDb.set(character.id, 'proactive_config', JSON.stringify(existing));

    proactiveConfig.enabled = existing.enabled;
    proactiveConfig.minMs = existing.minIntervalMinutes * 60_000;
    proactiveConfig.maxMs = existing.maxIntervalMinutes * 60_000;
    proactiveConfig.startupGreeting = existing.startupGreeting ?? true;
    resetProactiveTimer();

    logDb.insert({
      id: crypto.randomUUID(),
      level: 'info',
      category: 'proactive',
      content: `Config updated: enabled=${existing.enabled}, min=${existing.minIntervalMinutes}min, max=${existing.maxIntervalMinutes}min, startupGreeting=${existing.startupGreeting}`,
      createdAt: now()
    });

    res.json({ success: true, config: existing });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
}

export async function handleProactiveTrigger(req: Request, res: Response): Promise<void> {
  logDb.insert({
    id: crypto.randomUUID(),
    level: 'info',
    category: 'proactive',
    content: `Manual trigger requested (clients=${proactiveSSEClients.length}, chatActive=${chatState.currentChatAbortController !== null})`,
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

  if (chatState.currentProactiveAbortController) {
    logDb.insert({
      id: crypto.randomUUID(),
      level: 'info',
      category: 'proactive',
      content: 'Aborting previous proactive interaction',
      createdAt: now()
    });
    chatState.currentProactiveAbortController.abort();
    chatState.currentProactiveAbortController = null;
  }

  if (chatState.currentChatAbortController) {
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

  chatState.currentProactiveAbortController = new AbortController();
  const signal = chatState.currentProactiveAbortController.signal;

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
    if (chatState.currentProactiveAbortController?.signal === signal) {
      chatState.currentProactiveAbortController = null;
    }
    proactiveBackoffMultiplier = Math.min(proactiveBackoffMultiplier * 3, 81);
    resetProactiveTimer();
  }
}

export function handleLauncherState(req: Request, res: Response): void {
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
}

export function handleProactiveStream(req: Request, res: Response): void {
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
}
