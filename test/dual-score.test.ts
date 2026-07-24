import { describe, it, expect } from 'vitest';
import {
  evaluateDualScore,
  buildDualConflictOverride,
  DUAL_CONFLICT_THRESHOLD,
  predictDirectionFromScore,
} from '../src/utils/dual-score';

describe('evaluateDualScore', () => {
  it('双分接近且同向 → aligned / both', () => {
    const v = evaluateDualScore(62, 58);
    expect(v.alignment).toBe('aligned');
    expect(v.actionPolicy).toBe('both');
    expect(v.actionOverride).toBeNull();
    expect(v.sameDirection).toBe(true);
  });

  it('偏差>15 → conflict / hold，文案可解释', () => {
    const v = evaluateDualScore(75, 40);
    expect(Math.abs(v.delta!)).toBeGreaterThan(DUAL_CONFLICT_THRESHOLD);
    expect(v.alignment).toBe('conflict');
    expect(v.actionPolicy).toBe('hold_on_conflict');
    expect(v.actionOverride?.headline).toMatch(/对立|LLM|量化/);
    expect(v.actionOverride?.action).toMatch(/定投|仓位/);
    expect(v.actionOverride?.headline).not.toMatch(/双体系不一致/);
  });

  it('无量化 → llm_only', () => {
    const v = evaluateDualScore(60, null);
    expect(v.alignment).toBe('quant_missing');
    expect(v.actionPolicy).toBe('llm_only');
  });

  it('弱一致性但双分对齐 → 不强制弃权覆盖', () => {
    const v = evaluateDualScore(55, 52, { consistencyWeak: true });
    expect(v.actionPolicy).toBe('both');
    expect(v.actionOverride).toBeNull();
    expect(v.banners.some(b => b.includes('四维度一致性弱'))).toBe(true);
  });

  it('弱一致性 + 温和同向偏差 → quant_preferred，非双体系', () => {
    // 30 与 40 均为偏空，|Δ|=10 → mild_gap 且同向
    const v = evaluateDualScore(30, 40, { consistencyWeak: true });
    expect(v.alignment).toBe('mild_gap');
    expect(v.sameDirection).toBe(true);
    expect(v.actionPolicy).toBe('quant_preferred');
    expect(v.actionOverride).toBeNull();
  });

  it('弱一致性 + 真冲突 → 仍 hold，但文案不说双体系不一致', () => {
    const v = evaluateDualScore(28, 45, { consistencyWeak: true });
    expect(v.actionPolicy).toBe('hold_on_conflict');
    expect(v.actionOverride?.headline).not.toMatch(/双体系不一致/);
    expect(v.actionOverride?.headline).toMatch(/LLM|量化/);
  });

  it('数据红档 → hold 且覆盖', () => {
    const v = evaluateDualScore(70, 65, { dataActionable: false });
    expect(v.actionOverride).not.toBeNull();
  });
});

describe('buildDualConflictOverride', () => {
  it('方向对立', () => {
    const o = buildDualConflictOverride({
      llmScore: 70,
      quantScore: 30,
      llmDirection: 'bullish',
      quantDirection: 'bearish',
      delta: 40,
      sameDirection: false,
    });
    expect(o.headline).toMatch(/对立/);
  });

  it('一方中性', () => {
    const o = buildDualConflictOverride({
      llmScore: 28,
      quantScore: 45,
      llmDirection: 'bearish',
      quantDirection: 'neutral',
      delta: -17,
      sameDirection: false,
    });
    expect(o.headline).toMatch(/不完全一致|偏空|中性/);
  });
});

describe('predictDirectionFromScore', () => {
  it('边界', () => {
    expect(predictDirectionFromScore(56)).toBe('up');
    expect(predictDirectionFromScore(44)).toBe('down');
    expect(predictDirectionFromScore(50)).toBeNull();
  });
});
