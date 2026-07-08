import { describe, it, expect } from 'vitest';
import {
  blendTechnicalScore,
  computeTechnicalRuleScore,
} from '../src/utils/technical-rule-score';

describe('computeTechnicalRuleScore', () => {
  it('MACD 死叉 + 价低于 MA20 时偏空', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 - i * 0.5);
    const score = computeTechnicalRuleScore({ closes, weeklyCloses: closes.slice(-8) });
    expect(score).toBeLessThan(50);
  });

  it('MACD 金叉 + 价高于 MA20 时偏多', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 0.5);
    const score = computeTechnicalRuleScore({ closes, weeklyCloses: closes.slice(-8) });
    expect(score).toBeGreaterThan(50);
  });
});

describe('blendTechnicalScore', () => {
  it('60% 规则 + 40% LLM', () => {
    expect(blendTechnicalScore(40, 70)).toBe(Math.round(40 * 0.6 + 70 * 0.4));
  });
});
