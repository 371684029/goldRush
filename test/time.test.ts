import { describe, it, expect } from 'vitest';
import { todayDate, getTradingTime } from '../src/utils/time';

describe('todayDate — 按 Asia/Shanghai 日历日', () => {
  it('UTC 临近午夜的时刻应返回上海当日（次日）', () => {
    // 2026-06-23T17:30:00Z = 上海 2026-06-24 01:30
    expect(todayDate(new Date('2026-06-23T17:30:00Z'))).toBe('2026-06-24');
  });

  it('UTC 上午时刻应返回上海当日', () => {
    // 2026-06-23T10:00:00Z = 上海 2026-06-23 18:00
    expect(todayDate(new Date('2026-06-23T10:00:00Z'))).toBe('2026-06-23');
  });
});

describe('getTradingTime — 夜盘边界 02:00~02:30', () => {
  it('上海 02:15（工作日）应判定为夜盘', () => {
    // 2026-06-22T18:15:00Z = 上海周二 02:15
    expect(getTradingTime('CST', new Date('2026-06-22T18:15:00Z')).session).toBe('night');
  });

  it('上海 02:45（夜盘 02:30 收盘后）应判定为盘前', () => {
    expect(getTradingTime('CST', new Date('2026-06-22T18:45:00Z')).session).toBe('pre_market');
  });

  it('上海 10:00（工作日）应判定为日盘', () => {
    // 2026-06-23T02:00:00Z = 上海周二 10:00
    expect(getTradingTime('CST', new Date('2026-06-23T02:00:00Z')).session).toBe('day');
  });

  it('周末应判定为休市', () => {
    // 2026-06-20T04:00:00Z = 上海周六 12:00
    const info = getTradingTime('CST', new Date('2026-06-20T04:00:00Z'));
    expect(info.session).toBe('closed');
    expect(info.isTradingDay).toBe(false);
  });
});
