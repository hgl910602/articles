import { defineConfig } from 'vitepress';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

export default defineConfig({
  title: '文章分享集',
  description: '业务与技术分享',
  lang: 'zh-CN',
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],
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
