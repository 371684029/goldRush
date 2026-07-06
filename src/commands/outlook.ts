// goldrush outlook — 长期方向预期（1/3/5 年）

import fs from 'node:fs';
import { getDb } from '../db/index.js';
import { ReportsRepo } from '../db/reports.js';
import { GoldPricesRepo } from '../db/gold-prices.js';
import { forwardFillCloses, latestDeviationFromMA } from '../utils/price-series.js';
import { detectMacroRegime } from '../utils/macro-regime.js';
import {
  buildLongTermOutlook,
  formatLongTermOutlookConsole,
  formatLongTermOutlookMarkdown,
} from '../utils/long-term-outlook.js';
import { header, separator } from '../utils/format.js';
import type { GoldAnalysisReport } from '../types/analysis.js';

export function outlookCommand(options: { json: boolean; md: boolean }): number {
  const db = getDb();
  const reports = new ReportsRepo(db).getRecent(30);

  if (reports.length === 0) {
    console.log('\n⚠️ 暂无分析报告，请先运行: goldrush analysis\n');
    return 1;
  }

  const latest = reports[0];
  let report: GoldAnalysisReport;
  try {
    report = JSON.parse(latest.reportJson) as GoldAnalysisReport;
  } catch {
    console.error('❌ 无法解析最新报告 JSON');
    return 1;
  }

  let goldDeviation: number | null = null;
  try {
    const closes = forwardFillCloses(new GoldPricesRepo(db).getRecent(60));
    goldDeviation = latestDeviationFromMA(closes, 20);
  } catch { /* ignore */ }

  const macroRegime = detectMacroRegime(report.marketData, goldDeviation);
  const outlook = report.longTermOutlook ?? buildLongTermOutlook({
    technical: report.technical,
    fundamental: report.fundamental,
    sentiment: report.sentiment,
    rebuttal: report.rebuttal,
    overallScore: report.overall.score,
    overallDirection: report.overall.direction,
    macroRegime,
  });

  if (options.json) {
    console.log(JSON.stringify({ date: latest.date, macroRegime, longTermOutlook: outlook }, null, 2));
    return 0;
  }

  console.log(header('🔭 GoldRush 长期方向预期', `基于 ${latest.date} 分析报告`));
  console.log(formatLongTermOutlookConsole(outlook));

  if (options.md) {
    const docsDir = 'docs';
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    const outPath = `${docsDir}/goldrush-outlook-latest.md`;
    fs.writeFileSync(outPath, formatLongTermOutlookMarkdown(outlook), 'utf-8');
    console.log(`\n📝 已写入 ${outPath}`);
  }

  console.log(separator('═', 55));
  return 0;
}
