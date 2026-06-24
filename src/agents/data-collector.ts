// 数据采集 Agent — 双引擎搜索 + 结构化数据提取

import { BaseAgent } from './base.js';
import { getConfig } from '../utils/config.js';
import { getDb } from '../db/index.js';
import { GoldPricesRepo } from '../db/gold-prices.js';
import { FundNavRepo } from '../db/fund-nav.js';
import { SearchRouter } from '../data/search-router.js';
import { gradeSource } from '../utils/source-rank.js';
import { todayDate, formatNow } from '../utils/time.js';
import type { MarketData, SearchResult } from '../types/market.js';

const PRICE_COLLECT_PROMPT = `你是黄金市场数据采集专家。你的任务是从搜索结果中提取结构化的金价数据。

## 信息可靠性规则（必须遵守）

1. 严禁捏造数据，只使用搜索到的真实数据
2. 每个关键数据点至少搜索2-3个不同来源交叉验证
3. 来源分级：
   - A级（权威）：交易所、央行 → 直接采信
   - B级（可信）：金十、东方财富、华尔街见闻 → 采信但标注来源
   - C级（参考）：自媒体、论坛 → 仅作情绪参考
4. 所有数据必须标注获取时间和来源
5. 多来源数据差异>1%时，标注 ⚠️ 提醒

## 输出要求

请严格按照以下 JSON 格式输出：
{
  "timestamp": "数据时间ISO格式",
  "london": {
    "price": { "value": 数字, "change": 涨跌幅百分比, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "验证时间" },
    "high": { "value": 数字, "source": "来源", "sourceGrade": "A/B/C", "verifiedAt": "时间" },
    "low": { "value": 数字, "source": "来源", "sourceGrade": "A/B/C", "verifiedAt": "时间" }
  },
  "shanghai": {
    "price": { "value": 数字, "change": 涨跌幅百分比, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" },
    "high": { "value": 数字, "source": "来源", "sourceGrade": "A/B/C", "verifiedAt": "时间" },
    "low": { "value": 数字, "source": "来源", "sourceGrade": "A/B/C", "verifiedAt": "时间" }
  },
  "etf": {
    "code": "518880",
    "name": "华安黄金ETF",
    "nav": { "value": 数字, "change": 涨跌幅百分比, "source": "来源", "sourceGrade": "A/B/C", "verifiedAt": "时间" },
    "premiumDiscount": { "value": 数字, "source": "来源", "sourceGrade": "A/B/C", "verifiedAt": "时间" }
  },
  "dollarIndex": {
    "value": { "value": 数字, "change": 涨跌幅百分比, "source": "来源", "sourceGrade": "A/B/C", "verifiedAt": "时间" }
  },
  "usTreasury": {
    "yield10y": { "value": 数字, "change": 涨跌幅百分比, "source": "来源", "sourceGrade": "A/B/C", "verifiedAt": "时间" },
    "tips": { "value": 数字, "source": "来源", "sourceGrade": "A/B/C", "verifiedAt": "时间" }
  }
}

如果某个字段找不到数据，设为 null，不要编造。`;

export class DataCollectorAgent extends BaseAgent {
  private searchRouter: SearchRouter;

  constructor() {
    const config = getConfig();
    super({
      name: 'data-collector',
      model: config.models.dataCollector,
      systemPrompt: PRICE_COLLECT_PROMPT,
    });
    this.searchRouter = new SearchRouter(config.search.tavilyApiKey);
  }

  /** 采集市场数据 */
  async collectMarketData(): Promise<MarketData> {
    // 精简搜索 — 每类数据一条查询，减少 LLM prompt 长度
    const searches = [
      { query: `gold price XAUUSD spot today ${new Date().getFullYear()}`, dataType: 'xauusd' },
      { query: `上海金 Au99.99 今日行情 2026`, dataType: 'shanghai_gold' },
      { query: `黄金ETF 518880 最新净值 涨跌幅`, dataType: 'etf_nav' },
      { query: `US dollar index DXY today`, dataType: 'dxy' },
      { query: `US 10 year treasury yield TIPS real yield today`, dataType: 'us10y' },
    ];

    const searchResults = await this.searchRouter.searchBatch(searches, { numResults: 3 });

    // 反捏造防线：若所有搜索均无结果，则不应让 LLM 凭空"提取"数据，直接中止。
    const totalResults = Array.from(searchResults.values()).reduce((n, arr) => n + arr.length, 0);
    if (totalResults === 0) {
      throw new Error('搜索结果为空，无法采集市场数据。请配置 TAVILY_API_KEY 并确认网络连接；为避免编造数据，已中止本次采集。');
    }

    // 将搜索结果格式化为文本 — 截断 snippet 避免超长 prompt
    const MAX_SNIPPET = 300;
    const searchContext = Array.from(searchResults.entries())
      .map(([query, results]) => {
        const snippets = results
          .map(r => {
            const snip = r.snippet.length > MAX_SNIPPET ? r.snippet.slice(0, MAX_SNIPPET) + '...' : r.snippet;
            return `[${r.engine}] ${r.title}: ${snip}`;
          })
          .join('\n');
        return `搜索 "${query}" 结果:\n${snippets}`;
      })
      .join('\n\n');

    // 调用 LLM 结构化提取
    const schema = {
      type: 'object',
      properties: {
        timestamp: { type: 'string' },
        london: {
          type: 'object',
          properties: {
            price: { type: 'object', properties: { value: { type: 'number' }, change: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          },
        },
        shanghai: {
          type: 'object',
          properties: {
            price: { type: 'object', properties: { value: { type: 'number' }, change: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          },
        },
        etf: {
          type: 'object',
          properties: {
            code: { type: 'string' }, name: { type: 'string' },
            nav: { type: 'object', properties: { value: { type: 'number' }, change: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          },
        },
        dollarIndex: {
          type: 'object',
          properties: {
            value: { type: 'object', properties: { value: { type: 'number' }, change: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          },
        },
        usTreasury: {
          type: 'object',
          properties: {
            yield10y: { type: 'object', properties: { value: { type: 'number' }, change: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
            tips: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          },
        },
      },
      required: ['timestamp', 'london', 'shanghai', 'etf', 'dollarIndex', 'usTreasury'],
    };

    const data = await this.structuredPrompt<MarketData>(
      `当前时间: ${formatNow()}\n\n请从以下搜索结果中提取金价数据:\n\n${searchContext}`,
      schema,
    );

    // 自动保存快照到 SQLite
    try {
      this.saveSnapshot(data);
    } catch (err) {
      console.error('保存快照失败:', err);
    }

    return data;
  }

  /** 保存数据快照 */
  private saveSnapshot(data: MarketData): void {
    const db = getDb();
    const repo = new GoldPricesRepo(db);

    repo.upsert({
      date: todayDate(),
      londonClose: data.london?.price?.value ?? null,
      londonHigh: data.london?.high?.value ?? null,
      londonLow: data.london?.low?.value ?? null,
      shanghaiClose: data.shanghai?.price?.value ?? null,
      shanghaiHigh: data.shanghai?.high?.value ?? null,
      shanghaiLow: data.shanghai?.low?.value ?? null,
      etfNav: data.etf?.nav?.value ?? null,
      etfChange: data.etf?.nav?.change ?? null,
      dollarIndex: data.dollarIndex?.value?.value ?? null,
      us10yYield: data.usTreasury?.yield10y?.value ?? null,
      tipsYield: data.usTreasury?.tips?.value ?? null,
    });
  }
}
