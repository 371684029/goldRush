import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, resetConfigCache } from '../src/utils/config';

describe('loadConfig — 深合并与 llm.models 别名', () => {
  let tmpDir: string;

  afterEach(() => {
    resetConfigCache();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('识别 goldrush.config.json 中的 llm.models 嵌套写法', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldrush-cfg-'));
    const cfgPath = path.join(tmpDir, 'goldrush.config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({
      llm: {
        models: {
          rebuttal: { providerID: 'opencode-go', modelID: 'custom-model-x' },
        },
      },
    }));

    const cfg = loadConfig(cfgPath);
    expect(cfg.models.rebuttal.modelID).toBe('custom-model-x');
    expect(cfg.models.technical.modelID).toBe('glm-5.1');
  });

  it('database.path 可被用户配置覆盖', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldrush-cfg-'));
    const cfgPath = path.join(tmpDir, 'goldrush.config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({
      database: { path: './custom/db.sqlite' },
    }));

    const cfg = loadConfig(cfgPath);
    expect(cfg.database.path).toBe('./custom/db.sqlite');
  });
});
