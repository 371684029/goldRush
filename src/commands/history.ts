// goldrush history — 查看本地历史数据/报告/基金净值

import Table from 'cli-table3';
import { getDb } from '../db/index.js';
import { GoldPricesRepo } from '../db/gold-prices.js';
import { ReportsRepo } from '../db/reports.js';
import { FundNavRepo } from '../db/fund-nav.js';
import { TRACKED_FUNDS } from '../types/fund.js';
import { pctChangeSince } from '../utils/fund-nav-stats.js';
import { header, directionMark } from '../utils/format.js';

export type HistoryType = 'prices' | 'reports' | 'funds';

export async function historyCommand(
  type: HistoryType = 'prices',
  days: number = 30,
): Promise<void> {
  const db = getDb();

  if (type === 'prices') {
    const repo = new GoldPricesRepo(db);
    const records = repo.getRecent(days);

    console.log(header('📜 GoldRush 历史金价', `最近${days}天 | 共${records.length}条`));

    if (records.length === 0) {
      console.log('\n  ⚠️ 暂无历史数据');
      console.log('  请运行 goldrush price、goldrush snapshot 或 goldrush init-history');
      return;
    }

    const table = new Table({
      head: ['日期', '伦敦金', '上海金', 'ETF净值', '美元指数'],
      colAligns: ['left', 'right', 'right', 'right', 'right'],
      style: { head: ['cyan'] },
    });

    for (const r of records.slice(-20)) {
      table.push([
        r.date,
        r.londonClose != null ? `$${r.londonClose.toFixed(2)}` : 'N/A',
        r.shanghaiClose != null ? `¥${r.shanghaiClose.toFixed(2)}` : 'N/A',
        r.etfNav != null ? r.etfNav.toFixed(3) : 'N/A',
        r.dollarIndex != null ? r.dollarIndex.toFixed(2) : 'N/A',
      ]);
    }

    console.log(table.toString());
    return;
  }

  if (type === 'funds') {
    const repo = new FundNavRepo(db);
    const latest = repo.getLatestPerCode(days);
    const nameByCode = Object.fromEntries(TRACKED_FUNDS.map(f => [f.code, f.name]));

    console.log(header('📜 GoldRush 基金净值', `最近${days}天 | ${latest.length} 只基金有数据`));

    if (latest.length === 0) {
      console.log('\n  ⚠️ 暂无 fund_nav 数据');
      console.log('  请运行 goldrush fund 或 goldrush price 采集');
      return;
    }

    const table = new Table({
      head: ['代码', '基金', '日期', '净值', '近1周', '近1月'],
      colAligns: ['left', 'left', 'left', 'right', 'right', 'right'],
      style: { head: ['cyan'] },
    });

    for (const row of latest) {
      const recent = repo.getRecent(row.code, days);
      const c1w = pctChangeSince(recent, 7);
      const c1m = pctChangeSince(recent, 30);
      table.push([
        row.code,
        (nameByCode[row.code] ?? row.code).slice(0, 12),
        row.date,
        row.nav.toFixed(4),
        c1w != null ? `${c1w >= 0 ? '+' : ''}${c1w.toFixed(2)}%` : 'N/A',
        c1m != null ? `${c1m >= 0 ? '+' : ''}${c1m.toFixed(2)}%` : 'N/A',
      ]);
    }

    console.log(table.toString());
    return;
  }

  const repo = new ReportsRepo(db);
  const reports = repo.getRecent(days);

  console.log(header('📜 GoldRush 历史报告', `最近${days}天 | 共${reports.length}条`));

  if (reports.length === 0) {
    console.log('\n  ⚠️ 暂无历史报告');
    console.log('  请运行 goldrush analysis 积累分析数据');
    return;
  }

  const table = new Table({
    head: ['日期', '评分', '方向', '视角'],
    colAligns: ['left', 'right', 'left', 'left'],
    style: { head: ['cyan'] },
  });

  for (const r of reports) {
    table.push([r.date, `${r.overallScore}/100`, directionMark(r.direction), r.horizon]);
  }

  console.log(table.toString());
}
