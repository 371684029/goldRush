// 东方财富搜索 API（JSONP）— 现网可达，用于 GLD 持仓 / PBOC 储备新闻抽取

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const USER_AGENT = 'Mozilla/5.0 (compatible; GoldRush/0.1)';

export interface EastmoneyArticle {
  title: string;
  content: string;
  date: string;
  url?: string;
  mediaName?: string;
}

async function curlText(url: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('curl', [
      '-sS', '-L',
      '-H', `User-Agent: ${USER_AGENT}`,
      '-H', 'Accept: application/json,*/*',
      '--max-time', '18',
      url,
    ], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 22_000,
    });
    return stdout || null;
  } catch {
    return null;
  }
}

/** 搜索资讯文章 */
export async function searchEastmoneyArticles(
  keyword: string,
  pageSize = 8,
): Promise<EastmoneyArticle[]> {
  const param = encodeURIComponent(
    JSON.stringify({
      uid: '',
      keyword,
      type: ['cmsArticleWebOld'],
      client: 'web',
      clientType: 'web',
      clientVersion: 'curr',
      param: {
        cmsArticleWebOld: {
          searchScope: 'default',
          sort: 'default',
          pageIndex: 1,
          pageSize,
        },
      },
    }),
  );
  const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=jQuery&param=${param}`;
  const text = await curlText(url);
  if (!text) return [];

  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) return [];

  try {
    const data = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    const rows = data?.result?.cmsArticleWebOld ?? [];
    return rows.map((r: any) => ({
      title: String(r.title ?? '').replace(/<[^>]+>/g, ''),
      content: String(r.content ?? '').replace(/<[^>]+>/g, ''),
      date: String(r.date ?? '').slice(0, 10),
      url: r.url,
      mediaName: r.mediaName,
    }));
  } catch {
    return [];
  }
}
