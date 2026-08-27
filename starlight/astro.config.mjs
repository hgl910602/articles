import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://www.articleshare.cn',
  integrations: [
    starlight({
      title: '思享集',
      description: '业余思考 · 沉淀',
      defaultLocale: 'zh',
      locales: {
        zh: { label: '简体中文', lang: 'zh-CN' },
      },
      sidebar: [
        {
          label: '随笔',
          items: [{ autogenerate: { directory: 'youth-and-destiny' } }],
        },
      ],
    }),
  ],
});
