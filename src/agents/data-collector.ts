// 数据采集 Agent — Tavily 搜索 + 结构化提取 + SQLite 快照

import { BaseAgent } from './base.js';
import { getConfig } from '../utils/config.js';
import { getDb } from '../db/index.js';
import { GoldPricesRepo } from '../db/gold-prices.js';
import { FundNavRepo } from '../db/fund-nav.js';
import { SearchCacheRepo } from '../db/search-cache.js';
import { SearchRouter } from '../data/search-router.js';
import { todayDate, formatNow } from '../utils/time.js';
import { listMissingLondonDates, normalizeHistoryRows, type HistoryPriceRow } from '../utils/history-backfill.js';
import { ensureGoldPriceHistory } from '../utils/ensure-gold-history.js';
import { TRACKED_FUNDS } from '../types/fund.js';
import type { MarketData, SearchResult } from '../types/market.js';
import { parseMarketData, isMissingPrice, isValidMarketNumber } from '../schemas/market.js';
import { fetchLiveAnchors, type LiveAnchorPrice } from '../data/live-anchors.js';
import type { SourcedPrice } from '../types/market.js';

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

- london.price / shanghai.price 为主报价
- london.altPrices / shanghai.altPrices 为其他独立来源报价（最多2条，无则空数组）
- 如果某个字段找不到数据，设为 null，不要编造`;

const SOURCED_PRICE_SCHEMA = {
  type: 'object',
  properties: {
    value: { type: 'number' },
    change: { type: 'number' },
    source: { type: 'string' },
    sourceGrade: { type: 'string' },
    verifiedAt: { type: 'string' },
  },
};

const MARKET_DATA_SCHEMA = {
  type: 'object',
  properties: {
    timestamp: { type: 'string' },
    london: {
      type: 'object',
      properties: {
        price: SOURCED_PRICE_SCHEMA,
        altPrices: { type: 'array', items: SOURCED_PRICE_SCHEMA },
        high: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
        low: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
      },
    },
    shanghai: {
      type: 'object',
      properties: {
        price: SOURCED_PRICE_SCHEMA,
        altPrices: { type: 'array', items: SOURCED_PRICE_SCHEMA },
        high: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
        low: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
      },
    },
    etf: {
      type: 'object',
      properties: {
        code: { type: 'string' }, name: { type: 'string' },
        nav: SOURCED_PRICE_SCHEMA,
        premiumDiscount: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
      },
    },
    dollarIndex: {
      type: 'object',
      properties: {
        value: SOURCED_PRICE_SCHEMA,
      },
    },
    usTreasury: {
      type: 'object',
      properties: {
        yield10y: SOURCED_PRICE_SCHEMA,
        tips: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
      },
    },
  },
  required: ['timestamp', 'london', 'shanghai', 'etf', 'dollarIndex', 'usTreasury'],
};

export class DataCollectorAgent extends BaseAgent {
  private searchRouter: SearchRouter;

  constructor() {
    const config = getConfig();
    super({
      name: 'data-collector',
      model: config.models.dataCollector,
      systemPrompt: PRICE_COLLECT_PROMPT,
    });
    const db = getDb();
    const cache = new SearchCacheRepo(db, config.search.cacheMinutes);
    this.searchRouter = new SearchRouter(config.search.tavilyApiKey, { cache });
  }

  /**
   * 采集市场数据 — **先锚定、后搜索**。
   * 1) 直连 gold-api/新浪/FRED 等（短超时并行）保证金价成功率
   * 2) Tavily+LLM 补上海/ETF/叙事；失败不拖垮已有锚定
   * 3) 再 merge 一次锚定（补洞 + 交叉验证 alt）
   */
  async collectMarketData(): Promise<MarketData> {
    console.log('  ⚓ Step 1a: 直连锚定（优先，不依赖 LLM）...');
    let data = await this.buildSkeletonFromAnchors();

    const year = new Date().getFullYear();
    const searches = [
      { query: `gold price XAUUSD spot today ${year}`, dataType: 'xauusd' },
      { query: `London gold spot price Kitco Investing.com ${year}`, dataType: 'xauusd_alt' },
      { query: `COMEX gold futures close price today`, dataType: 'xauusd_alt2' },
      { query: `上海金 Au99.99 今日行情 ${year}`, dataType: 'shanghai_gold' },
      { query: `上海黄金交易所 Au99.99 收盘价`, dataType: 'shanghai_gold_alt' },
      { query: `黄金ETF 518880 最新净值 涨跌幅`, dataType: 'etf_nav' },
      { query: `US dollar index DXY today`, dataType: 'dxy' },
      { query: `US 10 year treasury yield TIPS real yield today`, dataType: 'us10y' },
    ];

    try {
      console.log('  🔎 Step 1b: 搜索 + LLM 补全（上海/ETF/叙事）...');
      const searchResults = await this.searchRouter.searchBatch(searches, { numResults: 3 });
      const totalResults = Array.from(searchResults.values()).reduce((n, arr) => n + arr.length, 0);
      if (totalResults > 0) {
        const llmData = await this.extractMarketDataFromSearch(searchResults);
        data = this.mergeMarketData(llmData, data);
      } else {
        console.warn('  ⚠️ 搜索结果为空，保留直连锚定数据（不调用 LLM 抽价）');
      }
    } catch (err) {
      console.warn('  ⚠️ 搜索/LLM 采集失败，保留锚定数据:', err instanceof Error ? err.message : err);
    }

    // 补洞 + 把锚定价加入 altPrices 供交叉验证
    data = await this.enrichWithLiveAnchors(data);

    if (isMissingPrice(data.london?.price)) {
      throw new Error(
        '金价锚定与搜索均未拿到有效伦敦金。请检查网络（gold-api/新浪）与 TAVILY_API_KEY；为避免编造数据已中止。',
      );
    }

    try {
      this.saveSnapshot(data);
    } catch (err) {
      console.error('保存快照失败:', err);
    }
    return data;
  }

  /** 仅用直连源构造 MarketData 骨架（可部分字段缺失） */
  private async buildSkeletonFromAnchors(): Promise<MarketData> {
    const now = new Date().toISOString();
    const empty = (): SourcedPrice => ({
      value: 0, change: 0, source: 'N/A', sourceGrade: 'C', verifiedAt: now,
    });
    let data: MarketData = {
      timestamp: now,
      london: { price: empty(), altPrices: [] },
      shanghai: { price: empty(), altPrices: [] },
      etf: { code: '518880', name: '华安黄金ETF', nav: empty() },
      dollarIndex: { value: empty() },
      usTreasury: {
        yield10y: empty(),
        tips: { value: 0, source: 'N/A', sourceGrade: 'C', verifiedAt: now },
      },
    };
    return this.enrichWithLiveAnchors(data);
  }

  /**
   * 合并：prefer 优先用 primary 的有效字段，缺失则用 fallback（锚定）。
   * 金价：两边都有效时，primary 作主价，fallback 进 altPrices。
   */
  private mergeMarketData(primary: MarketData, fallback: MarketData): MarketData {
    const pickPrice = (a?: SourcedPrice, b?: SourcedPrice): SourcedPrice => {
      if (a && !isMissingPrice(a)) return a;
      if (b && !isMissingPrice(b)) return b;
      return a ?? b ?? {
        value: 0, change: 0, source: 'N/A', sourceGrade: 'C', verifiedAt: new Date().toISOString(),
      };
    };

    const londonPrimary = primary.london?.price;
    const londonFb = fallback.london?.price;
    const london = pickPrice(londonPrimary, londonFb);
    const alts: SourcedPrice[] = [...(primary.london?.altPrices ?? [])];
    if (
      londonFb && !isMissingPrice(londonFb)
      && londonPrimary && !isMissingPrice(londonPrimary)
      && londonFb.value !== londonPrimary.value
    ) {
      alts.push(londonFb);
    }
    for (const a of fallback.london?.altPrices ?? []) {
      if (!isMissingPrice(a)) alts.push(a);
    }

    return {
      timestamp: primary.timestamp || fallback.timestamp,
      london: {
        ...primary.london,
        price: london,
        altPrices: alts.slice(0, 3),
        high: primary.london?.high ?? fallback.london?.high,
        low: primary.london?.low ?? fallback.london?.low,
      },
      shanghai: {
        ...primary.shanghai,
        price: pickPrice(primary.shanghai?.price, fallback.shanghai?.price),
        altPrices: primary.shanghai?.altPrices?.length
          ? primary.shanghai.altPrices
          : (fallback.shanghai?.altPrices ?? []),
      },
      etf: {
        ...primary.etf,
        code: primary.etf?.code ?? fallback.etf?.code ?? '518880',
        name: primary.etf?.name ?? fallback.etf?.name ?? '华安黄金ETF',
        nav: pickPrice(primary.etf?.nav, fallback.etf?.nav),
      },
      dollarIndex: {
        value: pickPrice(primary.dollarIndex?.value, fallback.dollarIndex?.value),
      },
      usTreasury: {
        yield10y: pickPrice(primary.usTreasury?.yield10y, fallback.usTreasury?.yield10y),
        tips: (() => {
          const t = primary.usTreasury?.tips;
          const f = fallback.usTreasury?.tips;
          if (t && t.source !== 'N/A' && isValidMarketNumber(t.value)) return t;
          if (f && f.source !== 'N/A' && isValidMarketNumber(f.value)) return f;
          return t ?? f ?? { value: 0, source: 'N/A', sourceGrade: 'C', verifiedAt: '' };
        })(),
      },
    };
  }

  /** 用直连锚定源覆盖 N/A 或 0 占位，不覆盖已有有效 LLM/搜索提取 */
  private async enrichWithLiveAnchors(data: MarketData): Promise<MarketData> {
    try {
      const anchors = await fetchLiveAnchors();
      const now = new Date().toISOString();

      const toPrice = (a: LiveAnchorPrice, grade: 'A' | 'B' = 'A'): SourcedPrice => ({
        value: a.price,
        change: a.change,
        source: a.source,
        sourceGrade: grade,
        verifiedAt: a.timestamp || now,
      });

      if (anchors.gold && isMissingPrice(data.london?.price)) {
        data.london = {
          ...data.london,
          price: toPrice(anchors.gold),
          altPrices: data.london?.altPrices ?? [],
        };
        console.log(`  ⚓ 金价锚定: $${anchors.gold.price} (${anchors.gold.source})`);
      } else if (anchors.gold && data.london?.price && isValidMarketNumber(data.london.price.value)) {
        // 已有报价时把锚定源加入 altPrices 供交叉验证
        const alts = data.london.altPrices ?? [];
        const exists = alts.some(a => a.source === anchors.gold!.source);
        if (!exists) alts.push(toPrice(anchors.gold));
        data.london.altPrices = alts.slice(0, 3);
      }

      if (anchors.dxy && isMissingPrice(data.dollarIndex?.value)) {
        data.dollarIndex = { value: toPrice(anchors.dxy) };
        console.log(`  ⚓ 美元指数锚定: ${anchors.dxy.price} (${anchors.dxy.source})`);
      }

      if (anchors.us10y && isMissingPrice(data.usTreasury?.yield10y)) {
        data.usTreasury = {
          ...data.usTreasury,
          yield10y: toPrice(anchors.us10y),
          tips: data.usTreasury?.tips ?? { value: 0, source: 'N/A', sourceGrade: 'C', verifiedAt: now },
        };
        console.log(`  ⚓ 10Y 锚定: ${anchors.us10y.price}% (${anchors.us10y.source})`);
      }

      if (anchors.tips && (data.usTreasury?.tips?.source === 'N/A' || !isValidMarketNumber(data.usTreasury?.tips?.value))) {
        data.usTreasury = {
          ...data.usTreasury,
          yield10y: data.usTreasury?.yield10y ?? { value: 0, change: 0, source: 'N/A', sourceGrade: 'C', verifiedAt: now },
          tips: {
            value: anchors.tips.price,
            source: anchors.tips.source,
            sourceGrade: 'A',
            verifiedAt: anchors.tips.timestamp || now,
          },
        };
        console.log(`  ⚓ TIPS 锚定: ${anchors.tips.price}% (${anchors.tips.source})`);
      }
    } catch (err) {
      console.warn('  ⚠️ 实时锚定补齐失败:', err instanceof Error ? err.message : err);
    }
    return data;
  }

  /**
   * 回填过去 days 天缺失的 london_close。
   * 优先 Yahoo GC=F 日线（无需 Tavily）；不足时再尝试 Tavily+LLM。
   */
  async backfillHistory(days = 60): Promise<{ filled: number; attempted: number }> {
    const db = getDb();
    const repo = new GoldPricesRepo(db);

    const yahooResult = await ensureGoldPriceHistory(repo, days);
    let filled = yahooResult.filled;

    const missing = listMissingLondonDates(repo, days);
    if (missing.length === 0 || !this.searchRouter.enabled) {
      return { filled, attempted: yahooResult.attempted };
    }

    if (yahooResult.readyForAnalysis) {
      return { filled, attempted: yahooResult.attempted };
    }

    const from = missing[0];
    const to = missing[missing.length - 1];
    const year = new Date().getFullYear();

    const searches = [
      { query: `XAUUSD gold daily closing price history ${from} to ${to} ${year}`, dataType: 'hist' },
      { query: `London gold historical daily close price chart ${days} days`, dataType: 'hist2' },
    ];
    const searchResults = await this.searchRouter.searchBatch(searches, { numResults: 5 });
    const totalResults = Array.from(searchResults.values()).reduce((n, arr) => n + arr.length, 0);
    if (totalResults === 0) {
      return { filled, attempted: yahooResult.attempted + missing.length };
    }

    const schema = {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string' },
              londonClose: { type: 'number' },
              shanghaiClose: { type: 'number' },
            },
            required: ['date', 'londonClose'],
          },
        },
      },
      required: ['rows'],
    };

    const allowed = new Set(missing);
    const CHUNK = 20;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const context = formatSearchContext(searchResults);
      const extracted = await this.structuredPrompt<{ rows: HistoryPriceRow[] }>(
        `请从搜索结果中提取伦敦金（XAUUSD）每日收盘价。\n`
        + `仅输出以下缺失日期（YYYY-MM-DD）中有据可查的行，严禁编造：\n${chunk.join(', ')}\n\n`
        + `${context}`,
        schema,
      );
      const rows = normalizeHistoryRows(extracted.rows ?? [], allowed);
      for (const row of rows) {
        repo.upsertBackfill({
          date: row.date,
          londonClose: row.londonClose,
          londonHigh: row.londonClose,
          londonLow: row.londonClose,
          shanghaiClose: row.shanghaiClose ?? null,
          shanghaiHigh: null,
          shanghaiLow: null,
          etfNav: null,
          etfChange: null,
          dollarIndex: null,
          us10yYield: null,
          tipsYield: null,
        });
        filled++;
      }
    }

    return { filled, attempted: yahooResult.attempted + missing.length };
  }

  /** 采集并持久化跟踪基金净值（供 fund 命令） */
  async collectFundNavs(): Promise<void> {
    if (!this.searchRouter.enabled) {
      throw new Error('未配置 TAVILY_API_KEY，无法采集基金净值。');
    }

    const searches = TRACKED_FUNDS.map(f => ({
      query: `${f.name} ${f.code} 最新净值 涨跌幅`,
      dataType: `fund_${f.code}`,
    }));
    const searchResults = await this.searchRouter.searchBatch(searches, { numResults: 3 });
    const context = formatSearchContext(searchResults);

    const schema = {
      type: 'object',
      properties: {
        funds: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              name: { type: 'string' },
              nav: { type: 'number' },
              changePct: { type: 'number' },
              premium: { type: 'number' },
            },
            required: ['code', 'nav'],
          },
        },
      },
      required: ['funds'],
    };

    const extracted = await this.structuredPrompt<{
      funds: Array<{ code: string; name?: string; nav: number; changePct?: number; premium?: number }>;
    }>(
      `当前时间: ${formatNow()}\n从搜索结果提取以下基金的最新净值（严禁捏造）：\n`
      + `${TRACKED_FUNDS.map(f => f.code).join(', ')}\n\n${context}`,
      schema,
    );

    const date = todayDate();
    const db = getDb();
    const repo = new FundNavRepo(db);
    for (const f of extracted.funds ?? []) {
      if (!f.code || f.nav == null || !Number.isFinite(f.nav)) continue;
      repo.upsert({
        date,
        code: f.code,
        nav: f.nav,
        accNav: f.nav,
        changePct: f.changePct ?? 0,
        premium: f.premium ?? null,
      });
    }
  }

  private async extractMarketDataFromSearch(
    searchResults: Map<string, SearchResult[]>,
  ): Promise<MarketData> {
    const totalResults = Array.from(searchResults.values()).reduce((n, arr) => n + arr.length, 0);
    if (totalResults === 0) {
      throw new Error('搜索结果为空，无法采集市场数据。请配置 TAVILY_API_KEY 并确认网络连接；为避免编造数据，已中止本次采集。');
    }

    const searchContext = formatSearchContext(searchResults);
    const raw = await this.structuredPrompt<MarketData>(
      `当前时间: ${formatNow()}\n\n请从以下搜索结果中提取金价数据:\n\n${searchContext}`,
      MARKET_DATA_SCHEMA,
    );
    return parseMarketData(raw);
  }

  /** 保存金价快照 + ETF 净值（缺失/0 不入库，避免污染历史） */
  private saveSnapshot(data: MarketData): void {
    const db = getDb();
    const date = todayDate();
    const repo = new GoldPricesRepo(db);

    const numOrNull = (p: { value?: number; source?: string } | null | undefined): number | null => {
      if (!p || p.source === 'N/A') return null;
      if (p.value == null || !Number.isFinite(p.value) || p.value === 0) return null;
      return p.value;
    };

    repo.upsert({
      date,
      londonClose: numOrNull(data.london?.price),
      londonHigh: numOrNull(data.london?.high),
      londonLow: numOrNull(data.london?.low),
      shanghaiClose: numOrNull(data.shanghai?.price),
      shanghaiHigh: numOrNull(data.shanghai?.high),
      shanghaiLow: numOrNull(data.shanghai?.low),
      etfNav: numOrNull(data.etf?.nav),
      etfChange: !isMissingPrice(data.etf?.nav) ? (data.etf?.nav?.change ?? null) : null,
      dollarIndex: numOrNull(data.dollarIndex?.value),
      us10yYield: numOrNull(data.usTreasury?.yield10y),
      tipsYield: data.usTreasury?.tips?.source !== 'N/A' && isValidMarketNumber(data.usTreasury?.tips?.value)
        ? data.usTreasury!.tips!.value
        : null,
    });

    if (!isMissingPrice(data.etf?.nav) && data.etf?.nav?.value != null) {
      const fundRepo = new FundNavRepo(db);
      fundRepo.upsert({
        date,
        code: data.etf.code ?? '518880',
        nav: data.etf.nav.value,
        accNav: data.etf.nav.value,
        changePct: data.etf.nav.change ?? 0,
        premium: data.etf.premiumDiscount?.value ?? null,
      });
    }
  }
}

function formatSearchContext(searchResults: Map<string, SearchResult[]>): string {
  const MAX_SNIPPET = 300;
  return Array.from(searchResults.entries())
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
}
