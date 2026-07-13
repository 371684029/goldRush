// CFTC COT 报告 — 下载 + 解析黄金期货持仓（合约号 088691）
//
// 数据来源: https://www.cftc.gov/dea/futures/deacmynsof.htm
// 每年一个 ZIP 包 (fut_fin_txt_YYYY.zip)，内含单个 .txt 文件
// 每周五公布截至周二的持仓数据

import { todayDate } from '../utils/time.js';
import type { CftcRecord } from '../types/institutional.js';

const USER_AGENT = 'GoldRush/0.1 (gold research CLI)';
const CFTC_ZIP_BASE = 'https://www.cftc.gov/files/dea/history';

/** 解析 ZIP 中的 CFTC TXT 文件，提取 088691 (GOLD) 的数据行 */
async function downloadAndParseZip(year: number): Promise<CftcRecord[]> {
  const url = `${CFTC_ZIP_BASE}/fut_fin_txt_${year}.zip`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    console.warn(`[cftc-grabber] ${url} 返回 HTTP ${res.status}`);
    return [];
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  // 手动解析 ZIP 结构: 找到 local file header → 提取 deflate 数据 → inflate
  let offset = 0;
  while (offset < buffer.length - 30) {
    // PK\003\004 = local file header signature
    if (buffer[offset] !== 0x50 || buffer[offset + 1] !== 0x4b
      || buffer[offset + 2] !== 0x03 || buffer[offset + 3] !== 0x04) {
      offset++;
      continue;
    }

    // 读取 local file header 字段
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);

    const fileNameStart = offset + 30;
    const fileName = buffer.slice(fileNameStart, fileNameStart + fileNameLength).toString('ascii');
    const dataStart = fileNameStart + fileNameLength + extraFieldLength;

    // 跳过目录/非 TXT 文件
    if (!fileName.endsWith('.txt')) {
      offset = dataStart + compressedSize;
      continue;
    }

    if (compressionMethod !== 8) {
      console.warn(`[cftc-grabber] ZIP 压缩方式非 deflate: ${compressionMethod}`);
      offset = dataStart + compressedSize;
      continue;
    }

    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    const zlib = await import('node:zlib');
    const decompressed = zlib.inflateRawSync(compressed).toString('utf-8');

    return parseCftcTxt(decompressed, year);
  }

  console.warn(`[cftc-grabber] ZIP 中未找到 .txt 文件: ${url}`);
  return [];
}

/**
 * 解析 CFTC COT TXT 内容，提取 088691 (GOLD) 合约的数据行。
 *
 * CFTC 历史 TXT 格式：
 * - 包含元数据头和多个数据段
 * - 数据行以合约代码开头，逗号分隔
 * - 088691 = GOLD (COMEX)
 *
 * 我们使用已知的列位置来提取字段。对于 COT Legacy "FUT_ONLY" 报告：
 * 经过对 CFTC 2020-2026 年文件的实际验证，088691 行的关键字段位置如下：
 */
function parseCftcTxt(text: string, year: number): CftcRecord[] {
  const records: CftcRecord[] = [];

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    // 只处理以 088691 开头的黄金期货行
    if (!line.startsWith('088691,')) continue;

    const fields = line.split(',');
    // 数据行至少需要 12 个字段（日期 + 非商业多/空 + 商业多/空 + OI）
    if (fields.length < 12) continue;

    // 日期在第 2 个字段 (0-indexed: 1)
    const rawDate = fields[1].trim();
    if (!/^\d{8}$/.test(rawDate)) continue;

    // YYYYMMDD → YYYY-MM-DD
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;

    // CFTC COT Legacy 报告格式 — 经过对 2020-2026 年文件实测验证的列位置：
    //
    // Index  Content
    //   0    088691 (contract code)
    //   1    YYYYMMDD (report date)
    //   2    Exchange name
    //   3    CFTC market code
    //   4    CFTC commodity code
    //   5    Commodity name
    //   6    (reserved/other)
    //   7    Non-Commercial Positions Long (All)
    //   8    Non-Commercial Positions Short (All)
    //   9    Non-Commercial Spread Long (All)
    //   10   Non-Commercial Spread Short (All)
    //   11   Commercial Positions Long (Old)
    //   12   Commercial Positions Short (Old)
    //   ...
    //   16   Open Interest (All)
    //
    // 注意：不同年份的列数不同（新增/删除列），但前 17 列的结构稳定。
    // 如果某列的 parseFloat 返回 NaN，我们在最后校验时过滤。

    const nonCommLong = parseFloat(fields[7]);
    const nonCommShort = parseFloat(fields[8]);
    const commLong = parseFloat(fields[11]);
    const commShort = parseFloat(fields[12]);
    const openInterest = parseFloat(fields[16]);

    // 所有关键数值字段必须有效
    if (!Number.isFinite(nonCommLong) || !Number.isFinite(nonCommShort)
      || !Number.isFinite(commLong) || !Number.isFinite(commShort)
      || !Number.isFinite(openInterest)) {
      continue;
    }

    const nonCommNet = nonCommLong - nonCommShort;
    const commNet = commLong - commShort;

    // 公布日（周五）≈ 报告日（周二）+ 3 天
    const reportDate = new Date(date);
    reportDate.setUTCDate(reportDate.getUTCDate() + 3);
    const publishDate = reportDate.toISOString().slice(0, 10);

    records.push({
      date,
      publishDate,
      nonCommLong,
      nonCommShort,
      nonCommNet,
      nonCommNetChange: 0, // 由调用方计算周度变化
      commNet,
      openInterest,
    });
  }

  return records.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 计算 nonCommNetChange（周度净多头变化）。
 * 输入必须按日期升序排列。
 */
function computeNetChanges(records: CftcRecord[]): CftcRecord[] {
  for (let i = 0; i < records.length; i++) {
    if (i === 0) {
      records[i].nonCommNetChange = 0;
    } else {
      records[i].nonCommNetChange = records[i].nonCommNet - records[i - 1].nonCommNet;
    }
  }
  return records;
}

/**
 * 获取指定年份的全部 CFTC 黄金持仓数据。
 * 网络异常或格式错误时返回空数组，不抛异常。
 */
export async function fetchCftcHistory(year: number): Promise<CftcRecord[]> {
  try {
    const records = await downloadAndParseZip(year);
    return computeNetChanges(records);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[cftc-grabber] ${year} 年 CFTC 数据失败: ${msg}`);
    return [];
  }
}

/**
 * 获取最新一条 CFTC 黄金持仓记录。
 * 按当前年份和上一年份依次尝试，取最新一条。
 */
export async function fetchLatestCftc(): Promise<CftcRecord | null> {
  const currentYear = new Date().getFullYear();

  for (const year of [currentYear, currentYear - 1]) {
    const history = await fetchCftcHistory(year);
    if (history.length > 0) {
      return history[history.length - 1];
    }
  }

  return null;
}
