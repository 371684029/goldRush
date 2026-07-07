// MarketData Zod 校验与规范化 — LLM 输出后兜底

import { z } from 'zod';
import { gradeSource } from '../utils/source-rank.js';
import type { MarketData, SourceGrade, SourcedPrice } from '../types/market.js';

const sourceGradeSchema = z.enum(['A', 'B', 'C']).catch('B' as SourceGrade);

const sourcedPriceInner = z.object({
  value: z.number().finite().nullable().optional(),
  change: z.number().finite().optional().default(0),
  source: z.string().optional().default('unknown'),
  sourceGrade: sourceGradeSchema.optional(),
  verifiedAt: z.string().optional().default(''),
});

const sourcedPriceSchema = z.union([
  z.number().finite(),
  sourcedPriceInner,
  z.null(),
]).transform((p): SourcedPrice | null => {
  // null → 返回 null，调用方处理
  if (p == null) return null;
  // 如果 LLM 只输出一个数字（如 4175.39），自动补齐为对象
  if (typeof p === 'number') {
    return {
      value: p,
      change: 0,
      source: 'unknown',
      sourceGrade: 'B' as SourceGrade,
      verifiedAt: new Date().toISOString(),
    };
  }
  // 对象格式
  if (p.value == null || !Number.isFinite(p.value)) return null;
  const source = p.source || 'unknown';
  return {
    value: p.value,
    change: p.change ?? 0,
    source,
    sourceGrade: (p.sourceGrade ?? gradeSource(source)) as SourceGrade,
    verifiedAt: p.verifiedAt || new Date().toISOString(),
  };
});

const optionalSourcedPriceList = z.array(sourcedPriceSchema).optional().default([]);

const marketDataSchema = z.object({
  timestamp: z.string().min(1).catch(() => new Date().toISOString()),
  london: z.object({
    price: sourcedPriceSchema,
    altPrices: optionalSourcedPriceList,
    high: z.unknown().optional(),
    low: z.unknown().optional(),
  }).passthrough().optional().catch(undefined),
  shanghai: z.object({
    price: sourcedPriceSchema,
    altPrices: optionalSourcedPriceList,
    high: z.unknown().optional(),
    low: z.unknown().optional(),
  }).passthrough().optional().catch(undefined),
  etf: z.object({
    code: z.string().optional().default('518880'),
    name: z.string().optional().default('华安黄金ETF'),
    nav: sourcedPriceSchema,
    premiumDiscount: z.unknown().optional(),
  }).passthrough().optional().catch(undefined),
  dollarIndex: z.object({
    value: sourcedPriceSchema,
  }).passthrough().optional().catch(undefined),
  usTreasury: z.object({
    yield10y: sourcedPriceSchema,
    tips: z.object({
      value: z.number().finite().nullable().optional(),
      source: z.string().optional(),
      sourceGrade: sourceGradeSchema.optional(),
      verifiedAt: z.string().optional(),
    }).nullable().optional(),
  }).passthrough().optional().catch(undefined),
}).passthrough();

function nullPrice(): SourcedPrice {
  return {
    value: 0,
    change: 0,
    source: 'N/A',
    sourceGrade: 'C',
    verifiedAt: new Date().toISOString(),
  };
}

/** 规范化 LLM 输出的 MarketData，过滤无效 altPrices */
export function parseMarketData(input: unknown): MarketData {
  const parsed = marketDataSchema.parse(input);

  const filterAlts = (alts: Array<SourcedPrice | null>): SourcedPrice[] =>
    alts.filter((p): p is SourcedPrice => p != null);

  const londonPrice = parsed.london?.price ?? nullPrice();
  const shanghaiPrice = parsed.shanghai?.price ?? nullPrice();
  const etfNav = parsed.etf?.nav ?? nullPrice();
  const dxy = parsed.dollarIndex?.value ?? nullPrice();
  const y10 = parsed.usTreasury?.yield10y ?? nullPrice();
  const tips = parsed.usTreasury?.tips;

  return {
    timestamp: parsed.timestamp,
    london: {
      ...(parsed.london ?? {}),
      price: londonPrice,
      altPrices: filterAlts((parsed.london?.altPrices ?? []) as Array<SourcedPrice | null>),
    },
    shanghai: {
      ...(parsed.shanghai ?? {}),
      price: shanghaiPrice,
      altPrices: filterAlts((parsed.shanghai?.altPrices ?? []) as Array<SourcedPrice | null>),
    },
    etf: {
      ...(parsed.etf ?? {}),
      nav: etfNav,
    },
    dollarIndex: { value: dxy },
    usTreasury: {
      yield10y: y10,
      tips: tips?.value != null
        ? {
            value: tips.value,
            source: tips.source ?? 'unknown',
            sourceGrade: (tips.sourceGrade ?? 'B') as SourceGrade,
            verifiedAt: tips.verifiedAt ?? '',
          }
        : { value: 0, source: 'N/A', sourceGrade: 'C', verifiedAt: '' },
    },
  } as MarketData;
}
