# 文章分享集 · 新站迁移进度与任务清单

> 分支:`astro-poc`(全部实验代码在此分支;`main` 是现行线上站,未动)
> 最后更新:2026-08-31(第二批:9 篇全部迁完)

## 目标

把站点从"手写整页 HTML"迁到 **Markdown + VitePress**,达到:

- 正文(Markdown)与样式(CSS/主题)彻底分离
- 保留 Git 真源、Cloudflare Pages 部署、AI 改稿工作流
- 可选叠加 Pages CMS / Obsidian 做可视化编辑

三个候选模板(AstroPaper 博客版 / Starlight / VitePress)对比后,**选定 VitePress**(样式最素净、中文观感最好、目录形态最接近旧站)。

## 目录结构(本分支)

```
vitepress/            ✅ 线上站点(2026-08-31 起唯一站点)
  <slug>.md           9 篇文章正文(frontmatter + Markdown)
  index.md            首页 = 文章列表页(卡片 + 标签筛选)
  wrangler.jsonc      Cloudflare 部署配置(产物目录/404 处理)
  .vitepress/
    config.mjs        侧栏按路径映射(每页只显示本篇目录)、sitemap、favicon
    posts.data.js     数据加载器:扫 *.md frontmatter 供首页消费
    theme/            custom.css + tocSpy.js + 品牌区/列表/首页头部组件
  public/images/<slug>/  图片资产(82 个:webp 截图 + SVG)
scripts/              迁移期工具(html2vitepress.py 等),旧 HTML 已删,仅作历史记录
blog/ starlight/      候选落选,保留参考(后续可删)
```

## 已完成

### 第一批(环境与样板)

- VitePress 环境搭建,样式定制集中在 `theme/custom.css`(流式正文宽度、360px 侧栏、三级目录全展开、衬线标题、品牌区)
- 样板迁移 `youth-and-destiny.md`

### 第二批(9 篇全部迁完)

- **批量转换器** `scripts/html2vitepress.py`:标题/段落/加粗小节/四类 callout(`::: tip/info/warning/danger`)/diagram 示意图(```text 围栏)/代码围栏(带语法高亮)/figure→图片/表格保留原生 HTML/嵌图表 figure 原样保留/有序无序列表/引用/hr
- **文字保真校验** `scripts/verify_md_text.py`:9 篇全部字符级比对通过(正文一字不改的机器闸门)
- 9 篇文章全量迁移,82 个资产拷贝到 `public/images/<slug>/`,17 张章末内联 SVG 抽取为独立文件(summary-NN.svg)
- 文内旧锚点(`#sec8-3` 等 300+ 处)按 VitePress slug 算法重映射,全站 0 死锚点(已机器验证)
- 章节徽章(「重点」badge)迁移时丢弃——纯装饰,标题文字保留
- **首页升级为文章列表页**:9 张卡片(标题/分类/日期/约 N 分钟/摘要/标签)+ 标签 chips 筛选(客户端),数据来自各篇 frontmatter(posts.data.js)
- 每篇 md 统一 frontmatter(title/description/date/category/tags,源自 articles.json)
- 修 config.mjs 侧栏锚点:子项链接带文章路径前缀(纯 `#anchor` 跨页点击不跳转)
- 浏览器实测:首页列表、文章页(callout/表格/代码/SVG 总结图/滚动高亮)、商家文嵌图表格(31 图全加载)均正常

## 踩坑记录(重要,勿重蹈)

1. **不要改 `--vp-layout-max-width`**:主题在 ≥1440 视口用 `(100vw-该值)/2` 算边距,调大在中等窗口产生负边距,内容会钻到侧栏底下
2. **侧栏实际占宽 ≠ 272px**:主题给侧栏写了随视口变宽的公式,若只改内容边距不改侧栏,正文会被盖住
3. **`tocSpy.js` 顶层禁止访问 `document`**:SSR 会崩(curl 拿到空壳是 dev 模式正常现象)
4. **dev 必须在 `vitepress/` 子目录跑**;端口以终端输出为准(本轮实测 5173,非固定)
5. 主题自带样式带 `data-v` 作用域,覆盖时选择器挂 `.Layout` 前缀、必要时 `!important`
6. **`git add` 漏了未跟踪文件曾导致 theme 文件丢失**:上批工作只提交了 index.js/custom.css,`tocSpy.js` 和 `components/SidebarTop.vue` 从未入库,切机器即崩。本轮已按 CSS 类名线索重建并入库。**提交前跑 `git status` 确认无未跟踪的必要文件**
7. **Windows 上 Python 写文件默认 CRLF**:会打破 JS 侧的行首正则(frontmatter 解析、config.mjs 标题扫描全失灵,症状是首页标题退化成文件名)。转换器已强制 `newline='\n'`;手写文件也要留意
8. **旧 HTML 里裸写的 `<xxx>` 标签浏览器不显示**(如 llm 工程文代码里的 `<task>`、散文里的 `<untrusted_input>`,作者是想展示标签文本但没转义):迁移时按"旧站实际渲染效果"剥掉了;将来若要真正展示这些标签,得在 md 里写 `\&lt;task\&gt;` 形式
9. 转换器遇到的形态差异备忘:`<table class="article-table">`(带 class)、`<ul class="appendix-list">`、`<h5>` 五级标题、callout 内嵌 `<ul>`、裸文本 `<blockquote>`、代码块闭合标签带换行(`</code>\n</pre>`)——全部已兼容
10. **CommonMark 强调的侧翼规则对中文不友好**:`**核心目标：**辅助` 这种"闭合 ** 后紧跟中文"不会渲染成粗体(星号原样露出)。转换器因此把 `<strong>/<em>` 输出为 HTML 标签而非 `**/*`。手写 md 时要么在闭合 ** 后加空格,要么直接写 `<strong>` 标签
11. **侧栏是按路径前缀映射的**(config.mjs 里 `map[pagePath] = [...]`):每页只显示该篇文章自己的目录,对齐旧站。新增文章无需改配置,扫描器自动收录

## 后续任务

### 1. 切换上线(2026-08-31 已合并 main,只差面板一步)

用户决策:**直接全量替换,不做任何旧链接兼容(无 301 重定向)**。

仓库侧已全部就绪:sitemap(config 里 hostname 指向 articleshare.cn)、favicon。**剩余唯一动作在 Cloudflare Pages 面板**(旧项目是纯静态直传,没有构建配置,仓库里改不了):

- Settings → Builds & deployments → Build configuration,改 Custom:
  - Build command: `cd vitepress && npm ci && npm run build`
  - Build output directory: `vitepress/.vitepress/dist`
- 环境变量 `NODE_VERSION` 设 `20`(默认镜像一般也够,VitePress 1.6 要 node 18+)
- 保存后重试部署,域名不变,老 URL(`articles/*` 路径)会 404,按决策不处理

#### 替换成本结论

- 面板 2 个字段,5 分钟,这是唯一硬成本;**2026-08-31 已上线成功**(根目录 `vitepress`、构建 `npm ci && npm run build`、部署 `npx wrangler deploy`)
- 部署踩坑:面板根目录最初误填产物路径导致 "root directory not found";自动生成的 assets.directory 指向 VitePress 默认模板的 `docs/.vitepress/dist`,与本站自定义目录不符——已提交 `vitepress/wrangler.jsonc` 写死产物路径解决
- 旧站文件(articles/、assets/、index.html、template.html、.pages.yml、articles.json、build-index.mjs、adopt.mjs)**已从 main 删除**,需要时从 git 历史找回;README/AGENTS.md 已同步改写为 VitePress 工作流
- 遗留小项(不阻塞上线):
  - 每篇文章缺 og:image,社交分享无预览图(要恢复需在主题里按 frontmatter 生成 per-page og 标签)
  - 旧站首页的搜索框在新站首页已补齐;全站 Navbar 搜索未开(VitePress local search 对中文分词弱,首页搜索够用)

### 2. 可选增强(不影响上线)

- 顶层 figure 的图注目前只进 alt(悬停可见),页面不显示;旧站 figcaption 是可见文字。如需恢复,做一个带 caption 的图片组件替换 `![]()` 写法
- 嵌图表格(merchant/ecommerce 的对照表)保留原生 HTML,后续可择机改造成 Markdown 表 + 组件
- 每篇文章 og:image(社交分享预览图)

### 3. 不做的事(已明确)

- 不引入数据库/动态服务(WordPress/Ghost 路线已否)
- 不追求所见即所得编辑(Obsidian + Pages CMS 覆盖该需求)

## 新文章怎么写(迁移后工作流)

1. `vitepress/<slug>.md` 新建文件,从现有文章抄 frontmatter 格式
2. 图片放 `vitepress/public/images/<slug>/`,正文引用 `![图注](/images/<slug>/x.png)`
3. 侧栏、首页列表自动收录,无需改配置
4. 正文照常过 de-ai-tone(AGENTS.md 要求不变)

## 新机器快速开始

```bash
git clone git@github.com:hgl910602/articles.git
cd articles && git checkout astro-poc
cd vitepress && npm install
npm run dev        # 端口看终端输出
```

转换器/校验器重跑(仅当旧 HTML 又有修订需要同步时):

```bash
python scripts/html2vitepress.py <slug>   # 注意用 python,Windows 的 python3 是商店占位符
python scripts/verify_md_text.py <slug>
```
