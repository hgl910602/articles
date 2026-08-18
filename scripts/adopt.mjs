#!/usr/bin/env node
/**
 * 一键把一篇自包含 HTML 文章（内联 style/script、Prism 走 cdnjs）适配成站点文章。
 *
 * 用法：node scripts/adopt.mjs <源文件.html> <slug>
 * 产出：articles/<slug>/index.html，做四件事：
 *   1. cdnjs 的 Prism 引用替换为本地 /assets/vendor/prism/（缺的组件自动下载）
 *   2. 删除内联 <style> 块，改为引用全站公共 theme.css / article.css
 *   3. 删除内联 <script>（目录高亮等由公共 /assets/js/article.js 提供）
 *   4. 侧边栏顶部插入「← 返回首页」链接
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [input, slug] = process.argv.slice(2);
if (!input || !slug) {
  console.error('用法：node scripts/adopt.mjs <源文件.html> <slug>');
  console.error('示例：node scripts/adopt.mjs ~/Downloads/新文章.html my-new-article');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let html = readFileSync(input, 'utf8');

// 1) cdnjs Prism 引用 → 本地 vendor；本地没有的组件自动下载
const vendorDir = join(root, 'assets', 'vendor', 'prism');
const cdnUrls = [...html.matchAll(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/prism\/[^"'\s)]+/g)]
  .map((m) => m[0]);
for (const url of new Set(cdnUrls)) {
  const name = basename(url.split('?')[0]);
  const local = join(vendorDir, name);
  if (!existsSync(local)) {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[警告] 下载失败，保留原引用：${url}`);
      continue;
    }
    writeFileSync(local, Buffer.from(await res.arrayBuffer()));
    console.log(`已下载 Prism 组件：assets/vendor/prism/${name}`);
  }
  html = html.replaceAll(url, `/assets/vendor/prism/${name}`);
}

// 2) 删除内联 <style> 块（样式由公共 article.css 提供）
html = html.replace(/[ \t]*<style>[\s\S]*?<\/style>\n?/g, '');

// 3) 删除无 src 的内联 <script>（行为由公共 article.js 提供）
html = html.replace(/[ \t]*<script>[\s\S]*?<\/script>\n?/g, '');

// 4) head 中插入公共样式（保持 theme → prism → article 的加载顺序）
const prismCssLink = /<link href="\/assets\/vendor\/prism\/[^"]*" rel="stylesheet" \/>/;
if (!html.includes('/assets/css/article.css')) {
  if (prismCssLink.test(html)) {
    html = html.replace(prismCssLink, (m) =>
      `<link href="/assets/css/theme.css" rel="stylesheet" />\n${m}\n<link href="/assets/css/article.css" rel="stylesheet" />`);
  } else {
    html = html.replace('</head>',
      '<link href="/assets/css/theme.css" rel="stylesheet" />\n<link href="/assets/css/article.css" rel="stylesheet" />\n</head>');
  }
}

// 5) 底部加载公共文章脚本
if (!html.includes('/assets/js/article.js')) {
  html = html.replace('</body>', '<script src="/assets/js/article.js"></script>\n\n</body>');
}

// 6) 侧边栏插入返回首页链接
if (html.includes('<div id="sidebar">')) {
  if (!html.includes('back-home')) {
    html = html.replace('<div id="sidebar">',
      '<div id="sidebar">\n  <a class="back-home" href="/">← 返回首页</a>');
  }
} else {
  console.warn('[警告] 未找到 <div id="sidebar">，页面结构可能不同，请手动检查（返回首页链接未插入）。');
}

// 7) 提示仍然外链的资源（src= 引用的资源建议本地化）
const externals = [...html.matchAll(/ src="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
if (externals.length) {
  console.warn('[提示] 仍引用外部资源，建议下载后放到文章目录：');
  for (const u of new Set(externals)) console.warn(`  ${u}`);
}

const outDir = join(root, 'articles', slug);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), html);
console.log(`\n已生成 articles/${slug}/index.html`);
console.log('接下来：');
console.log('  1. 在 articles.json 中新增该文章的元数据（slug/title/description/date/tags）');
console.log('  2. node scripts/build-index.mjs 重新生成首页');
console.log('  3. 本地预览确认后 git add . && git commit && git push');
