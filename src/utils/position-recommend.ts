// 当前仓位推荐 — 相对「计划黄金仓位」的 0–100% 建议（非绝对账户杠杆）
//
// 输入：LLM/量化分、门禁、双分策略、主力、长期配置档
// 输出：目标仓位% + 定投层/波段层拆分 + 人话理由

import type { Direction } from '../types/analysis.js';

export type PositionLabel = '极轻' | '偏轻' | '标配' | '偏积极' | '积极';

export interface PositionRecommendation {
  /** 相对计划黄金总仓 0–100 */
  targetPct: number;
  /** 其中定投/底仓占比（占 target 的百分比） */
  coreSharePct: number;
  /** 波段/卫星仓占比（占 target） */
  satelliteSharePct: number;
  label: PositionLabel;
  emoji: string;
  headline: string;
  action: string;
  reasons: string[];
  /** 约束标记：门禁红、双分冲突等 */
  constraints: string[];
  /** 建议操作：减/持/加 */
  tilt: 'reduce' | 'hold' | 'add';
}

export interface PositionRecommendInput {
  llmScore: number;
  quantScore?: number | null;
  dataActionable?: boolean;
  /** dual-score actionPolicy */
  dualPolicy?: string | null;
  flowScore?: number | null;
  longTermStance?: 'overweight' | 'neutral' | 'underweight' | null;
  consistencyLevel?: 'strong' | 'moderate' | 'weak' | null;
  direction?: Direction | null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function scoreToBasePct(score: number): number {
  if (score <= 25) return 25;
  if (score <= 35) return 35;
  if (score <= 45) return 45;
  if (score <= 55) return 55;
  if (score <= 65) return 65;
  if (score <= 75) return 75;
  return 85;
}

function labelFromPct(pct: number): PositionLabel {
  if (pct <= 30) return '极轻';
  if (pct <= 45) return '偏轻';
  if (pct <= 60) return '标配';
  if (pct <= 75) return '偏积极';
  return '积极';
}

function emojiFromLabel(l: PositionLabel): string {
  if (l === '极轻') return '🔴';
  if (l === '偏轻') return '🟠';
  if (l === '标配') return '🟡';
  if (l === '偏积极') return '🟢';
  return '🔵';
}

/**
 * 计算当前仓位推荐（相对计划仓，非杠杆倍数）
 */
export function recommendPosition(input: PositionRecommendInput): PositionRecommendation {
  const reasons: string[] = [];
  const constraints: string[] = [];

  // 1) 主分：有量化则取中点，避免单边极端
  let score = input.llmScore;
  if (input.quantScore != null && Number.isFinite(input.quantScore)) {
    score = Math.round((input.llmScore + input.quantScore) / 2);
    reasons.push(`综合参考分 ${(score)}（LLM ${input.llmScore} / 量化 ${input.quantScore} 均值）`);
  } else {
    reasons.push(`参考 LLM 分 ${input.llmScore}`);
  }

  let target = scoreToBasePct(score);

  // 2) 数据门禁红档：强制偏轻
  if (input.dataActionable === false) {
    target = Math.min(target, 35);
    constraints.push('数据门禁红档：上限 35%');
  }

  // 3) 双打分冲突弃权：压到标配以下
  if (input.dualPolicy === 'hold_on_conflict') {
    target = Math.min(target, 50);
    constraints.push('双分冲突：操作弃权，仓位不超过标配 50%');
  }

  // 4) 弱一致
  if (input.consistencyLevel === 'weak') {
    target = Math.min(target, 50);
    constraints.push('四维一致性弱：不加仓');
  }

  // 5) 主力 flow
  if (input.flowScore != null) {
    if (input.flowScore <= 35) {
      target -= 8;
      reasons.push(`主力偏空（flow ${input.flowScore}）：卫星仓收缩`);
    } else if (input.flowScore >= 65) {
      target += 5;
      reasons.push(`主力偏多（flow ${input.flowScore}）：可略积极`);
    }
  }

  // 6) 长期配置档
  if (input.longTermStance === 'underweight') {
    target -= 5;
    reasons.push('长期档偏谨慎：总仓略降');
  } else if (input.longTermStance === 'overweight') {
    target += 5;
    reasons.push('长期档偏积极：总仓略升');
  }

  target = Math.round(clamp(target, 15, 90));

  // 定投层 vs 波段层：越谨慎，定投层占比越高
  let coreShare = 70;
  if (target <= 40) coreShare = 85;
  else if (target <= 55) coreShare = 75;
  else if (target >= 75) coreShare = 60;
  if (input.dualPolicy === 'hold_on_conflict' || input.dataActionable === false) {
    coreShare = Math.max(coreShare, 85);
  }
  const satelliteShare = 100 - coreShare;

  const label = labelFromPct(target);
  const emoji = emojiFromLabel(label);

  let tilt: PositionRecommendation['tilt'] = 'hold';
  if (target <= 40) tilt = 'reduce';
  else if (target >= 70) tilt = 'add';

  let headline: string;
  let action: string;
  if (input.dataActionable === false) {
    headline = '数据不可靠，建议维持轻仓纪律仓';
    action = `建议相对计划仓约 ${target}%（定投层 ${coreShare}% / 波段层 ${satelliteShare}%）；暂停加仓，修好数据再评估`;
  } else if (input.dualPolicy === 'hold_on_conflict') {
    headline = '双体系不一致，维持纪律仓、不追方向';
    action = `建议相对计划仓约 ${target}%；以定投层为主（${coreShare}%），波段仓轻仓或空仓`;
  } else if (tilt === 'reduce') {
    headline = '建议偏轻：控制黄金风险暴露';
    action = `建议相对计划仓约 ${target}%（${label}）；可降单次定投额，波段仓观望`;
  } else if (tilt === 'add') {
    headline = '可偏积极，但仍忌一次性重仓';
    action = `建议相对计划仓约 ${target}%（${label}）；定投维持，急跌再小加卫星仓`;
  } else {
    headline = '标配附近：纪律定投为主';
    action = `建议相对计划仓约 ${target}%（${label}）；按日历定投，少做择时加减`;
  }

  return {
    targetPct: target,
    coreSharePct: coreShare,
    satelliteSharePct: satelliteShare,
    label,
    emoji,
    headline,
    action,
    reasons,
    constraints,
    tilt,
  };
}

export function formatPositionConsole(p: PositionRecommendation, indent = '  '): string {
  const lines = [
    `${indent}📦 当前仓位推荐（相对计划黄金仓）`,
    `${indent}  ${p.emoji} ${p.label} · 目标 ${p.targetPct}% · 定投层 ${p.coreSharePct}% / 波段层 ${p.satelliteSharePct}%`,
    `${indent}  ${p.headline}`,
    `${indent}  → ${p.action}`,
  ];
  if (p.constraints.length) {
    lines.push(`${indent}  约束：${p.constraints.join('；')}`);
  }
  if (p.reasons.length) {
    lines.push(`${indent}  依据：${p.reasons.slice(0, 3).join('；')}`);
  }
  lines.push(`${indent}  （非绝对账户比例，亦非杠杆建议）`);
  return lines.join('\n');
}

export function formatPositionMarkdown(p: PositionRecommendation): string {
  const lines = [
    '## 📦 当前仓位推荐',
    '',
    `> ${p.emoji} **${p.label}** · 相对计划仓 **${p.targetPct}%** · 定投层 ${p.coreSharePct}% / 波段层 ${p.satelliteSharePct}%`,
    '',
    `- **结论**：${p.headline}`,
    `- **操作**：${p.action}`,
    `- **倾向**：${p.tilt === 'reduce' ? '减仓/偏轻' : p.tilt === 'add' ? '可小幅积极' : '维持'}`,
  ];
  if (p.constraints.length) {
    lines.push(`- **约束**：${p.constraints.join('；')}`);
  }
  if (p.reasons.length) {
    lines.push(`- **依据**：${p.reasons.join('；')}`);
  }
  lines.push('');
  lines.push('> 仓位百分比均相对于你预设的「黄金计划仓」=100%，不是总资产杠杆，不构成投资建议。');
  lines.push('');
  return lines.join('\n');
}
