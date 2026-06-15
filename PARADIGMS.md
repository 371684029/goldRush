# 金融理财 Agent 架构范式参考

## 0. 结论先行

GoldRush 当前走的是**"LLM编排+搜索增强"范式**——这在2024-2026年是主流做法，但**不是唯一路径**，也不一定是最优路径。

金融Agent领域有 **6 种主要范式**，每种有不同的适用场景和技术深度。GoldRush 选的路对个人投资者来说够了，但仍有明显的改进空间。

---

## 1. 六种金融 Agent 范式

### 范式 1：LLM 编排 + 搜索增强（GoldRush 当前路线）

```
用户 → CLI → 多Agent编排 → LLM推理 + 搜索数据 → 结构化输出
```

**代表项目**：大多数2024-2026年的金融ChatGPT插件、自定义GPTs

**优点**：
- 开发门槛低，用现有LLM能力
- 搜索数据实时性好
- 灵活，可观可改

**缺点**：
- LLM会幻觉——搜索结果可能被误读或编造
- 无记忆无学习——每次分析都是独立推断
- 没有回测验证——"过去这样分析对不对？"
- 成本随调用次数线性增长

**GoldRush的增强**：双引擎搜索、交叉验证、SQLite历史——已经比纯LLM方案好很多了，但本质上还是同一范式。

---

### 范式 2：RAG + 知识图谱（检索增强生成）

```
用户提问 → 向量检索相关知识 → LLM基于检索结果回答
         → 知识图谱提供实体关系推理
```

**代表项目**：FinGPT（GitHub 20K+ stars）、BloombergGPT

**核心思路**：
- 不是每次搜索互联网，而是预先构建金融知识库
- 知识图谱存储实体关系（"美联储降息" → 影响 → "黄金上涨"）
- 向量数据库存储金融文档/研报/新闻的embedding
- 检索时先找最相关的文档片段，再让LLM基于这些片段回答

**与GoldRush的区别**：

| 维度 | GoldRush（搜索增强） | RAG + 知识图谱 |
|------|---------------------|--------------|
| 数据来源 | 实时搜索 | 预建知识库 |
| 知识深度 | 搜索结果片段 | 完整研报/历史 |
| 推理能力 | LLM泛化推理 | 实体关系图谱增强 |
| 幻觉风险 | 中等（有验证但仍有风险） | 较低（基于已有知识） |
| 实时性 | 强（实时搜索） | 弱（知识库更新延迟） |
| 建设成本 | 低 | 高（要建知识图谱） |

**可借鉴**：
- **知识图谱**：黄金的因果关系比较固定（美元涨→黄金跌），可以建一个简化版因果图谱
- **RAG**：把历史分析报告存入向量数据库，下次分析时检索"上次类似行情我们怎么判断的"

---

### 范式 3：传统量化 + 技术指标（纯算法，无LLM）

```
历史数据 → 技术指标计算 → 规则引擎/统计模型 → 信号输出
```

**代表项目**：QuantConnect、Zipline、Backtrader、TradingView Pine Script

**核心思路**：
- 完全不用LLM，纯数学计算
- 双均线交叉、RSI超买超卖、MACD金叉死叉等经典策略
- 可以严格回测（用历史数据验证过去表现）
- 信号明确：金叉=买入，死叉=卖出

**与GoldRush的区别**：

| 维度 | GoldRush | 传统量化 |
|------|---------|---------|
| 可回测 | ❌ 不能 | ✅ 可以 |
| 信号客观性 | LLM主观评分 | 数学规则100%客观 |
| 解释性 | 自然语言解释好 | 规则清晰但缺乏"为什么" |
| 灵活性 | 可分析任何文本数据 | 只能处理结构化数据 |
| 开发难度 | 中 | 中 |
| 运行成本 | LLM调用费用 | 几乎为零 |

**可借鉴**：
- **回测机制**：GoldRush 已经有 SQLite 历史数据了，完全可以加一个回测模块——"如果过去3个月每次RSI<30都加仓，收益如何？"
- **纯技术指标信号**：不依赖LLM，本地计算MA/RSI/MACD后输出客观信号

---

### 范式 4：多Agent辩论（Multi-Agent Debate）

```
用户提问 → 多个Agent各自分析
         → 看多Agent vs 看空Agent 辩论
         → 裁判Agent总结
```

**代表项目**：ChatDev（软件工程）、MetaGPT、部分金融研究

**核心思路**：
- 不是单个Agent综合分析，而是让多个Agent各自持不同立场
- 例如：看多Agent找出所有利好，看空Agent找出所有利空
- 辩论几轮后，裁判Agent总结最终观点
- 减少单一LLM的偏见和遗漏

**与GoldRush的区别**：
- GoldRush已经部分采用了这个思路（要求"必须搜反方论据"）
- 但GoldRush是一个Agent内做正反分析，而不是独立Agent辩论

**可借鉴**：
- 可以做一个 `--debate` 模式：运行两次analysis，一次强制看多视角，一次强制看空视角，对比输出
- 成本翻倍（多一轮LLM调用），但分析质量可能显著提升

---

### 范式 5：强化学习 + 自适应策略

```
历史数据 → 环境模拟 → Agent试错 → 奖励函数优化 → 最优策略
```

**代表项目**：FinRL（AI4Finance）、OpenAI Gym 金融环境

**核心思路**：
- 不告诉Agent规则，让它自己学
- 定义奖励函数（如：收益率、夏普比率、最大回撤）
- Agent在模拟环境中反复试错，学习最优策略
- 可以持续进化——市场变了，模型自动适应

**与GoldRush的区别**：

| 维度 | GoldRush | 强化学习 |
|------|---------|---------|
| 学习能力 | ❌ 不学习 | ✅ 持续进化 |
| 数据需求 | 少（搜索即可） | 大（需要大量历史数据） |
| 计算资源 | 低 | 高（需要GPU训练） |
| 可解释性 | 好（自然语言） | 差（黑盒） |
| 开发门槛 | 中 | 高 |
| 过拟合风险 | 无 | 高 |

**可借鉴**：
- 短期不建议引入强化学习（太重了）
- 但可以借鉴**反馈学习**思想：存储历史研判结果和实际行情对比，自动评分"上次分析准不准"
- 这就是 GoldRush 的 `analysis_reports` 表可以做的——记录每次研判，回头看对了多少

---

### 范式 6：人在回路（Human-in-the-Loop）

```
Agent 分析 → 输出建议 → 人确认/修改 → Agent执行 → 反馈学习
```

**代表项目**：各种 Robo-Advisor（Betterment、Wealthfront）、Copilot 式投资助手

**核心思路**：
- Agent 不自动做决策，只做分析和建议
- 人在关键步骤拍板
- 记录人的偏好和决策模式
- 逐渐学习人的风格，个性化推荐

**与GoldRush的区别**：
- GoldRush 目前就是纯分析建议，人自己决策——这已经是在回路中了
- 但没有"学习人的风格"这个环节

**可借鉴**：
- 记录用户对每次分析的反馈（"这个建议我认同/不认同"）
- 逐渐学习用户的偏好（偏保守还是偏激进、更喜欢定投还是波段）
- 这需要简单的用户反馈机制，比如 `goldrush feedback --agree` / `goldrush feedback --disagree`

---

## 2. GoldRush 当前架构的定位

```
范式1: LLM编排+搜索增强 ──✅ GoldRush在这里
范式2: RAG + 知识图谱      ──🔲 可以部分引入
范式3: 传统量化+技术指标   ──🔲 可以部分引入（已开始：本地指标计算）
范式4: 多Agent辩论          ──🔲 可以部分引入
范式5: 强化学习             ──❌ 暂不考虑
范式6: 人在回路             ──✅ 已部分是（人最终拍板）
```

**当前GoldRush本质**：范式1为主，叠加了范式3的本地技术指标计算、范式2的交叉验证思想。

---

## 3. 值得渐进引入的改进

### 改进 1：回测验证（来自范式3）

**现状**：GoldRush 每次分析都是"此时此刻"的判断，无法验证"过去这样判断对不对"

**改进**：
- 已经有 SQLite 历史数据和 `analysis_reports` 表
- 加一个 `goldrush backtest` 命令
- 逻辑：取过去N次分析报告 → 对比实际行情走势 → 输出准确率

```
goldrush backtest --last 30          # 回测最近30次分析
goldrush backtest --from 2026-01-01  # 从指定日期回测

输出示例：
═══════════════════════════════════════
  📊 GoldRush 回测报告（最近30次分析）
═══════════════════════════════════════
  总体准确率: 72%
  看多准确率: 78% (14/18)
  看空准确率: 60% (6/10)
  中性准确率: 50% (1/2)
  
  平均偏差: +0.3%（预测偏多0.3%）
  最大失误: 2026-04-15 预测偏空，实际涨2.1%
═══════════════════════════════════════
```

### 改进 2：简易知识图谱（来自范式2）

**现状**：每次分析都从头搜索"美元涨→黄金跌"这种因果关系

**改进**：
- 黄金的因果关系网络相对固定，可以硬编码一个简化版
- 不需要完整知识图谱，只需要一个因果关系表

```jsonc
// causal_graph.json
{
  "relations": [
    { "cause": "美元指数上涨", "effect": "黄金承压", "strength": "strong", "direction": "negative" },
    { "cause": "实际利率上行", "effect": "黄金持有成本增加", "strength": "strong", "direction": "negative" },
    { "cause": "地缘风险上升", "effect": "避险需求增加", "strength": "medium", "direction": "positive" },
    { "cause": "央行购金", "effect": "黄金需求增加", "strength": "medium", "direction": "positive" },
    { "cause": "通胀预期上升", "effect": "黄金保值需求增加", "strength": "medium", "direction": "positive" },
    { "cause": "美联储降息", "effect": "实际利率下行", "strength": "strong", "direction": "positive" }
  ]
}
```

- 好处：LLM 分析时不用每次从搜索结果里推断因果关系，直接参照图谱
- 成本：几乎为零（JSON文件，不需要向量数据库）

### 改进 3：双视角辩论模式（来自范式4）

**现状**：一个综合Agent做最终判断，可能有偏差

**改进**：
- `goldrush analysis --debate` 触发辩论模式
- 运行两次分析：一次强制看多视角，一次强制看空视角
- 不增加搜索成本（数据复用），只增加一次LLM调用

```
═══════════════════════════════════════
  ⚔️ GoldRush 辩论模式
═══════════════════════════════════════

🐂 看多Agent 评分: 72/100
  · 美元指数回落，利多黄金
  · 央行持续购金
  · RSI未超买，有上行空间

🐻 看空Agent 评分: 45/100  
  · 金价已连涨3周，短线超买风险
  · 美联储不排除再次加息
  · 季节性因素（6月黄金传统偏弱）

⚖️ 裁判综合: 偏多但谨慎（60/100）
  建议维持定投，但短线不加仓
═══════════════════════════════════════
```

### 改进 4：用户偏好学习（来自范式6）

**现状**：所有用户看到相同的分析，没有个性化

**改进**：
- 简单的反馈机制：`goldrush feedback --agree` / `goldrush feedback --disagree`
- 存储反馈到 SQLite
- 逐渐学习用户偏好：

```sql
CREATE TABLE user_feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id   INTEGER,          -- 关联分析报告
  agree       BOOLEAN,          -- 是否认同
  horizon     TEXT,              -- short | mid
  note        TEXT,              -- 用户备注
  created_at  TEXT DEFAULT (datetime('now'))
);
```

- 长期可以做到：用户偏保守 → 定投建议偏谨慎；用户偏激进 → 波段建议占比更高

### 改进 5：定时推送 + 异常告警

**现状**：只有主动查询模式

**改进**：
- `goldrush daily` 可以配置为定时任务（cron）
- 异常告警：当黄金出现重大异动时主动推送

```
# .goldrush/alerts.json
{
  "alerts": [
    { "condition": "gold_price_change > 2%", "action": "notify", "channels": ["terminal", "wechat"] },
    { "condition": "dollar_index > 106", "action": "report", "channels": ["terminal"] },
    { "condition": "us10y_yield > 4.5%", "action": "notify", "channels": ["terminal"] }
  ]
}
```

---

## 4. 各范式代表性项目/论文

| 范式 | 代表项目/论文 | GitHub/链接 | Stars |
|------|-------------|------------|-------|
| 范式1 LLM编排+搜索 | 大多数金融GPTs | - | - |
| 范式2 RAG+知识图谱 | **FinGPT** | [AI4Finance-Foundation/FinGPT](https://github.com/AI4Finance-Foundation/FinGPT) | 20K+ |
| | BloombergGPT | 论文（闭源） | - |
| | FinRobot | [AI4Finance-Foundation/FinGPT](https://github.com/AI4Finance-Foundation/FinGPT) 内 | - |
| 范式3 传统量化 | **FinRL** | [AI4Finance-Foundation/FinRL](https://github.com/AI4Finance-Foundation/FinRL) | 10K+ |
| | Zipline | [quantopian/zipline](https://github.com/quantopian/zipline) | 18K+ |
| | Backtrader | [mhallsmoore/backtrader](https://github.com/mhallsmoore/backtrader) | 14K+ |
| | VectorBT | [polakowo/vectorbt](https://github.com/polkovo/vectorbt) | 4K+ |
| 范式4 多Agent辩论 | **MetaGPT** | [geekan/MetaGPT](https://github.com/geekan/MetaGPT) | 50K+ |
| | ChatDev | [OpenBMB/ChatDev](https://github.com/OpenBMB/ChatDev) | 26K+ |
| | AgentVerse (多Agent金融) | [OAID/AgentVerse](https://github.com/OpenBMB/ChatDev) | - |
| 范式5 强化学习 | **FinRL** | 同上 | 10K+ |
| | QLib (微软) | [microsoft/qlib](https://github.com/microsoft/qlib) | 16K+ |
| 范式6 人在回路 | Betterment/Wealthfront | 商业闭源 | - |
| | **PortfolioOptimizer** | [robertmartin8/PortfolioOptimizer](https://github.com/robertmartin8/PortfolioOptimizer) | - |

---

## 5. GoldRush 渐进升级路线图

```
当前 (P0-P3)              短期改进 (P4)             中期改进 (P5)           长期 (P6)
─────────────            ─────────────             ───────────           ────────
LLM编排+搜索             + 回测验证                + 因果图谱             自适应系统
+ 双引擎搜索             + 辩论模式               + 用户偏好学习
+ 本地技术指标            + 异常告警                + RAG向量库
+ 来源验证               + 反馈机制               

核心技术栈不变            核心技术栈不变             加向量数据库           可能引入轻量RL
SQLite + LLM             SQLite + LLM             SQLite+ChromaDB
```

**关键原则**：每次升级都不破坏现有功能，是**增量式**的。

---

## 6. 推荐阅读

| 资源 | 类型 | 重点 |
|------|------|------|
| [FinGPT论文](https://arxiv.org/abs/2306.06031) | 论文 | 金融LLM全栈框架：数据层→工程层→LLM层→任务层→应用层 |
| [FinRL](https://github.com/AI4Finance-Foundation/FinRL) | 代码 | 强化学习做金融交易的框架，可借鉴回测思路 |
| [Microsoft QLib](https://github.com/microsoft/qlib) | 代码 | 微软的AI量化平台，有完整的因子挖掘和回测 |
| [MetaGPT](https://github.com/geekan/MetaGPT) | 代码 | 多Agent协作框架，辩论模式可参考 |
| [BloombergGPT论文](https://arxiv.org/abs/2303.17564) | 论文 | 金融领域特训LLM的思路（成本很高但有参考价值） |
| [FinGPT-Forecaster](https://huggingface.co/spaces/FinGPT/FinGPT-Forecaster) | Demo | 输入股票代码预测走势的Demo，可体验交互方式 |
| [VectorBT文档](https://vectorbt.dev/) | 文档 | Python回测框架，速度比Backtrader快100x |