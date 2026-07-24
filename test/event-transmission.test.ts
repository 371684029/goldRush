import { describe, it, expect } from 'vitest';
import { buildEventGoldTransmission, formatTransmissionMarkdown } from '../src/utils/event-transmission.js';
import { buildReadingChecklist, formatReadingChecklistMarkdown } from '../src/utils/reading-checklist.js';

describe('event-transmission', () => {
  it('美元大涨 + 高 TIPS → 利空传导 actionable', () => {
    const t = buildEventGoldTransmission({
      marketData: {
        dollarIndex: { value: { change: 0.6 } },
        usTreasury: { tips: { value: 2.3 } },
      } as never,
      sentiment: { geopoliticalRisk: '中性', vix: 'VIX 16' },
    });
    expect(t.actionable).toBe(true);
    expect(t.legs.find(l => l.channel === 'dollar')?.bias).toBe('headwind');
    expect(t.legs.find(l => l.channel === 'rates')?.bias).toBe('headwind');
    expect(formatTransmissionMarkdown(t)).toContain('事件→黄金传导');
  });

  it('无显著通道 → 热点可忽略', () => {
    const t = buildEventGoldTransmission({
      marketData: {
        dollarIndex: { value: { change: 0.05 } },
        usTreasury: { tips: { value: 1.6 } },
      } as never,
      sentiment: { geopoliticalRisk: '一般', vix: 'VIX 15' },
    });
    expect(t.actionable).toBe(false);
    expect(t.headline).toMatch(/可忽略|不清/);
  });

  it('高地缘 + 高 VIX 与美元利空打架 → 提示冲突', () => {
    const t = buildEventGoldTransmission({
      marketData: {
        dollarIndex: { value: { change: 0.5 } },
        usTreasury: { tips: { value: 1.5 } },
      } as never,
      sentiment: { geopoliticalRisk: '地缘冲突升级、战争风险升高', vix: 'VIX 28' },
    });
    expect(t.actionable).toBe(true);
    expect(t.headline).toMatch(/打架|冲突|互/);
  });
});

describe('reading-checklist', () => {
  it('按序输出 5 步且门禁红档置顶提示', () => {
    const c = buildReadingChecklist({
      dataGate: { actionable: false, tier: 'red' },
      position: { targetPct: 35, label: '偏轻', emoji: '🟠' },
      reliability: {
        score: 40,
        label: '数据不可操作',
        scoreBand: { low: 28, high: 52, center: 40 },
        tldr: { line1: '', line2: '', line3: '' },
      },
      dayDelta: { skipFineRead: true, headline: '与昨日持平', scoreDelta: 0, positionDelta: 0 },
      dual: { llmScore: 55, quantScore: 54, delta: 1, actionPolicy: 'both' },
      transmission: { actionable: false, headline: '热点可忽略' },
      reflectOneLiner: '近14日命中55%',
    });
    expect(c.items).toHaveLength(5);
    expect(c.items[0].value).toMatch(/门禁/);
    expect(c.items[1].skippable).toBe(true);
    expect(c.items[4].skippable).toBe(true);
    expect(formatReadingChecklistMarkdown(c)).toContain('今日必看');
  });
});
