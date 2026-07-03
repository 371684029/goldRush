import { describe, it, expect } from 'vitest';
import { parseMarketData } from '../src/schemas/market';

describe('parseMarketData', () => {
  it('过滤无效 altPrices 并规范化 sourceGrade', () => {
    const data = parseMarketData({
      timestamp: '2026-06-01T00:00:00Z',
      london: {
        price: { value: 2650, change: 0.5, source: 'Kitco', sourceGrade: 'B', verifiedAt: 't' },
        altPrices: [
          { value: 2652, change: 0, source: 'Reuters', sourceGrade: 'B', verifiedAt: 't' },
          { value: null },
        ],
      },
      shanghai: { price: { value: 580, change: 0, source: 'SGE', sourceGrade: 'A', verifiedAt: 't' } },
      etf: { nav: { value: 5.2, change: 0.1, source: 'x', sourceGrade: 'B', verifiedAt: 't' } },
      dollarIndex: { value: { value: 104, change: -0.2, source: 'x', sourceGrade: 'B', verifiedAt: 't' } },
      usTreasury: {
        yield10y: { value: 4.2, change: 0, source: 'x', sourceGrade: 'B', verifiedAt: 't' },
        tips: { value: 1.8, source: 'x', sourceGrade: 'B', verifiedAt: 't' },
      },
    });
    expect(data.london.altPrices).toHaveLength(1);
    expect(data.london.price.value).toBe(2650);
  });
});
