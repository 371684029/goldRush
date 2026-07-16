# 长期方向预期（1 / 3 / 5 年）

> 更新：2026-07-16  
> 目标：**提高可靠性与可解释性**（配置向），**不**追求假精确的多年点位命中率。

**相关**：`IMPROVEMENTS.md` 第十轮、`AGENTS.md`、`README` 命令 `outlook`、`docs/POSITION-AND-TRACK.md`（`allocationStance` 微调当日仓位）、**`docs/ROADMAP-FINENG.md`**（不追求点位 KPI、配置向与反模式一致）。

---

## 1. 产品定义

| 做 | 不做 |
|----|------|
| 配置档位：偏积极 / 中性 / 偏谨慎 | 承诺 5 年累计涨跌幅 |
| 慢变量主导的方向粗分 | 把当日综合分 / 强反驳直接复制到 5 年 |
| 历史无条件分位作参考 | 年数线性放大成 −60% 式吓人区间 |
| low 置信不展示点位 | 日频大幅翻转 1/3/5 年方向 |

### 准确率怎么理解

| 可追求 | 不追求 |
|--------|--------|
| 配置档位是否稳健 | 1/3/5 年累计收益点预测命中 |
| 是否少日频乱翻 | 「五年一定涨/跌 X%」 |
| low 时是否少误导 | 样本足够做传统准确率排行（多年标签极少） |

---

## 2. 算法要点（`src/utils/long-term-outlook.ts`）

### 2.1 权重（技术, 基本面, 情绪, 宏观）

| 期限 | 技术 | 基本面 | 情绪(结构) | 宏观 | 当日 overall 掺入 |
|------|------|--------|------------|------|-------------------|
| 1 年 | 15% | 35% | 25% | 25% | **8%** |
| 3 年 | 5% | 35% | 35% | 25% | **0%（脱钩）** |
| 5 年 | 0% | 30% | 40% | 30% | **0%（脱钩）** |

### 2.2 反驳惩罚（封顶）

| 期限 | 大约上限 |
|------|----------|
| 1 年 | ±5 分 |
| 3 年 | ±3 分 |
| 5 年 | ±2 分 |

旧版可把单日 `bearScore` 打成五年极空；新版多年档几乎不被日度反驳绑架。

### 2.3 参考区间

1. **软启发式**：温和年化中枢 × 年数 + √年半宽，**名义累计硬顶 ±35%**  
2. **历史**：有足够 `gold_prices` 时附带 **无条件** P10 / 中位 / P90（GC=F 代理，`long-term-backtest.ts`）  
3. **`confidence === 'low'`**：不展示点位式累计%，只给配置 + 定投纪律（或仅历史分位说明）

### 2.4 平滑（防日度乱翻）

- 相对上一份报告同期限 `biasScore`：`0.55×新 + 0.45×旧`  
- 单日步长上限 **8**  
- `analysis` 从近 21 日报告 JSON 取 `previousOutlook`；`outlook` 命令用报告内旧 outlook 作 previous 后**按新规则重算**

### 2.5 配置档位 `allocationStance`

| 值 | 含义 | 定投语气 |
|----|------|----------|
| `overweight` | 偏积极 | 维持定投，急跌可小加 |
| `neutral` | 中性 | 标准定投、少择时 |
| `underweight` | 偏谨慎 | 保留骨架、放慢加码，**非清仓** |

---

## 3. 改造前后对照（同日 2026-07-16 输入重算示例）

| 期限 | 改造前（示意） | 改造后（示意） |
|------|----------------|----------------|
| 1 年 | 强度 ~22 · low · −28%～−4% | ~29 · moderate · −11%～+5% · 偏谨慎 |
| 3 年 | ~24 · low · −45%～−21% | ~31 · moderate · −23%～+5% · 偏谨慎 |
| 5 年 | ~25 · low · **−62%～−38%** | ~31 · moderate · **−33%～+3%**（顶内）· 偏谨慎 |

方向仍可偏空（与当日宏观一致），但 **不再「五年腰斩」文案**，定投建议为保留骨架而非清仓。

---

## 4. 命令

```bash
cd /path/to/goldRush

# 基于最新 analysis 报告，用当前规则重算长期档（推荐日常查看）
node dist/index.js outlook
node dist/index.js outlook --md    # → docs/goldrush-outlook-latest.md
node dist/index.js outlook --json

# 完整分析写入 report.longTermOutlook（含平滑）
node dist/index.js analysis --md
```

**Web**：读 `docs/goldrush-analysis-*.md` 或 `goldrush-outlook-latest.md`；**只更新 md 不必重启** `server.cjs`。完整日报段需 `analysis --md` 后再刷新浏览器。

---

## 5. 相关文件

| 路径 | 职责 |
|------|------|
| `src/utils/long-term-outlook.ts` | 主逻辑、格式化 |
| `src/utils/long-term-backtest.ts` | 历史无条件分位 |
| `src/types/analysis.ts` | `LongTermHorizonOutlook`（含 `allocationStance`） |
| `src/commands/outlook.ts` | CLI 重算 |
| `src/commands/analysis.ts` | 写入报告 + previous 平滑 |
| `src/utils/report-md.ts` | 日报 Markdown 段 |
| `test/long-term-outlook.test.ts` | 回归（极值、low 区间、平滑） |

---

## 6. 验收清单

- [ ] 强空 + 强反驳输入下，5 年 `returnBand` **不含** −50%～−60% 级数字  
- [ ] `allocationStance` 三期限均有  
- [ ] low 置信文案含「不展示」或仅历史参考  
- [ ] 连续两日极端跳变时，强度变化受平滑约束  
- [ ] `outlook --md` 可独立更新最新长期档  
