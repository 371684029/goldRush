import { describe, it, expect } from 'vitest';
import {
  classifyMissReasons,
  buildWeeklyReflect,
  formatWeeklyReflectMarkdown,
  formatReflectPromptContext,
} from '../src/utils/weekly-reflect.js';
import type { PredictionRecentRow } from '../src/utils/prediction-track.js';

function row(partial: Partial<PredictionRecentRow> & Pick<PredictionRecentRow, 'date' | 'llmScore' | 'pred' | 'status'>): PredictionRecentRow {
  return {
    quantScore: null,
    direction: 'neutral',
    actual5dPct: null,
    hit: null,
    alignPct: null,
    bucketAvgReturn: null,
    vsBucketPct: null,
    quantPred: null,
    quantHit: null,
    quantStatus: null,
    ...partial,
  };
}

describe('weekly-reflect', () => {
  it('classifyMissReasons：虚假看多 + 过自信', () => {
    const reasons = classifyMissReasons(row({
      date: '2026-07-01',
      llmScore: 78,
      pred: 'up',
      status: 'miss',
      actual5dPct: -2.5,
      alignPct: -2.5,
      hit: false,
    }));
    expect(reasons).toContain('false_bull');
    expect(reasons).toContain('overconfident');
    expect(reasons).toContain('large_surprise');
  });

  it('classifyMissReasons：LLM 错量化对 → quant_saved', () => {
    const reasons = classifyMissReasons(row({
      date: '2026-07-02',
      llmScore: 60,
      quantScore: 40,
      pred: 'up',
      quantPred: 'down',
      status: 'miss',
      actual5dPct: -1.2,
      hit: false,
      quantHit: true,
      quantStatus: 'hit',
    }));
    expect(reasons).toContain('false_bull');
    expect(reasons).toContain('dual_split');
    expect(reasons).toContain('quant_saved');
  });

  it('buildWeeklyReflect 产出教训与 MD', () => {
    const outcomes: PredictionRecentRow[] = [
      row({
        date: '2026-07-10', llmScore: 70, pred: 'up', status: 'miss',
        actual5dPct: -1.5, hit: false, alignPct: -1.5,
      }),
      row({
        date: '2026-07-11', llmScore: 72, pred: 'up', status: 'miss',
        actual5dPct: -2.0, hit: false, alignPct: -2.0,
      }),
      row({
        date: '2026-07-12', llmScore: 30, pred: 'down', status: 'hit',
        actual5dPct: -1.0, hit: true, alignPct: 1.0,
      }),
      row({
        date: '2026-07-13', llmScore: 55, pred: 'flat', status: 'flat',
        actual5dPct: 0.05, hit: null,
      }),
    ];
    const reflect = buildWeeklyReflect({
      outcomes,
      days: 14,
      asOf: '2026-07-14',
      previous: {
        lessons: ['虚假看多偏多：测试'],
        watchNextWeek: [],
        reasonCounts: { false_bull: 2 },
        headline: 'prev',
      },
    });
    expect(reflect.totals.misses).toBe(2);
    expect(reflect.totals.hits).toBe(1);
    expect(reflect.reasonCounts.false_bull).toBeGreaterThanOrEqual(2);
    expect(reflect.lessons.some(l => /虚假看多/.test(l))).toBe(true);
    expect(reflect.recurringThemes.some(t => /虚假看多/.test(t))).toBe(true);
    const md = formatWeeklyReflectMarkdown(reflect);
    expect(md).toContain('预测错因反思');
    expect(md).toContain('阅读教训');
    const ctx = formatReflectPromptContext(reflect);
    expect(ctx).toContain('上周预测错因反思');
  });

  it('无样本时给出友好 headline', () => {
    const r = buildWeeklyReflect({ outcomes: [], days: 14, asOf: '2026-07-14' });
    expect(r.headline).toMatch(/暂无/);
    expect(formatReflectPromptContext(null)).toMatch(/无上周/);
  });
});
