import { Request, Response } from 'express';
import { unifiedAgent } from '../agent/unified-agent.js';
import { logDb, now } from '../db/database.js';
import { chatState, resetProactiveTimer } from './proactive.js';

export async function handleChat(req: Request, res: Response): Promise<void> {
  const { message } = req.body;

  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  // 中断进行中的主动交互
  if (chatState.currentProactiveAbortController) {
    chatState.currentProactiveAbortController.abort();
    chatState.currentProactiveAbortController = null;
  }

  // 中断当前正在进行的对话（等待旧 process 完成落库后再开始新的）
  if (chatState.currentChatAbortController) {
    chatState.currentChatAbortController.abort();
    try { await chatState.currentChatCompletion; } catch {}
  }
  chatState.currentChatAbortController = new AbortController();
  const signal = chatState.currentChatAbortController.signal;

  // 跟踪本次 process 完成，用于后续打断时等待落库
  let resolveCompletion: () => void;
  chatState.currentChatCompletion = new Promise<void>(resolve => { resolveCompletion = resolve; });

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
    resolveCompletion!();
    // 清理（仅当仍是当前 controller 时）
    if (chatState.currentChatAbortController && chatState.currentChatAbortController.signal === signal) {
      chatState.currentChatAbortController = null;
      chatState.currentChatCompletion = null;
    }
  }
}
