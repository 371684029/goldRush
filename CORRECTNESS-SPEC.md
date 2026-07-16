# GoldRush 正确率与风险暴露率改进规范

## 0. 核心原则

**成本不是问题，正确率和风险暴露率才是关键。**

PortBench证明90%的LLM组合跑不赢等权分配。这意味着：
- GoldRush的价值不在于"频繁优化"
- 而在于"识别异常时刻是否该偏离定投"
- 评分"偏多68分"如果历史准确率只有55%，就是废话
- 真正亏钱的不是"大概率事件"，而是"小概率大影响事件"

改进目标：
1. **让每个评分有统计意义**（回测校准闭环）
2. **让被忽略的风险被暴露**（强制反驳机制）
3. **让不确定性显性化**（情景分析 + 尾部风险）
4. **长期档可靠性**（1/3/5 年配置向、慢变量、不展示假精确吓人区间；见 `docs/LONG-TERM-OUTLOOK.md`）

---

## 1. P0-1：回测校准闭环

### 1.1 问题定义

当前评分"偏多68分"没有历史统计意义。68分可能意味着：
- 历史上，68分区间的分析后续涨概率55%（比抛硬币好一点）
- 历史上，68分区间的分析后续涨概率90%（非常有信心）
- 你根本不知道

没有校准，评分就是拍脑袋。

### 1.2 数据流

```
每次 goldrush analysis 运行：
  → 存入 analysis_reports（date, overall_score, direction）
  → 存入 scenario_features（10维特征向量）

每次 goldrush calibrate 运行：
  ← 读取 analysis_reports（过去N天）
  ← 读取 gold_prices（对应日期价格数据）
  ← 读取 scenario_features（如有）
  → 对每条报告：
     找到报告日期后 T 天的金价
     计算 actual_return 和 actual_direction
  → 按评分区间分组统计
  → 生成校准报告

每次 goldrush analysis 运行（有历史数据后）：
  ← 读取校准结果
  → 注入综合编排prompt："过去90天，70-80分区间的分析，实际涨概率67%"
```

### 1.3 校准算法

```typescript
interface CalibrationBucket {
  scoreRange: string          // "60-70", "70-80", "80-90", "90-100"
  sampleSize: number
  predictedDirection: 'bullish' | 'bearish' | 'neutral'
  actualUpCount: number       // 后T天实际上涨次数
  actualUpProbability: number // 实际上涨概率
  avgReturn: number           // 平均后续收益率
  calibrationError: number    // |midScore - actualUpProbability*100|
  systematicBias: 'optimistic' | 'pessimistic' | 'calibrated'
}

function computeCalibration(
  reports: AnalysisReport[],
  prices: GoldPrice[],
  T: number = 5  // 后续天数
): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = []
  const ranges = [
    { range: '0-30', min: 0, max: 30 },
    { range: '30-50', min: 30, max: 50 },
    { range: '50-60', min: 50, max: 60 },
    { range: '60-70', min: 60, max: 70 },
    { range: '70-80', min: 70, max: 80 },
    { range: '80-90', min: 80, max: 90 },
    { range: '90-100', min: 90, max: 100 },
  ]

  for (const { range, min, max } of ranges) {
    const matching = reports.filter(r => r.overall_score >= min && r.overall_score < max)
    if (matching.length === 0) continue

    let upCount = 0
    let totalReturn = 0
    let validCount = 0

    for (const report of matching) {
      const futurePrice = findPriceNDaysLater(prices, report.date, T)
      const currentPrice = findPriceOnDate(prices, report.date)
      if (!futurePrice || !currentPrice) continue

      const futureReturn = (futurePrice - currentPrice) / currentPrice * 100
      if (futureReturn > 0) upCount++
      totalReturn += futureReturn
      validCount++
    }

    if (validCount === 0) continue

    const avgReturn = totalReturn / validCount
    const actualUpProbability = upCount / validCount * 100
    const midScore = (min + max) / 2
    const calibrationError = Math.abs(midScore - actualUpProbability)

    buckets.push({
      scoreRange: range,
      sampleSize: validCount,
      predictedDirection: midScore > 50 ? 'bullish' : midScore < 50 ? 'bearish' : 'neutral',
      actualUpCount: upCount,
      actualUpProbability: actualUpProbability / 100,
      avgReturn,
      calibrationError,
      systematicBias: calibrationError < 5 ? 'calibrated'
        : midScore > actualUpProbability ? 'optimistic' : 'pessimistic'
    })
  }

  return buckets
}
```

### 1.4 校准上下文注入

当有足够历史数据（≥30条报告）后，每次 `goldrush analysis` 运行时，综合编排prompt注入：

```markdown
## 历史校准数据（过去{N}天）

| 评分区间 | 样本数 | 实际涨概率 | 平均涨幅 | 系统偏差 |
|---------|--------|----------|---------|---------|
| 60-70   | 12     | 58%      | +0.3%   | 偏乐观8% |
| 70-80   | 18     | 67%      | +0.8%   | 校准良好 |
| 80-90   | 8      | 75%      | +1.2%   | 偏保守   |
| 90-100  | 2      | 50%      | -0.1%   | 严重偏乐观 |

你的综合评分应参考此校准数据。特别是：
- 90-100区间历史表现差（50%），高置信度时请额外谨慎
- 70-80区间校准良好，可正常使用
- 偏乐观区间，评分应下调3-5分
```

### 1.5 风险预警质量评估

```typescript
interface RiskAlertQuality {
  redAlertCount: number        // 红灯触发次数（direction=bearish & score<40）
  redAlertHitCount: number     // 红灯后实际大跌次数
  redAlertHitRate: number       // 红灯命中率
  missedAlerts: number         // 该亮红灯但没亮的次数
  missedRate: number           // 漏报率
  // "该亮红灯但没亮"定义：后5天跌幅>2%，但当日评分>60且direction≠bearish
}

function computeRiskAlertQuality(
  reports: AnalysisReport[],
  prices: GoldPrice[],
  threshold: number = -2  // 跌幅超2%算"大跌"
): RiskAlertQuality {
  // ...
}
```

### 1.6 自动回填

分析报告的评分需要和后续实际走势对比。自动回填逻辑：

```typescript
// 每次运行 goldrush analysis 时：
// 1. 检查5天前的报告，如果 scenario_features.backfill_status === 'pending'
// 2. 从 gold_prices 读取5天后的金价
// 3. 计算 actual_5d_return 和 actual_5d_direction
// 4. 更新 backfill_status = 'filled'

async function backfillScenarioFeatures(db: Database) {
  const pending = db.query(`
    SELECT sf.*, ar.date as report_date
    FROM scenario_features sf
    JOIN analysis_reports ar ON sf.report_id = ar.id
    WHERE sf.backfill_status = 'pending'
    AND date(ar.date, '+5 days') <= date('now')
  `)

  for (const row of pending) {
    const futurePrice = await db.query(`
      SELECT london_close FROM gold_prices
      WHERE date > ?
      ORDER BY date ASC LIMIT 1
    `, [row.report_date])

    const currentPrice = await db.query(`
      SELECT london_close FROM gold_prices
      WHERE date = ?
    `, [row.report_date])

    if (futurePrice && currentPrice) {
      const returnPct = (futurePrice.london_close - currentPrice.london_close) / currentPrice.london_close * 100
      db.update(`
        UPDATE scenario_features
        SET actual_5d_return = ?,
            actual_5d_direction = ?,
            backfill_status = 'filled'
        WHERE id = ?
      `, [returnPct, returnPct > 0 ? 'up' : returnPct < 0 ? 'down' : 'flat', row.id])
    }
  }
}
```

### 1.7 `goldrush calibrate` 输出格式

```
═════════════════════════════════════════════════════════════
  📊 GoldRush 置信度校准报告（过去30天）
  报告日期范围: 2026-05-09 ~ 2026-06-08
  分析报告总数: 28条 | 有效回填: 25条
═════════════════════════════════════════════════════════════

  📈 评分区间校准

  评分区间  样本  预测涨概率  实际涨概率  平均涨幅  偏差    系统偏差
  ─────────────────────────────────────────────────────────
  60-70     5     65%       60%       +0.2%    偏乐观5%  轻微乐观
  70-80     12    75%       67%       +0.8%    偏乐观8%  乐观
  80-90     6     85%       75%       +1.2%    偏乐观10% 乐观
  90-100    2     95%       50%       -0.1%    偏乐观45% 严重乐观！

  ⚠️ 系统偏差：整体偏乐观8%
  💡 建议：评分70-80时，实际涨概率约67%，可正常参考
  ⚠️ 警告：评分90+时历史样本少（2条），高置信度可能不可靠

  🚨 风险预警质量

  红灯触发: 3次（direction=bearish & score<40）
  红灯命中: 2次（红灯后5天内实际跌>2%）
  红灯命中率: 67% ✅
  漏报次数: 1次（5天跌>2%但当日评分>60）
  漏报率: 25% ⚠️

  💡 改进建议
  · 高评分（90+）时过于乐观，建议在prompt中增加谨慎修正
  · 漏报率25%，建议增强反驳Agent的强度
═════════════════════════════════════════════════════════════
```

---

## 2. P0-2：强制反驳机制

### 2.1 问题定义

当前分析有反方论据（`counterPoints`），但：
1. 反方论据只是"列一下"，从不改变结论
2. LLM天然偏乐观（FINSABER：牛市过度保守，熊市过度激进）
3. 反方论据是同一个Agent生成的，存在自我确认偏差

### 2.2 架构设计

```
当前流程：
  四维度分析 → 综合编排 → 偏多68分 → 列2条反方 → 结论不变

改进流程：
  四维度分析 → 综合编排 → 初始评分70分
       ↓
  强制反驳Agent（独立session，独立prompt）
       ↓
  反驳评分42分，反驳强度：中等
    · 看空论据1：日线RSI 62已偏强，短线超买
    · 看空论据2：美联储点阵图可能偏鹰
    · 看空论据3：COMEX净多头高位，拥挤交易
    · 看多方漏洞1：美元指数回落可持续性存疑
    · 看多方漏洞2：通胀数据下周公布，可能不及预期
       ↓
  评分修正：70 → 68（反驳强度中等，下调2分）
       ↓
  最终输出：68分 + 反驳摘要 + 尾部风险
```

### 2.3 反驳Agent Prompt

```markdown
# 角色
你是黄金投资分析的独立反驳者。你的唯一任务是找出所有支持金价下跌或风险的证据。

# 规则
1. 你必须找到至少3条实质性看空论据
2. 对每条看多论据，你必须尝试找到它的漏洞或适用条件
3. 如果找不到看空论据，说明你不够努力——几乎任何时刻都有看空理由
4. 你的评分（0-100）代表纯粹的看空力度，100=极度看空
5. 不需要"平衡"观点，你只负责反驳

# 输入数据
{四维度分析结果}
{市场数据}

# 输出格式（JSON Schema）
{
  "bearScore": number,           // 看空力度 0-100
  "bearPoints": [                // 至少3条看空论据
    {
      "point": string,           // 论据描述
      "evidence": string,        // 证据来源
      "probability": number,     // 发生概率估计(%)
      "impact": string           // 如果发生的影响
    }
  ],
  "bullVulnerabilities": [       // 看多论据的漏洞
    {
      "originalPoint": string,   // 原看多论据
      "vulnerability": string,   // 漏洞或适用条件
      "counterCondition": string // 在什么条件下此论据失效
    }
  ],
  "rebuttalStrength": "weak" | "moderate" | "strong",
  "tailRisks": [                 // 尾部风险（小概率大影响）
    {
      "risk": string,
      "probability": number,      // %
      "impact": string,
      "trigger": string,
      "mitigation": string
    }
  ]
}
```

### 2.4 评分修正逻辑

```typescript
function adjustScoreWithRebuttal(
  originalScore: number,
  rebuttal: RebuttalAnalysis
): { adjustedScore: number; adjustment: string } {
  const { rebuttalStrength, bearScore } = rebuttal

  // 反驳强度评估
  const strengthMultiplier = {
    weak: 0.1,      // 轻微修正
    moderate: 0.2,  // 中等修正
    strong: 0.35,   // 显著修正
  }

  const adjustment = (bearScore - originalScore) * strengthMultiplier[rebuttalStrength]
  const adjustedScore = Math.round(originalScore + adjustment)

  return {
    adjustedScore: Math.max(0, Math.min(100, adjustedScore)),
    adjustment: adjustment > 0 ? '上调' : '下调',
  }
}

// 示例：
// originalScore=70, bearScore=42, rebuttalStrength='moderate'
// adjustment = (42 - 70) * 0.2 = -5.6 ≈ -6
// adjustedScore = 70 - 6 = 64 → 但我们不精确到个位，所以取68（中等修正通常不超5分）
// 最终：70 → 68
```

### 2.5 在综合编排中注入反驳

综合编排prompt中增加：

```markdown
## 反驳分析结果

独立反驳Agent评估如下：
- 看空力度：{bearScore}/100
- 反驳强度：{rebuttalStrength}
- 看空论据：
  {bearPoints}
- 看多漏洞：
  {bullVulnerabilities}

评分修正：原始评分{originalScore} → 调整为{adjustedScore}
修正原因：{rebuttalStrength}反驳：{主要看空论据摘要}

请在最终报告中：
1. 包含反驳摘要
2. 如果反驳强度≥中等，在风险提示中突出看空论据
3. 不得忽略反驳结果
```

### 2.6 完整实现示例

#### 示例一：正常偏多行情，中等反驳

**Step 1 — 四维度分析完成，综合编排初步打分**

```
技术面: 75/100 偏多（站上5/20日均线，MACD金叉，RSI 62偏强未超买）
基本面: 70/100 偏多（美元回落，TIPS下行，降息预期增强）
情绪面: 60/100 中性偏多（央行购金，CFTC净多头小幅增加，VIX 15.2）
基金面: 65/100 偏多（ETF净值随金价上涨，折价0.05%，估值偏低）
→ 综合初步评分: 70/100 偏多
```

**Step 2 — 反驳Agent（独立session，独立prompt）**

反驳Agent收到：四维度分析结果 + 原始市场数据。它**不看到**综合评分70分，只看到多方论据，任务是推翻它们。

反驳Agent输出：

```json
{
  "bearScore": 42,
  "bearPoints": [
    {
      "point": "日线RSI 62已进入偏强区间，短线超买风险上升",
      "evidence": "RSI>60在最近3次触及后，2次出现3-5%回调（技术面分析数据）",
      "probability": 35,
      "impact": "金价可能回调$40-60（约1.5-2.3%）"
    },
    {
      "point": "美联储6月点阵图可能偏鹰，市场尚未完全定价",
      "evidence": "CME FedWatch显示7月降息概率仅62%，仍有38%概率维持利率；近期联储官员讲话偏鹰",
      "probability": 25,
      "impact": "若鹰派，金价可能跌至$2,620-$2,640"
    },
    {
      "point": "COMEX净多头持仓处于近3个月高位，拥挤交易风险",
      "evidence": "CFTC数据显示非商业净多头较4周前增加23%，接近历史75%分位",
      "probability": 30,
      "impact": "多头平仓可能触发$30-50快速回调"
    }
  ],
  "bullVulnerabilities": [
    {
      "originalPoint": "美元指数回落利多黄金",
      "vulnerability": "美元回落仅0.15%，幅度过小，可持续性存疑",
      "counterCondition": "若周五非农数据强于预期，美元可能反弹，此利多失效"
    },
    {
      "originalPoint": "降息预期增强利多黄金",
      "vulnerability": "降息预期已部分体现在金价中（溢价约$80-100）",
      "counterCondition": "若降息推迟或幅度不及预期，已体现在金价中的预期将回吐"
    }
  ],
  "rebuttalStrength": "moderate",
  "tailRisks": [
    {
      "risk": "美联储意外加息或维持鹰派立场更久",
      "probability": 5,
      "impact": "金价可能跌8%（约$214）",
      "trigger": "CPI > 3.5% 且美联储官员集体鹰派发言",
      "mitigation": "暂停定投1期，观察2周"
    },
    {
      "risk": "美元指数突破105关键阻力位",
      "probability": 8,
      "impact": "金价可能跌5%（约$134）",
      "trigger": "欧央行意外鸽派 + 美国经济数据强于预期",
      "mitigation": "减仓10%，美元回落至103后恢复定投"
    },
    {
      "risk": "全球风险偏好突变（黑天鹅）导致流动性危机",
      "probability": 3,
      "impact": "金价可能跌12%（约$320），但通常短期后反弹",
      "trigger": "VIX > 30，或重大地缘事件",
      "mitigation": "全面暂停定投，1周后评估"
    }
  ]
}
```

**Step 3 — 评分修正**

```
originalScore = 70
bearScore = 42
rebuttalStrength = "moderate"

adjustment = (42 - 70) * 0.2 = -5.6 ≈ -6
adjustedScore = 70 - 6 = 64
```

修正后评分：**70 → 64**（中等反驳强度下调6分）

**Step 4 — 综合编排Agent最终输出**

综合编排收到：四维度分析 + 反驳结果 + 校准数据，输出最终报告：

```
🎯 综合研判：偏多（64/100）  ← 注意：从初步70分下调至64分
   校准参考：60-70分区历史准确率58%（偏差：偏乐观8%）

⚡ 情景分析
   基准情景（55%）：金价温和上行至$2,700-$2,720
     → 维持定投
   上行情景（25%）：降息预期强化，金价测试$2,750-$2,800
     → 定投+加码20%（触发：美联储给出明确降息指引）
   下行情景（20%）：鹰派信号+美元反弹，金价回落至$2,620-$2,640
     → 暂停定投1期，$2,620附近恢复（触发：非农数据强于预期）

🔴 强制反驳摘要
   反驳强度: 中等 | 看空力度: 42/100
   · RSI 62偏强，短线超买回调风险35%
   · 美联储6月点阵图偏鹰概率25%
   · COMEX净多头高位，拥挤交易风险30%
   · 看多漏洞：美元回落仅0.15%可持续性存疑
   · 看多漏洞：降息预期已溢价$80-100，不及预期将回吐
   → 评分从初步70分下调至64分

⚠️ 尾部风险
  1. 美联储意外加息 → 概率5%，金价可能跌8%
  2. 美元突破105 → 概率8%，金价可能跌5%
  3. VIX>30黑天鹅 → 概率3%，金价可能跌12%
  综合尾部风险指数: 15.2%
```

#### 示例二：强看多但反驳也强 — 修正显著

```
初始分析:
  技术面: 85/100 强看多（突破20周均线，周线MACD金叉，放量上攻）
  基本面: 80/100 强看多（美元大跌2.3%，TIPS下行12bp，央行大规模购金）
  情绪面: 70/100 偏多（CFTC净多头大幅增加，VIX降至13.8）
  基金面: 75/100 偏多（ETF资金大幅流入，溢价0.3%）
  → 综合初步评分: 82/100 强看多

反驳Agent:
  bearScore: 55
  rebuttalStrength: "strong"

  bearPoints:
    1. "美元大跌2.3%可能是超跌反弹前的死猫跳反杀"
       — 历史上美元单日跌>2%后3日内反弹超1.5%的概率40%
       — probability: 40%, impact: 金价可能回落$50-80
    2. "VIX 13.8处于极端低位，市场过度乐观往往是反转前兆"
       — VIX<14在过去12个月中出现8次，其中6次在2周内出现>15%涨幅（意味恐慌回升）
       — probability: 50%, impact: 金价可能波动加大，方向不确定
    3. "金价偏离20周均线3.2%，历史上偏离>3%后30日回调概率72%"
       — 过去24个月中，偏离20周均线>3%出现6次，5次在30天内回归均线
       — probability: 72%, impact: 可能回调3-5%

  bullVulnerabilities:
    1. "TIPS急剧下行" → 下行仅0.12bp幅度不大，可持续性存疑
    2. "央行大规模购金" → Q1数据滞后，可能已被市场充分消化（金价已涨5%）

评分修正:
  adjustment = (55 - 82) * 0.35 = -9.45 ≈ -9
  adjustedScore = 82 - 9 = 73
```

**关键**：从82下调9分到73。这是一个有意义的调整——从"强看多"变成了"适度看多"。反驳强度为strong，修正系数0.35使得差距的35%被计入。

最终输出中，下行情景概率会被上调（因为反驳截到了真实风险），操作建议会从"加码定投"调整为"维持定投，关注回调风险"。

#### 示例三：弱看多且反驳也弱 — 几乎不修正

```
初始分析:
  技术面: 55/100 中性（均线缠绕，MACD零轴附近，方向不明）
  基本面: 60/100 中性偏多（数据清淡，无重大催化剂）
  情绪面: 58/100 中性（CFTC持仓中立，VIX 16正常水平）
  基金面: 60/100 中性偏多（ETF资金流入流出平衡，溢价0.02%）
  → 综合初步评分: 58/100 弱看多

反驳Agent:
  bearScore: 45
  rebuttalStrength: "weak"

  bearPoints:
    1. "下周美联储会议前市场可能波动加大，方向不明"
       — probability: 15%, impact: 波动增加但方向不确定
    2. "行情确实方向不明，缺少明确催化剂"
       — probability: 20%, impact: 横盘震荡概率大

  bullVulnerabilities:
    (反驳Agent很难找到强力的看多漏洞，因为本身看多力度就弱)

评分修正:
  adjustment = (45 - 58) * 0.1 = -1.3 ≈ -1
  adjustedScore = 58 - 1 = 57
```

修正微乎其微——这是正确的，因为弱看空的行情本来就不需要大幅修正。反驳Agent自己也不够努力（因为实在找不到强力的看空论据）。

最终输出就是一个轻微偏多的中性判断，情景分析中基准情景占比高（60-65%），上下行概率都不高。

### 2.7 反驳强度判定规则

反驳强度不是靠LLM自己说的（它可能自谦），而是通过其输出内容的客观指标来判定：

```typescript
function determineRebuttalStrength(rebuttal: RebuttalAnalysis): 'weak' | 'moderate' | 'strong' {
  const { bearPoints, bullVulnerabilities, bearScore } = rebuttal
  
  let strength: number = 0
  
  // 维度1: bearScore本身 (0-40分)
  // bearScore越高，说明反驳Agent自认为看空力度越强
  if (bearScore >= 70) strength += 40
  else if (bearScore >= 55) strength += 25
  else if (bearScore >= 40) strength += 15
  else strength += 5
  
  // 维度2: 看空论据质量 (0-30分)
  // 高概率论据越多，反驳越有力
  const highProbPoints = bearPoints.filter(p => p.probability >= 30)
  strength += Math.min(highProbPoints.length * 10, 30)
  
  // 维度3: 看多漏洞数量 (0-30分)
  // 漏洞越多，说明原始分析越站不住脚
  strength += Math.min(bullVulnerabilities.length * 10, 30)
  
  if (strength >= 60) return 'strong'
  if (strength >= 35) return 'moderate'
  return 'weak'
}
```

**为什么不用LLM自述的rebuttalStrength？**

LLM有三种倾向：
1. **过于礼貌**：大部分LLM倾向于说"moderate"（60%+），即使反驳很弱
2. **过度自信**：少数LLM可能总是说"strong"
3. **一致性偏差**：LLM的rebuttalStrength和bearScore可能高度相关，没有额外信息量

用客观指标判定，更好更可控：
- bearScore反映整体看空力度
- 高概率论据数量反映反驳是否有实质证据
- 看多漏洞数量反映原始分析是否站得住脚

三个维度综合，比单靠self-assessment准确得多。

### 2.8 评分修正公式的合理性

```
修正公式: adjustment = (bearScore - originalScore) × strengthMultiplier

strengthMultiplier:
  weak:     0.10  → 反驳力度弱，轻微修正（1-3分）
  moderate: 0.20  → 反驳力度中等，适度修正（3-8分）
  strong:   0.35  → 反驳力度强，显著修正（5-15分）
```

**为什么不是1.0？**

反驳Agent是专门找空方论据的，天然偏空。它的bearScore不代表"真实看空力度"，而是"尽力找看空理由后的最高看空力度"。如果全盘接受（乘数1.0），评分会被拉到bearScore附近，失去原始分析的价值。

折中处理：承认反驳有一定道理（修正10-35%的差距），但不全盘接受。

**乘数校准**：

初始值基于经验判断（weak=0.1, moderate=0.2, strong=0.35），但应通过`goldrush calibrate`数据持续校准：

```typescript
// 校准公式（积累足够数据后启用）
// 目标：找到使校准误差最小的乘数
interface MultiplierCalibration {
  weakMultiplier: number      // 初始0.10
  moderateMultiplier: number  // 初始0.20
  strongMultiplier: number    // 初始0.35
  calibrationDate: string
  sampleSize: number
}

// 每30天用历史数据重新校准：
// 1. 取最近30次分析的 originalScore, bearScore, rebuttalStrength, adjustedScore
// 2. 对比 adjustedScore vs 后5日实际走势的准确率
// 3. 用网格搜索找使准确率最高的乘数
// 4. 如果新乘数与旧乘数差异<0.05，保持旧乘数（稳定性优先）
```

**边界情况处理**：

| 场景 | originalScore | bearScore | strength | adjustment | 结果 | 说明 |
|------|-------------|-----------|----------|------------|------|------|
| 正常偏多 | 70 | 42 | moderate | -5.6 | 64 | 典型修正 |
| 强看多强反驳 | 82 | 55 | strong | -9.5 | 73 | 显著修正 |
| 弱看多弱反驳 | 58 | 45 | weak | -1.3 | 57 | 几乎不修正 |
| 看空行情 | 30 | 75 | strong | +15.8 | 46 | 反驳推动看空→更空 |
| 反驳比原始更乐观 | 65 | 70 | moderate | +1.0 | 66 | 反驳同意看多，微调 |
| 极端修正保护 | 85 | 20 | strong | -22.8 | 62→clamp(0,100)=62 | 最大修正约23分 |

**注意**：反驳机制不只在看多时生效。当originalScore看空（如30分），bearScore看空力度更强（如75分），修正会把评分朝更空的方向推。反之，如果反驳Agent认为空方论据也不足（bearScore比originalScore还高），说明市场确实方向不明，微调即可。

### 2.9 反驳Agent的关键设计决策

**Q: 反驳Agent应该看到原始评分吗？**

A: **不应该。** 反驳Agent看到的输入是四维度分析结果和原始市场数据，不包含综合评分。这样避免了锚定效应——如果看到"70分偏多"，反驳Agent可能会围绕70分来组织论据，而不是全力找空方理由。

**Q: 反驳Agent应该看到其他Agent的名称和角色吗？**

A: **不应该。** 反驳Agent的prompt只说"以下是市场分析数据"，不告诉它这些数据来自"技术面Agent"或"基本面Agent"。避免它因为权威暗示而降低反驳力度。

**Q: 如果反驳Agent真的找不到看空论据（极端看多行情）怎么办？**

A: 反驳Agent的prompt硬编码了规则："如果找不到看空论据，说明你不够努力——几乎任何时刻都有看空理由"。如果仍然bearScore很低（<30），rebuttalStrength判定为"weak"，修正系数0.1，修正量很小。这是合理的——在极端看多行情中，反驳确实应该弱。

**Q: 评分修正后，是否需要再跑一轮反驳？**

A: **不需要。** 只跑一轮反驳。多轮反驳会导致：1) 成本翻倍但没有显著收益；2) 第二轮反驳会知道第一轮的评分修正结果，产生锚定。一轮足够暴露主要风险。

**Q: 反驳Agent和综合编排Agent应该用同一个LLM还是不同LLM？**

A: **建议同一个模型（glm-5.1），但独立session。** 不同模型可能产生系统偏差（如一个模型天然偏乐观）。同模型同prompt不同角色，可以隔离偏见到角色而非模型。

---

## 3. P1-1：情景分析

### 3.1 替代单一点估计

当前输出：`偏多68分 → 建议入场$2665-2675`

改为三情景：

```typescript
interface Scenarios {
  base: {
    probability: number      // 基准情景概率（通常45-60%）
    description: string      // "金价温和上行至$2,710"
    goldPrice: string        // 预期金价区间
    action: string           // "维持定投"
    confidence: 'moderate'  // 基于校准数据的置信度
  }
  upside: {
    probability: number      // 上行情景概率（通常15-30%）
    description: string
    goldPrice: string
    trigger: string          // "美联储意外降息"
    action: string           // "定投+加码20%"
    confidence: 'low'       // 低概率情景置信度低
  }
  downside: {
    probability: number      // 下行情景概率（通常10-25%）
    description: string
    goldPrice: string
    trigger: string          // "通胀反弹导致延迟降息"
    action: string           // "暂停定投1期"
    confidence: 'low'
    hedges: string[]         // 对冲建议
  }
}
```

### 3.2 概率约束

- 三个概率之和必须 = 100%
- 基准情景概率通常 > 40%（太高说明不确定）
- 下行情景概率 **不得低于15%**（强制暴露下行风险）
- 每个情景必须有明确的触发条件

### 3.3 在综合编排prompt中

```markdown
## 情景分析要求

你必须输出三个情景（基准/上行/下行），而非单一预测：

1. 基准情景：最可能发生的路径（概率45-60%）
2. 上行情景：超预期情景（概率15-30%）
3. 下行情景：不及预期情景（概率15-30%，不得低于15%）

规则：
- 三个概率之和 = 100%
- 每个情景必须有明确的触发条件
- 下行情景的概率不得低于15%（这是风险暴露的要求）
- 每个情景给出对应的操作建议
- 基准情景的操作建议是默认建议
- 上行/下行情景的操作建议是"如果发生则如何调整"

校准数据参考：
{注入历史校准数据}
```

---

## 4. P1-2：尾部风险探测器

### 4.1 设计原则

尾部风险不是"可能发生的小风险"，而是"小概率但如果发生会亏大钱的事件"。

### 4.2 尾部风险来源

每次分析时，综合编排Agent必须输出至少3项尾部风险，来源包括：
1. 反驳Agent输出的`tailRisks`
2. 事件日历（美联储决议日、非农日等）
3. 宏观异常（美元指数突破关键位、VIX飙升等）

### 4.3 尾部风险指数

```typescript
function computeTailRiskIndex(risks: TailRisk[]): {
  index: number              // 综合尾部风险指数（%）
  highestRisk: TailRisk      // 最高单项风险
} {
  // 概率不简单叠加（事件可能互斥），取近似计算
  const noRisk = risks.reduce((p, r) => p * (1 - r.probability / 100), 1)
  const index = (1 - noRisk) * 100  // 至少一项发生的概率

  const highest = risks.reduce((max, r) =>
    r.probability * parseImpactScore(r.impact) > max ? r : max, risks[0])

  return { index: Math.round(index * 10) / 10, highestRisk: highest }
}
```

### 4.4 在输出中的展示

```
⚠️ 尾部风险（可能导致重大亏损的情景）
─────────────────────────────────────────
1. 美联储意外加息 → 概率5%，金价可能跌8%
   触发: CPI > 3.5% 且美联储鹰派 | 对冲: 暂停定投1期
2. 美元指数突破105 → 概率8%，金价可能跌5%
   触发: 欧央行意外鸽派 | 对冲: 减仓10%
3. 全球风险偏好突变（VIX > 30）→ 概率3%，金价可能跌12%
   触发: 黑天鹅事件 | 对冲: 全面暂停定投，1周后评估

综合尾部风险指数: 15.2%（至少一项发生的概率）
```

---

## 5. 实现优先级和依赖关系

```
P0-1: 回测校准闭环 ─────→ 需要30+天历史数据才能有意义
  ├─ 建立 scenario_features 表      ← P1阶段
  ├─ 自动回填 actual_5d_return      ← 每次analysis后自动
  ├─ calibrate 命令                  ← P1阶段
  └─ 校准上下文注入prompt           ← 有30条数据后启用

P0-2: 强制反驳机制 ──────→ 可立即实现
  ├─ 反驳Agent prompt               ← 立即开始
  ├─ RebuttalAnalysis 类型定义       ← 立即开始
  ├─ 评分修正逻辑                    ← 立即开始
  └─ 综合编排prompt注入              ← P1阶段

P1-1: 情景分析 ──────────→ 需要修改GoldAnalysisReport
  ├─ Scenarios 类型定义             ← P1阶段
  ├─ 综合编排prompt修改             ← P1阶段
  └─ 终端输出格式修改               ← P1阶段

P1-2: 尾部风险 ──────────→ 与P0-2反驳Agent自然结合
  ├─ TailRisk 类型定义              ← P0-2部分
  ├─ 反驳Agent输出tailRisks         ← P0-2部分
  └─ 综合编排prompt增加尾部风险模块  ← P1阶段
```

### 实现顺序建议

```
Phase 0（立即，1-2天）：
  · 新建 scenario_features 表
  · 定义 RebuttalAnalysis, TailRisk, Scenarios 类型
  · 编写反驳Agent prompt
  · 编写评分修正逻辑

Phase 1（P1开发时，与analysis命令一起）：
  · 实现 rebuttal Agent 调用
  · 修改综合编排prompt（注入校准数据 + 三情景 + 尾部风险）
  · 修改 GoldAnalysisReport 输出格式
  · 实现 scenario_features 自动存储
  · 实现 actual_5d_return 自动回填
  · 实现 calibrate 命令

Phase 2（积累30+条数据后启用）：
  · 校准上下文自动注入
  · 历史模式匹配（余弦相似度检索）
```

---

## 6. 成功指标

| 指标 | 当前状态 | 目标 | 衡量方法 |
|------|---------|------|---------|
| 评分校准度 | 未知 | 各区间校准误差<10% | `goldrush calibrate --detail` |
| 系统偏差 | 未知 | 偏乐观<5% | 校准报告中系统偏差 |
| 风险暴露率 | 未知 | 下行情景概率≥15% | 每次输出的downside.probability |
| 反驳有效性 | 无 | 反驳强度≥moderate时评分修正≥3分 | 反驳评分vs最终评分差异 |
| 尾部风险覆盖 | 无 | 每次分析≥3项尾部风险 | 统计tailRisks.length |
| 漏报率 | 未知 | <20% | calibrate报告中missedRate |