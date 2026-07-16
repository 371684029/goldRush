import { describe, it, expect } from 'vitest';
import { recommendPosition, formatPositionMarkdown } from '../src/utils/position-recommend';

describe('recommendPosition', () => {
  it('中性分落在标配附近', () => {
    const p = recommendPosition({ llmScore: 50 });
    expect(p.targetPct).toBeGreaterThanOrEqual(45);
    expect(p.targetPct).toBeLessThanOrEqual(60);
    expect(p.label).toMatch(/标配|偏轻/);
    expect(p.coreSharePct + p.satelliteSharePct).toBe(100);
  });

  it('红档门禁上限 35%', () => {
    const p = recommendPosition({ llmScore: 80, dataActionable: false });
    expect(p.targetPct).toBeLessThanOrEqual(35);
    expect(p.constraints.some(c => c.includes('门禁'))).toBe(true);
  });

  it('双分冲突不超过 50%', () => {
    const p = recommendPosition({
      llmScore: 75,
      quantScore: 40,
      dualPolicy: 'hold_on_conflict',
      dataActionable: true,
    });
    expect(p.targetPct).toBeLessThanOrEqual(50);
    expect(p.constraints.some(c => c.includes('冲突'))).toBe(true);
  });

  it('高分可偏积极', () => {
    const p = recommendPosition({
      llmScore: 78,
      quantScore: 72,
      dataActionable: true,
      dualPolicy: 'both',
      flowScore: 70,
      longTermStance: 'overweight',
    });
    expect(p.targetPct).toBeGreaterThanOrEqual(70);
    expect(p.tilt).toBe('add');
  });

  it('Markdown 含关键字段', () => {
    const p = recommendPosition({ llmScore: 55, quantScore: 50 });
    const md = formatPositionMarkdown(p);
    expect(md).toContain('## 📦 当前仓位推荐');
    expect(md).toContain(`${p.targetPct}%`);
    expect(md).toContain('不构成投资建议');
  });
});
