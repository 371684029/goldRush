// 今日必看清单 — 把「怎么读报告」写死成 5 步，塞入当日数字

import type { DayDelta } from './day-delta.js';
import type { DualScoreVerdict } from './dual-score.js';
import type { PositionRecommendation } from './position-recommend.js';
import type { ReliabilityCard } from './reliability-card.js';
import type { DataQualityGate } from './data-quality-gate.js';
import type { EventGoldTransmission } from './event-transmission.js';

export interface ReadingChecklistItem {
  step: number;
  title: string;
  value: string;
  skippable: boolean;
}

export interface ReadingChecklist {
  headline: string;
  items: ReadingChecklistItem[];
  footer: string;
}

export interface BuildReadingChecklistInput {
  reliability?: Pick<ReliabilityCard, 'score' | 'label' | 'scoreBand' | 'tldr'> | null;
  position?: Pick<PositionRecommendation, 'targetPct' | 'label' | 'emoji'> | null;
  dayDelta?: Pick<DayDelta, 'skipFineRead' | 'headline' | 'scoreDelta' | 'positionDelta'> | null;
  dual?: Pick<DualScoreVerdict, 'delta' | 'actionPolicy' | 'llmScore' | 'quantScore'> | null;
  dataGate?: Pick<DataQualityGate, 'actionable' | 'tier'> | null;
  transmission?: Pick<EventGoldTransmission, 'actionable' | 'headline'> | null;
  reflectOneLiner?: string | null;
}

function gateLabel(tier: DataQualityGate['tier'] | undefined): string {
  if (tier === 'red') return '红档';
  if (tier === 'yellow') return '黄档';
  if (tier === 'green') return '绿档';
  return '';
}

export function buildReadingChecklist(input: BuildReadingChecklistInput): ReadingChecklist {
  const gateBlocked = input.dataGate && input.dataGate.actionable === false;
  const items: ReadingChecklistItem[] = [];

  const pos = input.position;
  const rel = input.reliability;
  items.push({
    step: 1,
    title: '仓位% + 可信度',
    value: gateBlocked
      ? `⛔ 门禁${gateLabel(input.dataGate?.tier)}：勿据此加减仓`
      : [
          pos ? `${pos.emoji} 建议仓 ${pos.targetPct}%（${pos.label}）` : '仓位见仓位节',
          rel ? `${rel.label} ${rel.score}/100 · 区间 ${rel.scoreBand.low}–${rel.scoreBand.high}` : null,
        ].filter(Boolean).join(' · '),
    skippable: false,
  });

  const dd = input.dayDelta;
  items.push({
    step: 2,
    title: '较昨日',
    value: dd
      ? (dd.skipFineRead
        ? `${dd.headline} → 细文可跳过`
        : dd.headline)
      : '无昨日对比（首日或断档）',
    skippable: !!(dd?.skipFineRead),
  });

  items.push({
    step: 3,
    title: '对错 / 反思',
    value: input.reflectOneLiner?.trim()
      || '看列表对错行或周日 reflect；无数据则跳过',
    skippable: !input.reflectOneLiner,
  });

  const dual = input.dual;
  const dualConflict = dual?.actionPolicy === 'hold_on_conflict';
  items.push({
    step: 4,
    title: '双打分',
    value: dual && dual.llmScore != null
      ? `LLM ${dual.llmScore} · 量化 ${dual.quantScore ?? '—'} · Δ${dual.delta ?? '—'}${dualConflict ? ' · 分歧→定投为主' : ''}`
      : '暂无双分',
    skippable: !dualConflict && Math.abs(dual?.delta ?? 0) < 8,
  });

  const tr = input.transmission;
  items.push({
    step: 5,
    title: '事件→黄金传导',
    value: tr
      ? (tr.actionable ? tr.headline : `${tr.headline} → 热点可忽略`)
      : '未生成传导卡',
    skippable: !tr?.actionable,
  });

  return {
    headline: gateBlocked
      ? '今日先看门禁：数据不可用，其余当背景'
      : '今日必看（按序 1→5；可跳过项已标）',
    items,
    footer: '有用信息 = 能改仓位或阅读重心的信息；改不了的不看。',
  };
}

export function formatReadingChecklistConsole(c: ReadingChecklist, indent = '  '): string {
  const lines = [`${indent}📖 ${c.headline}`];
  for (const it of c.items) {
    const skip = it.skippable ? '（可跳过）' : '';
    lines.push(`${indent}  ${it.step}. ${it.title}${skip}：${it.value}`);
  }
  lines.push(`${indent}  ${c.footer}`);
  return lines.join('\n');
}

export function formatReadingChecklistMarkdown(c: ReadingChecklist): string {
  const lines = [
    '## 📖 今日必看',
    '',
    `> **${c.headline}**`,
    '',
  ];
  for (const it of c.items) {
    const skip = it.skippable ? ' `可跳过`' : '';
    lines.push(`${it.step}. **${it.title}**${skip}：${it.value}`);
  }
  lines.push('');
  lines.push(`_${c.footer}_`);
  lines.push('');
  return lines.join('\n');
}
