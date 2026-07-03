// 搜索 snippet 启发式抽价 — Validator 独立 spot-check（无额外 LLM）

import { gradeSource } from './source-rank.js';
import type { SearchResult, ValidationSource } from '../types/market.js';

const LONDON_MIN = 800;
const LONDON_MAX = 12000;
const SHANGHAI_MIN = 200;
const SHANGHAI_MAX = 2000;

/** 从 Tavily 结果中提取伦敦金 USD/oz 候选价 */
export function extractLondonPricesFromSearch(results: SearchResult[]): ValidationSource[] {
  const out: ValidationSource[] = [];
  const seen = new Set<number>();

  for (const r of results) {
    const text = `${r.title} ${r.snippet}`;
    const patterns = [
      /\$\s*([\d,]+\.?\d*)/g,
      /([\d,]+\.?\d*)\s*(?:USD|usd)\s*(?:\/|\s)?(?:oz|ounce)?/gi,
      /XAU\/?USD[^\d]*([\d,]+\.?\d*)/gi,
      /(?:伦敦金|现货黄金)[^\d]*([\d,]+\.?\d*)/g,
    ];

    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) != null) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!Number.isFinite(val) || val < LONDON_MIN || val > LONDON_MAX) continue;
        const key = Math.round(val * 10);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          value: val,
          source: r.title.slice(0, 48) || r.url,
          grade: r.sourceGrade ?? gradeSource(r.url),
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
  return out;
}

/** 从搜索结果提取上海金 CNY/g 候选价 */
export function extractShanghaiPricesFromSearch(results: SearchResult[]): ValidationSource[] {
  const out: ValidationSource[] = [];
  const seen = new Set<number>();

  for (const r of results) {
    const text = `${r.title} ${r.snippet}`;
    const patterns = [
      /(?:¥|￥|元)\s*([\d,]+\.?\d*)\s*(?:\/|\s)?g/gi,
      /([\d,]+\.?\d*)\s*(?:元\/克|元\/g|CNY\/g)/gi,
      /Au99\.99[^\d]*([\d,]+\.?\d*)/gi,
      /上海金[^\d]*([\d,]+\.?\d*)/g,
    ];

    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) != null) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!Number.isFinite(val) || val < SHANGHAI_MIN || val > SHANGHAI_MAX) continue;
        const key = Math.round(val * 100);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          value: val,
          source: r.title.slice(0, 48) || r.url,
          grade: r.sourceGrade ?? gradeSource(r.url),
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
  return out;
}

/** 合并验证源，跳过与已有值过于接近的重复项（% 容差） */
export function mergeValidationSources(
  existing: ValidationSource[],
  extra: ValidationSource[],
  tolerancePct = 0.05,
): ValidationSource[] {
  const merged = [...existing];
  for (const e of extra) {
    if (typeof e.value !== 'number') continue;
    const dup = merged.some(m => {
      if (typeof m.value !== 'number' || typeof e.value !== 'number') return false;
      const avg = (m.value + e.value) / 2;
      return avg > 0 && Math.abs(m.value - e.value) / avg * 100 < tolerancePct;
    });
    if (!dup) merged.push(e);
  }
  return merged;
}

/** 是否已有足够多源 */
export function needsSpotCheck(sources: ValidationSource[], minSources = 2): boolean {
  return sources.filter(s => typeof s.value === 'number').length < minSources;
}
