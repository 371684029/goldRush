// 人话翻译 + 信号一致性 + 统一操作建议出口 — CLI / MD / Web 共用口径

import type { Direction } from '../types/analysis.js';

/** 评分 → 人话操作建议 */
export interface PlainAdvice {
  label: string;
  emoji: string;
  headline: string;
  action: string;
}

/** 操作建议来源（优先级见 resolveOperationalAdvice） */
export type AdviceSource = 'data_gate' | 'dual_conflict' | 'position' | 'score';

export interface OperationalAdvice extends PlainAdvice {
  /** 决策来源（便于调试/展示） */
  source: AdviceSource;
  /** Web 色板（可选） */
  color: string;
  bg: string;
}

const ADVICE_TABLE: PlainAdvice[] = [
  { label: '强烈偏空', emoji: '🔴', headline: '下行风险大于反弹空间', action: '暂停定投，等待评分回升至 45 以上' },
  { label: '偏空', emoji: '🟠', headline: '需防回调', action: '放慢定投节奏，不加仓' },
  { label: '中性', emoji: '🟡', headline: '震荡整理，方向未明', action: '维持基础定投，按日历执行、少择时' },
  { label: '偏多', emoji: '🟢', headline: '短期动能偏强', action: '维持定投；急跌可小幅加码，高位不追' },
  { label: '强烈偏多', emoji: '🔵', headline: '多头趋势明确', action: '可适度加码，但高位不追、设好止盈' },
];

const COLORS: Record<string, { color: string; bg: string }> = {
  red: { color: '#ef4444', bg: '#ef444418' },
  orange: { color: '#f97316', bg: '#f9731618' },
  yellow: { color: '#f59e0b', bg: '#f59e0b18' },
  green: { color: '#22c55e', bg: '#22c55e18' },
  blue: { color: '#3b82f6', bg: '#3b82f618' },
  gray: { color: '#94a3b8', bg: '#33415544' },
};

export function scoreToAdvice(score: number): PlainAdvice {
  if (score <= 30) return ADVICE_TABLE[0];
  if (score <= 45) return ADVICE_TABLE[1];
  if (score <= 55) return ADVICE_TABLE[2];
  if (score <= 75) return ADVICE_TABLE[3];
  return ADVICE_TABLE[4];
}

function withPalette(base: PlainAdvice, palette: keyof typeof COLORS, source: AdviceSource): OperationalAdvice {
  const c = COLORS[palette];
  return { ...base, source, color: c.color, bg: c.bg };
}

function paletteForScore(score: number): keyof typeof COLORS {
  if (score <= 30) return 'red';
  if (score <= 45) return 'orange';
  if (score <= 55) return 'yellow';
  if (score <= 75) return 'green';
  return 'blue';
}

export interface ResolveOperationalAdviceInput {
  llmScore?: number | null;
  direction?: Direction | null;
  /** 数据门禁是否允许操作；false = 最高优先弃权 */
  dataActionable?: boolean | null;
  /** 双分 actionOverride（冲突时） */
  dualActionOverride?: { headline: string; action: string } | null;
  dualPolicy?: string | null;
  /** 仓位推荐（已含门禁/双分约束时，作为正常路径的操作文案） */
  position?: {
    headline: string;
    action: string;
    emoji: string;
    label: string;
    tilt?: 'reduce' | 'hold' | 'add';
    targetPct?: number;
  } | null;
}

/**
 * 统一操作建议出口（单一真相源）
 *
 * 优先级：
 * 1. 数据门禁红档 → 勿加减仓
 * 2. 双打分冲突弃权 → 维持纪律定投
 * 3. 有仓位推荐 → 用仓位结论/操作（已含门禁·双分约束）
 * 4. 否则按 LLM 分映射人话
 *
 * CLI printReport / report-md / Web resolveAdvice 均应对齐此顺序。
 */
export function resolveOperationalAdvice(input: ResolveOperationalAdviceInput): OperationalAdvice | null {
  // 1) 门禁
  if (input.dataActionable === false) {
    return withPalette(
      {
        label: '数据不可用',
        emoji: '🔴',
        headline: '数据质量不足，暂停依据本报告操作',
        action: '维持既有定投纪律或观望；修复数据后重新 analysis',
      },
      'red',
      'data_gate',
    );
  }

  // 2) 双分冲突
  const dualHold =
    input.dualPolicy === 'hold_on_conflict'
    || (input.dualActionOverride != null && input.dualActionOverride.headline.length > 0);
  if (dualHold) {
    const ov = input.dualActionOverride;
    return withPalette(
      {
        label: '双分冲突·弃权',
        emoji: '⚖️',
        headline: ov?.headline ?? '双体系不一致，操作弃权',
        action: ov?.action ?? '维持基础定投，按日历执行；待双分同向或校准明确后再加减仓',
      },
      'gray',
      'dual_conflict',
    );
  }

  // 3) 仓位推荐（正常可操作日的主文案）
  if (input.position?.action) {
    const p = input.position;
    const pct = p.targetPct != null ? `（约 ${p.targetPct}%）` : '';
    return withPalette(
      {
        label: p.label || '仓位建议',
        emoji: p.emoji || '📦',
        headline: p.headline,
        action: p.action.includes('计划仓') ? p.action : `${p.action}${pct}`,
      },
      p.tilt === 'reduce' ? 'orange' : p.tilt === 'add' ? 'green' : 'yellow',
      'position',
    );
  }

  // 4) 分数映射
  if (input.llmScore == null || !Number.isFinite(input.llmScore)) return null;
  const base = scoreToAdvice(input.llmScore);
  return withPalette(base, paletteForScore(input.llmScore), 'score');
}

// ===== 信号一致性 =====

export interface ConsistencyCheck {
  /** 一致的维度数 */
  agreeCount: number;
  /** 总维度数 */
  totalCount: number;
  /** 一致方向 */
  consensusDirection: Direction | null;
  /** 不一致的维度名称 */
  dissenters: string[];
  /** 一致性等级 */
  level: 'strong' | 'moderate' | 'weak';
  /** 一句话描述 */
  summary: string;
}

const DIR_SCORE_THRESHOLD = 55; // >= 55 偏多, <= 45 偏空, 中间中性

export function checkConsistency(dims: { name: string; score: number }[]): ConsistencyCheck {
  const bullish: string[] = [];
  const bearish: string[] = [];
  const neutral: string[] = [];

  for (const d of dims) {
    if (d.score >= DIR_SCORE_THRESHOLD) bullish.push(d.name);
    else if (d.score <= 45) bearish.push(d.name);
    else neutral.push(d.name);
  }

  const maxGroup = Math.max(bullish.length, bearish.length, neutral.length);
  let consensusDirection: Direction | null = null;
  if (bullish.length === maxGroup && bullish.length >= 2) consensusDirection = 'bullish';
  else if (bearish.length === maxGroup && bearish.length >= 2) consensusDirection = 'bearish';
  else if (neutral.length === maxGroup && neutral.length >= 2) consensusDirection = 'neutral';

  const dissenters: string[] = [];
  if (consensusDirection === 'bullish') {
    if (bearish.length > 0) dissenters.push(...bearish);
    if (neutral.length >= 2) dissenters.push(...neutral);
  } else if (consensusDirection === 'bearish') {
    if (bullish.length > 0) dissenters.push(...bullish);
    if (neutral.length >= 2) dissenters.push(...neutral);
  }

  const total = dims.length;
  const agreeCount = total - dissenters.length;

  let level: ConsistencyCheck['level'] = 'strong';
  if (agreeCount <= 2) level = 'weak';
  else if (agreeCount <= 3 && dissenters.length > 0) level = 'moderate';

  const summary = consensusDirection
    ? `${agreeCount}/${total} 维度一致${consensusDirection === 'bullish' ? '偏多' : consensusDirection === 'bearish' ? '偏空' : '中性'}${dissenters.length ? `，${dissenters.join('、')}唱反调` : ''}`
    : `${total} 维度方向分歧，各执一词`;

  return { agreeCount, totalCount: total, consensusDirection, dissenters, level, summary };
}

/** 一致性 → emoji */
export function consistencyEmoji(level: ConsistencyCheck['level']): string {
  if (level === 'strong') return '✅';
  if (level === 'moderate') return '⚠️';
  return '🔴';
}
