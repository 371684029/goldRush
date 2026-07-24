# 双打分机制（LLM × 量化）

> 更新：2026-07-15  
> 目标：**两套独立分数并存、可校准、冲突可解释**，不是合成一个黑箱分，也不是冲突时抬某一侧权重。

**相关**：`IMPROVEMENTS.md`、`AGENTS.md`、`docs/POSITION-AND-TRACK.md`（冲突 → 仓位上限 50%）、`docs/DATA-QUALITY.md`、**`docs/ROADMAP-FINENG.md`**（禁止狂调权重、因子 IC 规划）。

---

## 1. 架构

```
LLM 分：四维 Agent → 反驳 → 历史校准偏移 → overall.score
量化分：本地因子加权 → overall.quantScore（+ quantFactors 明细）
              ↓
     evaluateDualScore（冲突规则）
              ↓
   展示双分 + 操作策略（both / hold_on_conflict / …）
```

| 轨道 | 入口 | 依赖 |
|------|------|------|
| LLM | `analysis-agents` + `rebuttal` + `calibration-adjust` | opencode |
| 量化 | `indicators/quant-score.ts` | SQLite 金价/利率 + flow 信号 |

---

## 2. 操作策略（产品规则）

| 条件 | `actionPolicy` | 用户侧操作 |
|------|----------------|------------|
| 无量化分 | `llm_only` | 仅 LLM（标明量化缺失） |
| \|Δ\| ≤ 8 且同向 | `both` | 可参考综合结论 |
| 8 &lt; \|Δ\| ≤ 15 同向 | `quant_preferred` | 叙事 LLM；结构可参考量化 |
| \|Δ\| &gt; **15** 或同档方向相反 | `hold_on_conflict` | **仓位受限（≤50%）+ 定投为主**；文案须说明谁偏哪边 |
| 仅四维弱一致、双分未冲突 | `both` / `quant_preferred` | **不是**「双体系不一致」；仓位仍受弱一致上限 |
| 数据门禁红档 | hold | 数据门禁优先，关闭操作 |

**冲突日怎么写给人看（重要）：**

- ❌ 不要天天重复「双体系不一致，操作弃权」盖掉一切  
- ✅ 写清：`LLM 偏空28 / 量化 中性45：阶段判断不完全一致` + **具体仓位%**  
- ✅ **单一文案源**：`buildDualConflictOverride` 出标题；仓位算完后 `alignDualOverrideWithPosition` 把双打分节 / 策略风险提示 / 操作建议对齐为同一 headline + 仓位 action  
- ✅ 统一出口 `resolveOperationalAdvice`：有仓位推荐时，冲突日仍以仓位结论为主文案  

**明确不做的事：**

- ❌ 冲突时自动提高「量化总权重」  
- ❌ 只显示一个合成分  
- ❌ 用 LLM 文案覆盖量化数值（或反过来偷偷改 LLM 分）
- ❌ 把「四维弱一致」误标成「双体系不一致」

**谁更准：** 看 `goldrush calibrate` 分轨结果（方向命中、分桶误差、冲突日对照），再人工决定是否改因子权重或 prompt。

---

## 3. 校准（分轨）

```bash
node dist/index.js calibrate --days 90 --detail
# 可选：--tearsheet --md
```

输出包括：

1. **LLM 分桶表**（overall_score vs 后 5 日涨跌）  
2. **量化分桶表**（quant_score；需历史报告已写入 quant_score）  
3. **方向命中率**（score&gt;55 预测涨，&lt;45 预测跌，中间不计入）  
4. **冲突日** \|Δ\|&gt;15：若跟 LLM / 跟量化各自命中次数  
5. **样本排除**：无效金价、报告数据红档（ conf&lt;35 或门禁警告）

注入编排 prompt 的仍是 **LLM 分区间** 的历史校准上下文（与量化分轨展示并存）。

---

## 4. 量化因子

文件：`src/indicators/quant-score.ts` → `DEFAULT_WEIGHTS`（**总和必须 = 1.0**）。

| key | 默认权重 | 说明 |
|-----|----------|------|
| trend | 12% | MA20 偏离 |
| rsi / macd / bollinger | 10% / 10% / 5% | 技术 |
| valuation | 8% | 历史百分位 |
| **flow** | **15%** | CFTC+GLD+央行（结构化，宜保留） |
| dxy / us10y / **tips** | 12% / 8% / **10%** | 宏观（tips 实际利率逻辑强） |
| volatility / regime | 5% / 5% | 波动与阶段 |
| **event_heat** | **0%** | 事件热度默认关闭（噪声大） |

**无效因子降权到 0：** 用历史回测看因子与后 5/20 日收益是否有稳定关系；无效则该 key 权重改 0，把权重加到仍有效的因子上，保持总和 1.0。这是**量化轨道内部**调整，不取消双打分。

---

## 5. 与数据门禁的关系

| 层 | 模块 | 作用 |
|----|------|------|
| 数据 | `data-quality-gate.ts` | 有没有可信金价；红档关操作 |
| 双分 | `dual-score.ts` | 两套分是否打架；冲突弃权 |
| 展示 | CLI / MD / Web | 两套分 + 策略文案始终可见 |

顺序：先数据红档，再双分冲突；都通过才允许较积极的定投加减建议。

---

## 6. 相关代码

| 路径 | 职责 |
|------|------|
| `src/utils/dual-score.ts` | 冲突判定与文案 |
| `src/indicators/quant-score.ts` | 量化引擎 + 因子 Markdown |
| `src/db/calibration.ts` | 分轨校准 + 命中统计 + 坏样本排除 |
| `src/commands/calibrate.ts` | CLI 校准报告 |
| `src/commands/analysis.ts` | 接入弃权覆盖 |
| `src/agents/orchestrator.ts` | 写入 quantScore / quantFactors |
| `src/utils/report-md.ts` | 日报双分与因子表 |
| `server.cjs` | Web 双分横幅 |

---

## 7. 验收清单

- [ ] `analysis` 输出同时含 LLM 分与量化分  
- [ ] \|Δ\|&gt;15 时操作文案为维持定投 / 弃权  
- [ ] `calibrate` 有 LLM 表；有 quant_score 样本后有量化表  
- [ ] MD 含 `## ⚖️ 双打分机制`  
- [ ] Web 文章页有双分横幅（新报告更完整）  
- [ ] 因子表不展示 weight=0 的 event_heat  

---

## 8. 后续（规划，勿违背）

| 可做 | 不做（反模式） |
|------|----------------|
| 因子 IC 体检后**降权/下线**失效因子（`ROADMAP-FINENG` 包 E） | 因短期命中率**抬高** LLM 或量化单侧权重 |
| Walk-forward 分轨命中（包 F） | 冲突时「站队」合成一个黑箱分 |
| 冲突日统计跟 Q / 跟 L（已有 prediction-track） | 用深度学习替代双分纪律 |

完整说明：[ROADMAP-FINENG.md](./ROADMAP-FINENG.md) §2.2、§5。
