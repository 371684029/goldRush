// goldrush reflect — 周末预测错因反思

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { buildPredictionTrackStats, savePredictionTrackJson } from '../utils/prediction-track.js';
import {
  buildWeeklyReflectFromStats,
  formatWeeklyReflectConsole,
  formatWeeklyReflectMarkdown,
  type WeeklyReflect,
} from '../utils/weekly-reflect.js';

const LATEST_MD = 'docs/goldrush-reflect-latest.md';
const LATEST_JSON = 'docs/goldrush-reflect-latest.json';

export function loadPreviousReflect(projectRoot = process.cwd()): WeeklyReflect | null {
  try {
    const fp = path.join(projectRoot, LATEST_JSON);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as WeeklyReflect;
  } catch {
    return null;
  }
}

export function saveWeeklyReflect(
  reflect: WeeklyReflect,
  projectRoot = process.cwd(),
): { md: string; json: string; dated: string } {
  const docsDir = path.join(projectRoot, 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  const day = reflect.generatedAt.slice(0, 10);
  const dated = path.join(docsDir, `goldrush-reflect-${day}.md`);
  const mdPath = path.join(projectRoot, LATEST_MD);
  const jsonPath = path.join(projectRoot, LATEST_JSON);
  const md = formatWeeklyReflectMarkdown(reflect);
  fs.writeFileSync(dated, md, 'utf-8');
  fs.writeFileSync(mdPath, md, 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(reflect, null, 2), 'utf-8');
  return { md: mdPath, json: jsonPath, dated };
}

export function reflectCommand(options: {
  days: number;
  md: boolean;
  json: boolean;
  refreshStats: boolean;
}): number {
  const db = getDb();
  const days = Math.max(7, options.days || 14);

  // 刷新对错统计，保证整窗明细可用于错因分桶
  let stats = buildPredictionTrackStats(db, Math.max(days, 90), 5);
  if (options.refreshStats || options.md) {
    const p = savePredictionTrackJson(stats);
    console.log(`  💾 已刷新预测对错统计: ${p}`);
  }

  const previous = loadPreviousReflect();
  const reflect = buildWeeklyReflectFromStats(stats, {
    days,
    previous,
  });

  if (options.json) {
    console.log(JSON.stringify(reflect, null, 2));
    return 0;
  }

  console.log('\n' + formatWeeklyReflectConsole(reflect));

  if (options.md) {
    const paths = saveWeeklyReflect(reflect);
    console.log(`\n  📝 反思已写入 ${paths.dated}`);
    console.log(`  📝 最新 ${paths.md}`);
    console.log(`  📦 JSON ${paths.json}（供下次 analysis 注入）`);
  } else {
    console.log('\n  💡 加 --md 写入 docs/goldrush-reflect-latest.md');
  }

  return 0;
}
