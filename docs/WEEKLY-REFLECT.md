# 周末预测错因反思

每周末自动归纳「方向打脸」原因，形成反思文档，并在下周 `analysis` 注入阅读要点——**改善怎么读报告，不自动改权重**。

## 命令

```bash
npm run dev -- reflect --days 14 --md
# 或编译后
goldrush reflect --days 14 --md --refresh-stats
```

产出：

| 文件 | 用途 |
|------|------|
| `docs/goldrush-reflect-YYYY-MM-DD.md` | 当日归档 |
| `docs/goldrush-reflect-latest.md` | 最新可读版 |
| `docs/goldrush-reflect-latest.json` | 供下次 analysis 注入 |

## 定时（周日）

已挂在现有 `scripts/daily-analysis.sh`：周日在 `digest` 之后跑 `reflect --md`。

也可单独 cron（示例）：

```bash
# 周日 12:00 仅反思（路径按实机调整）
# 0 12 * * 0 cd /root/git/goldRush && node dist/index.js reflect --days 14 --md --refresh-stats >> logs/reflect.log 2>&1
```

## 错因分桶（规则可复现）

| 代码 | 含义 |
|------|------|
| `false_bull` | 预测涨 → 实际跌 |
| `false_bear` | 预测跌 → 实际涨 |
| `overconfident` | \|分−50\|≥25 仍打脸 |
| `dual_split` | LLM/量化方向相反且 LLM 错 |
| `quant_saved` | LLM 错但量化对 |
| `both_wrong` | 双分同错 |
| `vs_bucket_worse` | 明显差于同评分档均值 |
| `large_surprise` | 逆预测幅度 ≥2% |

## 如何「驱动更准」

1. 反思 JSON → `formatReflectPromptContext` → 写入 `analysis` 的近期上下文  
2. Web 首页「错因反思」区可读  
3. **不**自动改 `DEFAULT_WEIGHTS`；权重变动仍需 `calibrate --ic` + 人工确认  

## 相关

- 列表对错行：`docs/DAILY-DELTA.md`
- 对错统计：`docs/POSITION-AND-TRACK.md`
