// 搜索缓存 CRUD
import Database from 'better-sqlite3';
import crypto from 'node:crypto';

export interface SearchCacheEntry {
  queryHash: string;
  query: string;
  engine: string;
  results: string; // JSON
  createdAt: string;
  expiresAt: string;
}

export class SearchCacheRepo {
  constructor(private db: Database.Database, private ttlMinutes: number = 5) {}

  /** 计算查询哈希 */
  private hash(query: string, engine: string): string {
    return crypto.createHash('sha256').update(`${engine}:${query}`).digest('hex').slice(0, 16);
  }

  /** 查找缓存 */
  get(query: string, engine: string): string | null {
    const hash = this.hash(query, engine);
    const row = this.db.prepare(`
      SELECT results FROM search_cache
      WHERE query_hash = ? AND expires_at > datetime('now')
    `).get(hash) as { results: string } | undefined;
    return row?.results ?? null;
  }

  /** 写入缓存 */
  set(query: string, engine: string, results: string): void {
    const hash = this.hash(query, engine);
    this.db.prepare(`
      INSERT OR REPLACE INTO search_cache (query_hash, query, engine, results, expires_at)
      VALUES (?, ?, ?, ?, datetime('now', '+${this.ttlMinutes} minutes'))
    `).run(hash, query, engine, results);
  }

  /** 清理过期缓存 */
  purge(): number {
    const result = this.db.prepare(`DELETE FROM search_cache WHERE expires_at <= datetime('now')`).run();
    return result.changes;
  }
}
