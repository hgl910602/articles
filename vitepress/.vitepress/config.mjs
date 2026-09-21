import { defineConfig } from 'vitepress';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// config 在 .vitepress/ 下，Markdown 源文件在上一级（项目根）
const srcDir = join(import.meta.dirname, '..');

// 与 VitePress 内部 headline slug 算法保持一致（未从包入口导出，故内联）
const rControl = /[\u0000-\u001f]/g;
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const rCombining = /[\u0300-\u036F]/g;
const slugify = (str) =>
  str
    .normalize('NFKD')
    .replace(rCombining, '')
    .replace(rControl, '')
    .replace(rSpecial, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();

// 站点对外域名：OG 标签（微信/社交卡片）必须用绝对 URL
const SITE_URL = 'https://www.articleshare.cn';
const OG_DEFAULT_IMAGE = '/images/og-default.png';

// 每页注入 Open Graph 标签：标题/摘要取页面自身，卡图优先用文章 frontmatter 的 cover，否则用站点默认卡图
function transformHead({ pageData, title, description }) {
  const relativePath = pageData.relativePath ?? '';
  const cover = pageData.frontmatter?.cover;
  const pageUrl =
    '/' + relativePath.replace(/\.md$/, '').replace(/(^|\/)index$/, '') || '/';
  return [
    ['meta', { property: 'og:site_name', content: '文章分享集' }],
    ['meta', { property: 'og:type', content: relativePath === 'index.md' ? 'website' : 'article' }],
    ['meta', { property: 'og:url', content: SITE_URL + (pageUrl === '/' ? '/' : pageUrl) }],
    ['meta', { property: 'og:title', content: title }],
    ['meta', { property: 'og:description', content: description }],
    ['meta', { property: 'og:image', content: SITE_URL + (cover || OG_DEFAULT_IMAGE) }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ];
}

// 扫描每篇 md 的 ##/###/#### 标题，生成"当前文章目录"式侧边栏：
// 按路径前缀映射，每页只显示该篇文章自己的目录（对齐旧站行为），全部默认展开
function buildSidebar() {
  const map = {};
  for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.md') && f !== 'index.md')) {
    const text = readFileSync(join(srcDir, file), 'utf-8');
    const title =
      text.match(/^# (.+)$/m)?.[1] ?? file.replace('.md', '');
    const items = [];
    const pagePath = '/' + file.replace('.md', '');
    for (const line of text.split('\n')) {
      const m = line.match(/^(#{2,4}) (.+)$/);
      if (!m) continue;
      // 锚点必须带文章路径前缀：纯 #anchor 在别的页面上点击只改本页 hash，不会跳转
      const link = `${pagePath}#${slugify(m[2].trim())}`;
      if (m[1] === '##') {
        items.push({ text: m[2].trim(), link, collapsed: false, items: [] });
      } else if (m[1] === '###' && items.length) {
        const parent = items[items.length - 1];
        parent.items.push({ text: m[2].trim(), link, collapsed: false, items: [] });
      } else if (items.length) {
        // #### 挂到最近的 ###，没有 ### 就挂到 ##
        const chapter = items[items.length - 1];
        const section = chapter.items[chapter.items.length - 1];
        (section?.items ?? chapter.items).push({ text: m[2].trim(), link });
      }
    }
    map[pagePath] = [
      {
        text: title,
        link: pagePath,
        items,
        collapsed: false,
      },
    ];
  }
  return map;
}

// sidebar 是从 Markdown 标题同步生成的，开发时标题变化需要重新加载站点配置。
// 普通 Markdown HMR 只更新正文，保留旧 sidebar 会让链接仍指向改名前的 hash。
function refreshSidebarOnMarkdownChange() {
  return {
    name: 'refresh-sidebar-on-markdown-change',
    async handleHotUpdate({ file, server }) {
      const articleFile = relative(srcDir, file);
      const isTopLevelMarkdown =
        articleFile.endsWith('.md') &&
        !articleFile.includes('/') &&
        !articleFile.includes('\\');

      if (isTopLevelMarkdown) {
        await server.restart();
        return [];
      }
    },
  };
}

// 给所有正文表格统一包一层横向滚动容器 .table-scroll：
// 表格改成 display:table + width:100% 铺满内容区后（见 theme/custom.css），
// display:table 不再支持 overflow 滚动，宽表与窄屏由这层容器兜底滚动。
// 管道表格与正文里原生的 <table> HTML 块都要覆盖：前者走 markdown-it 的
// table_open/table_close 渲染规则；后者是 html_block token，表内无空行时
// 为单个 token，有空行会拆成多个，所以要一路扫到 </table> 再闭合容器。
function wrapTablesInScroll(md) {
  const defaultOpen = md.renderer.rules.table_open;
  const defaultClose = md.renderer.rules.table_close;
  md.renderer.rules.table_open = (...args) =>
    '<div class="table-scroll">' + (defaultOpen ? defaultOpen(...args) : '<table>\n');
  md.renderer.rules.table_close = (...args) =>
    (defaultClose ? defaultClose(...args) : '</table>\n') + '</div><!--/.table-scroll-->';

  md.core.ruler.push('wrap-html-tables', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'html_block' || !/^\s*<table[\s>]/.test(tokens[i].content)) continue;
      let end = i;
      while (end < tokens.length && !tokens[end].content.includes('</table>')) end++;
      if (end >= tokens.length) continue; // 没扫到闭合标签，保守起见不包
      const close = new state.Token('html_block', '', 0);
      close.content = '</div><!--/.table-scroll-->';
      const open = new state.Token('html_block', '', 0);
      open.content = '<div class="table-scroll">';
      // 从后往前插，避免前面的插入让后面的索引位移
      tokens.splice(end + 1, 0, close);
      tokens.splice(i, 0, open);
      i = end + 2;
    }
  });
}

export default defineConfig({
  title: '文章分享集',
  description: '业务与技术分享',
  lang: 'zh-CN',
  cleanUrls: true,
  sitemap: { hostname: 'https://www.articleshare.cn' },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],
  markdown: {
    config: (md) => wrapTablesInScroll(md),
  },
  vite: {
    plugins: [refreshSidebarOnMarkdownChange()],
  },
  transformHead,
  themeConfig: {
    siteTitle: false,
    sidebar: buildSidebar(),
    outline: false,
    docFooter: { prev: '上一篇', next: '下一篇' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色',
    darkModeSwitchTitle: '切换到深色',
  },
});
