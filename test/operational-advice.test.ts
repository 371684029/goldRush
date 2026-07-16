import { describe, it, expect } from 'vitest';
import { resolveOperationalAdvice, scoreToAdvice } from '../src/utils/plain-advice.js';

describe('resolveOperationalAdvice', () => {
  it('门禁红档优先于双分与仓位', () => {
    const a = resolveOperationalAdvice({
      llmScore: 80,
      dataActionable: false,
      dualPolicy: 'hold_on_conflict',
      dualActionOverride: { headline: '冲突', action: '弃权' },
      position: {
        headline: '积极',
        action: '加仓',
        emoji: '🔵',
        label: '积极',
        tilt: 'add',
        targetPct: 85,
      },
    });
    expect(a?.source).toBe('data_gate');
    expect(a?.label).toContain('不可用');
  });

  it('双分冲突优先于仓位与分数', () => {
    const a = resolveOperationalAdvice({
      llmScore: 70,
      dataActionable: true,
      dualPolicy: 'hold_on_conflict',
      dualActionOverride: { headline: '双体系不一致', action: '维持定投' },
      position: {
        headline: '偏积极',
        action: '可加',
        emoji: '🟢',
        label: '偏积极',
        tilt: 'add',
        targetPct: 70,
      },
    });
    expect(a?.source).toBe('dual_conflict');
    expect(a?.action).toContain('定投');
  });

  it('正常日优先仓位文案', () => {
    const a = resolveOperationalAdvice({
      llmScore: 60,
      dataActionable: true,
      dualPolicy: 'show_both',
      position: {
        headline: '标配附近',
        action: '建议相对计划仓约 55%',
        emoji: '🟡',
        label: '标配',
        tilt: 'hold',
        targetPct: 55,
      },
    });
    expect(a?.source).toBe('position');
    expect(a?.action).toContain('55%');
  });

  it('无仓位时回落分数映射', () => {
    const a = resolveOperationalAdvice({
      llmScore: 40,
      dataActionable: true,
    });
    expect(a?.source).toBe('score');
    expect(a?.label).toBe(scoreToAdvice(40).label);
  });

  it('无分数返回 null', () => {
    expect(resolveOperationalAdvice({})).toBeNull();
  });
});
