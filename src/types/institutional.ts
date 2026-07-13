// 主力动向数据类型定义

/** 分析方向 */
export type Direction = 'bullish' | 'bearish' | 'neutral';

// ===== CFTC COT 数据 =====

/** CFTC COT 报告单条记录 */
export interface CftcRecord {
  date: string;              // 报告截止日（周二）YYYY-MM-DD
  publishDate: string;       // 公布日（周五）YYYY-MM-DD
  nonCommLong: number;       // 非商业多头（管理基金多头）
  nonCommShort: number;      // 非商业空头（管理基金空头）
  nonCommNet: number;        // 非商业净多头 = long - short
  nonCommNetChange: number;  // 净头寸周度变化（需计算上一周差值）
  commNet: number;           // 商业净头寸（套保盘）
  openInterest: number;      // 总持仓量
}

// ===== ETF 持仓数据 =====

/** ETF 持仓单条记录 */
export interface EtfHoldings {
  date: string;              // YYYY-MM-DD
  gldTons: number;           // GLD 持仓（吨）
  gldChange: number;         // GLD 日度持仓变化（吨）
  gldAum: number;            // GLD AUM（百万美元）
  iauTons?: number;          // IAU 持仓（吨）
}

// ===== 央行购金数据 =====

/** 央行黄金储备记录 */
export interface CentralBankRecord {
  date: string;              // YYYY-MM-DD（月初披露日，报告的是上月末数据）
  reportMonth: string;       // 报告月份 YYYY-MM
  pbocReserves: number;      // PBOC 黄金储备（吨）
  pbocChange: number;        // PBOC 月度变化（吨）
  pbocConsecutiveMonths: number; // PBOC 连续增持月数
}

// ===== 国内 ETF 份额 =====

/** 国内 ETF 份额记录 */
export interface CnEtfFlow {
  date: string;              // YYYY-MM-DD
  code: string;              // ETF 代码
  shares: number;            // 份额（亿份）
  flow: number;              // 净流入（亿元）
}

// ===== SQLite 存储记录 =====

/** institutional_flows 表行 */
export interface InstitutionalFlowRecord {
  date: string;
  // CFTC
  cftcNcLong: number | null;
  cftcNcShort: number | null;
  cftcNcNet: number | null;
  cftcNcChange: number | null;
  cftcCommNet: number | null;
  cftcOpenInterest: number | null;
  cftcReportDate: string | null;
  // ETF 持仓
  gldHoldingsTons: number | null;
  gldHoldingsChange: number | null;
  gldAumMillion: number | null;
  iauHoldingsTons: number | null;
  // 国内 ETF
  cnEtf518880Shares: number | null;
  cnEtf518880Flow: number | null;
  cnEtf159934Shares: number | null;
  cnEtf159934Flow: number | null;
  // 央行
  cbPbocReserves: number | null;
  cbPbocChange: number | null;
  // COMEX
  comexVolume: number | null;
  createdAt: string;
}

// ===== 主力信号（本地计算，非 LLM） =====

/** CFTC 信号 */
export interface CftcSignal {
  score: number;             // 0-100
  direction: Direction;
  percentile: number;        // 当前净多头在历史中的百分位
  extreme: boolean;          // 是否处于极端位置（>90 或 <10 百分位）
  extremeLabel: string;      // 极端位置描述
  trend4w: string;           // 近4周趋势描述
  summary: string;           // 一句话总结
}

/** ETF 资金流信号 */
export interface EtfFlowSignal {
  score: number;             // 0-100
  direction: Direction;
  percentile: number;        // GLD 持仓历史百分位
  change5d: number;          // 5日持仓变化（吨）
  change20d: number;         // 20日持仓变化（吨）
  divergence: boolean;       // 是否与金价背离
  divergenceLabel: string;   // 背离描述
  summary: string;
}

/** 央行购金信号 */
export interface CentralBankSignal {
  score: number;
  direction: Direction;
  pbocConsecutiveMonths: number;
  pbocMonthlyChange: number;
  summary: string;
}

/** 主力动向综合指标 */
export interface InstitutionalSignal {
  // 子信号
  cftc: CftcSignal;
  etfFlow: EtfFlowSignal;
  centralBank: CentralBankSignal;
  // 综合
  overallScore: number;        // 0-100
  overallDirection: Direction;
  divergences: DivergenceSignal[];
  summary: string;
}

/** 背离信号 */
export interface DivergenceSignal {
  type: 'price_cftc' | 'price_etf' | 'price_pboc';
  severity: 'none' | 'mild' | 'significant';
  description: string;
}
