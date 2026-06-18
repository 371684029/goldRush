// goldrush analysis — 综合分析报告

import { DataCollectorAgent } from '../agents/data-collector.js';
import { ValidatorAgent } from '../agents/validator.js';
import { TechnicalAgent, FundamentalAgent, SentimentAgent, FundAgent } from '../agents/analysis-agents.js';
import { RebuttalAgent } from '../agents/rebuttal.js';
import { OrchestratorAgent } from '../agents/orchestrator.js';
import { header, separator, directionMark, scoreBar, changeColor, riskLevel, valuationMark, sessionMark } from '../utils/format.js';
import { formatNow } from '../utils/time.js';
import type { Horizon } from '../types/config.js';
import type { GoldAnalysisReport } from '../types/analysis.js';

export async function analysisCommand(options: { horizon: Horizon; json: boolean; save: boolean; md: boolean }): Promise<void> {
  console.log('\n🔬 GoldRush 综合分析启动...\n');

  // Step 1: 数据采集 + 验证
  console.log('  📡 Step 1: 采集市场数据...');
  const collector = new DataCollectorAgent();
  let marketData;
  try {
    marketData = await collector.collectMarketData();
  } catch (err) {
    console.error('数据采集失败:', err instanceof Error ? err.message : err);
    await collector.cleanup();
    return;
  }

  const validator = new ValidatorAgent();
  const validation = await validator.validate(marketData);
  console.log(`  ✅ 数据采集完成 (置信度: ${validation.overallConfidence}%)`);

  // Step 1.5: 加载历史数据 + 本地指标已在 TechnicalAgent 中处理

  // Step 2: 四维度分析（两批：技术+基本面 并行，情绪+基金 并行）
  console.log('  🧠 Step 2: 四维度分析...');
  console.log('  📊 分析中: 技术面 & 基本面...');
  const [technical, fundamental] = await Promise.all([
    new TechnicalAgent().analyze(marketData),
    new FundamentalAgent().analyze(marketData),
  ]);
  console.log(`  ✅ 技术面 ${technical.score}/100 | 基本面 ${fundamental.score}/100`);

  console.log('  📊 分析中: 情绪面 & 基金面...');
  const [sentiment, fund] = await Promise.all([
    new SentimentAgent().analyze(marketData),
    new FundAgent().analyze(marketData),
  ]);
  console.log(`  ✅ 情绪面 ${sentiment.score}/100 | 基金面 ${fund.valuation.level}`);

  // Step 2.5: 强制反驳
  console.log('  ⚔️ Step 2.5: 强制反驳...');
  const rebuttalAgent = new RebuttalAgent();
  const rebuttal = await rebuttalAgent.rebut(technical, fundamental, sentiment, fund, marketData);
  console.log(`  ✅ 反驳完成 (看空力度: ${rebuttal.bearScore}/100, 强度: ${rebuttal.rebuttalStrength})`);

  // Step 3: 综合编排
  console.log('  🎯 Step 3: 综合编排...');
  const orchestrator = new OrchestratorAgent();
  const report = await orchestrator.orchestrate(marketData, technical, fundamental, sentiment, fund, rebuttal, options.horizon);
  console.log('  ✅ 编排完成');

  // 输出报告
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, options.horizon);
  }

  // 保存到文件 (JSON)
  if (options.save) {
    const filename = `goldrush-analysis-${new Date().toISOString().slice(0, 10)}.json`;
    const fs = await import('node:fs');
    fs.writeFileSync(filename, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n💾 报告已保存到 ${filename}`);
  }

  // 保存为 Markdown 格式
  if (options.md) {
    const fs = await import('node:fs');
    const docsDir = 'docs';
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    const filename = `${docsDir}/goldrush-analysis-${new Date().toISOString().slice(0, 10)}.md`;
    const mdContent = renderReportMarkdown(report, options.horizon);
    fs.writeFileSync(filename, mdContent, 'utf-8');
    console.log(`\n📝 报告已保存为 Markdown: ${filename}`);
  }

  // 清理
  await collector.cleanup();
  await validator.cleanup();
  await rebuttalAgent.cleanup();
  await orchestrator.cleanup();
}

function printReport(report: GoldAnalysisReport, horizon: Horizon): void {
  const { overall, technical, fundamental, sentiment, fund: fundAnalysis, rebuttal, tailRisks } = report;

  console.log(header('🎯 GoldRush 综合分析报告', formatNow()));

  // 综合研判
  const scoreDisplay = overall?.score ?? 'N/A';
  const directionDisplay = overall?.direction ?? 'neutral';
  console.log(`\n  综合研判: ${directionMark(directionDisplay)} ${scoreDisplay}/100`);
  if (overall?.score) {
    console.log(`  ${scoreBar(overall.score)}`);
  }

  // 校准上下文
  if (overall?.calibration?.historicalAccuracy !== null && overall?.calibration?.historicalAccuracy !== undefined) {
    console.log(`  📊 校准参考: ${overall.calibration.scoreRange}区间历史准确率${Math.round(overall.calibration.historicalAccuracy * 100)}% (${overall.calibration.systematicBias})`);
  }

  // 情景分析
  console.log(`\n  ⚡ 情景分析`);
  const scenarios = overall?.scenarios;
  if (scenarios) {
    const { base, upside, downside } = scenarios;
    console.log(`  基准 (${base.probability}%): ${base.description} → ${base.action}`);
    console.log(`  上行 (${upside.probability}%): ${upside.description} (触发: ${upside.trigger})`);
    console.log(`  下行 (${downside.probability}%): ${downside.description} (触发: ${downside.trigger})`);
  } else {
    console.log(`  (情景数据暂不可用)`);
  };

  // 四维度摘要
  console.log(`\n  📈 四维度摘要`);
  console.log(`  技术面: ${technical.score}/100 ${directionMark(technical.direction)} — ${technical.summary}`);
  console.log(`  基本面: ${fundamental.score}/100 ${directionMark(fundamental.direction)} — ${fundamental.summary}`);
  console.log(`  情绪面: ${sentiment.score}/100 ${directionMark(sentiment.direction)} — ${sentiment.summary}`);
  console.log(`  基金面: 估值${valuationMark(fundAnalysis.valuation.level)}`);

  // 反驳摘要
  console.log(`\n  🔴 强制反驳摘要`);
  console.log(`  反驳强度: ${rebuttal.rebuttalStrength} | 看空力度: ${rebuttal.bearScore}/100`);
  for (const point of rebuttal.bearPoints.slice(0, 3)) {
    console.log(`  · ${point.point} (${point.probability}%概率)`);
  }
  for (const vul of rebuttal.bullVulnerabilities.slice(0, 2)) {
    console.log(`  · 看多漏洞: ${vul.vulnerability}`);
  }
  if (rebuttal.adjustedScore) {
    console.log(`  → 评分从初步${Math.round((technical.score + fundamental.score + sentiment.score) / 3)}分调整为${rebuttal.adjustedScore}分`);
  }

  // 双轨策略
  if (horizon !== 'mid' && overall?.shortTerm) {
    console.log(`\n  ⏱️ 短期策略 (日线级别)`);
    console.log(`  操作: ${overall.shortTerm.action ?? 'N/A'}`);
    console.log(`  入场: ${overall.shortTerm.entryZone ?? 'N/A'}`);
    console.log(`  目标: ${overall.shortTerm.target ?? 'N/A'}`);
    console.log(`  止损: ${overall.shortTerm.stopLoss ?? 'N/A'}`);
    console.log(`  品种: ${overall.shortTerm.recommendedProduct ?? 'N/A'}`);
    console.log(`  ⚠️ ${overall.shortTerm.riskWarning ?? 'N/A'}`);
  }

  if (horizon !== 'short' && overall?.midTerm) {
    console.log(`\n  📅 中长期策略 (周线级别)`);
    const mid = overall.midTerm;
    console.log(`  定投: ${mid.investAdvice?.dipInvest === 'increase' ? '加码' : mid.investAdvice?.dipInvest === 'pause' ? '暂停' : '继续'}`);
    console.log(`  仓位: ${mid.investAdvice?.positionAdjust === 'add' ? '加仓' : mid.investAdvice?.positionAdjust === 'reduce' ? '减仓' : '维持'}`);
    console.log(`  推荐基金: ${mid.investAdvice?.recommendedFund ?? 'N/A'}`);
    console.log(`  支撑区: ${mid.keyLevels?.supportZone ?? 'N/A'}`);
    console.log(`  阻力区: ${mid.keyLevels?.resistanceZone ?? 'N/A'}`);
    console.log(`  ⚠️ ${mid.riskWarning ?? 'N/A'}`);
  }

  // 尾部风险
  if (tailRisks.length > 0) {
    console.log(`\n  ⚠️ 尾部风险`);
    for (const risk of tailRisks) {
      console.log(`  ${risk.probability}% → ${risk.risk}: ${risk.impact} (触发: ${risk.trigger})`);
      console.log(`    对冲: ${risk.mitigation}`);
    }

    // 尾部风险指数
    const noRisk = tailRisks.reduce((p, r) => p * (1 - r.probability / 100), 1);
    const index = (1 - noRisk) * 100;
    console.log(`  综合尾部风险指数: ${index.toFixed(1)}%`);
  }

  console.log(separator('═', 55));
}

/** 渲染报告为 Markdown 格式 */
function renderReportMarkdown(report: GoldAnalysisReport, horizon: Horizon): string {
  const { overall, technical, fundamental, sentiment, fund: fundAnalysis, rebuttal, tailRisks, timestamp } = report;
  const lines: string[] = [];

  lines.push(`# 🥇 GoldRush 综合分析报告`);
  lines.push(``);
  lines.push(`**生成时间**: ${timestamp}`);
  lines.push(`**视角**: ${horizon === 'short' ? '短期' : horizon === 'mid' ? '中长期' : '双视角（短期+中长期）'}`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // 综合研判
  const score = overall?.score ?? 'N/A';
  const dirMap: Record<string, string> = { bullish: '📈 看多', bearish: '📉 看空', neutral: '➡️ 中性' };
  lines.push(`## 🎯 综合研判`);
  lines.push(``);
  lines.push(`**评分**: ${score}/100`);
  lines.push(`**方向**: ${dirMap[overall?.direction ?? 'neutral'] ?? overall?.direction}`);
  lines.push(``);
  if (overall?.calibration?.historicalAccuracy != null) {
    lines.push(`**校准参考**: ${overall.calibration.scoreRange}区间历史准确率 ${Math.round(overall.calibration.historicalAccuracy * 100)}% (${overall.calibration.systematicBias})`);
    lines.push(``);
  }

  // 情景分析
  lines.push(`### ⚡ 情景分析`);
  lines.push(``);
  const scenarios = overall?.scenarios;
  if (scenarios) {
    lines.push(`| 情景 | 概率 | 描述 | 操作/触发 |`);
    lines.push(`|------|------|------|-----------|`);
    lines.push(`| **基准** | ${scenarios.base.probability}% | ${scenarios.base.description} | ${scenarios.base.action} |`);
    lines.push(`| **上行** | ${scenarios.upside.probability}% | ${scenarios.upside.description} | 触发: ${scenarios.upside.trigger} |`);
    lines.push(`| **下行** | ${scenarios.downside.probability}% | ${scenarios.downside.description} | 触发: ${scenarios.downside.trigger} |`);
  } else {
    lines.push(`情景数据暂不可用`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // 四维度分析
  lines.push(`## 📈 四维度分析`);
  lines.push(``);

  lines.push(`### 技术面 — ${technical.score}/100 — ${dirMap[technical.direction] ?? technical.direction}`);
  lines.push(``);
  lines.push(`${technical.summary}`);
  lines.push(``);
  lines.push(`**关键论点**:`);
  for (const kp of technical.keyPoints) lines.push(`- ${kp}`);
  lines.push(``);
  lines.push(`**反面论据**:`);
  for (const cp of technical.counterPoints) lines.push(`- ${cp}`);
  lines.push(``);
  if (technical.shortTerm) {
    const st = technical.shortTerm;
    lines.push(`**短期 (日线)**: 支撑 ${st.support} | 阻力 ${st.resistance} | 趋势: ${st.trend}`);
    lines.push(`  - MA5: ${st.indicators.ma5} | MA20: ${st.indicators.ma20} | MACD: ${st.indicators.macd} | RSI: ${st.indicators.rsi}`);
    lines.push(`  - 关键信号: ${st.keySignal}`);
  }
  if (technical.midTerm) {
    const mt = technical.midTerm;
    lines.push(`**中长期 (周线)**: 支撑 ${mt.support} | 阻力 ${mt.resistance} | 趋势: ${mt.trend}`);
    lines.push(`  - MA20W: ${mt.indicators.ma20w} | MA60W: ${mt.indicators.ma60w} | MACD: ${mt.indicators.macd} | RSI: ${mt.indicators.rsi}`);
    lines.push(`  - 关键信号: ${mt.keySignal}`);
  }
  lines.push(``);
  lines.push(`**来源**: ${technical.sources.join(', ')}`);
  lines.push(``);

  lines.push(`### 基本面 — ${fundamental.score}/100 — ${dirMap[fundamental.direction] ?? fundamental.direction}`);
  lines.push(``);
  lines.push(`${fundamental.summary}`);
  lines.push(``);
  lines.push(`**关键论点**:`);
  for (const kp of fundamental.keyPoints) lines.push(`- ${kp}`);
  lines.push(``);
  lines.push(`**反面论据**:`);
  for (const cp of fundamental.counterPoints) lines.push(`- ${cp}`);
  lines.push(``);
  if (fundamental.dollarIndexEffect) lines.push(`- **美元指数**: ${fundamental.dollarIndexEffect}`);
  if (fundamental.interestRateEffect) lines.push(`- **利率**: ${fundamental.interestRateEffect}`);
  if (fundamental.inflationEffect) lines.push(`- **通胀**: ${fundamental.inflationEffect}`);
  if (fundamental.fedStance) lines.push(`- **美联储**: ${fundamental.fedStance}`);
  lines.push(``);
  lines.push(`**来源**: ${fundamental.sources.join(', ')}`);
  lines.push(``);

  lines.push(`### 情绪面 — ${sentiment.score}/100 — ${dirMap[sentiment.direction] ?? sentiment.direction}`);
  lines.push(``);
  lines.push(`${sentiment.summary}`);
  lines.push(``);
  lines.push(`**关键论点**:`);
  for (const kp of sentiment.keyPoints) lines.push(`- ${kp}`);
  lines.push(``);
  lines.push(`**反面论据**:`);
  for (const cp of sentiment.counterPoints) lines.push(`- ${cp}`);
  lines.push(``);
  if (sentiment.centralBanks) lines.push(`- **央行购金**: ${sentiment.centralBanks}`);
  if (sentiment.cftcPosition) lines.push(`- **CFTC持仓**: ${sentiment.cftcPosition}`);
  if (sentiment.vix) lines.push(`- **VIX**: ${sentiment.vix}`);
  if (sentiment.geopoliticalRisk) lines.push(`- **地缘风险**: ${sentiment.geopoliticalRisk}`);
  if (sentiment.etfFlows) lines.push(`- **ETF资金流**: ${sentiment.etfFlows}`);
  lines.push(``);
  lines.push(`**来源**: ${sentiment.sources.join(', ')}`);
  lines.push(``);

  lines.push(`### 基金面 — 估值: ${fundAnalysis.valuation.level}`);
  lines.push(``);
  lines.push(`**判断依据**: ${fundAnalysis.valuation.indicator}`);
  lines.push(`**操作建议**: ${fundAnalysis.valuation.action}`);
  if (fundAnalysis.premiumDiscount) {
    lines.push(`**溢价/折价**: ${fundAnalysis.premiumDiscount.current}% (${fundAnalysis.premiumDiscount.trend})`);
    lines.push(`  - 建议: ${fundAnalysis.premiumDiscount.advice}`);
  }
  if (fundAnalysis.recommendation) {
    lines.push(`**推荐**:`);
    if (fundAnalysis.recommendation.longTerm) lines.push(`  - 长期: ${fundAnalysis.recommendation.longTerm}`);
    if (fundAnalysis.recommendation.mediumTerm) lines.push(`  - 中期: ${fundAnalysis.recommendation.mediumTerm}`);
    if (fundAnalysis.recommendation.dipBuy) lines.push(`  - 逢跌: ${fundAnalysis.recommendation.dipBuy}`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // 强制反驳
  lines.push(`## 🔴 强制反驳`);
  lines.push(``);
  lines.push(`**反驳强度**: ${rebuttal.rebuttalStrength} | **看空力度**: ${rebuttal.bearScore}/100`);
  lines.push(``);
  lines.push(`### 看空论据`);
  for (const bp of rebuttal.bearPoints) {
    lines.push(`- **${bp.point}** (${bp.probability}%概率)`);
    lines.push(`  - 证据: ${bp.evidence}`);
    lines.push(`  - 影响: ${bp.impact}`);
  }
  lines.push(``);
  lines.push(`### 看多漏洞`);
  for (const vul of rebuttal.bullVulnerabilities) {
    lines.push(`- **${vul.vulnerability}**`);
    if (vul.originalPoint) lines.push(`  - 原论点: ${vul.originalPoint}`);
    if (vul.counterCondition) lines.push(`  - 反制条件: ${vul.counterCondition}`);
  }
  lines.push(``);
  if (rebuttal.adjustedScore) {
    lines.push(`**评分调整**: 初步 ${Math.round((technical.score + fundamental.score + sentiment.score) / 3)} → 修正 ${rebuttal.adjustedScore}`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // 策略建议
  if (horizon !== 'mid' && overall?.shortTerm) {
    lines.push(`## ⏱️ 短期策略`);
    lines.push(``);
    lines.push(`| 项目 | 建议 |`);
    lines.push(`|------|------|`);
    lines.push(`| 操作 | ${overall.shortTerm.action} |`);
    lines.push(`| 入场区间 | ${overall.shortTerm.entryZone} |`);
    lines.push(`| 目标 | ${overall.shortTerm.target} |`);
    lines.push(`| 止损 | ${overall.shortTerm.stopLoss} |`);
    lines.push(`| 推荐品种 | ${overall.shortTerm.recommendedProduct} |`);
    lines.push(`| ⚠️ 风险提示 | ${overall.shortTerm.riskWarning} |`);
    lines.push(``);
  }

  if (horizon !== 'short' && overall?.midTerm) {
    const mid = overall.midTerm;
    lines.push(`## 📅 中长期策略`);
    lines.push(``);
    const dipMap: Record<string, string> = { increase: '加码定投', pause: '暂停定投', continue: '继续定投' };
    const posMap: Record<string, string> = { add: '加仓', reduce: '减仓', hold: '维持仓位' };
    lines.push(`| 项目 | 建议 |`);
    lines.push(`|------|------|`);
    lines.push(`| 定投操作 | ${dipMap[mid.investAdvice?.dipInvest] ?? mid.investAdvice?.dipInvest} |`);
    lines.push(`| 仓位调整 | ${posMap[mid.investAdvice?.positionAdjust] ?? mid.investAdvice?.positionAdjust} |`);
    lines.push(`| 推荐基金 | ${mid.investAdvice?.recommendedFund} |`);
    lines.push(`| 支撑区 | ${mid.keyLevels?.supportZone} |`);
    lines.push(`| 阻力区 | ${mid.keyLevels?.resistanceZone} |`);
    lines.push(`| ⚠️ 风险提示 | ${mid.riskWarning} |`);
    lines.push(``);
  }

  // 尾部风险
  if (tailRisks.length > 0) {
    lines.push(`## ⚠️ 尾部风险`);
    lines.push(``);
    for (const risk of tailRisks) {
      lines.push(`### ${risk.probability}% — ${risk.risk}`);
      lines.push(``);
      lines.push(`- **影响**: ${risk.impact}`);
      lines.push(`- **触发条件**: ${risk.trigger}`);
      lines.push(`- **对冲措施**: ${risk.mitigation}`);
      lines.push(``);
    }
    const noRisk = tailRisks.reduce((p, r) => p * (1 - r.probability / 100), 1);
    const index = (1 - noRisk) * 100;
    lines.push(`**综合尾部风险指数**: ${index.toFixed(1)}%`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*报告由 GoldRush 自动生成，仅供投资研究参考，不构成投资建议*`);

  return lines.join('\n');
}
