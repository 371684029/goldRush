// 金价快照 CRUD
import Database from 'better-sqlite3';
import type { GoldPriceRecord } from '../types/market.js';
import { addCalendarDays, todayDate } from '../utils/time.js';

export class GoldPricesRepo {
  constructor(private db: Database.Database) {}

  /** 插入或更新当日金价快照 */
  upsert(record: Omit<GoldPriceRecord, 'createdAt'>): void {
    this.db.prepare(`
      INSERT INTO gold_prices (date, london_close, london_high, london_low,
        shanghai_close, shanghai_high, shanghai_low, etf_nav, etf_change,
        dollar_index, us10y_yield, tips_yield)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        london_close = excluded.london_close,
        london_high = excluded.london_high,
        london_low = excluded.london_low,
        shanghai_close = excluded.shanghai_close,
        shanghai_high = excluded.shanghai_high,
        shanghai_low = excluded.shanghai_low,
        etf_nav = excluded.etf_nav,
        etf_change = excluded.etf_change,
        dollar_index = excluded.dollar_index,
        us10y_yield = excluded.us10y_yield,
        tips_yield = excluded.tips_yield
    `).run(
      record.date, record.londonClose, record.londonHigh, record.londonLow,
      record.shanghaiClose, record.shanghaiHigh, record.shanghaiLow,
      record.etfNav, record.etfChange, record.dollarIndex,
      record.us10yYield, record.tipsYield
    );
  }

  /** 历史回填：仅填充 NULL 字段，不覆盖已有实时采集数据 */
  upsertBackfill(record: Omit<GoldPriceRecord, 'createdAt'>): void {
    this.db.prepare(`
      INSERT INTO gold_prices (date, london_close, london_high, london_low,
        shanghai_close, shanghai_high, shanghai_low, etf_nav, etf_change,
        dollar_index, us10y_yield, tips_yield)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        london_close = COALESCE(gold_prices.london_close, excluded.london_close),
        london_high = COALESCE(gold_prices.london_high, excluded.london_high),
        london_low = COALESCE(gold_prices.london_low, excluded.london_low),
        shanghai_close = COALESCE(gold_prices.shanghai_close, excluded.shanghai_close),
        shanghai_high = COALESCE(gold_prices.shanghai_high, excluded.shanghai_high),
        shanghai_low = COALESCE(gold_prices.shanghai_low, excluded.shanghai_low),
        etf_nav = COALESCE(gold_prices.etf_nav, excluded.etf_nav),
        etf_change = COALESCE(gold_prices.etf_change, excluded.etf_change),
        dollar_index = COALESCE(gold_prices.dollar_index, excluded.dollar_index),
        us10y_yield = COALESCE(gold_prices.us10y_yield, excluded.us10y_yield),
        tips_yield = COALESCE(gold_prices.tips_yield, excluded.tips_yield)
    `).run(
      record.date, record.londonClose, record.londonHigh, record.londonLow,
      record.shanghaiClose, record.shanghaiHigh, record.shanghaiLow,
      record.etfNav, record.etfChange, record.dollarIndex,
      record.us10yYield, record.tipsYield,
    );
  }

  /** 获取指定日期金价 */
  getByDate(date: string): GoldPriceRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM gold_prices WHERE date = ?`).get(date) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : undefined;
  }

  /** 获取最近 N 个日历日窗口内的金价（按上海日历截止日） */
  getRecent(days: number, asOf: string = todayDate()): GoldPriceRecord[] {
    const from = addCalendarDays(asOf, -(days - 1));
    return this.getRange(from, asOf);
  }

  /** 获取指定日期区间的金价 */
  getRange(from: string, to: string): GoldPriceRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM gold_prices
      WHERE date >= ? AND date <= ?
      ORDER BY date ASC
    `).all(from, to) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  /** 获取指定日期之后的金价（用于回测） */
  getAfter(date: string, limit: number = 30): GoldPriceRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM gold_prices
      WHERE date > ?
      ORDER BY date ASC
      LIMIT ?
    `).all(date, limit) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  /** 获取总记录数 */
  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM gold_prices`).get() as { cnt: number };
    return row.cnt;
  }
}

function mapRow(row: Record<string, unknown>): GoldPriceRecord {
  return {
    date: row.date as string,
    londonClose: row.london_close as number | null,
    londonHigh: row.london_high as number | null,
    londonLow: row.london_low as number | null,
    shanghaiClose: row.shanghai_close as number | null,
    shanghaiHigh: row.shanghai_high as number | null,
    shanghaiLow: row.shanghai_low as number | null,
    etfNav: row.etf_nav as number | null,
    etfChange: row.etf_change as number | null,
    dollarIndex: row.dollar_index as number | null,
    us10yYield: row.us10y_yield as number | null,
    tipsYield: row.tips_yield as number | null,
    createdAt: row.created_at as string,
  };
}
