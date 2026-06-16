// MACD 计算

import { ema } from './ma.js';

export interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

/**
 * 计算 MACD (Moving Average Convergence Divergence)
 * MACD Line = EMA12 - EMA26
 * Signal Line = EMA9 of MACD Line
 * Histogram = MACD - Signal
 */
export function macd(data: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): MACDResult {
  const emaFast = ema(data, fastPeriod);
  const emaSlow = ema(data, slowPeriod);

  // MACD Line = EMA12 - EMA26
  const macdLine: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdLine.push(emaFast[i]! - emaSlow[i]!);
    } else {
      macdLine.push(null);
    }
  }

  // Signal Line = EMA9 of MACD Line
  const validMacd = macdLine.filter((v): v is number => v !== null);
  const signalLine = ema(validMacd, signalPeriod);

  // 对齐 signal line 到 macd line
  const alignedSignal: (number | null)[] = [];
  let signalIdx = 0;
  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] === null) {
      alignedSignal.push(null);
    } else {
      alignedSignal.push(signalLine[signalIdx] ?? null);
      signalIdx++;
    }
  }

  // Histogram = MACD - Signal
  const histogram: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] !== null && alignedSignal[i] !== null) {
      histogram.push(macdLine[i]! - alignedSignal[i]!);
    } else {
      histogram.push(null);
    }
  }

  return {
    macd: macdLine,
    signal: alignedSignal,
    histogram,
  };
}

/** 获取最近的 MACD 值 */
export function latestMACD(data: number[]): { macd: number | null; signal: number | null; histogram: number | null } | null {
  const result = macd(data);
  for (let i = data.length - 1; i >= 0; i--) {
    if (result.macd[i] !== null) {
      return {
        macd: result.macd[i],
        signal: result.signal[i],
        histogram: result.histogram[i],
      };
    }
  }
  return null;
}

/** 判断 MACD 金叉/死叉 */
export function macdCross(data: number[]): 'golden' | 'dead' | 'none' {
  const result = macd(data);

  // 找最近两个有效 histogram 点
  let recent = -1;
  let previous = -1;

  for (let i = result.histogram.length - 1; i >= 0; i--) {
    if (result.histogram[i] !== null) {
      if (recent === -1) {
        recent = i;
      } else {
        previous = i;
        break;
      }
    }
  }

  if (recent === -1 || previous === -1) return 'none';

  // 金叉：histogram 从负变正
  if (result.histogram[previous]! < 0 && result.histogram[recent]! > 0) {
    return 'golden';
  }

  // 死叉：histogram 从正变负
  if (result.histogram[previous]! > 0 && result.histogram[recent]! < 0) {
    return 'dead';
  }

  return 'none';
}
