// 基金净值 CRUD
import Database from 'better-sqlite3';
import type { FundNavRecord } from '../types/fund.js';

export class FundNavRepo {
  constructor(private db: Database.Database) {}

  /** 插入或更新基金净值 */
  upsert(record: Omit<FundNavRecord, 'createdAt'>): void {
    this.db.prepare(`
      INSERT INTO fund_nav (date, code, nav, acc_nav, change_pct, premium)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, code) DO UPDATE SET
        nav = excluded.nav,
        acc_nav = excluded.acc_nav,
        change_pct = excluded.change_pct,
        premium = excluded.premium
    `).run(record.date, record.code, record.nav, record.accNav, record.changePct, record.premium);
  }

  /** 批量插入 */
  upsertBatch(records: Omit<FundNavRecord, 'createdAt'>[]): void {
    const tx = this.db.transaction((items: typeof records) => {
      for (const r of items) this.upsert(r);
    });
    tx(records);
  }

  /** 获取各跟踪基金最近一条净值（date 降序） */
  getLatestPerCode(days = 90): FundNavRecord[] {
    const rows = this.db.prepare(`
      SELECT f.* FROM fund_nav f
      INNER JOIN (
        SELECT code, MAX(date) AS max_date FROM fund_nav
        WHERE date >= date('now', '-' || ? || ' days')
        GROUP BY code
      ) latest ON f.code = latest.code AND f.date = latest.max_date
      ORDER BY f.code ASC
    `).all(days) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  /** 获取指定基金最近 N 天净值 */
  getRecent(code: string, days: number): FundNavRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM fund_nav
      WHERE code = ? AND date >= date('now', '-' || ? || ' days')
      ORDER BY date ASC
    `).all(code, days) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  /** 获取指定日期所有基金净值 */
  getByDate(date: string): FundNavRecord[] {
    const rows = this.db.prepare(`SELECT * FROM fund_nav WHERE date = ?`).all(date) as Record<string, unknown>[];
    return rows.map(mapRow);
  }
}

function mapRow(row: Record<string, unknown>): FundNavRecord {
  return {
    date: row.date as string,
    code: row.code as string,
    nav: row.nav as number,
    accNav: row.acc_nav as number,
    changePct: row.change_pct as number,
    premium: row.premium as number | null,
    createdAt: row.created_at as string,
  };
}
