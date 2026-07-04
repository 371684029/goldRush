// Tavily 搜索客户端封装
import { tavily } from '@tavily/core';
import type { SearchResult, SearchOptions } from '../types/market.js';

export class TavilyClient {
  private client: ReturnType<typeof tavily> | null = null;

  constructor(apiKey?: string) {
    if (apiKey) {
      this.client = tavily({ apiKey });
    }
  }

  /** 是否可用 */
  get isAvailable(): boolean {
    return this.client !== null;
  }

  /** 搜索 */
  async search(query: string, options: SearchOptions = { engine: 'tavily' }): Promise<SearchResult[]> {
    if (!this.client) {
      return [];
    }

    try {
      const response = await this.client.search(query, {
        maxResults: options.numResults ?? 5,
        includeAnswer: false,
        searchDepth: 'basic',
      });

      return (response.results || []).map((r: { title?: string; url?: string; content?: string; publishedDate?: string }) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.content ?? '',
        engine: 'tavily' as const,
        publishedDate: r.publishedDate,
      }));
    } catch (err) {
      console.error('Tavily search error:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }
}
