import { describe, it, expect } from 'vitest';
import { percentile, rollingPercentile } from '../src/indicators/percentile';

describe('percentile', () => {
  it('空历史返回 50', () => {
    expect(percentile(100, [])).toBe(50);
  });

  it('当前值高于全部历史返回 100', () => {
    expect(percentile(10, [1, 2, 3])).toBe(100);
  });
});

describe('rollingPercentile — 窗口应包含当前值', () => {
  it('窗口含当前值时百分位正确', () => {
    // data=[1,2,3,4,5], window=3
    // i=2 窗口 [1,2,3]，当前值 3 → (below=2 + equal/2=0.5)/3*100 = 83.33...
    const result = rollingPercentile([1, 2, 3, 4, 5], 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(83.333, 2);
    // i=4 窗口 [3,4,5]，当前值 5 → 最高，应为 83.33（含自身的中点法）
    expect(result[4]).toBeCloseTo(83.333, 2);
  });
});
