// 终端输出格式化

import chalk from 'chalk';
import Table from 'cli-table3';

/** 分隔线 */
export function separator(char: string = '═', width: number = 55): string {
  return char.repeat(width);
}

/** 标题块 */
export function header(title: string, subtitle?: string, width: number = 55): string {
  const lines: string[] = [];
  lines.push(separator('═', width));
  lines.push(`  ${title}`);
  if (subtitle) {
    lines.push(`  ${chalk.gray(subtitle)}`);
  }
  lines.push(separator('═', width));
  return lines.join('\n');
}

/** 来源可信度标记 */
export function gradeMark(grade: 'A' | 'B' | 'C'): string {
  switch (grade) {
    case 'A': return chalk.green('✅ A级');
    case 'B': return chalk.yellow('⚠️ B级');
    case 'C': return chalk.red('❌ C级');
  }
}

/** 涨跌幅颜色 */
export function changeColor(value: number): string {
  if (value > 0) return chalk.red(`+${value.toFixed(2)}%`);
  if (value < 0) return chalk.green(`${value.toFixed(2)}%`);
  return chalk.gray('0.00%');
}

/** 方向标记 */
export function directionMark(direction: string): string {
  switch (direction) {
    case 'bullish': return chalk.red('📈 偏多');
    case 'bearish': return chalk.green('📉 偏空');
    case 'neutral': return chalk.gray('➡️ 中性');
    default: return direction;
  }
}

/** 评分条 */
export function scoreBar(score: number, width: number = 20): string {
  const filled = Math.round(score / 100 * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `${bar} ${score}/100`;
}

/** 创建价格表格 */
export function priceTable(data: Array<{ label: string; value: string; change?: string; grade?: string }>): string {
  const table = new Table({
    head: ['品种', '价格', '涨跌幅', '可信度'],
    colWidths: [20, 16, 12, 10],
    style: { head: ['cyan'] },
  });

  for (const row of data) {
    table.push([row.label, row.value, row.change ?? '', row.grade ?? '']);
  }

  return table.toString();
}

/** 格式化金额 */
export function formatPrice(value: number, currency: 'USD' | 'CNY' = 'USD'): string {
  if (currency === 'USD') {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 风险等级标记 */
export function riskLevel(level: 'high' | 'medium' | 'low'): string {
  switch (level) {
    case 'high': return chalk.red('🔴 高');
    case 'medium': return chalk.yellow('🟡 中');
    case 'low': return chalk.green('🟢 低');
  }
}

/** 估值水位标记 */
export function valuationMark(level: 'low' | 'fair' | 'high'): string {
  switch (level) {
    case 'low': return chalk.green('偏低（适合加码定投）');
    case 'fair': return chalk.yellow('合理（维持定投）');
    case 'high': return chalk.red('偏高（考虑减仓）');
  }
}

/** 交易时段标记 */
export function sessionMark(session: string): string {
  switch (session) {
    case 'day': return chalk.green('● 日盘');
    case 'night': return chalk.blue('● 夜盘');
    case 'pre_market': return chalk.gray('○ 盘前');
    case 'after_hours': return chalk.gray('○ 盘后');
    case 'closed': return chalk.red('✕ 休市');
    default: return session;
  }
}
