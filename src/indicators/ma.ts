// 均线计算 (MA)

/** 计算简单移动平均 (SMA) */
export function sma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j];
    }
    result.push(sum / period);
  }

  return result;
}

/** 计算指数移动平均 (EMA) */
export function ema(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const multiplier = 2 / (period + 1);

  // 第一个 EMA 值用 SMA 初始化
  let emaValue: number | null = null;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }

    if (i === period - 1) {
      // 用前 period 个数据初始化
      let sum = 0;
      for (let j = 0; j <= i; j++) {
        sum += data[j];
      }
      emaValue = sum / period;
    } else {
      emaValue = (data[i] - emaValue!) * multiplier + emaValue!;
    }

    result.push(emaValue);
  }

  return result;
}

/** 获取最近的 MA 值 */
export function latestMA(data: number[], period: number): number | null {
  const ma = sma(data, period);
  for (let i = ma.length - 1; i >= 0; i--) {
    if (ma[i] !== null) return ma[i];
  }
  return null;
}

/** 判断均线交叉 */
export function maCross(shortData: number[], longData: number[], shortPeriod: number, longPeriod: number): 'golden' | 'dead' | 'none' {
  const shortMA = sma(shortData, shortPeriod);
  const longMA = sma(longData, longPeriod);

  // 找最近的两个有效点
  let recent = -1;
  let previous = -1;

  for (let i = shortMA.length - 1; i >= 0; i--) {
    if (shortMA[i] !== null && longMA[i] !== null) {
      if (recent === -1) {
        recent = i;
      } else {
        previous = i;
        break;
      }
    }
  }

  if (recent === -1 || previous === -1) return 'none';

  // 金叉：短期从下方穿越长期
  if (shortMA[previous]! < longMA[previous]! && shortMA[recent]! > longMA[recent]!) {
    return 'golden';
  }

  // 死叉：短期从上方穿越长期
  if (shortMA[previous]! > longMA[previous]! && shortMA[recent]! < longMA[recent]!) {
    return 'dead';
  }

  return 'none';
}
