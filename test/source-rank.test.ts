import { describe, it, expect } from 'vitest';
import { checkFreshness, gradeSource } from '../src/utils/source-rank';

describe('checkFreshness — 非法时间戳防御', () => {
  it('非法时间戳应判定为不新鲜并给出警告', () => {
    const r = checkFreshness('not-a-date');
    expect(r.fresh).toBe(false);
    expect(r.warning).toBeTruthy();
  });

  it('空字符串同样判定为不新鲜', () => {
    expect(checkFreshness('').fresh).toBe(false);
  });

  it('刚刚的时间应判定为新鲜', () => {
    expect(checkFreshness(new Date().toISOString()).fresh).toBe(true);
  });

  it('超过阈值的旧时间应判定为不新鲜', () => {
    const old = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    expect(checkFreshness(old, 4).fresh).toBe(false);
  });
});

describe('gradeSource', () => {
  it('权威来源识别为 A 级', () => {
    expect(gradeSource('上海黄金交易所')).toBe('A');
  });

  it('未知来源默认 B 级', () => {
    expect(gradeSource('某不知名网站')).toBe('B');
  });
});
