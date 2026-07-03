import { describe, it, expect } from 'vitest';
import { parseYahooChartResponse, yahooTimestampToDate } from '../src/data/yahoo-gold-history';

describe('yahooTimestampToDate', () => {
  it('按纽约时区格式化日期', () => {
    // 2026-06-02 16:00 UTC ≈ 2026-06-02 NY
    const d = yahooTimestampToDate(1748880000);
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('parseYahooChartResponse', () => {
  it('解析 timestamp 与 close', () => {
    const ts = 1746057600; // fixed unix
    const date = yahooTimestampToDate(ts);
    const rows = parseYahooChartResponse({
      chart: {
        result: [{
          timestamp: [ts],
          indicators: { quote: [{ close: [2650.5] }] },
        }],
      },
    }, date, date);
    expect(rows).toHaveLength(1);
    expect(rows[0].londonClose).toBe(2650.5);
  });
});
