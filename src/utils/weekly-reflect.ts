// 周末预测错因反思 — 纯本地归纳，驱动下周读报告更准
//
// 原则：
// 1. 不自动改因子权重 / 不抬单侧；只产出「怎么读报告」的教训
// 2. 错因用可复现规则分桶（虚假看多/看空、过自信、双分分裂等）
// 3. 读取上一份反思，标出反复出现的主题（驱动归纳更准）

import type { PredictionRecentRow, PredictionTrackStats } from './prediction-track.js';

export type MissReasonCode =
  | 'false_bull'
  | 'false_bear'
  | 'overconfident'
  | 'dual_split'
  | 'quant_saved'
  | 'both_wrong'
  | 'vs_bucket_worse'
  | 'large_surprise';

export const MISS_REASON_LABELS: Record<MissReasonCode, string> = {
  false_bull: '虚假看多（预测涨→实际跌）',
  false_bear: '虚假看空（预测跌→实际涨）',
  overconfident: '过自信极值分仍打脸',
  dual_split: '双分方向分裂且 LLM 错',
  quant_saved: 'LLM 错但量化对（本应更信结构）',
  both_wrong: '双分同向皆错',
  vs_bucket_worse: '明显差于同评分档均值',
  large_surprise: '逆预测幅度偏大（|顺预测|≥2%）',
};

export interface ReflectCase {
  date: string;
  llmScore: number;
  quantScore: number | null;
  pred: 'up' | 'down' | 'flat';
  actual5dPct: number;
  alignPct: number | null;
  vsBucketPct: number | null;
  reasons: MissReasonCode[];
  note: string;
}

export interface WeeklyReflect {
  generatedAt: string;
  period: { days: number; from: string; to: string };
  totals: {
    eligible: number;
    hits: number;
    misses: number;
    flats: number;
    pending: number;
    hitRate: number | null;
  };
  reasonCounts: Partial<Record<MissReasonCode, number>>;
  cases: ReflectCase[];
  lessons: string[];
  watchNextWeek: string[];
  /** 与上一份反思重复出现的主题 */
  recurringThemes: string[];
  headline: string;
  summary: string;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function predLabel(p: string): string {
  if (p === 'up') return '涨';
  if (p === 'down') return '跌';
  return '中性';
}

function alignOf(row: PredictionRecentRow): number | null {
  const a = num(row.alignPct);
  if (a != null) return a;
  const ret = num(row.actual5dPct);
  if (ret == null) return null;
  if (row.pred === 'up') return ret;
  if (row.pred === 'down') return -ret;
  return null;
}

/** 单条 miss 的错因标签 */
export function classifyMissReasons(row: PredictionRecentRow): MissReasonCode[] {
  if (row.status !== 'miss' || row.actual5dPct == null) return [];
  const reasons: MissReasonCode[] = [];
  const ret = row.actual5dPct;

  if (row.pred === 'up' && ret < -0.1) reasons.push('false_bull');
  if (row.pred === 'down' && ret > 0.1) reasons.push('false_bear');

  if (Math.abs(row.llmScore - 50) >= 25) reasons.push('overconfident');

  const align = alignOf(row);
  if (align != null && align <= -2) reasons.push('large_surprise');

  if (row.vsBucketPct != null) {
    // 预测涨时期望跑赢同档；预测跌时期望跑输同档（实际更负）
    if (row.pred === 'up' && row.vsBucketPct <= -1) reasons.push('vs_bucket_worse');
    if (row.pred === 'down' && row.vsBucketPct >= 1) reasons.push('vs_bucket_worse');
  }

  const qHit = row.quantHit;
  const qPred = row.quantPred;
  if (qPred && qPred !== 'flat' && row.pred !== 'flat' && qPred !== row.pred) {
    reasons.push('dual_split');
    if (qHit === true) reasons.push('quant_saved');
  } else if (qHit === true) {
    reasons.push('quant_saved');
  } else if (qHit === false && qPred && qPred !== 'flat') {
    reasons.push('both_wrong');
  }

  return [...new Set(reasons)];
}

function caseNote(row: PredictionRecentRow, reasons: MissReasonCode[]): string {
  const bits = [
    `预测${predLabel(row.pred)}`,
    `5日 ${row.actual5dPct! > 0 ? '+' : ''}${row.actual5dPct}%`,
    `LLM ${row.llmScore}`,
  ];
  if (row.quantScore != null) bits.push(`量化 ${row.quantScore}`);
  const align = alignOf(row);
  if (align != null) {
    bits.push(align >= 0 ? `顺${align}%` : `逆${Math.abs(align)}%`);
  }
  if (reasons.length) {
    bits.push(reasons.map(c => MISS_REASON_LABELS[c].split('（')[0]).join('、'));
  }
  return bits.join(' · ');
}

export interface BuildWeeklyReflectInput {
  /** 已按日展开的对错明细（通常来自 prediction-track 整窗） */
  outcomes: PredictionRecentRow[];
  /** 回顾日历天数（用于裁剪 + 文案） */
  days?: number;
  /** 锚点日期 YYYY-MM-DD，默认今天 */
  asOf?: string;
  previous?: Pick<WeeklyReflect, 'lessons' | 'watchNextWeek' | 'reasonCounts' | 'headline'> | null;
  generatedAt?: string;
}

function inWindow(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function addDaysIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * 构建周末反思报告（纯函数）
 */
export function buildWeeklyReflect(input: BuildWeeklyReflectInput): WeeklyReflect {
  const days = input.days ?? 14;
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
  const from = addDaysIso(asOf, -(days - 1));
  const to = asOf;

  const windowRows = input.outcomes.filter(r => inWindow(r.date, from, to));
  // 同一天可能多条（重复写入），按日期保留最新一条（数组通常新→旧）
  const byDate = new Map<string, PredictionRecentRow>();
  for (const r of windowRows) {
    if (!byDate.has(r.date)) byDate.set(r.date, r);
  }
  const unique = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  let hits = 0, misses = 0, flats = 0, pending = 0;
  const cases: ReflectCase[] = [];
  const reasonCounts: Partial<Record<MissReasonCode, number>> = {};

  for (const r of unique) {
    if (r.status === 'hit') hits++;
    else if (r.status === 'miss') misses++;
    else if (r.status === 'flat') flats++;
    else pending++;

    if (r.status !== 'miss' || r.actual5dPct == null) continue;
    const reasons = classifyMissReasons(r);
    for (const code of reasons) {
      reasonCounts[code] = (reasonCounts[code] ?? 0) + 1;
    }
    cases.push({
      date: r.date,
      llmScore: r.llmScore,
      quantScore: r.quantScore,
      pred: r.pred,
      actual5dPct: r.actual5dPct,
      alignPct: alignOf(r),
      vsBucketPct: num(r.vsBucketPct),
      reasons,
      note: caseNote(r, reasons),
    });
  }

  const scored = hits + misses;
  const hitRate = scored > 0 ? Math.round((hits / scored) * 1000) / 10 : null;

  const lessons = buildLessons(reasonCounts, cases, hitRate, misses);
  const watchNextWeek = buildWatchList(reasonCounts, cases);
  const recurringThemes = findRecurring(input.previous, reasonCounts, lessons);

  const topReason = Object.entries(reasonCounts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
  const headline = unique.length === 0
    ? `近 ${days} 日暂无可对账样本`
    : hitRate == null
      ? `近 ${days} 日 ${unique.length} 个交易日，方向样本不足`
      : `近 ${days} 日方向命中 ${hitRate}%（${hits}/${scored}）· 打脸 ${misses} 次`
        + (topReason ? ` · 主因「${MISS_REASON_LABELS[topReason[0] as MissReasonCode].split('（')[0]}」` : '');

  const summary = [
    headline,
    lessons[0] ?? '继续按门禁+双分+仓位%阅读，勿追点位。',
    recurringThemes.length ? `反复主题：${recurringThemes.join('；')}` : '',
  ].filter(Boolean).join(' ');

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    period: {
      days,
      from: unique[0]?.date ?? from,
      to: unique[unique.length - 1]?.date ?? to,
    },
    totals: {
      eligible: unique.length,
      hits,
      misses,
      flats,
      pending,
      hitRate,
    },
    reasonCounts,
    cases: cases.sort((a, b) => b.date.localeCompare(a.date)),
    lessons,
    watchNextWeek,
    recurringThemes,
    headline,
    summary,
  };
}

function buildLessons(
  counts: Partial<Record<MissReasonCode, number>>,
  cases: ReflectCase[],
  hitRate: number | null,
  misses: number,
): string[] {
  const lessons: string[] = [];
  if (misses === 0) {
    lessons.push('本窗无方向打脸样本：保持定投纪律，仍以可信度与仓位%为准，勿因短期命中加杠杆。');
    return lessons;
  }

  if ((counts.false_bull ?? 0) >= 2) {
    lessons.push('虚假看多偏多：高分日要先看反驳/风险门禁与实际利率，勿把「偏多叙事」直接换成加仓。');
  }
  if ((counts.false_bear ?? 0) >= 2) {
    lessons.push('虚假看空偏多：低分日核对是否已被定价；仓位下限仍守纪律，避免恐慌式过度减仓。');
  }
  if ((counts.overconfident ?? 0) >= 1) {
    lessons.push('极值分打脸：把综合分当区间中心而非点预测；可信度低时扩大心理区间、缩小操作幅度。');
  }
  if ((counts.quant_saved ?? 0) >= 1) {
    lessons.push('出现「LLM 错、量化对」：双分分歧日更应看量化结构与仓位上限，而不是站队讲故事。');
  }
  if ((counts.dual_split ?? 0) >= 1) {
    lessons.push('双分方向分裂日：产品规则是不抬单侧权重；反思时记录「若当时跟了哪一侧」仅作校准，不改即时仓位算法。');
  }
  if ((counts.both_wrong ?? 0) >= 1) {
    lessons.push('双分同错：可能是宏观冲击/标签噪音；下周优先检查数据门禁与事件，而非狂调因子。');
  }
  if ((counts.large_surprise ?? 0) >= 1) {
    lessons.push('逆预测幅度大：关注驱动归因（TIPS/DXY/利率）是否与分数叙事一致；不一致时以降仓解读。');
  }
  if ((counts.vs_bucket_worse ?? 0) >= 2) {
    lessons.push('多次差于同档均值：同分段历史涨概率仅供参考，样本少时勿过度解读校准条。');
  }

  if (hitRate != null && hitRate < 45) {
    lessons.push(`本窗命中仅 ${hitRate}%：降低对「方向结论」的权重，读报告时优先仓位%/门禁/双分，而非标题情绪。`);
  } else if (hitRate != null && hitRate >= 65) {
    lessons.push(`本窗命中 ${hitRate}% 尚可：仍禁止用命中率当业绩；继续用错因表检查是否过拟合叙事。`);
  }

  const worst = cases.slice().sort((a, b) => (a.alignPct ?? 0) - (b.alignPct ?? 0))[0];
  if (worst && (worst.alignPct ?? 0) <= -2) {
    lessons.push(`最大逆预测日 ${worst.date}（${worst.note}）：复盘当日 MD 的驱动与反驳是否互相打架。`);
  }

  if (lessons.length === 0) {
    lessons.push('存在打脸样本但未形成主导错因：逐日看列表对错行，积累后再归纳。');
  }
  return lessons.slice(0, 6);
}

function buildWatchList(
  counts: Partial<Record<MissReasonCode, number>>,
  cases: ReflectCase[],
): string[] {
  const watch: string[] = [];
  if ((counts.false_bull ?? 0) > (counts.false_bear ?? 0)) {
    watch.push('下周若分数偏多：先核对 TIPS/美元是否同步利多，再看仓位是否已偏高。');
  } else if ((counts.false_bear ?? 0) > (counts.false_bull ?? 0)) {
    watch.push('下周若分数偏空：区分「趋势空」与「超卖反弹」；定投层不因单日低分清仓。');
  }
  if ((counts.quant_saved ?? 0) >= 1 || (counts.dual_split ?? 0) >= 1) {
    watch.push('双分Δ>15 或方向相反时：列表上优先看量化分与「维持定投」提示。');
  }
  if (cases.some(c => c.reasons.includes('overconfident'))) {
    watch.push('出现 ≥75 或 ≤25 分时：强制对照可信度区间半宽，操作按区间下沿思考。');
  }
  watch.push('周末只更新阅读清单，不自动改 DEFAULT_WEIGHTS；权重变更需人工确认 + calibrate --ic。');
  return watch.slice(0, 5);
}

function findRecurring(
  previous: BuildWeeklyReflectInput['previous'],
  counts: Partial<Record<MissReasonCode, number>>,
  lessons: string[],
): string[] {
  if (!previous) return [];
  const recurring: string[] = [];
  const prevCounts = previous.reasonCounts ?? {};
  for (const code of Object.keys(counts) as MissReasonCode[]) {
    if ((counts[code] ?? 0) >= 1 && (prevCounts[code] ?? 0) >= 1) {
      recurring.push(MISS_REASON_LABELS[code].split('（')[0]);
    }
  }
  // 教训关键词简单重叠
  for (const lesson of lessons) {
    const key = lesson.slice(0, 8);
    if ((previous.lessons ?? []).some(l => l.includes(key) || key && l.startsWith(key.slice(0, 4)))) {
      if (!recurring.includes(lesson.slice(0, 16))) {
        // skip noisy; only reason labels above
      }
    }
  }
  return recurring.slice(0, 5);
}

/** 注入 analysis prompt 的短上下文 */
export function formatReflectPromptContext(reflect: WeeklyReflect | null | undefined): string {
  if (!reflect || !reflect.lessons?.length) {
    return '无上周预测错因反思（可先运行 goldrush reflect --md）。';
  }
  const lines = [
    '## 上周预测错因反思（只调整阅读重心，勿机械改仓）',
    `- ${reflect.headline}`,
  ];
  for (const l of reflect.lessons.slice(0, 4)) {
    lines.push(`- 教训：${l}`);
  }
  for (const w of reflect.watchNextWeek.slice(0, 3)) {
    lines.push(`- 下周注意：${w}`);
  }
  if (reflect.recurringThemes.length) {
    lines.push(`- 反复主题：${reflect.recurringThemes.join('、')}`);
  }
  lines.push('- 冲突日仍不抬单侧权重；以门禁与仓位%为准。');
  return lines.join('\n');
}

export function formatWeeklyReflectConsole(r: WeeklyReflect, indent = '  '): string {
  const lines = [
    `${indent}🪞 预测错因反思（${r.period.from} ~ ${r.period.to}）`,
    `${indent}  ${r.headline}`,
    `${indent}  样本 ${r.totals.eligible} · 命中 ${r.totals.hits} · 打脸 ${r.totals.misses} · 持平 ${r.totals.flats} · 待回填 ${r.totals.pending}`,
  ];
  const ranked = Object.entries(r.reasonCounts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (ranked.length) {
    lines.push(`${indent}  错因分桶：`);
    for (const [code, n] of ranked) {
      lines.push(`${indent}    · ${MISS_REASON_LABELS[code as MissReasonCode]} × ${n}`);
    }
  }
  lines.push(`${indent}  教训：`);
  for (const l of r.lessons) lines.push(`${indent}    · ${l}`);
  if (r.watchNextWeek.length) {
    lines.push(`${indent}  下周观察：`);
    for (const w of r.watchNextWeek) lines.push(`${indent}    · ${w}`);
  }
  if (r.recurringThemes.length) {
    lines.push(`${indent}  反复主题：${r.recurringThemes.join('、')}`);
  }
  if (r.cases.length) {
    lines.push(`${indent}  打脸日明细（最多 8）：`);
    for (const c of r.cases.slice(0, 8)) {
      lines.push(`${indent}    ❌ ${c.date} ${c.note}`);
    }
  }
  return lines.join('\n');
}

export function formatWeeklyReflectMarkdown(r: WeeklyReflect): string {
  const lines = [
    '# 🪞 GoldRush 预测错因反思',
    '',
    `> ${r.period.from} ~ ${r.period.to}（近 ${r.period.days} 日）· 生成 ${r.generatedAt.slice(0, 19).replace('T', ' ')}`,
    '',
    `## 摘要`,
    '',
    `**${r.headline}**`,
    '',
    r.summary,
    '',
    '## 对账统计',
    '',
    '| 指标 | 数值 |',
    '|------|------|',
    `| 可对账交易日 | ${r.totals.eligible} |`,
    `| 方向命中 | ${r.totals.hits} |`,
    `| 方向打脸 | ${r.totals.misses} |`,
    `| 持平/中性不计 | ${r.totals.flats} |`,
    `| 待回填 | ${r.totals.pending} |`,
    `| 命中率 | ${r.totals.hitRate != null ? `**${r.totals.hitRate}%**` : 'N/A'} |`,
    '',
    '## 错因分桶',
    '',
  ];

  const ranked = Object.entries(r.reasonCounts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (!ranked.length) {
    lines.push('_本窗无打脸样本或未识别出主导错因。_');
    lines.push('');
  } else {
    lines.push('| 错因 | 次数 |');
    lines.push('|------|------|');
    for (const [code, n] of ranked) {
      lines.push(`| ${MISS_REASON_LABELS[code as MissReasonCode]} | ${n} |`);
    }
    lines.push('');
  }

  lines.push('## 阅读教训（驱动下周更准）');
  lines.push('');
  for (const l of r.lessons) lines.push(`- ${l}`);
  lines.push('');

  lines.push('## 下周观察清单');
  lines.push('');
  for (const w of r.watchNextWeek) lines.push(`- ${w}`);
  lines.push('');

  if (r.recurringThemes.length) {
    lines.push('## 反复主题（相对上一份反思）');
    lines.push('');
    for (const t of r.recurringThemes) lines.push(`- ${t}`);
    lines.push('');
  }

  if (r.cases.length) {
    lines.push('## 打脸日明细');
    lines.push('');
    lines.push('| 日期 | LLM | 量化 | 预测 | 5日 | 顺/逆 | 错因 |');
    lines.push('|------|-----|------|------|-----|-------|------|');
    for (const c of r.cases) {
      const q = c.quantScore ?? '—';
      const align = c.alignPct == null ? '—'
        : c.alignPct >= 0 ? `顺+${c.alignPct}%` : `逆${Math.abs(c.alignPct)}%`;
      const rs = c.reasons.map(x => MISS_REASON_LABELS[x].split('（')[0]).join('、') || '—';
      lines.push(
        `| ${c.date} | ${c.llmScore} | ${q} | ${c.pred} | ${c.actual5dPct > 0 ? '+' : ''}${c.actual5dPct}% | ${align} | ${rs} |`,
      );
    }
    lines.push('');
  }

  lines.push('## 使用说明');
  lines.push('');
  lines.push('- 标签：分数 >55 预测涨、<45 预测跌；5 个交易日金价涨跌对账。');
  lines.push('- 本反思**只改善阅读与 prompt 上下文**，不自动改量化权重。');
  lines.push('- 定时：`goldrush reflect --md`（建议周六/日 cron）；下次 `analysis` 会注入「上周反思」要点。');
  lines.push('- 非投资建议，非业绩承诺。');
  lines.push('');
  return lines.join('\n');
}

/** 从 stats 构建（便捷） */
export function buildWeeklyReflectFromStats(
  stats: PredictionTrackStats | null | undefined,
  opts?: Omit<BuildWeeklyReflectInput, 'outcomes'>,
): WeeklyReflect {
  return buildWeeklyReflect({
    outcomes: stats?.recent ?? [],
    ...opts,
  });
}
