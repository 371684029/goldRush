import { describe, it, expect } from 'vitest';
import { buildLongTermOutlook } from '../src/utils/long-term-outlook';
import type { LongTermOutlookInput } from '../src/utils/long-term-outlook';
import type { GoldPriceRecord } from '../src/types/market';

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

describe('buildLongTermOutlook — 可靠性改造', () => {
  it('输出 1/3/5 年三个期限与配置档位', () => {
    const o = buildLongTermOutlook(baseInput());
    expect(o.horizons).toHaveLength(3);
    expect(o.horizons.map(h => h.years)).toEqual([1, 3, 5]);
    for (const h of o.horizons) {
      expect(h.allocationStance).toBeDefined();
    }
  });

  it('强看空反驳不再把 5 年打成极端偏低', () => {
    const o = buildLongTermOutlook(baseInput({
      overallScore: 25,
      overallDirection: 'bearish',
      technical: {
        ...baseInput().technical,
        score: 30,
        direction: 'bearish',
      },
      fundamental: {
        ...baseInput().fundamental,
        score: 35,
        direction: 'bearish',
      },
      sentiment: {
        ...baseInput().sentiment,
        score: 40,
        direction: 'bearish',
      },
      macroRegime: {
        tag: 'real_rate_headwind',
        label: '实际利率压制',
        description: 't',
        signals: [],
      },
      rebuttal: {
        bullScore: 30, bearScore: 80, rebuttalStrength: 'strong',
        bearPoints: [{ point: '利率更高', evidence: '', probability: 40, impact: '' }],
        bullVulnerabilities: [], netEffect: 'significant_downgrade', tailRisks: [],
      },
    }));
    const y5 = o.horizons.find(h => h.years === 5)!;
    // 旧公式可到 20 分 + 累计 -60%；新规则应温和许多
    expect(y5.biasScore).toBeGreaterThanOrEqual(30);
    expect(y5.returnBand).not.toMatch(/-6[0-9]/);
    expect(y5.returnBand).not.toMatch(/-5[0-9]/);
  });

  it('置信 low 时不展示点位式累计区间（除非仅有历史分位说明）', () => {
    const o = buildLongTermOutlook(baseInput({
      overallScore: 50,
      technical: { ...baseInput().technical, score: 50, direction: 'neutral' },
      fundamental: { ...baseInput().fundamental, score: 50, direction: 'neutral' },
      sentiment: { ...baseInput().sentiment, score: 50, direction: 'neutral' },
      macroRegime: { tag: 'range_bound', label: '震荡', description: '', signals: [] },
    }));
    const lowOnes = o.horizons.filter(h => h.confidence === 'low');
    for (const h of lowOnes) {
      const scary = /名义累计约\s*-?\d/.test(h.returnBand) && !h.returnBand.includes('历史');
      // low 应走「不展示点位」文案
      if (!h.returnBand.includes('历史')) {
        expect(h.returnBand).toMatch(/不展示|配置|纪律/);
      }
      expect(scary).toBe(false);
    }
  });

  it('previousOutlook 平滑限制单日跳变', () => {
    const prev = buildLongTermOutlook(baseInput({ overallScore: 70 }));
    const next = buildLongTermOutlook(baseInput({
      overallScore: 20,
      overallDirection: 'bearish',
      technical: { ...baseInput().technical, score: 25, direction: 'bearish' },
      fundamental: { ...baseInput().fundamental, score: 30, direction: 'bearish' },
      sentiment: { ...baseInput().sentiment, score: 30, direction: 'bearish' },
      macroRegime: { tag: 'real_rate_headwind', label: '压制', description: '', signals: [] },
      previousOutlook: prev,
    }));
    const p1 = prev.horizons[0].biasScore;
    const n1 = next.horizons[0].biasScore;
    expect(Math.abs(n1 - p1)).toBeLessThanOrEqual(12);
  });

  it('含免责声明', () => {
    expect(buildLongTermOutlook(baseInput()).disclaimer).toMatch(/非精确|非承诺|配置/);
  });

  it('有足够历史时可附无条件分位', () => {
    const prices: GoldPriceRecord[] = [];
    for (let i = 0; i < 800; i++) {
      prices.push({
        date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
        londonClose: 1800 + i * 0.5 + Math.sin(i / 30) * 20,
        londonHigh: null, londonLow: null, shanghaiClose: null, shanghaiHigh: null, shanghaiLow: null,
        etfNav: null, etfChange: null, dollarIndex: null, us10yYield: null, tipsYield: null, createdAt: '',
      });
    }
    const o = buildLongTermOutlook(baseInput({ priceHistory: prices }));
    // 至少某一期限可能带历史字样（取决于置信）
    expect(o.horizons.length).toBe(3);
  });
});
