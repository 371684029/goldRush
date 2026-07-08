import { describe, it, expect } from 'vitest';
import { spotProxyDeviationWarning, priceSeriesProxyNote } from '../src/utils/price-semantics';

describe('price-semantics', () => {
  it('代理说明包含 GC=F', () => {
    expect(priceSeriesProxyNote()).toContain('GC=F');
  });

  it('偏差低于阈值不告警', () => {
    expect(spotProxyDeviationWarning(4100, 4090, 1.5)).toBeNull();
  });

  it('偏差超阈值生成告警', () => {
    const w = spotProxyDeviationWarning(4200, 4100, 1.5);
    expect(w).toContain('基差');
  });
});
