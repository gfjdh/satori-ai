/**
 * Image Analysis 客户端 - 调用 Python Image Analysis 服务
 */
import * as http from 'http';

const IMAGE_SERVICE_HOST = process.env.IMAGE_SERVICE_HOST || '127.0.0.1';
const IMAGE_SERVICE_PORT = parseInt(process.env.IMAGE_SERVICE_PORT || '8742');

interface HttpResponse {
  data: unknown;
  statusCode: number;
}

function httpPost(host: string, port: number, pathStr: string, body: Record<string, unknown>, timeout = 120000): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: host,
      port,
      path: pathStr,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout,
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        try {
          resolve({ data: JSON.parse(data.toString()), statusCode: res.statusCode || 0 });
        } catch {
          resolve({ data: data.toString(), statusCode: res.statusCode || 0 });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}

export interface AnalyzeResult {
  success: boolean;
  vllm_result?: string;
  elapsed_ms: number;
  error?: string;
}

export async function analyzeImage(imageBase64: string, vllmMode: string = 'fast', query?: string): Promise<AnalyzeResult> {
  const { data, statusCode } = await httpPost(IMAGE_SERVICE_HOST, IMAGE_SERVICE_PORT, '/analyze', {
    image_base64: imageBase64,
    vllm_mode: vllmMode,
    query: query || null
  });

  if (statusCode >= 400) {
    throw new Error(`Image service error: ${statusCode} ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }

  return data as AnalyzeResult;
}

export async function captureAndAnalyze(vllmMode: string = 'fast', query?: string): Promise<AnalyzeResult> {
  const { data, statusCode } = await httpPost(IMAGE_SERVICE_HOST, IMAGE_SERVICE_PORT, '/capture', {
    vllm_mode: vllmMode,
    query: query || null
  });

  if (statusCode >= 400) {
    throw new Error(`Image service error: ${statusCode} ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }

  return data as AnalyzeResult;
}

export async function healthCheck(): Promise<{ status: string; service: string }> {
  const { data, statusCode } = await httpPost(IMAGE_SERVICE_HOST, IMAGE_SERVICE_PORT, '/health', {});
  if (statusCode >= 400) {
    throw new Error(`Health check failed: ${statusCode}`);
  }
  return data as { status: string; service: string };
}
