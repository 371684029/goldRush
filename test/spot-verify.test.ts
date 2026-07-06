import { describe, it, expect } from 'vitest';
import {
  extractLondonPricesFromSearch,
  mergeValidationSources,
} from '../src/utils/spot-verify';

describe('extractLondonPricesFromSearch', () => {
  it('从 snippet 提取美元金价', () => {
    const sources = extractLondonPricesFromSearch([{
      title: 'Gold Price Today',
      url: 'https://kitco.com',
      snippet: 'Gold spot price is $2,650.30 per ounce today.',
      engine: 'tavily',
      sourceGrade: 'B',
    }]);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0].value).toBeCloseTo(2650.3, 0);
  });
});

describe('mergeValidationSources', () => {
  it('去重相近价格', () => {
    const merged = mergeValidationSources(
      [{ value: 2650, source: 'a', grade: 'B', timestamp: 't' }],
      [{ value: 2650.5, source: 'b', grade: 'B', timestamp: 't' }],
    );
    expect(merged).toHaveLength(1);
  });
});
