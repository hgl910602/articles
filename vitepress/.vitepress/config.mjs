import { defineConfig } from 'vitepress';

export default defineConfig({
  title: '思享集',
  description: '业余思考 · 沉淀',
  lang: 'zh-CN',
  cleanUrls: true,
  themeConfig: {
    siteTitle: '思享集',
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色',
    darkModeSwitchTitle: '切换到深色',
    sidebar: [
      {
        text: '随笔',
        items: [{ text: '少年气与知天命', link: '/youth-and-destiny' }],
      },
    ],
  },
});
