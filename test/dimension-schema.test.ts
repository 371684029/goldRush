import { describe, it, expect } from 'vitest';
import {
  parseFundamentalAnalysis,
  parseRebuttalRaw,
  parseSentimentAnalysis,
  parseTechnicalAnalysis,
} from '../src/schemas/dimension';

describe('dimension schema', () => {
  it('技术面：非法 score 钳制到 0-100，缺字段有兜底', () => {
    const t = parseTechnicalAnalysis({
      score: 150,
      direction: 'maybe',
      keyPoints: ['a'],
      // counterPoints 缺失
      summary: 'ok',
      sources: [],
      shortTerm: { support: 4000, resistance: 4200, trend: '震荡', indicators: {}, keySignal: '无' },
      midTerm: { support: 3900, resistance: 4500, trend: '空', indicators: {}, keySignal: '无' },
    });
    expect(t.score).toBe(100);
    expect(t.direction).toBe('neutral');
    expect(t.counterPoints).toEqual([]);
    expect(t.shortTerm.timeframe).toBe('daily');
    expect(t.midTerm.timeframe).toBe('weekly');
  });

  it('基本面 / 情绪面：数字字符串 score 可解析', () => {
    const f = parseFundamentalAnalysis({
      score: '48',
      direction: 'bearish',
      keyPoints: [],
      counterPoints: [],
      summary: 's',
      sources: [],
      dollarIndexEffect: '压制',
      interestRateEffect: '压制',
      inflationEffect: '中性',
      fedStance: '鹰派',
    });
    expect(f.score).toBe(48);
    expect(f.direction).toBe('bearish');

    const s = parseSentimentAnalysis({
      score: 48.6,
      direction: 'neutral',
      keyPoints: [],
      counterPoints: [],
      summary: 's',
      sources: [],
      centralBanks: '购金',
      cftcPosition: '净多',
      vix: '低',
      geopoliticalRisk: '中',
      etfFlows: '流出',
    });
    expect(s.score).toBe(49);
  });

  it('反驳：缺数组时降级为空，hedge→mitigation', () => {
    const r = parseRebuttalRaw({
      bearScore: 72,
      rebuttalStrength: 'strong',
      tailRisks: [{ risk: 'x', probability: 10, impact: 'y', hedge: '对冲' }],
    });
    expect(r.bearPoints).toEqual([]);
    expect(r.bullVulnerabilities).toEqual([]);
    expect(r.tailRisks[0].mitigation).toBe('对冲');
    expect(r.rebuttalStrength).toBe('strong');
  });
});
