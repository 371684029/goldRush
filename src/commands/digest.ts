// goldrush digest — 周期摘要（周报）

import fs from 'node:fs';
import { getDb } from '../db/index.js';
import { ReportsRepo } from '../db/reports.js';
import {
  buildWeeklyDigest,
  enrichDigestWithDiff,
  formatDigestConsole,
  formatDigestMarkdown,
} from '../utils/weekly-digest.js';
import type { GoldAnalysisReport } from '../types/analysis.js';

function parseReport(json: string): GoldAnalysisReport | null {
  try {
    return JSON.parse(json) as GoldAnalysisReport;
  } catch {
    return null;
  }
}

export function digestCommand(days: number, md: boolean, json: boolean): void {
  const db = getDb();
  const reports = new ReportsRepo(db).getRecent(days);

  let digest = buildWeeklyDigest(reports, days);

  if (reports.length >= 2) {
    const sorted = [...reports].sort((a, b) => a.date.localeCompare(b.date));
    const first = parseReport(sorted[0].reportJson);
    const last = parseReport(sorted[sorted.length - 1].reportJson);
    digest = enrichDigestWithDiff(digest, first, last);
  }

  if (json) {
    console.log(JSON.stringify(digest, null, 2));
    return;
  }

  console.log(formatDigestConsole(digest));

  if (md) {
    const docsDir = 'docs';
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${docsDir}/goldrush-digest-${date}.md`;
    const latest = `${docsDir}/goldrush-digest-latest.md`;
    const content = formatDigestMarkdown(digest);
    fs.writeFileSync(filename, content, 'utf-8');
    fs.writeFileSync(latest, content, 'utf-8');
    console.log(`  📝 摘要已写入 ${filename}`);
    console.log(`  📝 最新链结 ${latest}`);
  }
}
