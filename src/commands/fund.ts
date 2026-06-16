// goldrush fund — 黄金基金对比分析

import { DataCollectorAgent } from '../agents/data-collector.js';
import { FundAgent } from '../agents/analysis-agents.js';
import { header, separator, valuationMark } from '../utils/format.js';
import { formatNow } from '../utils/time.js';
import Table from 'cli-table3';
import chalk from 'chalk';

export async function fundCommand(): Promise<void> {
  console.log('\n💰 GoldRush 基金分析启动...\n');

  // 采集数据
  const collector = new DataCollectorAgent();
  let marketData;
  try {
    marketData = await collector.collectMarketData();
  } catch (err) {
    console.error('数据采集失败:', err instanceof Error ? err.message : err);
    await collector.cleanup();
    return;
  }

  // 基金面分析
  const fundAgent = new FundAgent();
  const analysis = await fundAgent.analyze(marketData);

  // 输出
  console.log(header('💰 GoldRush 黄金基金分析', `${formatNow()} | 面向支付宝中期配置`));

  // 基金对比表
  const table = new Table({
    head: ['基金', '类型', '最新净值', '近1月', '费率', '规模', '适合'],
    colWidths: [16, 6, 10, 8, 8, 8, 16],
    style: { head: ['cyan'] },
  });

  for (const f of (analysis.funds ?? [])) {
    table.push([
      f.name.slice(0, 8),
      f.type + '类',
      f.nav.toFixed(4),
      f.change1m > 0 ? chalk.red(`+${f.change1m.toFixed(1)}%`) : chalk.green(`${f.change1m.toFixed(1)}%`),
      f.feeRate.toFixed(2) + '%',
      f.scale + '亿',
      f.recommendation,
    ]);
  }

  console.log('\n' + table.toString());

  // 估值水位
  console.log(`\n  📈 估值水位: ${valuationMark(analysis.valuation.level)}`);
  console.log(`  ${analysis.valuation.indicator}`);
  console.log(`  建议: ${analysis.valuation.action}`);

  // 溢价折价
  const pd = analysis.premiumDiscount;
  const pdMark = pd.current > 0 ? chalk.red(`溢价${pd.current.toFixed(2)}%`) : pd.current < 0 ? chalk.green(`折价${Math.abs(pd.current).toFixed(2)}%`) : '合理';
  console.log(`\n  💹 溢价折价: ${pdMark}`);
  console.log(`  ${pd.advice}`);

  // 推荐配置
  console.log(`\n${separator('━', 55)}`);
  console.log(`  🎯 推荐配置`);
  console.log(`  定投基础仓: ${analysis.recommendation.longTerm}`);
  console.log(`  波段加减仓: ${analysis.recommendation.mediumTerm}`);
  console.log(`  定投入门: ${analysis.recommendation.dipBuy}`);
  console.log(separator('═', 55));

  await collector.cleanup();
  await fundAgent.cleanup();
}
