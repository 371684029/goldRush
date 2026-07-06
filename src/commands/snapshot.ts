// goldrush snapshot — 手动保存数据快照
// goldrush init-history — Yahoo 回填 + 当日采集

import { getDb } from '../db/index.js';
import { GoldPricesRepo } from '../db/gold-prices.js';
import { DataCollectorAgent } from '../agents/data-collector.js';
import { ensureGoldPriceHistory, MIN_TRADING_ROWS_FOR_ANALYSIS } from '../utils/ensure-gold-history.js';
import { todayDate } from '../utils/time.js';

export async function snapshotCommand(): Promise<void> {
  console.log('\n📸 保存数据快照...\n');

  const db = getDb();
  const repo = new GoldPricesRepo(db);

  const today = todayDate();
  const existing = repo.getByDate(today);

  if (existing) {
    console.log(`  ⚠️ ${today} 的数据已存在`);
    console.log(`  伦敦金: $${existing.londonClose ?? 'N/A'}`);
    console.log(`  如需更新，请运行 goldrush price`);
    return;
  }

  console.log('  采集当前市场数据...');
  const collector = new DataCollectorAgent();
  try {
    const marketData = await collector.collectMarketData();
    console.log('  ✅ 数据已自动保存到 SQLite');
    console.log(`  伦敦金: $${marketData.london.price.value}`);
    console.log(`  上海金: ¥${marketData.shanghai.price.value}/g`);
  } catch (err) {
    console.error('  ❌ 采集失败:', err instanceof Error ? err.message : err);
  } finally {
    await collector.cleanup();
  }
}

export async function initHistoryCommand(days = 60): Promise<void> {
  console.log(`\n📜 历史数据初始化（目标 ${days} 天）...\n`);

  const db = getDb();
  const repo = new GoldPricesRepo(db);
  const before = repo.count();

  console.log(`  当前已有 ${before} 条历史数据`);
  console.log('  📥 从 Yahoo Finance (GC=F) 拉取日线并写入 SQLite...');

  try {
    const hist = await ensureGoldPriceHistory(repo, days);
    if (hist.filled > 0) {
      console.log(`  ✅ Yahoo 补全 ${hist.filled} 个交易日（窗口内共 ${hist.tradingRows} 行 london_close）`);
    } else if (hist.readyForAnalysis) {
      console.log(`  ✅ 历史已就绪（${hist.tradingRows} 个交易日，无需补全）`);
    } else {
      console.log(`  ⚠️ 窗口内仅 ${hist.tradingRows} 行，建议检查网络后重试`);
    }

    if (!hist.readyForAnalysis) {
      console.log('  🔍 尝试 Tavily+LLM 补充剩余缺失日...');
      const collector = new DataCollectorAgent();
      try {
        const { filled } = await collector.backfillHistory(days);
        if (filled > hist.filled) {
          console.log(`  ✅ 额外补全 ${filled - hist.filled} 行`);
        }
      } catch (err) {
        console.error('  ⚠️ Tavily 补充失败:', err instanceof Error ? err.message : err);
      } finally {
        await collector.cleanup();
      }
    }
  } catch (err) {
    console.error('  ❌ Yahoo 回填失败:', err instanceof Error ? err.message : err);
    console.log('  💡 请确认服务器可访问 query1.finance.yahoo.com');
  }

  const tradingRows = new GoldPricesRepo(db).getRecent(days).filter(r => r.londonClose != null).length;
  if (tradingRows >= MIN_TRADING_ROWS_FOR_ANALYSIS) {
    console.log(`  📈 技术指标所需数据已满足（≥${MIN_TRADING_ROWS_FOR_ANALYSIS} 个交易日）`);
  } else {
    console.log(`  ⚠️ 仍不足 ${MIN_TRADING_ROWS_FOR_ANALYSIS} 个交易日（当前 ${tradingRows}）`);
  }

  const today = todayDate();
  if (!repo.getByDate(today)?.londonClose) {
    console.log('  📸 采集当日实时数据（需 TAVILY + LLM，可选）...');
    const collector = new DataCollectorAgent();
    try {
      await collector.collectMarketData();
      console.log('  ✅ 当日数据已保存');
    } catch (err) {
      console.log('  ⏭️ 跳过当日采集:', err instanceof Error ? err.message : err);
      console.log('  💡 历史回填已完成，可先运行 goldrush calibrate / 查看 history');
    } finally {
      await collector.cleanup();
    }
  } else {
    console.log(`  ⏭️ ${today} 已有当日数据`);
  }

  const finalCount = repo.count();
  console.log(`\n  📊 gold_prices 共 ${finalCount} 条（+${finalCount - before}）`);
  console.log('  💡 现在可运行: goldrush analysis');
}
