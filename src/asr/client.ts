/**
 * ASR 客户端 - 调用 Python ASR 服务 (SenseVoice)
 */
import * as http from 'http';

// Python ASR 服务配置
const ASR_SERVICE_HOST = process.env.ASR_SERVICE_HOST || '127.0.0.1';
const ASR_SERVICE_PORT = parseInt(process.env.ASR_SERVICE_PORT || '5032');

export interface ASRResult {
  text: string;
  emotion: string;
  language: string;
}

/**
 * HTTP POST 请求 (Buffer → JSON)
 */
function httpPostBuffer(
  host: string,
  port: number,
  pathStr: string,
  body: Buffer,
  timeout = 30000
): Promise<{ data: unknown; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: host,
      port,
      path: pathStr,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
      },
      timeout,
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        try {
          const json = JSON.parse(data.toString());
          resolve({ data: json, statusCode: res.statusCode || 0 });
        } catch {
          resolve({ data: data.toString(), statusCode: res.statusCode || 0 });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('ASR request timeout'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * 调用 Python ASR 服务进行语音识别
 * @param audioBuffer - WAV 格式音频数据
 * @returns 识别结果 { text, emotion, language }
 */
export async function transcribe(audioBuffer: Buffer): Promise<ASRResult> {
  try {
    const { data, statusCode } = await httpPostBuffer(
      ASR_SERVICE_HOST,
      ASR_SERVICE_PORT,
      '/api/transcribe',
      audioBuffer
    );

    if (statusCode >= 400) {
      throw new Error(`ASR API error: ${statusCode}`);
    }

    const response = data as { success: boolean; text?: string; emotion?: string; language?: string; error?: string };

    if (!response.success) {
      throw new Error(response.error || 'ASR transcription failed');
    }

    return {
      text: response.text || '',
      emotion: response.emotion || 'neutral',
      language: response.language || 'unknown',
    };
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
      throw new Error(`ASR service is not running at ${ASR_SERVICE_HOST}:${ASR_SERVICE_PORT} (${err.message})`);
    }
    throw error;
  }
}

/**
 * 健康检查
 */
export async function healthCheck(): Promise<{ status: string }> {
  try {
    const { data } = await httpPostBuffer(
      ASR_SERVICE_HOST,
      ASR_SERVICE_PORT,
      '/api/health',
      Buffer.alloc(0)
    );
    const response = data as { status: string; service: string };
    return { status: response.status };
  } catch {
    return { status: 'disconnected' };
  }
}
