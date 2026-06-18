#!/usr/bin/env node
// GoldRush Docs Server — 展示 docs/ 下的分析报告

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 80;
const DOCS_DIR = path.join(__dirname, 'docs');

/** HTML 转义 */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 生成文件列表页 */
function renderIndex(files) {
  const rows = files.map(f => {
    const stats = fs.statSync(path.join(DOCS_DIR, f));
    const dateStr = stats.mtime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const sizeKB = (stats.size / 1024).toFixed(1);
    return `<tr>
      <td><a href="/${f}">${esc(f)}</a></td>
      <td>${sizeKB} KB</td>
      <td>${dateStr}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🥇 GoldRush 分析报告</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
    }
    .container { max-width: 960px; margin: 0 auto; padding: 40px 24px; }
    header {
      text-align: center;
      margin-bottom: 48px;
    }
    header h1 {
      font-size: 2rem;
      background: linear-gradient(135deg, #f59e0b, #d97706);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: 700;
    }
    header p { color: #94a3b8; margin-top: 8px; font-size: 0.95rem; }
    .stats {
      display: flex;
      justify-content: center;
      gap: 32px;
      margin-bottom: 32px;
      flex-wrap: wrap;
    }
    .stat-card {
      background: #1e293b;
      border-radius: 12px;
      padding: 16px 28px;
      text-align: center;
      min-width: 120px;
    }
    .stat-card .num {
      font-size: 1.8rem;
      font-weight: 700;
      color: #f59e0b;
    }
    .stat-card .label {
      font-size: 0.8rem;
      color: #64748b;
      margin-top: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #1e293b;
      border-radius: 12px;
      overflow: hidden;
    }
    th {
      background: #334155;
      text-align: left;
      padding: 12px 16px;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #94a3b8;
    }
    td { padding: 12px 16px; border-top: 1px solid #334155; }
    tr:hover td { background: #1e293b; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    td:nth-child(2), td:nth-child(3) { color: #94a3b8; font-size: 0.85rem; }
    footer {
      text-align: center;
      margin-top: 48px;
      color: #475569;
      font-size: 0.8rem;
    }
    footer a { color: #64748b; }
    @media (max-width: 640px) {
      .container { padding: 24px 16px; }
      header h1 { font-size: 1.5rem; }
      .stats { gap: 16px; }
      th:nth-child(3), td:nth-child(3) { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🥇 GoldRush 分析报告</h1>
      <p>黄金投资研究 — 每日四维度分析 · 强制反驳 · 双轨策略</p>
    </header>

    <div class="stats">
      <div class="stat-card">
        <div class="num">${files.length}</div>
        <div class="label">报告总数</div>
      </div>
      <div class="stat-card">
        <div class="num">${files.length > 0 ? (files.reduce((s, f) => s + fs.statSync(path.join(DOCS_DIR, f)).size, 0) / 1024).toFixed(0) : 0}</div>
        <div class="label">总大小 (KB)</div>
      </div>
      <div class="stat-card">
        <div class="num">${files.length > 0 ? files[files.length - 1].slice(20, 30) : '-'}</div>
        <div class="label">最新报告日期</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>文件名</th>
          <th>大小</th>
          <th>修改时间</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="3" style="text-align:center;color:#64748b;padding:32px;">暂无报告</td></tr>'}
      </tbody>
    </table>

    <footer>
      <p>报告由 <a href="https://github.com/your/repo">GoldRush</a> 自动生成 · 仅供研究参考，不构成投资建议</p>
    </footer>
  </div>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);
  let filePath = path.join(DOCS_DIR, url.pathname === '/' ? '' : url.pathname);

  // 安全校验：确保文件在 DOCS_DIR 内
  if (!filePath.startsWith(DOCS_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  // 目录请求 → 文件列表
  if (url.pathname === '/' || url.pathname === '/index.html') {
    fs.readdir(DOCS_DIR, (err, allFiles) => {
      if (err) {
        res.writeHead(500);
        return res.end('Server error');
      }
      const mdFiles = allFiles.filter(f => f.endsWith('.md')).sort();
      const html = renderIndex(mdFiles);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    return;
  }

  // 文件请求 → 直接 serve
  const ext = path.extname(filePath).toLowerCase();
  const mime = {
    '.md': 'text/markdown; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🥇 GoldRush Docs Server running on http://0.0.0.0:${PORT}`);
});
