// 维度 / 反驳 LLM 输出 Zod 校验 — 防止字段漂移与非法评分

import { z } from 'zod';
import type {
  Direction,
  FundamentalAnalysis,
  RebuttalAnalysis,
  RebuttalStrength,
  SentimentAnalysis,
  TechnicalAnalysis,
} from '../types/analysis.js';

const directionSchema = z.enum(['bullish', 'bearish', 'neutral']).catch('neutral' as Direction);

const scoreSchema = z.coerce.number().finite().transform((n) => Math.max(0, Math.min(100, Math.round(n))));

const stringList = z.array(z.string()).catch([]).transform((arr) => arr.map(String));

const dimensionBase = z.object({
  score: scoreSchema,
  direction: directionSchema,
  keyPoints: stringList,
  counterPoints: stringList,
  summary: z.string().catch(''),
  sources: stringList,
});

const shortTermSchema = z.object({
  timeframe: z.literal('daily').catch('daily'),
  support: z.coerce.number().finite().catch(0),
  resistance: z.coerce.number().finite().catch(0),
  trend: z.string().catch('未知'),
  indicators: z.object({
    ma5: z.string().catch('未知'),
    ma20: z.string().catch('未知'),
    macd: z.string().catch('未知'),
    rsi: z.string().catch('未知'),
  }).passthrough().catch({
    ma5: '未知', ma20: '未知', macd: '未知', rsi: '未知',
  }),
  keySignal: z.string().catch('无信号'),
}).passthrough();

const midTermSchema = z.object({
  timeframe: z.literal('weekly').catch('weekly'),
  support: z.coerce.number().finite().catch(0),
  resistance: z.coerce.number().finite().catch(0),
  trend: z.string().catch('未知'),
  indicators: z.object({
    ma20w: z.string().catch('未知'),
    ma60w: z.string().catch('未知'),
    macd: z.string().catch('未知'),
    rsi: z.string().catch('未知'),
  }).passthrough().catch({
    ma20w: '未知', ma60w: '未知', macd: '未知', rsi: '未知',
  }),
  keySignal: z.string().catch('无信号'),
}).passthrough();

const technicalSchema = dimensionBase.extend({
  shortTerm: shortTermSchema.catch({
    timeframe: 'daily' as const,
    support: 0,
    resistance: 0,
    trend: '未知',
    indicators: { ma5: '未知', ma20: '未知', macd: '未知', rsi: '未知' },
    keySignal: '无信号',
  }),
  midTerm: midTermSchema.catch({
    timeframe: 'weekly' as const,
    support: 0,
    resistance: 0,
    trend: '未知',
    indicators: { ma20w: '未知', ma60w: '未知', macd: '未知', rsi: '未知' },
    keySignal: '无信号',
  }),
}).passthrough();

const fundamentalSchema = dimensionBase.extend({
  dollarIndexEffect: z.string().catch('未知'),
  interestRateEffect: z.string().catch('未知'),
  inflationEffect: z.string().catch('未知'),
  fedStance: z.string().catch('未知'),
}).passthrough();

const sentimentSchema = dimensionBase.extend({
  centralBanks: z.string().catch('未知'),
  cftcPosition: z.string().catch('未知'),
  vix: z.string().catch('未知'),
  geopoliticalRisk: z.string().catch('未知'),
  etfFlows: z.string().catch('未知'),
}).passthrough();

const strengthSchema = z.enum(['weak', 'moderate', 'strong']).catch('moderate' as RebuttalStrength);

const bearPointSchema = z.object({
  point: z.string().catch(''),
  evidence: z.string().catch(''),
  probability: z.coerce.number().finite().catch(0).transform((n) => Math.max(0, Math.min(100, n))),
  impact: z.string().catch(''),
}).passthrough();

const bullVulnSchema = z.object({
  originalPoint: z.string().catch(''),
  vulnerability: z.string().catch(''),
  counterCondition: z.string().catch(''),
}).passthrough();

const tailRiskSchema = z.object({
  risk: z.string().catch(''),
  probability: z.coerce.number().finite().catch(0).transform((n) => Math.max(0, Math.min(100, n))),
  impact: z.string().catch(''),
  trigger: z.string().catch(''),
  mitigation: z.string().catch(''),
}).passthrough().transform((t) => ({
  ...t,
  // LLM 偶发用 hedge 字段
  mitigation: t.mitigation || (typeof (t as { hedge?: string }).hedge === 'string' ? (t as { hedge?: string }).hedge! : ''),
}));

/** 反驳 LLM 原始输出（强度可能被本地重算） */
const rebuttalRawSchema = z.object({
  bearScore: scoreSchema,
  bearPoints: z.array(bearPointSchema).catch([]),
  bullVulnerabilities: z.array(bullVulnSchema).catch([]),
  rebuttalStrength: strengthSchema,
  tailRisks: z.array(tailRiskSchema).catch([]),
}).passthrough();

export function parseTechnicalAnalysis(input: unknown): TechnicalAnalysis {
  return technicalSchema.parse(input) as TechnicalAnalysis;
}

export function parseFundamentalAnalysis(input: unknown): FundamentalAnalysis {
  return fundamentalSchema.parse(input) as FundamentalAnalysis;
}

export function parseSentimentAnalysis(input: unknown): SentimentAnalysis {
  return sentimentSchema.parse(input) as SentimentAnalysis;
}

export function parseRebuttalRaw(input: unknown): {
  bearScore: number;
  bearPoints: RebuttalAnalysis['bearPoints'];
  bullVulnerabilities: RebuttalAnalysis['bullVulnerabilities'];
  rebuttalStrength: RebuttalStrength;
  tailRisks: RebuttalAnalysis['tailRisks'];
} {
  const p = rebuttalRawSchema.parse(input);
  return {
    bearScore: p.bearScore,
    bearPoints: p.bearPoints as RebuttalAnalysis['bearPoints'],
    bullVulnerabilities: p.bullVulnerabilities as RebuttalAnalysis['bullVulnerabilities'],
    rebuttalStrength: p.rebuttalStrength,
    tailRisks: p.tailRisks as RebuttalAnalysis['tailRisks'],
  };
}
