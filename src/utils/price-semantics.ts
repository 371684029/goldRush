// 价格语义 — GC=F 期货代理 vs 搜索现货

const PROXY_NOTE =
  '技术指标与历史回填基于 Yahoo GC=F（COMEX 期货收盘）代理；当日伦敦/上海现货来自联网搜索，二者可能存在基差偏差。';

export function priceSeriesProxyNote(): string {
  return PROXY_NOTE;
}

/**
 * 现货与代理收盘价偏差超过阈值时生成告警文案。
 */
export function spotProxyDeviationWarning(
  spotLondon: number | null | undefined,
  proxyClose: number | null | undefined,
  thresholdPct = 1.5,
): string | null {
  if (spotLondon == null || proxyClose == null || proxyClose <= 0) return null;
  const dev = Math.abs((spotLondon - proxyClose) / proxyClose) * 100;
  if (dev < thresholdPct) return null;
  const sign = spotLondon >= proxyClose ? '高于' : '低于';
  return `伦敦现货 $${spotLondon.toFixed(0)} ${sign} GC=F 代理收盘 $${proxyClose.toFixed(0)} 约 ${dev.toFixed(1)}%，解读技术指标时请留意基差。`;
}
