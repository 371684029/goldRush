import { describe, it, expect } from 'vitest';
import {
  recommendPosition,
  formatPositionMarkdown,
  volToScalar,
  drawdownToScalar,
  smoothTargetPct,
  computePriceRiskMetrics,
  POSITION_MAX_DAILY_DELTA,
} from '../src/utils/position-recommend';

describe('recommendPosition', () => {
  it('中性分落在标配附近', () => {
    const p = recommendPosition({ llmScore: 50 });
    expect(p.targetPct).toBeGreaterThanOrEqual(45);
    expect(p.targetPct).toBeLessThanOrEqual(60);
    expect(p.label).toMatch(/标配|偏轻/);
    expect(p.coreSharePct + p.satelliteSharePct).toBe(100);
    expect(p.risk).toBeDefined();
  });

  it('红档门禁上限 35%', () => {
    const p = recommendPosition({ llmScore: 80, dataActionable: false });
    expect(p.targetPct).toBeLessThanOrEqual(35);
    expect(p.constraints.some(c => c.includes('门禁'))).toBe(true);
  });

  it('双分冲突不超过 50%，headline 含 LLM/量化分数', () => {
    const p = recommendPosition({
      llmScore: 28,
      quantScore: 45,
      dualPolicy: 'hold_on_conflict',
      dataActionable: true,
    });
    expect(p.targetPct).toBeLessThanOrEqual(50);
    expect(p.constraints.some(c => c.includes('双分') || c.includes('上限'))).toBe(true);
    expect(p.headline).toMatch(/LLM|量化/);
    expect(p.headline).not.toMatch(/双体系不一致/);
    expect(p.action).toMatch(/\d+%/);
  });

  it('高分可偏积极（无额外风险时）', () => {
    // 低波动序列
    const closes = Array.from({ length: 40 }, (_, i) => 2000 + i * 0.5);
    const p = recommendPosition({
      llmScore: 78,
      quantScore: 72,
      dataActionable: true,
      dualPolicy: 'both',
      flowScore: 70,
      longTermStance: 'overweight',
      closes,
    });
    expect(p.targetPct).toBeGreaterThanOrEqual(65);
  });

  it('高波动会压低目标仓', () => {
    // 剧烈上下跳
    const closes: number[] = [2000];
    for (let i = 0; i < 30; i++) {
      closes.push(closes[closes.length - 1] * (i % 2 === 0 ? 1.04 : 0.96));
    }
    const calm = recommendPosition({
      llmScore: 70,
      quantScore: 70,
      dataActionable: true,
      closes: Array.from({ length: 40 }, (_, i) => 2000 + i * 0.2),
    });
    const wild = recommendPosition({
      llmScore: 70,
      quantScore: 70,
      dataActionable: true,
      closes,
    });
    expect(wild.targetPct).toBeLessThanOrEqual(calm.targetPct);
    expect(wild.risk.volScalar).toBeLessThan(1);
    expect(wild.risk.badges.some(b => /波动/.test(b))).toBe(true);
  });

  it('日平滑限制单日跳动', () => {
    const p = recommendPosition({
      llmScore: 90,
      quantScore: 90,
      dataActionable: true,
      previousTargetPct: 40,
      maxDailyDelta: 10,
    });
    expect(p.targetPct).toBeLessThanOrEqual(50);
    expect(p.constraints.some(c => c.includes('日平滑'))).toBe(true);
    expect(p.risk.badges).toContain('日调受限');
  });

  it('Markdown 含风险字段', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 2000 + (i % 3) * 5);
    const p = recommendPosition({
      llmScore: 55,
      quantScore: 50,
      closes,
      previousTargetPct: 50,
    });
    const md = formatPositionMarkdown(p);
    expect(md).toContain('## 📦 当前仓位推荐');
    expect(md).toContain(`${p.targetPct}%`);
    expect(md).toContain('风险');
    expect(md).toContain('不构成投资建议');
  });
});

describe('risk helpers', () => {
  it('volToScalar 阶梯', () => {
    expect(volToScalar(10)).toBe(1);
    expect(volToScalar(16)).toBe(0.92);
    expect(volToScalar(20)).toBe(0.85);
    expect(volToScalar(30)).toBe(0.75);
    expect(volToScalar(null)).toBe(1);
  });

  it('drawdownToScalar 阶梯', () => {
    expect(drawdownToScalar(2)).toBe(1);
    expect(drawdownToScalar(7)).toBe(0.95);
    expect(drawdownToScalar(12)).toBe(0.88);
    expect(drawdownToScalar(20)).toBe(0.8);
  });

  it('smoothTargetPct 限幅', () => {
    const s = smoothTargetPct(80, 40, POSITION_MAX_DAILY_DELTA);
    expect(s.target).toBe(50);
    expect(s.applied).toBe(true);
    expect(s.delta).toBe(10);
  });

  it('computePriceRiskMetrics 有输出', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 2000 * (1 + Math.sin(i / 3) * 0.02));
    const m = computePriceRiskMetrics(closes);
    expect(m.vol20AnnPct).not.toBeNull();
    expect(m.drawdown60Pct).not.toBeNull();
    expect(m.drawdown60Pct!).toBeGreaterThanOrEqual(0);
  });
});
