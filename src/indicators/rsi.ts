// RSI 计算

/**
 * 计算 RSI (Relative Strength Index)
 * RSI = 100 - (100 / (1 + RS))
 * RS = 平均涨幅 / 平均跌幅
 */
export function rsi(data: number[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = [];

  if (data.length < period + 1) {
    return data.map(() => null);
  }

  // 计算每日涨跌
  const changes: number[] = [];
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1]);
  }

  // 初始平均涨跌幅（简单平均）
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      avgGain += changes[i];
    } else {
      avgLoss += Math.abs(changes[i]);
    }
  }

  avgGain /= period;
  avgLoss /= period;

  // 第一个 RSI（在 period+1 数据点处）
  result.push(...Array(period).fill(null));

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(100 - 100 / (1 + rs));

  // 后续用 EMA 方式计算
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }

  return result;
}

/** 获取最近的 RSI 值 */
export function latestRSI(data: number[], period: number = 14): number | null {
  const values = rsi(data, period);
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return values[i];
  }
  return null;
}

/** RSI 信号判断 */
export function rsiSignal(rsiValue: number): 'oversold' | 'overbought' | 'neutral' {
  if (rsiValue >= 70) return 'overbought';
  if (rsiValue <= 30) return 'oversold';
  return 'neutral';
}
