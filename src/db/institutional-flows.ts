// 主力动向数据 CRUD
import Database from 'better-sqlite3';
import type { InstitutionalFlowRecord } from '../types/institutional.js';
import { addCalendarDays, todayDate } from '../utils/time.js';

export class InstitutionalFlowsRepo {
  constructor(private db: Database.Database) {}

  /** 插入或更新当日主力动向数据 */
  upsert(record: Omit<InstitutionalFlowRecord, 'createdAt'>): void {
    this.db.prepare(`
      INSERT INTO institutional_flows (date,
        cftc_nc_long, cftc_nc_short, cftc_nc_net, cftc_nc_change,
        cftc_comm_net, cftc_open_interest, cftc_report_date,
        gld_holdings_tons, gld_holdings_change, gld_aum_million,
        iau_holdings_tons,
        cn_etf_518880_shares, cn_etf_518880_flow,
        cn_etf_159934_shares, cn_etf_159934_flow,
        cb_pboc_reserves, cb_pboc_change,
        comex_volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        cftc_nc_long = excluded.cftc_nc_long,
        cftc_nc_short = excluded.cftc_nc_short,
        cftc_nc_net = excluded.cftc_nc_net,
        cftc_nc_change = excluded.cftc_nc_change,
        cftc_comm_net = excluded.cftc_comm_net,
        cftc_open_interest = excluded.cftc_open_interest,
        cftc_report_date = excluded.cftc_report_date,
        gld_holdings_tons = excluded.gld_holdings_tons,
        gld_holdings_change = excluded.gld_holdings_change,
        gld_aum_million = excluded.gld_aum_million,
        iau_holdings_tons = excluded.iau_holdings_tons,
        cn_etf_518880_shares = excluded.cn_etf_518880_shares,
        cn_etf_518880_flow = excluded.cn_etf_518880_flow,
        cn_etf_159934_shares = excluded.cn_etf_159934_shares,
        cn_etf_159934_flow = excluded.cn_etf_159934_flow,
        cb_pboc_reserves = excluded.cb_pboc_reserves,
        cb_pboc_change = excluded.cb_pboc_change,
        comex_volume = excluded.comex_volume
    `).run(
      record.date,
      record.cftcNcLong, record.cftcNcShort, record.cftcNcNet, record.cftcNcChange,
      record.cftcCommNet, record.cftcOpenInterest, record.cftcReportDate,
      record.gldHoldingsTons, record.gldHoldingsChange, record.gldAumMillion,
      record.iauHoldingsTons,
      record.cnEtf518880Shares, record.cnEtf518880Flow,
      record.cnEtf159934Shares, record.cnEtf159934Flow,
      record.cbPbocReserves, record.cbPbocChange,
      record.comexVolume,
    );
  }

  /** 获取指定日期主力动向 */
  getByDate(date: string): InstitutionalFlowRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM institutional_flows WHERE date = ?`).get(date) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : undefined;
  }

  /** 获取最近 N 个日历日窗口内的主力动向 */
  getRecent(days: number, asOf: string = todayDate()): InstitutionalFlowRecord[] {
    const from = addCalendarDays(asOf, -(days - 1));
    return this.getRange(from, asOf);
  }

  /** 获取指定日期区间的主力动向 */
  getRange(from: string, to: string): InstitutionalFlowRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM institutional_flows
      WHERE date >= ? AND date <= ?
      ORDER BY date ASC
    `).all(from, to) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  /** 获取最近一条含 CFTC 净多头数据的记录 */
  getLatestCftc(): InstitutionalFlowRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM institutional_flows
      WHERE cftc_nc_net IS NOT NULL
      ORDER BY date DESC
      LIMIT 1
    `).get() as Record<string, unknown> | undefined;
    return row ? mapRow(row) : undefined;
  }

  /** 获取 CFTC 历史记录（按日期倒序，最多 limit 条） */
  getCftcHistory(limit: number): InstitutionalFlowRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM institutional_flows
      WHERE cftc_nc_net IS NOT NULL
      ORDER BY date DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  /** 获取总记录数 */
  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM institutional_flows`).get() as { cnt: number };
    return row.cnt;
  }
}

function mapRow(row: Record<string, unknown>): InstitutionalFlowRecord {
  return {
    date: row.date as string,
    cftcNcLong: row.cftc_nc_long as number | null,
    cftcNcShort: row.cftc_nc_short as number | null,
    cftcNcNet: row.cftc_nc_net as number | null,
    cftcNcChange: row.cftc_nc_change as number | null,
    cftcCommNet: row.cftc_comm_net as number | null,
    cftcOpenInterest: row.cftc_open_interest as number | null,
    cftcReportDate: row.cftc_report_date as string | null,
    gldHoldingsTons: row.gld_holdings_tons as number | null,
    gldHoldingsChange: row.gld_holdings_change as number | null,
    gldAumMillion: row.gld_aum_million as number | null,
    iauHoldingsTons: row.iau_holdings_tons as number | null,
    cnEtf518880Shares: row.cn_etf_518880_shares as number | null,
    cnEtf518880Flow: row.cn_etf_518880_flow as number | null,
    cnEtf159934Shares: row.cn_etf_159934_shares as number | null,
    cnEtf159934Flow: row.cn_etf_159934_flow as number | null,
    cbPbocReserves: row.cb_pboc_reserves as number | null,
    cbPbocChange: row.cb_pboc_change as number | null,
    comexVolume: row.comex_volume as number | null,
    createdAt: row.created_at as string,
  };
}