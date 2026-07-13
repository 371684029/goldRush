# GoldRush 主力动向监测 — 设计规划

> 状态：草案 | 创建：2026-07-13 | 版本：v0.1

---

## 0. 背景与动机

### 现状

GoldRush 当前的 `情绪面分析（SentimentAgent）` 已定义了五个主力相关维度：

| 字段 | 中文含义 | 当前数据来源 | 问题 |
|------|----------|-------------|------|
| `cftcPosition` | CFTC 持仓 | LLM 从通用搜索结果推断 | 无结构化数据，无历史趋势 |
| `centralBanks` | 央行购金 | LLM 从新闻推断 | 季度数据，缺乏定量 |
| `etfFlows` | ETF 资金流 | LLM 从通用搜索结果推断 | 无日度跟踪，无定量 |
| `vix` | 恐慌指数 | LLM + 正则提取数值 | 可提取但非结构化 |
| `geopoliticalRisk` | 地缘风险 | LLM 定性判断 | 合理，保持现状 |

**核心缺陷**：所有主力数据都是 LLM "自由发挥"的文本分析，没有结构化采集、没有历史时间序列、没有定量指标。质量完全取决于 Tavily 搜索返回的随机内容——而实际搜索词中根本没有 CFTC 或 ETF 资金流的查询。

> **为什么要做这个改造？** `DataCollectorAgent` 的 8 个搜索词全部是金价/美元/美债，SentimentAgent 收到的 `MarketData` 里没有一字节的持仓数据。LLM 对 CFTC/ETF 的"分析"本质上是基于训练知识和随机搜索片段的**猜测**——这不是分析，是高级编造。注入本地结构化数据后，LLM 从"数据编造者"变成"数据解读者"，这才是 AI 分析应该做的事。

### 目标

1. **结构化采集** — 从公开数据源拉取真实的 CFTC/ETF/央行数据，存入 SQLite
2. **本地计算** — 不依赖 LLM，直接计算持仓变化、资金流向、历史百分位等定量指标
3. **独立命令** — 新增 `goldrush flow` 命令，专项展示主力动向
4. **增强分析** — 将结构化主力数据注入现有的 `analysis` 流程，替代 LLM 猜测

---

## 1. 数据源设计

### 1.1 数据源总览

| 数据源 | 频率 | 获取方式 | 难度 | 可用性 | 优先级 |
|--------|------|----------|------|--------|--------|
| **CFTC COT 报告** | 每周五 | 官网 TXT 文件 / Barchart | 低 | 免费公开 | **P0** |
| **GLD ETF 持仓** | 每日 | SPDR 官网 CSV/XLS | 低 | 免费公开 | **P0** |
| **IAU ETF 持仓** | 每日 | iShares 官网 CSV | 低 | 免费公开 | P1 |
| **国内黄金ETF份额** | 每日 | 天天基金/东方财富 API | 中 | 免费但需反爬 | P1 |
| **央行购金** | 月度 | PBOC 官网 / WGC / IMF IFS | 低-中 | 免费公开 | P1 |
| **COMEX 成交量/OI** | 每日 | CME 官网 / Yahoo | 低 | 部分免费 | P1 |

### 1.2 CFTC COT 报告 — 最核心的主力指标

**数据地址**：`https://www.cftc.gov/dea/futures/deacmynsof.htm`

CFTC 每周五下午 3:30 ET 公布截至周二的持仓数据。黄金的 CFTC 代码是 `088691`（CME Gold Futures）。

**可获取的结构化数据**（COT Legacy Report 格式）：

```
报告日期, 品种,
商业多头, 商业空头, 商业净头寸, 商业变化,
非商业多头, 非商业空头, 非商业净头寸, 非商业变化,
非报告多头, 非报告空头,
总多头, 总空头,
交易商数量, ...
```

**关键字段解析**：

| 字段 | 含义 | 主力解读 |
|------|------|----------|
| `noncomm_long` | 非商业多头（管理基金多头） | **投机主力**做多仓位 |
| `noncomm_short` | 非商业空头（管理基金空头） | **投机主力**做空仓位 |
| `noncomm_net` | 非商业净多头 = long - short | 正值=投机主力看多 |
| `noncomm_change` | 净多头周度变化 | 正向=主力加多，负向=主力减多 |
| `comm_net` | 商业净头寸（≈ 套保盘） | 通常与价格反向，极端值值得关注 |
| `open_interest` | 总持仓量 | 市场参与热度 |

**获取方式**：CFTC 官网提供历史 TXT 文件，可直接下载解析：

```
https://www.cftc.gov/files/dea/history/fut_fin_txt_2024.zip
https://www.cftc.gov/files/dea/history/fut_fin_txt_2025.zip
https://www.cftc.gov/files/dea/history/fut_fin_txt_2026.zip
```

**解析策略**：下载 zip → 解压 → 正则解析 `.txt` → 过滤黄金合约 `088691` → 提取字段 → 存入 SQLite。

**已有先例**：GoldRush 已有 `src/data/yahoo-gold-history.ts` 对外部数据 fetch + parse 的模式，CFTC 解析可以复用这个模式。

### 1.3 GLD ETF 持仓（SPDR Gold Trust）

**数据地址**：`https://www.spdrgoldshares.com/usa/historical-data/`

SPDR 提供每日更新的 CSV 下载，包含：
- 日期
- 总持仓（盎司）
- 总持仓（吨）
- AUM（美元）

**获取方式**：直接 HTTP GET 下载 CSV，解析后存入 SQLite。

```
GET https://www.spdrgoldshares.com/assets/dynamic/holdings/GLD_holdings_2026.csv
```

**指标计算**：
- 持仓变化（日度、5日、20日）= 流入/流出信号
- 持仓量 vs 金价背离 = "主力出货"信号
- 历史百分位 = 当前持仓在历史中的水位

### 1.4 国内黄金ETF份额

**数据地址**：天天基金 `https://fund.eastmoney.com/` 或东方财富 API

**候选 ETF**：

| 代码 | 名称 | 说明 |
|------|------|------|
| 518880 | 华安黄金ETF | 最大黄金ETF，流动性最好 |
| 159934 | 易方达黄金ETF | 规模第二 |
| 159937 | 博时黄金ETF | 规模第三 |

**获取方式**：东方财富 API 提供日度份额数据（免费，无鉴权）。

### 1.5 央行购金（月度，P1）

**核心关注**：中国人民银行（PBOC）每月 7 号左右公布上月末黄金储备数据。这是国内黄金投资者最直接、最关注的"主力"信号——中国央行是全球最大的黄金买家之一，其月度购金行为对金价有显著影响。

**数据地址**：
- PBOC 官网：国家外汇管理局每月公布官方储备资产
- WGC：`https://www.gold.org/goldhub/data/gold-demand-trends`（月度央行购金统计）
- IMF IFS：各国央行月度黄金储备

**获取策略**（Phase 1 即可做）：
1. **PBOC 月度数据**：国家外汇管理局每月 7 日发布，可从财经新闻（金十、东方财富）直接搜索获取，或写简单爬虫
2. 存入 `institutional_flows` 表：`cb_pboc_reserves`（中国央行黄金储备，吨）、`cb_pboc_change`（月度变化）
3. 搜索关键词：`"中国央行黄金储备 2026年X月"` 或从 WGC 月度报告提取

**信号解读**：
- PBOC 连续增持 → 强利多（央行级别的主力买入）
- PBOC 暂停增持 → 中性偏空（最大买家离场）
- PBOC 减持 → 极罕见，强利空

### 1.6 COMEX 成交量与未平仓合约（OI）

**数据地址**：Yahoo Finance `GC=F` 已包含日线成交量，CME 官网可查 OI。

**Yahoo GC=F** 的日线数据中包含 `volume` 字段，GoldRush 的 `yahoo-gold-history.ts` 只需增加 volume 字段解析即可获取。这基本是**零成本**的增强。

---

## 2. 数据架构设计

### 2.1 新增 SQLite 表：`institutional_flows`

```sql
CREATE TABLE IF NOT EXISTS institutional_flows (
  date          TEXT PRIMARY KEY,         -- YYYY-MM-DD
  -- CFTC 数据（每周更新，日度表中只在报告日有值）
  cftc_nc_long      REAL,                -- 非商业多头
  cftc_nc_short     REAL,                -- 非商业空头
  cftc_nc_net       REAL,                -- 非商业净头寸（核心指标）
  cftc_nc_change    REAL,                -- 净头寸周度变化
  cftc_comm_net     REAL,                -- 商业净头寸
  cftc_open_interest REAL,               -- 总持仓量
  cftc_report_date  TEXT,                -- CFTC 报告截止日期（周二）
  -- ETF 持仓（每日）
  gld_holdings_tons   REAL,              -- GLD 持仓（吨）
  gld_holdings_change REAL,              -- 持仓日度变化（吨）
  gld_aum_million     REAL,              -- GLD AUM（百万美元）
  iau_holdings_tons   REAL,              -- IAU 持仓（吨）
  -- 国内 ETF 份额
  cn_etf_518880_shares  REAL,            -- 518880 份额（亿份）
  cn_etf_518880_flow    REAL,            -- 518880 净流入（亿元）
  cn_etf_159934_shares  REAL,            -- 159934 份额
  cn_etf_159934_flow    REAL,            -- 159934 净流入
  -- COMEX 成交量（来自 Yahoo GC=F）
  comex_volume          REAL,            -- GC=F 日成交量
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_flows_date ON institutional_flows(date);
CREATE INDEX IF NOT EXISTS idx_flows_cftc ON institutional_flows(cftc_report_date);
```

### 2.2 扩展现有表：`gold_prices` 增加 volume

```sql
ALTER TABLE gold_prices ADD COLUMN comex_volume REAL;
```

（或者直接使用 `institutional_flows` 中的 `comex_volume`，避免 schema migration。）

### 2.3 新增类型定义：`src/types/institutional.ts`

```typescript
// CFTC COT 单条记录
export interface CftcRecord {
  date: string;              // 报告截止日（周二）
  publishDate: string;       // 公布日（周五）
  nonCommLong: number;       // 非商业多头
  nonCommShort: number;      // 非商业空头
  nonCommNet: number;        // 非商业净头寸
  nonCommNetChange: number;  // 净头寸变化
  commNet: number;           // 商业净头寸
  openInterest: number;      // 总持仓
}

// ETF 持仓单条记录
export interface EtfHoldings {
  date: string;
  gldTons: number;
  gldChange: number;         // 日吨变化
  gldAum: number;
  iauTons?: number;
}

// 国内 ETF 份额
export interface CnEtfFlow {
  date: string;
  code: string;
  shares: number;            // 份额（亿份）
  flow: number;              // 净流入（亿元）
}

// 主力动向综合指标（本地计算，非 LLM）
export interface InstitutionalSignal {
  // CFTC 信号
  cftcScore: number;          // 0-100，基于净多头百分位 + 变化方向
  cftcDirection: Direction;
  cftcPercentile: number;     // 当前净多头在历史中的百分位
  cftcExtreme: boolean;       // 净多头处于极端位置？

  // ETF 资金流信号
  etfFlowScore: number;       // 0-100，基于持仓变化趋势
  etfFlowDirection: Direction;
  etf5dChange: number;        // 5日持仓变化（吨）
  etf20dChange: number;       // 20日持仓变化（吨）

  // 背离信号
  priceFlowDivergence: boolean;  // 金价涨 + ETF 流出 = 主力出货信号
  cftcFlowDivergence: boolean;   // 金价涨 + CFTC 净多下降 = 警示信号

  // 综合
  overallFlowScore: number;   // 0-100
  summary: string;            // 一句话总结
}
```

### 2.4 项目文件结构

```
src/
├── data/
│   ├── cftc-grabber.ts          # [新] CFTC COT 报告下载 + 解析
│   ├── etf-grabber.ts           # [新] GLD/IAU ETF 持仓下载 + 解析
│   ├── cn-etf-grabber.ts        # [新] 国内 ETF 份额获取
│   ├── yahoo-gold-history.ts    # [改] 增加 volume 字段
│   └── index.ts
├── db/
│   ├── institutional-flows.ts   # [新] institutional_flows 表 CRUD
│   ├── index.ts                 # [改] 初始化新表
│   └── ...
├── indicators/
│   ├── flow-percentile.ts       # [新] CFTC/ETF 历史百分位
│   └── flow-signal.ts           # [新] 主力信号计算（背离、极值等）
├── commands/
│   ├── flow.ts                  # [新] goldrush flow 命令
│   └── ...
├── types/
│   ├── institutional.ts         # [新] 主力数据类型
│   └── ...
├── agents/
│   ├── sentiment-agent.ts       # [改] 注入结构化主力数据替代 LLM 推断
│   └── ...
└── utils/
    └── ensure-flows.ts          # [新] 自动补齐主力数据（类似 ensure-gold-history）
```

---

## 3. 数据获取流程

### 3.1 `goldrush init-flow` 或 `goldrush flow --init`

首次使用时的数据初始化命令：

```
goldrush flow --init --cftc --etf --cn-etf --days 365
```

**流程**：

```
init-flow
  ├── Step A: CFTC 历史数据
  │     ├── 下载年份对应的 ZIP 文件
  │     ├── 解压 → 解析 TXT → 过滤 088691
  │     ├── 提取字段 → UPSERT 到 institutional_flows
  │     └── 报告: 已回填 N 周 CFTC 数据
  │
  ├── Step B: GLD 历史持仓
  │     ├── HTTP GET SPDR CSV (单文件包含全部历史)
  │     ├── 解析 CSV → UPSERT 到 institutional_flows
  │     └── 报告: 已回填 N 天 ETF 数据
  │
  └── Step C: 国内 ETF 历史份额
        ├── 东方财富 API 分页拉取
        ├── 解析 JSON → UPSERT 到 institutional_flows
        └── 报告: 已回填 N 天 国内 ETF 数据
```

### 3.2 日常增量更新

`goldrush flow` 或 `goldrush analysis` 自动触发：

```
日常更新
  ├── 检查 institutional_flows 最后更新日
  ├── CFTC: 如果最新报告日 < 上周五 → 尝试拉取最新 COT
  ├── GLD: 如果最后更新 < 昨天 → HTTP GET 最新一行
  └── 国内 ETF: 如果最后更新 < 昨天 → API 查询最新
```

### 3.3 `goldrush analysis` 的改造

在 `analysis.ts` 的 Step 1 和 Step 2 之间插入：

```
Step 1.8: 补齐主力数据
  ├── ensureInstitutionalFlows()  // 增量更新，类似 ensureGoldPriceHistory()
  └── computeInstitutionalSignal() // 本地计算主力信号
```

然后将 `InstitutionalSignal` 注入到 SentimentAgent 的 prompt 中，**替代** LLM 对 CFTC/ETF 的"自由猜测"。

### 3.4 CFTC TXT 解析细节

CFTC 历史文件的格式是固定宽度文本。关键行格式：

```
088691,YYYYMMDD,GOLD - COMMODITY EXCHANGE INC.,...
```

需要解析的列位置（COT Legacy Report）：
- 列 C: `noncomm_positions_long_all` 
- 列 D: `noncomm_positions_short_all`
- 列 I: `comm_positions_long_all`
- 列 J: `comm_positions_short_all`
- 列 R: `open_interest_all`

**参考实现**：已有成熟的 npm 包 `cftc-cot` 或直接手写 ~60 行正则解析。

### 3.5 GLD CSV 解析细节

SPDR 的 CSV 格式简单：

```csv
Date,Total Ounces,Total Tonnes,Total Value (USD)
2026-07-10,28034567.89,872.14,78345678901.23
```

直接 CSV 解析即可。单文件覆盖从 2004 年至今的全部历史。

---

## 4. 主力信号计算（本地算法，不依赖 LLM）

### 4.1 CFTC 评分算法

```
cftcScore = blend(
  0.4 * percentile(noncomm_net, lookback=260),   // 当前净多头在 5 年中的百分位
  0.3 * direction_score(noncomm_net_change_4w),  // 近 4 周净多变化方向
  0.2 * extreme_signal(noncomm_net),              // 是否处于极端位置
  0.1 * divergence_with_price                     // 与金价的背离程度
)
```

**极端位置判定**：
- 净多头 > 历史 90 百分位 → 主力极度看多（注意拥挤交易风险）
- 净多头 < 历史 10 百分位 → 主力极度看空（可能超卖）
- 净多头在 90 百分位且开始下降 → 主力高位减仓，强烈看空信号

### 4.2 ETF 资金流评分算法

```
etfFlowScore = blend(
  0.4 * direction_score(gld_holdings_change_5d),   // 近 5 日持仓趋势
  0.3 * momentum_score(gld_holdings_change_20d),   // 近 20 日趋势
  0.2 * percentile(gld_holdings),                   // 持仓量历史水位
  0.1 * divergence_with_price
)
```

**关键信号**：
- 金价上涨 + ETF 持仓下降 → **背离**，"聪明钱"可能在出货
- 金价下跌 + ETF 持仓上升 → 主力抄底信号
- ETF 持仓连续 5 日增加 → 短期资金流入确认

### 4.3 综合主力评分

```
overallFlowScore = blend(
  0.40 * cftcScore,
  0.30 * etfFlowScore,
  0.15 * pbocSignal,             // PBOC 月度购金
  0.05 * comeVolumeSignal,       // 成交量异常
  0.10 * cnEtfFlowScore,         // 国内资金
)
```

### 4.4 背离检测（最核心的主力信号）

| 场景 | 金价 | CFTC 净多 | ETF 持仓 | 信号 |
|------|------|-----------|----------|------|
| 健康上涨 | ↑ | ↑ | ↑ | ✅ 主力一致看多 |
| 高位减仓 | ↑ | ↓ | ↓ | ⚠️ 主力出货，警惕回调 |
| 恐慌杀跌 | ↓ | ↓↓ | ↓↓ | 🔴 主力踩踏 |
| 低位吸筹 | ↓ | ↑ | ↑ | ✅ 主力抄底 |
| 量价背离 | ↑ | → | ↓ | ⚠️ 涨势难持续 |
| 价跌量增 | ↓ | → | ↑ | ⚠️ 主力借跌加仓 |

---

## 5. 展现设计

### 5.1 `goldrush flow` 命令

```
$ goldrush flow

🏦 GoldRush 主力动向监测 — 2026-07-13

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 CFTC 持仓 (最新: 2026-07-07 报告)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  非商业净多头: 285,432 手  ↑ 12,500 (周度变化)
  非商业多头:   320,100 手
  非商业空头:    34,668 手
  总持仓量:     520,890 手

  净多头历史百分位: 78% (近 5 年偏高)
  [████████████████████░░░░] 78/100 偏看多

  ⚠️ 净多头连续 3 周增加，当前处于偏高位置

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 ETF 资金流
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  GLD 持仓:  872.14 吨  (日变化: -1.23 吨)
  IAU 持仓:  385.60 吨  (日变化: +0.45 吨)
  
  近 5 日变化:  -3.25 吨  🔻 小幅流出
  近 20 日变化: +8.73 吨  🔺 中期仍为净流入

  GLD 持仓百分位: 85% (历史高位)
  [█████████████████████░░░] 85/100

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏛️ 央行购金 (最新: 2026-07-07 PBOC 披露)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  中国央行黄金储备: 2,380 吨
  月度变化: +5.2 吨  (连续第 20 个月增持)
  全球央行 Q2 购金: 183 吨 (WGC 预估)

🇨🇳 国内 ETF 份额
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  518880 华安黄金: 45.2 亿份 (周变化: +1.8 亿份)
  159934 易方达黄金: 18.7 亿份 (周变化: +0.3 亿份)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 背离检测
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ CFTC 净多与金价同向，无背离
  ⚠️ 近 5 日 GLD 小幅流出，与金价微涨形成轻度背离

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 主力综合信号
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  综合评分: 72/100  偏看多 🟢
  
   CFTC 占比 40%:  78/100 (主力投机盘偏多)
  ETF  占比 30%:  62/100 (ETF 资金中性偏正)
  央行  占比 15%:  85/100 (PBOC 连续增持，利多)
  成交量 占比 5%:  65/100
  国内   占比 10%: 70/100

  一句话: 主力投机资金偏多，但 ETF 资金有轻度流出，需关注持续性
```

**选项**：
```
goldrush flow --json          # JSON 格式输出
goldrush flow --md            # 输出 Markdown 到 docs/
goldrush flow --cftc          # 仅看 CFTC
goldrush flow --etf           # 仅看 ETF
goldrush flow --init          # 首次回填历史数据
goldrush flow --days 90       # 查看 90 天内趋势
```

### 5.2 增强 `goldrush analysis` 中的展现

当前 analysis 报告的情绪面部分：

```
情绪面: 65/100 🟢 — 央行购金持续，ETF资金流入
```

改为注入真实数据后：

```
情绪面: 68/100 🟢 — CFTC净多创3月新高 + GLD连续3周流入
  CFTC: 非商业净多 285,432 手 (百分位 78%, ↑12,500)
  ETF:  GLD近20日 +8.73吨, 近5日 -3.25吨 (轻度背离)
  VIX:  14.2 (低位, 市场情绪稳定)
  央行购金: 中国央行连续18个月增持
```

### 5.3 `goldrush flow --md` 输出到 `docs/`

每日主力监测报告自动写入 `docs/goldrush-flow-YYYY-MM-DD.md`，可以在报告页面查阅。

### 5.4 趋势图表（远期，P2）

利用终端 ASCII chart 或简单柱状图展示：
- CFTC 净多头 12 周趋势
- GLD 持仓 30 日趋势
- 金价 vs ETF 持仓对比

可选库：`asciichart`（零依赖，纯终端）。

### 5.5 每日自动执行

`goldrush flow` 通过两种机制保障每天都有最新数据：

**机制一：`analysis` 执行前自动拉取（主要）**

每次运行 `goldrush analysis` 时，在 Step 1（数据采集）之后、Step 2（四维分析）之前，自动执行：

```
Step 1.8: ensureInstitutionalFlows()
  ├── 检查 institutional_flows 最后更新日
  ├── CFTC: 今天是周六且最新报告日 < 本周五？ → 拉取最新 COT
  ├── GLD:  最新数据 < 昨天？ → HTTP GET 最新一行
  └── PBOC: 今天是 8 号且本月数据未拉？ → 搜索最新储备
```

因为服务器每天 11:30 cron 会自动跑 `analysis`，所以主力数据会随之每天自动更新。

**机制二：cron 独立产出日报**

在 `scripts/daily-analysis.sh` 中增加一行：

```bash
# 产出主力监测日报到 docs/（纯本地计算，秒级完成）
node "$PROJECT_DIR/dist/index.js" flow --md >> "$LOG_FILE" 2>&1 || true
```

这样每天 11:30 同步产出两份日报：
- `docs/goldrush-analysis-YYYY-MM-DD.md`（完整分析）
- `docs/goldrush-flow-YYYY-MM-DD.md`（主力动向专项）

**执行时机摘要**：

| 触发方式 | 做什么 | 频率 |
|----------|--------|------|
| `analysis` 自动补齐 | 增量拉取 CFTC/GLD/PBOC 最新数据 | 每次 analysis 调用 |
| cron `flow --md` | 产出主力监测 Markdown | 每日 11:30 |
| 手动 `flow` | 随时查看最新主力动向 | 按需 |

### 5.6 Web 展示

已有基础设施：`server.cjs` 是一个 Node HTTP 服务（端口 80），运行在 `http://106.14.92.235`。

**当前功能**：
- 首页列出 `docs/` 下所有 Markdown 文件（分析报告、摘要）
- 每份报告提取评分、方向、四维度、情景概率、定投建议，渲染为可视化仪表盘
- 支持搜索、按日期/评分排序

**`flow --md` 集成**：主力监测日报 `docs/goldrush-flow-YYYY-MM-DD.md` 会自动出现在首页文件列表中。`server.cjs` 的 `classifyDoc()` 函数可以增加 `flow` 类型识别：

```javascript
function classifyDoc(filename) {
  if (filename.includes('flow')) return 'flow';    // 新增
  if (filename.includes('digest')) return 'digest';
  if (filename.includes('analysis')) return 'analysis';
  // ...
}
```

主力日报在 Web 首页会显示为独立的卡片类型（如蓝色 `主力` 标签），点击进入查看完整内容。

**访问方式**：
```
http://106.14.92.235/                          # 首页，所有报告列表
http://106.14.92.235/goldrush-flow-2026-07-13.md  # 直接打开某日主力日报
```

---

## 6. 对现有分析流程的改造

### 6.1 SentimentAgent 改造

**当前**（`src/agents/analysis-agents.ts` 342-407 行）：

SentimentAgent 的 prompt 要求 LLM 分析 CFTC、ETF 等，但输入只有基本价格数据。LLM 只能"自由发挥"。

**改造后**：

在调用 SentimentAgent 之前，先本地计算 `InstitutionalSignal`，将其作为结构化数据注入 prompt：

```
## 主力动向（本地计算的客观数据，可直接采信）

CFTC COT (2026-07-07):
- 非商业净多头: 285,432 手
- 周度变化: +12,500 手
- 5年历史百分位: 78%
- 近4周趋势: 连续增加

GLD ETF (2026-07-12):
- 持仓量: 872.14 吨
- 5日变化: -3.25 吨 (小幅流出)
- 20日变化: +8.73 吨 (中期净流入)
- 历史百分位: 85%

请基于以上客观数据，结合你对央行购金、VIX、地缘风险的搜索，撰写情绪面分析。
```

这样 LLM 的分析有了真实数据锚点，而不是凭空猜测。

### 6.1.1 设计理由：为什么必须注入本地信号

**问题根源**：`DataCollectorAgent.collectMarketData()` 的 8 条搜索词全部是金价/美元/美债查询，没有任何一条搜索 CFTC 持仓或 ETF 资金流。SentimentAgent 收到的 `MarketData` 只有价格字段，没有仓位的影子。

**LLM 的实际行为**：在没有真实数据的情况下，LLM 对 `cftcPosition` 和 `etfFlows` 的分析只能依赖：
1. 训练数据中的陈旧知识（可能是一两个月前的 CFTC 报告）
2. 通用搜索片段中偶尔出现的 CFTC/ETF 提及（随机且不可靠）
3. 基于金价走势的"反向推测"（"金价涨了，说明资金流入"——这是循环论证）

本质上，旧版 SentimentAgent 在**编造分析**而非**基于数据分析**。

**注入后的效果**：
- `cftcPosition` 字段从"CFTC 持仓偏多"（空洞）变为"CFTC 非商业净多 285,432 手（百分位 78%，近4周连续增加）"（可验证）
- `etfFlows` 从"ETF 资金流入"（猜测）变为"GLD 近5日 -3.25 吨，近20日 +8.73 吨"（可追溯）
- LLM 的角色从"编造数据"转变为"解读数据"——这正是 LLM 擅长的事

### 6.1.2 实现细节

**修改文件**：
- `src/agents/analysis-agents.ts`：`SentimentAgent.analyze()` 新增可选参数 `flowSignal?: InstitutionalSignal`
  - 新增 `formatFlowSignalContext()` 将信号格式化为 prompt 注入块
  - 更新 system prompt 明确告知 LLM"主力数据来自 CFTC/SPDR 官方，可直接采信"
- `src/commands/analysis.ts`：Step 1.8 新增 `ensureInstitutionalFlows()` + `computeInstitutionalSignal()` 调用
  - 在 Step 2 之前执行，确保 SentimentAgent 拿到最新数据
  - 失败时优雅降级：`flowSignal` 为 `undefined`，SentimentAgent 回退到旧行为

**数据流**：
```
analysis.ts
  ├── Step 0: ensureGoldPriceHistory (Yahoo 日线)
  ├── Step 1: DataCollectorAgent (采集价格+美元+美债)
  ├── Step 1.8: ensureInstitutionalFlows (增量拉取 CFTC+GLD)  ← 新增
  │             computeInstitutionalSignal (本地计算评分)    ← 新增
  ├── Step 2: SentimentAgent.analyze(marketData, flowSignal) ← 注入
  │            └── prompt 包含结构化 CFTC/ETF/央行数据
  ├── Step 2.5: RebuttalAgent
  └── Step 3: OrchestratorAgent
```

### 6.2 Orchestrator 改造

Orchestrator 的综合编排 prompt 注入主力信号摘要：

```
## 主力动向信号
综合评分 72/100 偏看多: CFTC投机盘偏多(78), ETF资金中性偏正(62)
```

### 6.3 场景特征向量增强

`scenario_features` 表增加主力相关特征：

```
cftc_percentile  REAL,
etf_flow_5d      REAL,
flow_score       REAL,
```

用于历史模式匹配时加入主力维度。

---

## 7. 实施路线图

### Phase 1 — 核心数据管道（预计 4-6h）

| 任务 | 文件 | 说明 |
|------|------|------|
| 1.1 类型定义 | `src/types/institutional.ts` | CFTC、ETF Flow、央行购金、InstitutionalSignal 类型 |
| 1.2 SQLite 表 | `src/db/institutional-flows.ts` | CRUD + 表初始化（含 cb_pboc_reserves 字段） |
| 1.3 CFTC 采集器 | `src/data/cftc-grabber.ts` | ZIP 下载 → TXT 解析 → 结构化提取 |
| 1.4 GLD ETF 采集器 | `src/data/etf-grabber.ts` | SPDR CSV 下载 → 解析 |
| 1.5 指标计算 | `src/indicators/flow-signal.ts` | CFTC 评分、ETF 评分、背离检测、央行购金信号 |

### Phase 2 — 命令与展现（预计 3-4h）

| 任务 | 文件 | 说明 |
|------|------|------|
| 2.1 `flow` 命令 | `src/commands/flow.ts` | CLI 命令 + 格式化输出 |
| 2.2 注册命令 | `src/index.ts` | Commander.js 注册 |
| 2.3 Markdown 输出 | `src/utils/flow-md.ts` | 主力日报格式 |

### Phase 3 — 分析增强（预计 3-4h）

| 任务 | 文件 | 状态 |
|------|------|------|
| 3.1 自动补齐 | `src/utils/ensure-flows.ts` | ✅ 已完成 |
| 3.2 SentimentAgent 改造 | `src/agents/analysis-agents.ts` | ✅ 已完成 — `analyze()` 新增 `flowSignal` 参数，注入本地数据替代 LLM 猜测 |
| 3.3 analysis.ts 集成 | `src/commands/analysis.ts` | ✅ 已完成 — Step 1.8 自动补齐 + 信号计算，传入 SentimentAgent |
| 3.4 央行购金集成 | (暂缓：需独立 PBOC 数据源) | ⏳ |
| 3.5 特征向量扩展 | `src/db/scenario-features.ts` | ✅ 已完成 — `cftcPercentile`, `etfFlow5d`, `flowScore` 三个字段 |
| 3.6 相似度升级 | `src/utils/scenario-similarity.ts` | ✅ 已完成 — `featureToVector()` 增加主力维度 |
| 3.7 运维集成 | `scripts/daily-analysis.sh` | ✅ 已完成 — cron 同步产出 `flow --md` |
| 3.8 Web 识别 | `server.cjs` | ✅ 已完成 — `classifyDoc()` 识别 flow 类型 |
| 3.5 特征向量扩展 | `src/db/scenario-features.ts` | 加入主力特征 |

### Phase 4 — 增强与优化（P2，可选）

| 任务 | 说明 |
|------|------|
| 4.1 国内 ETF 采集 | `src/data/cn-etf-grabber.ts` |
| 4.2 COMEX volume | Yahoo 数据增加 volume 解析 |
| 4.3 ASCII 趋势图 | 终端可视化 |
| 4.4 `flow --md` 日报 | 定时 cron 生成主力日报 |

---

## 8. 风险与注意事项

### 8.1 数据延迟

| 数据源 | 延迟 | 影响 |
|--------|------|------|
| CFTC COT | 3 天（周二数据周五公布） | 非实时，但机构资金节奏慢，3天延迟可接受 |
| GLD ETF | 1 天（T+1 公布） | 可接受 |
| 国内 ETF | 1 天 | 可接受 |

### 8.2 CFTC 数据格式变更

CFTC 历史文件格式偶有调整。需要做好异常处理，解析失败时降级为"数据暂不可用"，不影响其他功能。

### 8.3 反爬

- 东方财富 API 目前免费无鉴权，但未来可能加反爬
- SPDR 官网稳定，多年未变
- CFTC 官网是政府站点，稳定

### 8.4 干扰信号

- CFTC 持仓中商业头寸包含套保盘，真正反映"主力"的是非商业（管理基金）头寸
- ETF 持仓变化受金价本身影响（AUM = 持仓量 × 金价），需要区分持仓量变化（吨）vs 市值变化
- 单一指标不可靠，**需要 CFTC + ETF + 背离检测多指标共振**

---

## 9. 附录：CFTC 品种代码参考

黄金相关品种：

| 代码 | 品种 | 交易所 |
|------|------|--------|
| `088691` | GOLD | COMEX (CME) |
| `088692` | SILVER | COMEX |
| `075651` | GOLD (Legacy) | COMEX |

**解析目标**：`088691` 的 COT Legacy Report 格式。

---

## 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-07-13 | v0.1 | 初稿：数据源设计、架构、展现、实施路线 |
| 2026-07-13 | v0.2 | 修正：央行购金频次 季度→月度，提升至 P1；增加每日执行与 Web 展示章节 |
| 2026-07-13 | v0.3 | Phase 1+2 完成：全量类型、DB CRUD、CFTC/ETF grabber、flow信号计算、`goldrush flow` 命令、Markdown 输出。Phase 3 完成：ensure-flows + SentimentAgent 注入本地数据 + scenario_features 主力维度扩展 + 相似度升级 + cron/Web 集成 |
