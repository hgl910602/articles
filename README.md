# 文章分享集

对外分享的纯静态文章站（域名 [www.articleshare.cn](https://www.articleshare.cn/)）：Markdown 写作、VitePress 构建，部署在 Cloudflare，push 到 main 自动构建上线。

## 目录结构

```
├── vitepress/                       # 站点源码（唯一站点）
│   ├── <slug>.md                    # 文章正文（frontmatter: title/description/date/category/tags）
│   ├── index.md                     # 首页 = 文章列表页（搜索 + 标签筛选 + 卡片，数据自动扫描各篇 frontmatter）
│   ├── public/
│   │   ├── logo.svg                 # 站点 logo（浏览器 favicon 同源）
│   │   └── images/<slug>/           # 文章图片资产
│   ├── wrangler.jsonc               # Cloudflare 部署配置（产物目录、404 处理）
│   └── .vitepress/
│       ├── config.mjs               # 站点配置：侧栏按路径映射（每页只显示本篇目录）、sitemap、favicon
│       ├── posts.data.js            # 首页列表数据加载器（扫 *.md frontmatter）
│       └── theme/
│           ├── custom.css           # 全部样式定制（首页头部/列表、文章页排版、侧栏）
│           ├── tocSpy.js            # 侧栏目录滚动跟随高亮
│           └── components/          # HomeHero / ArticleList / SidebarTop 组件
├── scripts/                         # 旧站 HTML → VitePress 的一次性迁移工具（历史记录，站点运行不依赖）
├── skills/de-ai-tone/               # 去 AI 腔 skill（版本化；~/.zcode/skills/de-ai-tone 是指向这里的软链）
├── MIGRATION-NOTES.md               # 旧站迁移与部署配置的完整记录（含踩坑清单）
└── AGENTS.md                        # AI 助手在本仓库工作的纪律
```

## 写新文章

```bash
# 1. vitepress/ 下新建 <slug>.md，frontmatter 抄现有文章
# 2. 图片放 vitepress/public/images/<slug>/，正文用 ![图注](/images/<slug>/x.png) 引用
# 3. 侧栏与首页列表自动收录，无需改任何配置

cd vitepress && npm install
npm run dev                        # 本地预览（端口看终端输出）
git add . && git commit -m "feat: 新增文章：xxx" && git push   # push 后自动构建上线
```

正文照常过"去 AI 腔"（见下方写作规范）。

## 部署（Cloudflare，已配置完成）

- Git 连接本仓库，根目录 `vitepress`，构建命令 `npm ci && npm run build`，部署命令 `npx wrangler deploy`（读 `vitepress/wrangler.jsonc`）
- push 到 main 自动构建上线；部署问题与历史决策见 [MIGRATION-NOTES.md](MIGRATION-NOTES.md)

## 写作规范（所有文章适用，不限技术文章）

- 正文写作或改写完成后，必须过一遍"去 AI 腔"：skill 收录在本仓库 `skills/de-ai-tone/`（`~/.zcode/skills/de-ai-tone` 是指向这里的软链），配套自检脚本：

  ```bash
  python3 skills/de-ai-tone/scripts/tone_scan.py vitepress/<slug>.md
  ```

- 常见症状与改法见 skill 内清单（破折号过密、"不是 X 而是 Y"对仗、总结腔、段末金句落点、绝对化用词等）。核心原则：**只动语气，不动事实、数据、引用与排版体系**；扫描 0 标记不等于过关，仍需人工做落点自检。
- 详见 [AGENTS.md](AGENTS.md)，AI 助手在本仓库工作时会自动读到。

## 风格统一机制

- 样式定制全部集中在 `vitepress/.vitepress/theme/custom.css`（衬线标题、首页头部/卡片、侧栏宽度与高亮），改风格改这一个文件
- 首页头部（logo + 标题 + 副标题）在 `theme/components/HomeHero.vue`，品牌色 `--toc-active`（亮蓝）统一点缀
- 文章内图片放 `vitepress/public/images/<slug>/`，用绝对路径引用（如 `/images/<slug>/fig1.png`）
