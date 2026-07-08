// 技术面规则分 — 本地指标推导，与 LLM 解读分混合

import type { GoldPriceRecord } from '../types/market.js';
import { latestMA, latestRSI, macdCross, latestMACD } from '../indicators/index.js';
import { forwardFillCloses } from './price-series.js';
import { aggregateWeeklyCloses } from './weekly-series.js';

export interface TechnicalRuleInput {
  closes: number[];
  weeklyCloses: number[];
}

/** 从日线历史构建规则分输入 */
export function buildTechnicalRuleInput(history: GoldPriceRecord[]): TechnicalRuleInput | null {
  if (history.length < 20) return null;
  const closes = forwardFillCloses(history);
  if (closes.length < 20) return null;
  const weeklyCandles = aggregateWeeklyCloses(history);
  const weeklyCloses = weeklyCandles.map(c => c.close);
  return { closes, weeklyCloses };
}

/**
 * 基于 MA/RSI/MACD/偏离度计算 0–100 规则分（50=中性）。
 * 不依赖 LLM，用于约束技术面评分与指标矛盾。
 */
export function computeTechnicalRuleScore(input: TechnicalRuleInput): number {
  const { closes, weeklyCloses } = input;
  let score = 50;

  const rsiVal = latestRSI(closes, 14);
  if (rsiVal != null) {
    if (rsiVal <= 30) score -= 10;
    else if (rsiVal <= 40) score -= 6;
    else if (rsiVal >= 70) score -= 5;
    else if (rsiVal >= 60) score += 5;
    else if (rsiVal >= 50) score += 2;
  }

  const macdCrossVal = macdCross(closes);
  if (macdCrossVal === 'golden') score += 8;
  else if (macdCrossVal === 'dead') score -= 8;

  const macdVal = latestMACD(closes);
  if (macdVal?.histogram != null) {
    if (macdVal.histogram > 0) score += 3;
    else if (macdVal.histogram < 0) score -= 3;
  }

  const ma20 = latestMA(closes, 20);
  const last = closes[closes.length - 1];
  if (ma20 != null && last != null) {
    if (last > ma20) score += 5;
    else if (last < ma20) score -= 5;
    const devPct = ((last - ma20) / ma20) * 100;
    if (devPct <= -8) score -= 6;
    else if (devPct >= 10) score -= 4;
  }

  if (weeklyCloses.length >= 4) {
    const wCross = macdCross(weeklyCloses);
    if (wCross === 'dead') score -= 10;
    else if (wCross === 'golden') score += 6;

    const wMa20 = latestMA(weeklyCloses, Math.min(20, weeklyCloses.length));
    const wLast = weeklyCloses[weeklyCloses.length - 1];
    if (wMa20 != null && wLast < wMa20) score -= 5;
    else if (wMa20 != null && wLast > wMa20) score += 3;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/** 规则分 60% + LLM 分 40% */
export function blendTechnicalScore(ruleScore: number, llmScore: number): number {
  const blended = ruleScore * 0.6 + llmScore * 0.4;
  return Math.max(0, Math.min(100, Math.round(blended)));
}
