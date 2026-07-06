import { describe, it, expect } from 'vitest';
import { buildLongTermOutlook } from '../src/utils/long-term-outlook';
import type { LongTermOutlookInput } from '../src/utils/long-term-outlook';

function baseInput(overrides: Partial<LongTermOutlookInput> = {}): LongTermOutlookInput {
  return {
    technical: {
      score: 65, direction: 'bullish', keyPoints: [], counterPoints: [], summary: '趋势偏多', sources: [],
      shortTerm: { timeframe: 'daily', support: 0, resistance: 0, trend: '', indicators: { ma5: '', ma20: '', macd: '', rsi: '' }, keySignal: '' },
      midTerm: { timeframe: 'weekly', support: 0, resistance: 0, trend: '', indicators: { ma20w: '', ma60w: '', macd: '', rsi: '' }, keySignal: '' },
    },
    fundamental: {
      score: 70, direction: 'bullish', keyPoints: [], counterPoints: [], summary: '', sources: [],
      dollarIndexEffect: '美元走弱利好', interestRateEffect: '', inflationEffect: '', fedStance: '偏鸽',
    },
    sentiment: {
      score: 72, direction: 'bullish', keyPoints: [], counterPoints: [], summary: '', sources: [],
      centralBanks: '央行持续购金', cftcPosition: '', vix: '', geopoliticalRisk: '', etfFlows: '净流入',
    },
    rebuttal: {
      bullScore: 60, bearScore: 45, rebuttalStrength: 'moderate', bearPoints: [], bullVulnerabilities: [],
      netEffect: 'unchanged', tailRisks: [],
    },
    overallScore: 68,
    overallDirection: 'bullish',
    macroRegime: {
      tag: 'dovish_pivot_watch',
      label: '降息预期升温',
      description: 'test',
      signals: [],
    },
    ...overrides,
  };
}

describe('buildLongTermOutlook', () => {
  it('输出 1/3/5 年三个期限', () => {
    const o = buildLongTermOutlook(baseInput());
    expect(o.horizons).toHaveLength(3);
    expect(o.horizons.map(h => h.years)).toEqual([1, 3, 5]);
  });

  it('强看空反驳会拉低近端偏多强度', () => {
    const weak = buildLongTermOutlook(baseInput({
      rebuttal: {
        bullScore: 40, bearScore: 75, rebuttalStrength: 'strong', bearPoints: [{ point: '利率更高', evidence: '', probability: 30, impact: '' }],
        bullVulnerabilities: [], netEffect: 'significant_downgrade', tailRisks: [],
      },
    }));
    const strong = buildLongTermOutlook(baseInput());
    expect(weak.horizons[0].biasScore).toBeLessThan(strong.horizons[0].biasScore);
  });

  it('含免责声明', () => {
    expect(buildLongTermOutlook(baseInput()).disclaimer).toContain('非');
  });
});
