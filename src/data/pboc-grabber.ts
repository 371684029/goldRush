// 中国央行（PBOC）黄金储备 — 东财搜索 API 解析（现网可达）
// 优先：东方财富 cmsArticle 搜索；回落：页面启发式

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CentralBankRecord } from '../types/institutional.js';
import { searchEastmoneyArticles } from './eastmoney-search.js';

const execFileP = promisify(execFile);
const USER_AGENT = 'Mozilla/5.0 (compatible; GoldRush/0.1)';

async function curlText(url: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('curl', [
      '-sS', '-L',
      '-H', `User-Agent: ${USER_AGENT}`,
      '-H', 'Accept: text/html,application/json,*/*',
      '--max-time', '20',
      url,
    ], {
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      timeout: 25_000,
    });
    return stdout || null;
  } catch {
    return null;
  }
}

/**
 * 从文本中启发式抽取黄金储备吨数 / 万盎司。
 * 万盎司 → 吨：×10000 / 32150.746
 */
export function parsePbocReservesFromText(text: string): {
  tons: number;
  changeTons: number | null;
  evidence: string;
  consecutiveMonths: number | null;
} | null {
  if (!text) return null;
  // 去 HTML 标签
  const plain = text.replace(/<[^>]+>/g, '');

  let tons: number | null = null;
  let evidence = '';

  // 优先「约2346.446吨」
  const tonExact = plain.match(/(?:约|达|为|报)?\s*(\d{3,5}(?:\.\d+)?)\s*吨/);
  // 「7544万盎司(约2346.446吨)」
  const wanOzWithTon = plain.match(/(\d{3,5}(?:\.\d+)?)\s*万盎司[^0-9]{0,12}(?:约)?\s*(\d{3,5}(?:\.\d+)?)\s*吨/);
  if (wanOzWithTon) {
    tons = parseFloat(wanOzWithTon[2]);
    evidence = wanOzWithTon[0];
  } else if (tonExact) {
    const t = parseFloat(tonExact[1]);
    if (t >= 1500 && t <= 5000) {
      tons = t;
      evidence = tonExact[0];
    }
  }

  if (tons == null) {
    const ozPatterns = [
      /黄金储备[^\d]{0,16}(\d{3,5}(?:\.\d+)?)\s*万盎司/,
      /(\d{3,5}(?:\.\d+)?)\s*万盎司/,
    ];
    for (const re of ozPatterns) {
      const m = plain.match(re);
      if (!m) continue;
      const wanOz = parseFloat(m[1]);
      const t = (wanOz * 10_000) / 32_150.746;
      if (t >= 1500 && t <= 5000) {
        tons = Math.round(t * 10) / 10;
        evidence = m[0];
        break;
      }
    }
  }

  if (tons == null || tons < 1500 || tons > 5000) return null;

  // 环比增加 14.93 吨 / 增加48万盎司
  let changeTons: number | null = null;
  const chTon = plain.match(/环比增加\s*(\d+(?:\.\d+)?)\s*吨|增加\s*(\d+(?:\.\d+)?)\s*吨/);
  if (chTon) {
    changeTons = parseFloat(chTon[1] || chTon[2]);
  } else {
    const chOz = plain.match(/环比增加\s*(\d+(?:\.\d+)?)\s*万盎司|增加\s*(\d+(?:\.\d+)?)\s*万盎司/);
    if (chOz) {
      const wan = parseFloat(chOz[1] || chOz[2]);
      changeTons = Math.round((wan * 10_000) / 32_150.746 * 10) / 10;
    }
  }

  let consecutiveMonths: number | null = null;
  const cm = plain.match(/连续第?\s*(\d+)\s*个?月/);
  if (cm) consecutiveMonths = parseInt(cm[1], 10);

  return { tons, changeTons, evidence, consecutiveMonths };
}

/** 东财搜索 → 解析 PBOC 储备 */
async function fetchFromEastmoneySearch(): Promise<CentralBankRecord | null> {
  const articles = await searchEastmoneyArticles('中国央行黄金储备', 8);

  for (const art of articles) {
    const blob = `${art.title} ${art.content}`;
    if (!/黄金储备|购金|增持.*黄金/.test(blob)) continue;
    const parsed = parsePbocReservesFromText(blob);
    if (!parsed) continue;

    const dateRaw = (art.date ?? '').slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : today;
    const month = date.slice(0, 7);

    console.log(
      `  ⚓ PBOC 储备: ${parsed.tons} 吨`
      + (parsed.changeTons != null ? ` (Δ${parsed.changeTons > 0 ? '+' : ''}${parsed.changeTons}吨)` : '')
      + ` — ${parsed.evidence}`,
    );

    return {
      date,
      reportMonth: month,
      pbocReserves: parsed.tons,
      pbocChange: parsed.changeTons ?? 0,
      pbocConsecutiveMonths: parsed.consecutiveMonths ?? 0,
    };
  }
  return null;
}

/** 拉取最近一次可解析的 PBOC 储备 */
export async function fetchLatestPbocReserve(): Promise<CentralBankRecord | null> {
  try {
    const em = await fetchFromEastmoneySearch();
    if (em) return em;
  } catch (err) {
    console.warn('[pboc-grabber] 东财搜索失败:', err instanceof Error ? err.message : err);
  }

  // 回落：外管局/新闻页（可能 404）
  const urls = [
    'https://www.safe.gov.cn/safe/whzb/index.html',
    'https://finance.sina.com.cn/roll/index.d.html?cid=56588&page=1',
  ];
  for (const url of urls) {
    const text = await curlText(url);
    if (!text) continue;
    const parsed = parsePbocReservesFromText(text);
    if (!parsed) continue;
    const today = new Date().toISOString().slice(0, 10);
    console.log(`  ⚓ PBOC 储备(页): ${parsed.tons} 吨 — ${parsed.evidence}`);
    return {
      date: today,
      reportMonth: today.slice(0, 7),
      pbocReserves: parsed.tons,
      pbocChange: parsed.changeTons ?? 0,
      pbocConsecutiveMonths: parsed.consecutiveMonths ?? 0,
    };
  }
  return null;
}
