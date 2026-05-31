/**
 * Python Exec Skill — AI 自主编写执行 Python 脚本
 */

import { spawn } from 'child_process';
import type { ToolDef } from '../../types/index.js';

// ========== Tool Handler ==========

async function handleExecutePython(params: Record<string, unknown>): Promise<string> {
  const script = params.script as string;
  if (!script) return JSON.stringify({ stdout: '', stderr: 'script 参数为空', exitCode: -1 });

  const timeout = Math.min((params.timeout as number) || 30, 120);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn('python', ['-c', script], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      timeout
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        resolve(JSON.stringify({
          stdout,
          stderr: (stderr || '脚本执行超时 (' + timeout + 's)'),
          exitCode: -1
        }));
      }
    }, timeout * 1000);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8');
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(JSON.stringify({ stdout, stderr, exitCode: code ?? -1 }));
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(JSON.stringify({ stdout, stderr: err.message, exitCode: -1 }));
    });
  });
}

// ========== Tool 注册 ==========

export const toolDefs: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'execute_python',
      description: '执行一段 Python 3 脚本，返回 stdout、stderr 和 exitCode。适用于数据处理、计算、文件操作等编程任务。默认超时 30 秒。',
      parameters: {
        type: 'object',
        properties: {
          script: { type: 'string', description: '要执行的 Python 代码' },
          timeout: { type: 'number', description: '超时秒数，默认 30，最大 120' }
        },
        required: ['script']
      }
    }
  }
];

export const toolHandlers: Record<string, (params: Record<string, unknown>) => Promise<string>> = {
  execute_python: handleExecutePython,
};
