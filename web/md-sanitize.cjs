// Markdown HTML 净化 — 防 XSS（报告来自本地生成，仍做兜底）

const createDOMPurify = require('isomorphic-dompurify');

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'strong', 'em', 'b', 'i', 'u', 's', 'del', 'a', 'span', 'div',
  'details', 'summary',
  'svg', 'path', 'g', 'line', 'polyline', 'circle', 'rect', 'text', 'title',
];

const ALLOWED_ATTR = [
  'href', 'title', 'target', 'rel', 'class', 'id', 'open',
  'colspan', 'rowspan',
  'data-sec-id', 'data-sec-kind',
  'viewBox', 'xmlns', 'width', 'height', 'fill', 'stroke', 'stroke-width',
  'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'points',
  'text-anchor', 'font-size', 'font-family', 'opacity', 'transform',
];

/**
 * @param {string} dirtyHtml
 * @returns {string}
 */
function sanitizeMarkdownHtml(dirtyHtml) {
  return createDOMPurify.sanitize(dirtyHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: true,
  });
}

module.exports = { sanitizeMarkdownHtml };
