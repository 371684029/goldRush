import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SearchCacheRepo } from '../src/db/search-cache';

describe('SearchCacheRepo', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE search_cache (
        query_hash TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        engine TEXT NOT NULL,
        results TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('set 后 get 命中', () => {
    const repo = new SearchCacheRepo(db, 5);
    repo.set('gold price', 'tavily', '[{"title":"x"}]');
    expect(repo.get('gold price', 'tavily')).toBe('[{"title":"x"}]');
  });

  it('不同 query 不命中', () => {
    const repo = new SearchCacheRepo(db, 5);
    repo.set('gold price', 'tavily', '[]');
    expect(repo.get('silver price', 'tavily')).toBeNull();
  });
});
