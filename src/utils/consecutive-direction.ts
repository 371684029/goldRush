// 连续同向天数 — 用于 scenario_features.momentum 特征

import type { Direction } from '../types/analysis.js';

export interface DirectionDay {
  date: string;
  direction: Direction;
}

/**
 * 统计截至今日、与今日方向连续一致的天数（含今日）。
 * 从最近一份历史报告向前回溯，方向中断则停止。
 */
export function countConsecutiveDirectionDays(
  history: DirectionDay[],
  todayDirection: Direction,
  todayDate: string,
): number {
  let count = 1;
  const sorted = [...history]
    .filter(h => h.date < todayDate)
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const row of sorted) {
    if (row.direction === todayDirection) {
      count++;
    } else {
      break;
    }
  }
  return count;
}
