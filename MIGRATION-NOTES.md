# 文章分享集 · 新站迁移进度与任务清单

> 分支:`astro-poc`(全部实验代码在此分支;`main` 是现行线上站,未动)
> 最后更新:2026-08-31

## 目标

把站点从"手写整页 HTML"迁到 **Markdown + VitePress**,达到:

- 正文(Markdown)与样式(CSS/主题)彻底分离
- 保留 Git 真源、Cloudflare Pages 部署、AI 改稿工作流
- 可选叠加 Pages CMS / Obsidian 做可视化编辑

三个候选模板(AstroPaper 博客版 / Starlight / VitePress)对比后,**选定 VitePress**(样式最素净、中文观感最好、目录形态最接近旧站)。

## 目录结构(本分支)

```
blog/       AstroPaper 博客版(候选落选,保留参考)
starlight/  Starlight 版(候选落选,保留参考)
vitepress/  ✅ 选定方案,持续迭代中
articles/   旧站 9 篇整页 HTML(迁移源,未动)
```

## 已完成

- VitePress 环境搭建(`vitepress/`,依赖已入 package.json)
- 样板文章迁移:`youth-and-destiny.md`(HTML→Markdown,纯文字零标签)
- 样式定制(全部集中在 `vitepress/.vitepress/theme/custom.css`):
  - 正文宽度流式自适应,跟随窗口无上限,贴右侧边距 48px
  - 左侧栏 360px、目录字号 12px、**三级目录(##/###/####)全部默认展开**
  - 滚动跟随高亮(`tocSpy.js`,亮蓝 #0a6cf5)
  - 标题衬线字体(Noto Serif SC→Songti SC 回退),副标题弱化
  - 顶栏:无站名、无分隔线、无标题底边线(都移除过错位/孤线问题)
  - 侧栏头部品牌区:「文章分享集」+「← 全部文章」
  - 站名由「思享集」更名「**文章分享集**」(config/品牌区/首页三处)
- 已推送 origin/astro-poc

## 踩坑记录(重要,勿重蹈)

1. **不要改 `--vp-layout-max-width`**:主题在 ≥1440 视口用 `(100vw-该值)/2` 算边距,调大在中等窗口产生负边距,内容会钻到侧栏底下
2. **侧栏实际占宽 ≠ 272px**:主题给侧栏写了随视口变宽的公式,若只改内容边距不改侧栏,正文会被盖住
3. **`tocSpy.js` 顶层禁止访问 `document`**:会让 SSR 崩溃退化成纯客户端渲染(curl 拿到空壳是 dev 模式正常现象,不是故障)
4. **dev 必须在 `vitepress/` 子目录跑**,在仓库根跑会起成空站(404)
5. 主题自带样式带 `data-v` 作用域属性,覆盖时选择器要挂 `.Layout` 前缀、必要时 `!important`

## 后续任务

### 1. 批量迁移剩余 8 篇(核心工作)

源:`articles/<slug>/index.html` → 目标:`vitepress/<slug>.md`

转换规则(以 youth-and-destiny.md 为样板):

- `<h1..h4>` → `#..####`(现有侧栏脚本已收录到四级)
- callout 提示块 → VitePress `::: tip` 容器
- diagram/SVG 图 → 拷贝 SVG 到 `vitepress/public/images/<slug>/`,Markdown 里用 `![图注](/images/<slug>/x.svg)`
- 代码块 `<pre><code class="language-x">` → ```lang 围栏
- 表格可保留原生 HTML(VitePress 能渲染)
- 元信息(标题/日期/分类/标签)从 `articles.json` 取,放 frontmatter
- **正文文字一字不改**(AGENTS.md 的去 AI 腔要求:内容不变,转换是纯机械操作)

### 2. 首页升级为文章列表页

现在 `vitepress/index.md` 是单篇入口的 splash。迁移完成后改为列出全部文章(标题/日期/分类/标签来自各篇 frontmatter),形成真正的"列表页"。

### 3. 切换上线(决策点,需用户确认节奏)

- Cloudflare Pages 项目改为构建模式:构建命令 `cd vitepress && npm run build`,输出目录 `vitepress/.vitepress/dist`
- 旧 URL 重定向:`/articles/<slug>/*` → `/<slug>/*`(`public/_redirects`)
- `main` 分支旧站的下线/归档方式
- `.pages.yml`(在 main)后续指向新结构,Pages CMS 继续可用

### 4. 不做的事(已明确)

- 不引入数据库/动态服务(WordPress/Ghost 路线已否)
- 不追求所见即所得编辑(Obsidian + Pages CMS 覆盖该需求)

## 新机器快速开始

```bash
git clone git@github.com:hgl910602/articles.git
cd articles && git checkout astro-poc
cd vitepress && npm install
npm run dev        # http://localhost:4323
```
