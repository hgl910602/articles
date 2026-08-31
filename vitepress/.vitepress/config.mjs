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

// 扫描每篇 md 的 ##/###/#### 标题，生成"文章标题 + 本页目录"式侧边栏，
// 全部默认展开不折叠（目录长不是问题）
function buildSidebar() {
  return readdirSync(srcDir)
    .filter((f) => f.endsWith('.md') && f !== 'index.md')
    .map((file) => {
      const text = readFileSync(join(srcDir, file), 'utf-8');
      const title =
        text.match(/^# (.+)$/m)?.[1] ?? file.replace('.md', '');
      const items = [];
      for (const line of text.split('\n')) {
        const m = line.match(/^(#{2,4}) (.+)$/);
        if (!m) continue;
        const link = `#${slugify(m[2].trim())}`;
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
      return {
        text: title,
        link: '/' + file.replace('.md', ''),
        items,
        collapsed: false,
      };
    });
}

export default defineConfig({
  title: '思享集',
  description: '业余思考 · 沉淀',
  lang: 'zh-CN',
  cleanUrls: true,
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
