// 交易时间判断

import type { TradingTimeInfo, TradingSession } from '../types/market.js';

/**
 * 判断当前是否为交易时间
 * 伦敦金: 24小时交易（周一早7点 ~ 周六凌晨3点 UTC）
 * 上海金: 日盘 9:00-15:30, 夜盘 20:00-02:30 (CST)
 * 黄金ETF: 9:30-11:30, 13:00-15:00 (CST, T+1)
 */
export function getTradingTime(timezone: 'CST' | 'UTC' = 'CST'): TradingTimeInfo {
  const now = new Date();

  // 转为 CST (UTC+8)
  const cstOffset = 8 * 60 * 60 * 1000;
  const cstTime = new Date(now.getTime() + cstOffset + now.getTimezoneOffset() * 60 * 1000);

  const day = cstTime.getDay(); // 0=周日
  const hour = cstTime.getHours();
  const minute = cstTime.getMinutes();

  // 判断是否为交易日（周一~周五）
  const isTradingDay = day >= 1 && day <= 5;

  // 判断交易时段
  let session: TradingSession = 'closed';
  let description = '';

  if (!isTradingDay) {
    session = 'closed';
    description = day === 6 ? '周六休市' : '周日休市';
  } else if (hour >= 20 || hour < 2) {
    // 夜盘（20:00 ~ 次日02:30）
    session = 'night';
    description = '夜盘交易中';
  } else if (hour >= 9 && (hour < 11 || (hour === 11 && minute <= 30))) {
    // 上午盘（9:00 ~ 11:30）
    session = 'day';
    description = '日盘交易中(上午)';
  } else if (hour >= 13 && hour < 15) {
    // 下午盘（13:00 ~ 15:00）
    session = 'day';
    description = '日盘交易中(下午)';
  } else if (hour >= 15 && hour < 20) {
    // 收盘后到夜盘前
    session = 'after_hours';
    description = '盘后休整';
  } else {
    // 其他（凌晨2:30~9:00之间）
    session = 'pre_market';
    description = '盘前';
  }

  return { session, description, isTradingDay };
}

/** 格式化当前时间 */
export function formatNow(): string {
  const now = new Date();
  return now.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(/\//g, '-');
}

/** 获取今日日期 YYYY-MM-DD */
export function todayDate(): string {
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000 + now.getTimezoneOffset() * 60 * 1000);
  return cst.toISOString().slice(0, 10);
}
