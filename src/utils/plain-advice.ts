// 人话翻译 + 信号一致性 — CLI 和 Web 共用

import type { Direction } from '../types/analysis.js';

/** 评分 → 人话操作建议 */
export interface PlainAdvice {
  label: string;
  emoji: string;
  headline: string;
  action: string;
}

const ADVICE_TABLE: PlainAdvice[] = [
  { label: '强烈偏空', emoji: '🔴', headline: '下行风险大于反弹空间', action: '暂停定投，等待评分回升至 45 以上' },
  { label: '偏空', emoji: '🟠', headline: '需防回调', action: '放慢定投节奏，不加仓' },
  { label: '中性', emoji: '🟡', headline: '震荡整理，方向未明', action: '维持基础定投，按日历执行、少择时' },
  { label: '偏多', emoji: '🟢', headline: '短期动能偏强', action: '维持定投；急跌可小幅加码，高位不追' },
  { label: '强烈偏多', emoji: '🔵', headline: '多头趋势明确', action: '可适度加码，但高位不追、设好止盈' },
];

export function scoreToAdvice(score: number): PlainAdvice {
  if (score <= 30) return ADVICE_TABLE[0];
  if (score <= 45) return ADVICE_TABLE[1];
  if (score <= 55) return ADVICE_TABLE[2];
  if (score <= 75) return ADVICE_TABLE[3];
  return ADVICE_TABLE[4];
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
