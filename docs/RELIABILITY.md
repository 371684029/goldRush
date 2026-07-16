# 可信度一览 · 评分区间 · 搜索存档

> 第十二轮（2026-07-16）：**准确率不吹嘘、可靠性可量化、日常一眼读完**

**相关**：`docs/DATA-QUALITY.md` · `docs/DUAL-SCORE.md` · `docs/POSITION-AND-TRACK.md` · `docs/OPTIMIZATION.md` · **`docs/ROADMAP-FINENG.md`**（新鲜度 SLA、walk-forward、snippet 对账等规划）

---

## 1. 解决什么问题

| 用户疑问 | 之前 | 现在 |
|----------|------|------|
| 这个 68 分有多准？ | 单点数字，像「确定」 | **评分区间**（如 62–74），半宽随不确定性变宽 |
| 今天能不能按报告加减仓？ | 散落在门禁/双分/校准多处 | **可信度 0–100** + 红/黄/绿档位 |
| 三行看懂今日结论？ | 长文开头难扫 | **三行 TL;DR**（研判区间 / 仓位 / 可信度注意） |
| 金价是不是 LLM 瞎编的？ | 难追溯 | **搜索原文存档** `docs/search-raw/YYYY-MM-DD.json` |

> **可信度 ≠ 金价预测准确率。**  
> 它衡量的是：数据是否可用、双体系是否一致、维度是否同向、校准样本是否够——即「是否适合做纪律操作」。

---

## 2. 可信度如何打分（权重）

| 因子 | 权重 | 说明 |
|------|------|------|
| 数据质量门禁 | 35 | 红档极低；黄档中等；绿+高置信满分 |
| 双打分对齐 | 25 | 冲突 / 弃权扣分；缺量化扣分 |
| 四维一致性 | 20 | strong / moderate / weak |
| 历史校准样本 | 15 | n≥20 满；n&lt;5 警告 |
| 滚动 5 日命中 | 5 | 有 `prediction-track` 时纳入 |

**档位**：

| tier | 条件（约） | Web 左边色 |
|------|------------|------------|
| high 🟢 | score ≥ 72 且非红档 | 绿 |
| medium 🟡 | 50–71 | 琥珀 |
| low 🟠 | &lt; 50 | 橙 |
| blocked 🔴 | 门禁 `actionable=false` | 红 |

**评分区间半宽**：可信度越低越宽（约 ±4～±12）；红档至少 ±12。

实现：`src/utils/reliability-card.ts`  
接入：`analysis` → 控制台 + MD + Web 解析。

---

## 3. 三行看懂（TL;DR）

1. 研判 **low–high**/100（中心 center）· 方向  
2. 建议仓位 %（来自仓位推荐）  
3. 可信度标签 + 首条警告  

MD 小节标题：`## 🛡️ 可信度一览`  
Web：首页与文章仪表盘最上方 `rel-panel`。

---

## 4. 搜索原文存档（准确率审计）

- **何时**：`DataCollector` 批量 Tavily 搜索之后、LLM 提取之前  
- **路径**：`docs/search-raw/YYYY-MM-DD.json`  
- **内容**：query、snippet、url、sourceGrade  
- **保留**：30 天自动清理  
- **用途**：金价异常时回看「片段里是否真有这个价」  

实现：`src/utils/search-raw-archive.ts`

---

## 5. 与其它机制关系

```
门禁红 ──→ 可信度 blocked + 仓位≤35%
双分冲突 ──→ 可信度下调 + 仓位≤50% + 操作弃权
四维弱一致 ──→ 可信度下调 + 仓位不加码
校准 n 小 ──→ 区间加宽 + Web 样本警告
滚动命中低 ──→ 轻微扣分 + 提示降操作强度
```

---

## 6. 运维

```bash
# 刷新 MD（含可信度小节）+ stats JSON
node dist/index.js analysis --md

# 查看今日搜索原文
ls docs/search-raw/
```

Web 旧日报无「可信度一览」时会 **粗推** 并标「粗推」，完整分需重新 analysis。

---

## 7. 统一操作建议（A 轮）

`resolveOperationalAdvice`（`plain-advice.ts`）为 **CLI / MD / Web** 单一出口：

| 优先级 | 条件 | source |
|--------|------|--------|
| 1 | 门禁 `actionable=false` | `data_gate` |
| 2 | 双分 `hold_on_conflict` / actionOverride | `dual_conflict` |
| 3 | 有仓位推荐 | `position` |
| 4 | 仅有 LLM 分 | `score` |

Smart 平稳日路径也会重算门禁/双分/仓位/可信度/对错 JSON（零 LLM）。

Web 首屏默认三块：**可信度 TL;DR · 仓位 · 命中 3 数**；门禁/双分/分桶明细折叠。

## 8. 规划中（与可信度相关）

完整优先级与反模式见 **[ROADMAP-FINENG.md](./ROADMAP-FINENG.md)**。与本模块直接相关的后续包：

| 包 | 说明 |
|----|------|
| D 新鲜度 SLA | 金价/快照年龄超阈 → 门禁降档（进可信度「数据质量」因子） |
| F Walk-forward 命中 | 与现有滚动命中并列，降低 in-sample 自嗨 |
| H Snippet 对账 | 搜索存档已有 → 自动比对抽价偏差 |

## 9. 非目标

- 不承诺「命中率 ≥ X%」  
- 不把可信度当成买卖信号本身（仓位另有 `position-recommend`）  
- 搜索存档不含 API Key，仅公开可搜片段  
- 不以「点位预测准确率」为对外 KPI（见 ROADMAP-FINENG 反模式）
