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

  it('双分分歧时优先给出具体仓位结论（不再空喊双体系不一致）', () => {
    const a = resolveOperationalAdvice({
      llmScore: 28,
      dataActionable: true,
      dualPolicy: 'hold_on_conflict',
      dualActionOverride: {
        headline: 'LLM 偏空28 / 量化 中性45：阶段判断不完全一致',
        action: '建议相对计划仓约 26%（极轻）；定投层为主（85%），波段仓轻仓或空仓',
      },
      position: {
        headline: 'LLM 偏空28 / 量化 中性45：阶段判断不完全一致',
        action: '建议相对计划仓约 26%（极轻）；定投层为主（85%），波段仓轻仓或空仓',
        emoji: '🔴',
        label: '极轻',
        tilt: 'reduce',
        targetPct: 26,
      },
    });
    expect(a?.source).toBe('dual_conflict');
    expect(a?.action).toContain('26%');
    expect(a?.headline).toBe('LLM 偏空28 / 量化 中性45：阶段判断不完全一致');
    expect(a?.headline).not.toMatch(/双体系不一致/);
    expect(a?.label).toContain('极轻');
  });

  it('双分分歧且无仓位时回落 override', () => {
    const a = resolveOperationalAdvice({
      llmScore: 70,
      dataActionable: true,
      dualPolicy: 'hold_on_conflict',
      dualActionOverride: { headline: '方向对立：LLM 偏多 vs 量化 偏空', action: '维持定投' },
    });
    expect(a?.source).toBe('dual_conflict');
    expect(a?.headline).toMatch(/对立|LLM/);
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
