// Agent 基类 — 通过 opencode HTTP API 调用 LLM
import type { ModelConfig } from '../types/config.js';

const OPENCODE_SERVER = process.env.OPENCODE_SERVER || 'http://localhost:8080';
const OPENCODE_USERNAME = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || 'goldrush2026';

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${OPENCODE_USERNAME}:${OPENCODE_PASSWORD}`).toString('base64');
}

export interface AgentOptions {
  name: string;
  model: ModelConfig;
  systemPrompt?: string;
}

export class BaseAgent {
  protected name: string;
  protected model: ModelConfig;
  protected systemPrompt: string;

  constructor(options: AgentOptions) {
    this.name = options.name;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt ?? '';
  }

  /** 创建新 session */
  private async createSession(): Promise<string> {
    const res = await fetch(`${OPENCODE_SERVER}/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader(),
      },
    });

    if (!res.ok) {
      throw new Error(`Agent ${this.name}: create session failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json() as { id: string };
    return data.id;
  }

  /** 发送消息到 session，等待完整回复（带超时和重试） */
  private async sendMessage(sessionId: string, content: string, system?: string): Promise<string> {
    const body: Record<string, unknown> = {
      providerID: this.model.providerID,
      modelID: this.model.modelID,
      parts: [{ type: 'text', text: content }],
    };
    if (system) {
      body.system = system;
    }

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(`${OPENCODE_SERVER}/session/${sessionId}/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader(),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(300_000), // 5 min timeout per request
        });

        if (!res.ok) {
          throw new Error(`Agent ${this.name}: send message failed: ${res.status} ${await res.text()}`);
        }

        const data = await res.json() as { parts: Array<{ type: string; text?: string }> };
        // 提取 text 类型的 parts 拼接成完整文本
        const textParts = (data.parts || [])
          .filter((p) => p.type === 'text' && p.text)
          .map((p) => p.text!)
          .join('\n');

        if (!textParts.trim()) {
          throw new Error(`Agent ${this.name}: empty response from LLM`);
        }

        return textParts;
      } catch (err) {
        const isLastAttempt = attempt === maxRetries;
        if (isLastAttempt) throw err;
        // 退避重试
        const delay = attempt * 5000;
        console.error(`  ⚠️ Agent ${this.name} attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}. Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    throw new Error(`Agent ${this.name}: all retries exhausted`);
  }

  /** 发送 prompt，获取文本回复 */
  async prompt(content: string): Promise<string> {
    const sessionId = await this.createSession();
    const text = await this.sendMessage(sessionId, content, this.systemPrompt || undefined);
    return text.trim();
  }

  /** 发送 prompt，获取结构化 JSON 输出 */
  async structuredPrompt<T>(content: string, _schema: Record<string, unknown>): Promise<T> {
    const jsonInstruction = `\n\n请严格按照上述 JSON 格式输出，不要包含任何其他文本。直接输出 JSON，不要用 markdown 代码块包裹。JSON中不要包含tab、换行等控制字符。`;
    const fullContent = content + jsonInstruction;

    const text = await this.prompt(fullContent);

    // 清理常见 LLM JSON 输出问题
    const cleaned = text
      .replace(/[\t\r\f\v]/g, ' ')        // 移除 tab 等控制字符
      .replace(/\\\n/g, ' ')               // 移除转义换行
      .replace(/\\t/g, ' ')                // 移除转义tab
      .replace(/[\x00-\x1f]/g, (c) => {   // 移除其他控制字符（保留 \n）
        return c === '\n' ? c : ' ';
      });

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // 尝试从文本中提取 JSON
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as T;
        } catch {
          throw new Error(`Agent ${this.name}: Failed to parse extracted JSON: ${jsonMatch[0].slice(0, 200)}`);
        }
      }
      throw new Error(`Agent ${this.name}: Failed to parse structured output: ${text.slice(0, 200)}`);
    }
  }

  /** 清理资源 (HTTP API 模式无需清理) */
  async cleanup(): Promise<void> {
    // 每次 prompt 创建独立 session，无需清理
  }
}