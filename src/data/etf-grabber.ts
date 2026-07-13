// SPDR Gold Trust (GLD) 每日持仓 — 从 SPDR 官网 CSV 拉取

import type { EtfHoldings } from '../types/institutional.js';

const USER_AGENT = 'GoldRush/0.1 (gold research CLI)';

// SPDR GLD daily holdings CSV URL (single file contains all history from 2004)
const GLD_CSV_URL = 'https://www.spdrgoldshares.com/assets/dynamic/holdings/GLD_holdings_2026.csv';

/** 构造指定年份的 SPDR GLD holdings CSV URL */
function gldCsvUrlForYear(year: number): string {
  return `https://www.spdrgoldshares.com/assets/dynamic/holdings/GLD_holdings_${year}.csv`;
}

/** 解析单行 CSV → EtfHoldings（不含 gldChange，由 computeChange 统一计算） */
function parseCsvLine(line: string): EtfHoldings | null {
  const cols = line.split(',');
  if (cols.length < 4) return null;

  const date = cols[0].trim();
  // YYYY-MM-DD 简单校验
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const gldTons = parseFloat(cols[2]);
  const gldAum = parseFloat(cols[3]);

  if (!Number.isFinite(gldTons) || !Number.isFinite(gldAum)) return null;

  return {
    date,
    gldTons,
    gldChange: 0,
    gldAum,
  };
}

/** 计算 gldChange：每条记录相对前一交易日的吨数变化（首条为 0） */
function computeChange(records: EtfHoldings[]): void {
  for (let i = 0; i < records.length; i++) {
    if (i === 0) {
      records[i].gldChange = 0;
      continue;
    }
    records[i].gldChange = records[i].gldTons - records[i - 1].gldTons;
  }
}

/** 尝试从指定 URL 拉取并解析 CSV，失败返回 null */
async function tryFetchCsv(url: string): Promise<EtfHoldings[] | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv' },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.warn(`[etf-grabber] ${url} 返回 HTTP ${res.status}`);
      return null;
    }

    const text = await res.text();
    if (!text || text.trim().length === 0) {
      console.warn(`[etf-grabber] ${url} 响应体为空`);
      return null;
    }

    const lines = text.split(/\r?\n/);
    if (lines.length < 2) {
      console.warn(`[etf-grabber] ${url} CSV 行数不足`);
      return null;
    }

    // 跳过表头，逐行解析
    const records: EtfHoldings[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue;
      const rec = parseCsvLine(line);
      if (rec) records.push(rec);
    }

    if (records.length === 0) {
      console.warn(`[etf-grabber] ${url} 未解析到任何有效记录`);
      return null;
    }

    // 按日期升序排序
    records.sort((a, b) => a.date.localeCompare(b.date));
    computeChange(records);
    return records;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[etf-grabber] 拉取 ${url} 失败: ${msg}`);
    return null;
  }
}

// Fetch ALL GLD historical holdings from SPDR CSV
export async function fetchGldHoldings(): Promise<EtfHoldings[]> {
  const currentYear = new Date().getFullYear();
  const candidateYears = [currentYear, currentYear - 1, 2025, 2026];

  // 去重，保持优先级顺序
  const seen = new Set<number>();
  const years: number[] = [];
  for (const y of candidateYears) {
    if (!seen.has(y)) {
      seen.add(y);
      years.push(y);
    }
  }

  for (const year of years) {
    const url = year === 2026 ? GLD_CSV_URL : gldCsvUrlForYear(year);
    const records = await tryFetchCsv(url);
    if (records && records.length > 0) {
      return records;
    }
  }

  console.warn('[etf-grabber] 所有候选 URL 均失败，返回空数组');
  return [];
}

// Fetch only the latest holdings day
export async function fetchLatestGldHolding(): Promise<EtfHoldings | null> {
  const records = await fetchGldHoldings();
  if (records.length === 0) return null;
  return records[records.length - 1];
}