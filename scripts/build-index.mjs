#!/usr/bin/env node
/**
 * 生成站点首页 index.html
 *
 * 数据源：articles.json（站点配置 + 文章清单）
 * 用法：node scripts/build-index.mjs
 *
 * 新增/修改文章后本地跑一次，把重新生成的 index.html 一起提交；
 * 部署侧（Cloudflare Pages）不需要任何构建命令。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'articles.json'), 'utf8'));
const { site, articles } = data;

const esc = (s) => String(s)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

// 基本校验：slug 唯一、必填字段、文章文件存在
const seen = new Set();
for (const a of articles) {
  if (!a.slug || !a.title || !a.date) {
    console.warn(`[警告] 文章缺少 slug/title/date 必填字段（标题：${a.title ?? '?'}）`);
  }
  if (seen.has(a.slug)) console.warn(`[警告] slug 重复：${a.slug}`);
  seen.add(a.slug);
  if (!existsSync(join(root, 'articles', a.slug, 'index.html'))) {
    console.warn(`[警告] 文章文件不存在：articles/${a.slug}/index.html`);
  }
}

// 按日期倒序
const sorted = [...articles].sort((a, b) => String(b.date).localeCompare(String(a.date)));

// 阅读时长估算：读文章 HTML，数中文字符 + 英文单词（约 450 字/分钟）
const readingMinutes = (slug) => {
  try {
    const raw = readFileSync(join(root, 'articles', slug, 'index.html'), 'utf8');
    const text = raw
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ');
    const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const words = (text.match(/[A-Za-z0-9]+/g) ?? []).length;
    return Math.max(1, Math.round((cjk + words * 1.5) / 450));
  } catch {
    return null;
  }
};

// 标签汇总（按出现次数排序）；chips 只展示 ≥2 篇的热门标签，长尾标签仍可搜索、仍在卡片上
const tagCounts = new Map();
for (const a of articles) {
  for (const t of a.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
}
const tags = [...tagCounts.entries()]
  .filter(([, n]) => n >= 2)
  .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'zh-Hans-CN'));

const chips = [
  '<button class="chip active" data-tag="">全部</button>',
  ...tags.map(([t, n]) => `<button class="chip" data-tag="${esc(t)}">${esc(t)}<small>${n}</small></button>`),
].join('\n      ');

const cards = sorted.map((a) => {
  const cardTags = (a.tags ?? []).map((t) => `<span class="tag" data-tag="${esc(t)}">${esc(t)}</span>`).join('');
  const mins = readingMinutes(a.slug);
  const readTime = mins ? `<span class="card-read">约 ${mins} 分钟</span>` : '';
  return `    <a class="card" href="/articles/${encodeURIComponent(a.slug)}/" data-tags="${esc((a.tags ?? []).join(','))}" data-title="${esc(a.title)}" data-desc="${esc(a.description ?? '')}">
      <div class="card-head">
        <h2>${esc(a.title)}</h2>
        <time>${esc(a.date)}</time>${readTime}
      </div>
      <p class="card-desc">${esc(a.description ?? '')}</p>
      <div class="card-tags">${cardTags}</div>
    </a>`;
}).join('\n');

// favicon + Open Graph（site.url 配置后 OG 图卡才有绝对地址）
const faviconLinks = `\
<link rel="icon" href="/assets/img/favicon.ico" sizes="32x32">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">`;
const siteUrl = (site.url ?? '').replace(/\/$/, '');
const og = [`\
<meta property="og:title" content="${esc(site.name)}">
<meta property="og:description" content="${esc(site.description ?? '')}">
<meta property="og:type" content="website">`];
if (siteUrl) {
  og.push(`\
<meta property="og:url" content="${esc(siteUrl)}/">
<meta property="og:image" content="${esc(siteUrl)}/assets/img/og-image.png">
<meta name="twitter:card" content="summary_large_image">`);
}

const html = `<!DOCTYPE html>
<!-- 本文件由 scripts/build-index.mjs 生成，请勿手改；修改 articles.json 后重新运行脚本。 -->
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(site.name)}</title>
<meta name="description" content="${esc(site.description ?? '')}">
${faviconLinks}
${og.join('\n')}
<link href="/assets/css/theme.css" rel="stylesheet" />
<link href="/assets/css/site.css?v=2" rel="stylesheet" />
</head>
<body>

<header class="site-header">
  <h1>${esc(site.headline ?? site.name)}</h1>
  <p class="site-desc">${esc(site.description ?? '')}</p>
</header>

<main class="article-list">
  <div class="search-box">
    <input id="search" type="search" placeholder="搜索文章标题、描述或标签…" autocomplete="off" />
  </div>
  <div class="chips">
      ${chips}
  </div>
  <p class="empty" id="empty" hidden>没有匹配的文章，换个关键词或标签试试</p>
${cards}
</main>

<footer class="site-footer">${esc(site.footer ?? '')}</footer>

<script src="/assets/js/home.js?v=1"></script>

</body>
</html>
`;

writeFileSync(join(root, 'index.html'), html);
console.log(`首页已生成：${articles.length} 篇文章，${tags.length} 个标签 → index.html`);
