// 反驳评分修正 — 纯函数，可单测

import type { RebuttalAnalysis, RebuttalStrength } from '../types/analysis.js';

/** 默认强度乘数（可被在线校准微调） */
export const STRENGTH_MULTIPLIER: Record<RebuttalStrength, number> = {
  weak: 0.10,
  moderate: 0.20,
  strong: 0.35,
};

export interface RebuttalAdjustmentDetail {
  adjustedScore: number;
  netEffect: RebuttalAnalysis['netEffect'];
  bearishImpliedScore: number;
  multiplier: number;
  rawAdjustment: number;
}

export interface MultiplierCalibrateInput {
  /** 系统偏差文案：optimistic / pessimistic / calibrated / 偏乐观… */
  systematicBias?: string | null;
  /** 校准误差绝对值（百分点），越大微调越强 */
  calibrationError?: number | null;
  /** 样本数，过少不调 */
  sampleSize?: number | null;
}

/**
 * 按历史校准偏差微调反驳强度乘数。
 * - 系统偏乐观 → 略增乘数（更用力压低乐观分）
 * - 系统偏悲观 → 略减乘数
 * 幅度有上限，样本不足时返回原值。
 */
export function calibrateStrengthMultiplier(
  base: number,
  input?: MultiplierCalibrateInput | null,
): number {
  if (!input || (input.sampleSize ?? 0) < 5) return base;

  const bias = String(input.systematicBias ?? '').toLowerCase();
  const err = Math.max(0, Math.min(40, input.calibrationError ?? 0));
  const scale = Math.min(0.25, err / 100); // 最多 ±25%

  let factor = 1;
  if (bias.includes('optimistic') || bias.includes('偏乐观') || bias.includes('乐观')) {
    factor = 1 + scale;
  } else if (bias.includes('pessimistic') || bias.includes('偏悲观') || bias.includes('悲观')) {
    factor = 1 - scale;
  } else {
    return base;
  }

  const next = base * factor;
  return Math.max(0.05, Math.min(0.50, Math.round(next * 1000) / 1000));
}

/** 计算反驳修正明细（供评分构成展示） */
export function computeRebuttalAdjustment(
  originalScore: number,
  bearScore: number,
  rebuttalStrength: RebuttalStrength,
  calibrate?: MultiplierCalibrateInput | null,
): RebuttalAdjustmentDetail {
  const baseMult = STRENGTH_MULTIPLIER[rebuttalStrength];
  const multiplier = calibrateStrengthMultiplier(baseMult, calibrate);
  const bearishImpliedScore = 100 - bearScore;
  const rawAdjustment = (bearishImpliedScore - originalScore) * multiplier;
  const adjustedScore = Math.max(0, Math.min(100, Math.round(originalScore + rawAdjustment)));

  const absAdjust = Math.abs(rawAdjustment);
  let netEffect: RebuttalAnalysis['netEffect'];
  if (absAdjust < 1) {
    netEffect = 'unchanged';
  } else if (rawAdjustment < 0) {
    netEffect = absAdjust < 5 ? 'downgraded' : 'significant_downgrade';
  } else {
    netEffect = 'unchanged';
  }

  return { adjustedScore, netEffect, bearishImpliedScore, multiplier, rawAdjustment };
}

/**
 * 将 bearScore（看空力度，越高越空）映射到与综合分同向的「隐含综合分」，
 * 再按反驳强度向该目标靠拢。
 *
 * 旧公式 (bearScore - originalScore) 在 bearScore > originalScore 时会错误抬高偏多分
 * （例：59 分 + strong 反驳 bear=71 → 63），与 CORRECTNESS-SPEC「反驳压低乐观分」矛盾。
 */
export function adjustScoreWithRebuttal(
  originalScore: number,
  bearScore: number,
  rebuttalStrength: RebuttalStrength,
  calibrate?: MultiplierCalibrateInput | null,
): { adjustedScore: number; netEffect: RebuttalAnalysis['netEffect'] } {
  const { adjustedScore, netEffect } = computeRebuttalAdjustment(
    originalScore, bearScore, rebuttalStrength, calibrate,
  );
  return { adjustedScore, netEffect };
}
