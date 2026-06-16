// 布林带计算

import { sma } from './ma.js';

export interface BollingerBands {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
  bandwidth: (number | null)[];
  percentB: (number | null)[];
}

/**
 * 计算布林带 (Bollinger Bands)
 * Middle Band = SMA(period)
 * Upper Band = Middle + k * StdDev
 * Lower Band = Middle - k * StdDev
 * 默认 period=20, k=2
 */
export function bollinger(data: number[], period: number = 20, k: number = 2): BollingerBands {
  const middle = sma(data, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  const bandwidth: (number | null)[] = [];
  const percentB: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (middle[i] === null) {
      upper.push(null);
      lower.push(null);
      bandwidth.push(null);
      percentB.push(null);
      continue;
    }

    // 计算标准差
    const start = i - period + 1;
    let sumSqDiff = 0;
    for (let j = start; j <= i; j++) {
      sumSqDiff += (data[j] - middle[i]!) ** 2;
    }
    const stdDev = Math.sqrt(sumSqDiff / period);

    const u = middle[i]! + k * stdDev;
    const l = middle[i]! - k * stdDev;

    upper.push(u);
    lower.push(l);
    bandwidth.push(middle[i]! !== 0 ? (u - l) / middle[i]! : null);
    percentB.push(u !== l ? (data[i] - l) / (u - l) : null);
  }

  return { upper, middle, lower, bandwidth, percentB };
}

/** 获取最近的布林带值 */
export function latestBollinger(data: number[], period: number = 20, k: number = 2): {
  upper: number | null; middle: number | null; lower: number | null;
  bandwidth: number | null; percentB: number | null;
} | null {
  const result = bollinger(data, period, k);
  for (let i = data.length - 1; i >= 0; i--) {
    if (result.middle[i] !== null) {
      return {
        upper: result.upper[i],
        middle: result.middle[i],
        lower: result.lower[i],
        bandwidth: result.bandwidth[i],
        percentB: result.percentB[i],
      };
    }
  }
  return null;
}
