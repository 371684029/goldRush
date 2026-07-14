// GLD ETF 持仓 — 从 Yahoo Finance 拉取 GLD 价格 + AUM，估算黄金持仓
//
// SPDR 官网已迁移为 Next.js SPA，旧 CSV URL 全部返回 404。
// 改用 Yahoo Finance 获取 GLD 实时数据，结合金价估算实物持仓量。
// 每 GLD 份额 ≈ 0.1 金衡盎司（来自基金说明书）。

import type { EtfHoldings } from '../types/institutional.js';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

/** Yahoo v8 chart endpoint — 返回 OHLCV + 前收盘 */
async function fetchGldChart(): Promise<{ price: number; prevClose: number } | null> {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/GLD?interval=1d&range=5d';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[etf-grabber] Yahoo GLD chart 返回 HTTP ${res.status}`);
      return null;
    }
    const data = await res.json() as any;
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    return {
      price: meta.regularMarketPrice,
      prevClose: meta.chartPreviousClose ?? meta.previousClose,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[etf-grabber] Yahoo GLD chart 失败: ${msg}`);
    return null;
  }
}

/** Yahoo quoteSummary — 获取 GLD 市值和份额数 */
async function fetchGldQuoteSummary(): Promise<{ marketCap: number; sharesOutstanding: number } | null> {
  const url = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/GLD?modules=price,defaultKeyStatistics';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[etf-grabber] Yahoo GLD quoteSummary 返回 HTTP ${res.status}`);
      return null;
    }
    const data = await res.json() as any;
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return null;

    const price = result.price;
    const stats = result.defaultKeyStatistics;
    const marketCap = price?.regularMarketPrice != null && stats?.sharesOutstanding?.raw != null
      ? price.regularMarketPrice * stats.sharesOutstanding.raw
      : null;

    return {
      marketCap: marketCap ?? 0,
      sharesOutstanding: stats?.sharesOutstanding?.raw ?? 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[etf-grabber] Yahoo GLD quoteSummary 失败: ${msg}`);
    return null;
  }
}

/** 从 GLD 份额数估算黄金持仓吨数 */
function estimateGoldTons(sharesOutstanding: number, gldPrice: number, goldPricePerOz: number): number {
  if (goldPricePerOz <= 0 || sharesOutstanding <= 0) return 0;
  // 标准方法：每 GLD 份额代表约 0.094 金衡盎司（扣除管理费用后）
  const ouncesPerShare = 0.094;
  const totalOunces = sharesOutstanding * ouncesPerShare;
  return totalOunces / 32150.746; // 金衡盎司 → 吨
}

/** 返回当日 GLD 持仓估算（单条） */
export async function fetchLatestGldHolding(): Promise<EtfHoldings | null> {
  const [chart, summary] = await Promise.all([fetchGldChart(), fetchGldQuoteSummary()]);
  if (!chart || !summary) return null;

  const today = new Date().toISOString().slice(0, 10);
  const gldTons = estimateGoldTons(summary.sharesOutstanding, chart.price, chart.price / 0.094);

  return {
    date: today,
    gldTons: Math.round(gldTons * 100) / 100,
    gldChange: 0,
    gldAum: Math.round(summary.marketCap / 1e6) / 100, // 转换为百万美元
  };
}

/** 获取当日 GLD 持仓数据（用于 flow --init 混入历史） */
export async function fetchGldHoldings(): Promise<EtfHoldings[]> {
  const holding = await fetchLatestGldHolding();
  return holding ? [holding] : [];
}
