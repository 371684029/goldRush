// 信息验证 Agent — 多源交叉验证 + 来源分级

import { BaseAgent } from './base.js';
import { getConfig } from '../utils/config.js';
import { gradeSource, crossValidate, checkFreshness } from '../utils/source-rank.js';
import type { MarketData, ValidationResult } from '../types/market.js';

const VALIDATION_PROMPT = `你是黄金市场数据验证专家。你的任务是验证采集到的市场数据的准确性和时效性。

## 验证规则

1. **3源验证**：同一数据点至少3个独立来源交叉验证
   - 3源一致 → ✅ 采信
   - 2源一致，1源偏差<0.5% → ⚠️ 取均值
   - 3源差异>1% → ❌ 标注可疑

2. **来源分级**：
   - A级（权威）：交易所、央行 → 直接采信
   - B级（可信）：财经媒体 → 采信但需验证
   - C级（参考）：自媒体 → 仅参考

3. **时效性**：
   - 价格数据 > 4小时 → 标注⚠️
   - 利率/CPI > 1天 → 正常
   - 新闻 > 3天 → 标注日期

4. **反向核查**：重大新闻/观点必须搜反对观点

## 输出格式

{
  "validations": [
    {
      "field": "london.price",
      "sources": [
        { "value": 数字, "source": "来源名", "grade": "A/B/C", "timestamp": "时间" }
      ],
      "consensus": "verified/minor_deviation/major_conflict",
      "finalValue": 数字,
      "confidence": 0-100
    }
  ],
  "overallConfidence": 0-100,
  "warnings": ["警告1", "警告2"]
}`;

export class ValidatorAgent extends BaseAgent {
  constructor() {
    const config = getConfig();
    super({
      name: 'validator',
      model: config.models.validator,
      systemPrompt: VALIDATION_PROMPT,
    });
  }

  /** 验证市场数据 */
  async validate(data: MarketData): Promise<{
    validations: ValidationResult[];
    overallConfidence: number;
    warnings: string[];
  }> {
    // 本地交叉验证（基于已有来源标注）
    const validations: ValidationResult[] = [];

    // 验证伦敦金价格
    if (data.london?.price?.value != null) {
      validations.push(crossValidate('london.price', [{
        value: data.london.price.value,
        source: data.london.price.source ?? 'unknown',
        grade: data.london.price.sourceGrade ?? 'C',
        timestamp: data.london.price.verifiedAt ?? '',
      }]));
    }

    // 验证上海金
    if (data.shanghai?.price?.value != null) {
      validations.push(crossValidate('shanghai.price', [{
        value: data.shanghai.price.value,
        source: data.shanghai.price.source ?? 'unknown',
        grade: data.shanghai.price.sourceGrade ?? 'C',
        timestamp: data.shanghai.price.verifiedAt ?? '',
      }]));
    }

    // 验证ETF净值
    if (data.etf?.nav?.value != null) {
      validations.push(crossValidate('etf.nav', [{
        value: data.etf.nav.value,
        source: data.etf.nav.source ?? 'unknown',
        grade: data.etf.nav.sourceGrade ?? 'C',
        timestamp: data.etf.nav.verifiedAt ?? '',
      }]));
    }

    // 验证美元指数
    if (data.dollarIndex?.value?.value != null) {
      validations.push(crossValidate('dollarIndex.value', [{
        value: data.dollarIndex.value.value,
        source: data.dollarIndex.value.source ?? 'unknown',
        grade: data.dollarIndex.value.sourceGrade ?? 'C',
        timestamp: data.dollarIndex.value.verifiedAt ?? '',
      }]));
    }

    // 检查时效性
    const warnings: string[] = [];

    const freshness = checkFreshness(data.timestamp);
    if (!freshness.fresh && freshness.warning) {
      warnings.push(freshness.warning);
    }

    // 计算整体置信度
    const overallConfidence = validations.length > 0
      ? Math.round(validations.reduce((sum, v) => sum + v.confidence, 0) / validations.length)
      : 50;

    return { validations, overallConfidence, warnings };
  }
}
