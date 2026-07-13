// Yahoo Finance 实时价格 — 零成本、零 LLM、直接 HTTP 获取
// 作为数据验证的 A 级锚定源

import { yahooTimestampToDate } from './yahoo-gold-history.js';
import { todayDate } from '../utils/time.js';

const USER_AGENT = 'GoldRush/0.1 (gold research CLI)';

export interface YahooLivePrice {
  symbol: string;
  price: number;        // 最新价
  previousClose: number; // 前收盘（用于计算涨跌幅）
  change: number;       // 涨跌幅 %
  timestamp: string;    // ISO datetime
  date: string;         // YYYY-MM-DD
}

interface YahooQuoteResult {
  meta?: {
    symbol?: string;
    regularMarketPrice?: number;
    previousClose?: number;
    regularMarketTime?: number;
  };
}

interface YahooQuoteResponse {
  quoteResponse?: {
    result?: YahooQuoteResult[];
    error?: { description?: string } | null;
  };
}

interface YahooChartMeta {
  currentTradingPeriod?: {
    regular?: { start?: number; end?: number };
  };
}

interface YahooChartResult {
  meta?: YahooChartMeta;
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
    }>;
  };
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[];
    error?: { description?: string } | null;
  };
}

/** 通过 Yahoo Finance Quote API 获取实时报价 */
async function fetchQuote(symbol: string): Promise<YahooLivePrice | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[yahoo-live] ${symbol} quote API 返回 HTTP ${res.status}`);
      return null;
    }

    const body = await res.json() as YahooQuoteResponse;
    const result = body.quoteResponse?.result?.[0];
    if (!result?.meta) {
      console.warn(`[yahoo-live] ${symbol} 无报价数据`);
      return null;
    }

    const { regularMarketPrice, previousClose, regularMarketTime } = result.meta;
    if (regularMarketPrice == null || !Number.isFinite(regularMarketPrice)) {
      console.warn(`[yahoo-live] ${symbol} 报价无效`);
      return null;
    }

    const ts = regularMarketTime ? new Date(regularMarketTime * 1000) : new Date();
    const chg = previousClose && Number.isFinite(previousClose)
      ? ((regularMarketPrice - previousClose) / previousClose) * 100
      : 0;

    return {
      symbol,
      price: Math.round(regularMarketPrice * 100) / 100,
      previousClose: previousClose ?? regularMarketPrice,
      change: Math.round(chg * 100) / 100,
      timestamp: ts.toISOString(),
      date: ts.toISOString().slice(0, 10),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[yahoo-live] ${symbol} 拉取失败: ${msg}`);
    return null;
  }
}

/** 获取 GC=F 黄金期货最新价 */
export async function fetchGoldLive(): Promise<YahooLivePrice | null> {
  return fetchQuote('GC=F');
}

/** 获取 DXY 美元指数最新价 */
export async function fetchDxyLive(): Promise<YahooLivePrice | null> {
  return fetchQuote('DX-Y.NYB');
}

/** 获取 10Y 美债收益率 */
export async function fetch10YLive(): Promise<YahooLivePrice | null> {
  return fetchQuote('^TNX');
}

/** 并行获取全部实时数据 */
export async function fetchAllLive(): Promise<{
  gold: YahooLivePrice | null;
  dxy: YahooLivePrice | null;
  us10y: YahooLivePrice | null;
}> {
  const [gold, dxy, us10y] = await Promise.all([
    fetchGoldLive(),
    fetchDxyLive(),
    fetch10YLive(),
  ]);
  return { gold, dxy, us10y };
}
