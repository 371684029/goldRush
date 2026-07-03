import { describe, it, expect } from 'vitest';
import { countLondonRowsInWindow } from '../src/utils/ensure-gold-history';
import type { GoldPricesRepo } from '../src/db/gold-prices';
import type { GoldPriceRecord } from '../src/types/market';

function mockRepo(records: GoldPriceRecord[]): GoldPricesRepo {
  return {
    getRange: (from: string, to: string) =>
      records.filter(r => r.date >= from && r.date <= to),
    getByDate: (date: string) => records.find(r => r.date === date),
  } as unknown as GoldPricesRepo;
}

function row(date: string, close: number): GoldPriceRecord {
  return {
    date,
    londonClose: close,
    londonHigh: null,
    londonLow: null,
    shanghaiClose: null,
    shanghaiHigh: null,
    shanghaiLow: null,
    etfNav: null,
    etfChange: null,
    dollarIndex: null,
    us10yYield: null,
    tipsYield: null,
    createdAt: '',
  };
}

describe('countLondonRowsInWindow', () => {
  it('统计有效 london_close 行', () => {
    const records = [
      row('2026-05-01', 2600),
      row('2026-05-02', 2610),
      row('2026-05-03', null as unknown as number),
    ];
    records[2].londonClose = null;
    expect(countLondonRowsInWindow(mockRepo(records), 60, '2026-05-03')).toBe(2);
  });
});
