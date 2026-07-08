import { describe, it, expect } from 'vitest';
import { countConsecutiveDirectionDays } from '../src/utils/consecutive-direction';

describe('countConsecutiveDirectionDays', () => {
  it('仅今日时返回 1', () => {
    expect(countConsecutiveDirectionDays([], 'bearish', '2026-07-08')).toBe(1);
  });

  it('连续同向累加', () => {
    const history = [
      { date: '2026-07-07', direction: 'bearish' as const },
      { date: '2026-07-06', direction: 'bearish' as const },
      { date: '2026-07-05', direction: 'neutral' as const },
    ];
    expect(countConsecutiveDirectionDays(history, 'bearish', '2026-07-08')).toBe(3);
  });

  it('方向中断则停止', () => {
    const history = [
      { date: '2026-07-07', direction: 'bullish' as const },
      { date: '2026-07-06', direction: 'bearish' as const },
    ];
    expect(countConsecutiveDirectionDays(history, 'bearish', '2026-07-08')).toBe(1);
  });
});
