// 校准 Tearsheet — 区间收益分布 + 简易策略权益曲线

import type { AnalysisReportRow } from '../db/reports.js';
import type { GoldPricesRepo } from '../db/gold-prices.js';
import { SCORE_BUCKETS } from './score-buckets.js';

export interface BucketReturnStats {
  scoreRange: string;
  sampleSize: number;
  upRate: number;
  avgReturn: number;
  minReturn: number;
  maxReturn: number;
  medianReturn: number;
}

export interface EquityCurvePoint {
  date: string;
  score: number;
  signal: 'invest' | 'half' | 'pause';
  return5d: number;
  cumulativeStrategy: number;
  cumulativeBenchmark: number;
}

export interface CalibrationTearsheet {
  bucketStats: BucketReturnStats[];
  equityCurve: EquityCurvePoint[];
  strategyTotalReturn: number;
  benchmarkTotalReturn: number;
  sampleCount: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function scoreToSignal(score: number): 'invest' | 'half' | 'pause' {
  if (score >= 55) return 'invest';
  if (score >= 45) return 'half';
  return 'pause';
}

function signalWeight(signal: 'invest' | 'half' | 'pause'): number {
  if (signal === 'invest') return 1;
  if (signal === 'half') return 0.5;
  return 0;
}

/** 从报告与金价构建 tearsheet（5 日持有期） */
export function buildCalibrationTearsheet(
  reports: AnalysisReportRow[],
  prices: GoldPricesRepo,
  holdDays = 5,
): CalibrationTearsheet {
  const bucketReturns = new Map<string, number[]>();
  for (const { range } of SCORE_BUCKETS) {
    bucketReturns.set(range, []);
  }

  const equityCurve: EquityCurvePoint[] = [];
  let cumStrategy = 100;
  let cumBenchmark = 100;

  const sorted = [...reports].sort((a, b) => a.date.localeCompare(b.date));

  for (const report of sorted) {
    const current = prices.getByDate(report.date);
    const future = prices.getAfter(report.date, holdDays);
    const futurePrice = future.length >= holdDays ? future[holdDays - 1] : null;
    if (!current?.londonClose || !futurePrice?.londonClose) continue;

    const return5d = (futurePrice.londonClose - current.londonClose) / current.londonClose * 100;
    const signal = scoreToSignal(report.overallScore);
    const w = signalWeight(signal);

    cumBenchmark *= 1 + return5d / 100;
    cumStrategy *= 1 + (return5d * w) / 100;

    equityCurve.push({
      date: report.date,
      score: report.overallScore,
      signal,
      return5d: Math.round(return5d * 100) / 100,
      cumulativeStrategy: Math.round(cumStrategy * 100) / 100,
      cumulativeBenchmark: Math.round(cumBenchmark * 100) / 100,
    });

    for (const { range, min, max } of SCORE_BUCKETS) {
      const isLast = max === 100;
      if (report.overallScore >= min && (isLast ? report.overallScore <= max : report.overallScore < max)) {
        bucketReturns.get(range)!.push(return5d);
        break;
      }
    }
  }

  const bucketStats: BucketReturnStats[] = [];
  for (const { range } of SCORE_BUCKETS) {
    const returns = bucketReturns.get(range)!;
    if (returns.length === 0) continue;
    const upRate = returns.filter(r => r > 0).length / returns.length;
    bucketStats.push({
      scoreRange: range,
      sampleSize: returns.length,
      upRate,
      avgReturn: returns.reduce((a, b) => a + b, 0) / returns.length,
      minReturn: Math.min(...returns),
      maxReturn: Math.max(...returns),
      medianReturn: median(returns),
    });
  }

  return {
    bucketStats,
    equityCurve,
    strategyTotalReturn: Math.round((cumStrategy - 100) * 100) / 100,
    benchmarkTotalReturn: Math.round((cumBenchmark - 100) * 100) / 100,
    sampleCount: equityCurve.length,
  };
}

/** CLI 表格输出 */
export function formatTearsheetConsole(sheet: CalibrationTearsheet): string {
  const lines: string[] = [];
  lines.push('\n  📉 区间 5 日收益分布（Tearsheet）');
  lines.push('  区间      样本  上涨率  均收益  中位数  最小~最大');
  lines.push('  ' + '─'.repeat(52));

  for (const b of sheet.bucketStats) {
    lines.push(
      `  ${b.scoreRange.padEnd(8)} ${String(b.sampleSize).padStart(4)}  `
      + `${(b.upRate * 100).toFixed(0).padStart(5)}%  `
      + `${(b.avgReturn >= 0 ? '+' : '')}${b.avgReturn.toFixed(2).padStart(6)}%  `
      + `${(b.medianReturn >= 0 ? '+' : '')}${b.medianReturn.toFixed(2).padStart(6)}%  `
      + `${b.minReturn.toFixed(1)}~${b.maxReturn.toFixed(1)}%`,
    );
  }

  lines.push('');
  lines.push(`  📈 模拟权益曲线（起点 100，${sheet.sampleCount} 个有效样本）`);
  lines.push(`  策略（≥55 全投 / 45–54 半投 / <45 暂停）: ${sheet.strategyTotalReturn >= 0 ? '+' : ''}${sheet.strategyTotalReturn.toFixed(2)}%`);
  lines.push(`  基准（每报告日均定投）: ${sheet.benchmarkTotalReturn >= 0 ? '+' : ''}${sheet.benchmarkTotalReturn.toFixed(2)}%`);

  if (sheet.equityCurve.length >= 2) {
    const last = sheet.equityCurve[sheet.equityCurve.length - 1];
    const first = sheet.equityCurve[0];
    lines.push(`  期末净值 — 策略 ${last.cumulativeStrategy.toFixed(1)} | 基准 ${last.cumulativeBenchmark.toFixed(1)}（自 ${first.date}）`);
  }

  return lines.join('\n');
}

/** Markdown 导出 */
export function formatTearsheetMarkdown(sheet: CalibrationTearsheet, periodLabel: string): string {
  const lines: string[] = [
    '# 📊 GoldRush 校准 Tearsheet',
    '',
    `> 区间：${periodLabel}　|　有效样本：${sheet.sampleCount}`,
    '',
    '## 评分区间 · 5 日收益分布',
    '',
    '| 区间 | 样本 | 上涨率 | 均收益 | 中位数 | 最小 | 最大 |',
    '|------|------|--------|--------|--------|------|------|',
  ];

  for (const b of sheet.bucketStats) {
    lines.push(
      `| ${b.scoreRange} | ${b.sampleSize} | ${(b.upRate * 100).toFixed(0)}% `
      + `| ${b.avgReturn.toFixed(2)}% | ${b.medianReturn.toFixed(2)}% `
      + `| ${b.minReturn.toFixed(2)}% | ${b.maxReturn.toFixed(2)}% |`,
    );
  }

  lines.push('');
  lines.push('## 模拟权益曲线');
  lines.push('');
  lines.push(`- **策略**（≥55 全投 / 45–54 半投 / <45 暂停）：累计 **${sheet.strategyTotalReturn >= 0 ? '+' : ''}${sheet.strategyTotalReturn.toFixed(2)}%**`);
  lines.push(`- **基准**（每期均投）：累计 **${sheet.benchmarkTotalReturn >= 0 ? '+' : ''}${sheet.benchmarkTotalReturn.toFixed(2)}%**`);
  lines.push('');
  lines.push('| 日期 | 评分 | 信号 | 5日收益 | 策略净值 | 基准净值 |');
  lines.push('|------|------|------|---------|----------|----------|');

  for (const p of sheet.equityCurve.slice(-20)) {
    const sig = p.signal === 'invest' ? '全投' : p.signal === 'half' ? '半投' : '暂停';
    lines.push(
      `| ${p.date} | ${p.score} | ${sig} | ${p.return5d >= 0 ? '+' : ''}${p.return5d.toFixed(2)}% `
      + `| ${p.cumulativeStrategy.toFixed(1)} | ${p.cumulativeBenchmark.toFixed(1)} |`,
    );
  }

  if (sheet.equityCurve.length > 20) {
    lines.push('');
    lines.push(`> 上表仅展示最近 20 条，共 ${sheet.equityCurve.length} 条。`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('> 仅供研究参考，不构成投资建议。模拟假设简化，未计费率与滑点。');
  lines.push('');

  return lines.join('\n');
}
