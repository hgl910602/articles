# AGENTS.md — 给在本仓库工作的 AI 助手

纯静态中文文章站（Markdown + VitePress，Cloudflare 部署，push 到 main 自动上线）。仓库结构、新增文章流程、部署配置见 [README.md](README.md)，此处只写工作纪律。

## 硬性要求

### 1. 所有文章正文必须过"去 AI 腔"

**适用范围是全部文章，不限技术文章**——业务分析、领域建模、随笔感想，凡新写、扩写、改写的正文都算。

- 加载并遵循仓库内 `skills/de-ai-tone/SKILL.md`（skill 已版本化在本仓库；ZCode 环境通过 `~/.zcode/skills/de-ai-tone` 软链自动发现，其他环境直接读仓库内文件照做）。
- 交付前自检：

  ```bash
  python skills/de-ai-tone/scripts/tone_scan.py vitepress/<slug>.md
  ```

  改写后 AI 腔标记密度应明显下降（重点看破折号"——"密度和"一段 ≥2 个——"的段落数），读起来不顺眼的热点句子清零。**扫描 0 标记不等于过关**：段末金句落点、对偶句密度、姊妹篇共用结尾模板这些"读感"问题脚本抓不到，交付前把每章最后一句连起来读一遍做落点自检，并和站内旧文比对收尾句式（详见 skill 工作流程）。
- 核心原则：**只动语气，不动内容**——事实、数字、引用、代码、术语、章节编号一律保持原样。

### 2. 排版对齐站内既有惯例

- 新文章是 `vitepress/<slug>.md`，frontmatter 抄现有文章（title/description/date/category/tags），正文 Markdown；图片放 `vitepress/public/images/<slug>/`，用 `/images/<slug>/x.png` 绝对路径引用。
- 先读一两篇现有文章（如 `vitepress/llm-engineering-guide.md`、`vitepress/domain-modeling-practice.md`）对齐小节分层、图注、提示框（`::: tip/info/warning/danger`）、示意图（```text 围栏）的写法。
- 强调标记注意：**CommonMark 对"闭合 `**` 后紧跟中文"不识别粗体**，正文强调直接写 `<strong>` 标签（现有文章均如此）。

### 3. 改动后必须校验

- 侧栏目录、首页列表由 `config.mjs` / `posts.data.js` 扫描自动生成，不要手改生成物；frontmatter 是它们的数据源，字段写错会导致列表卡片缺信息。
- 小节重编号时，全文搜索旧编号（如 `6.5.2`）更新文内交叉引用 `[...](#锚点)`；锚点由 VitePress 按标题文本生成。
- 改完跑 `cd vitepress && npm run build` 验证构建通过。

### 4. 提交纪律

- 提交信息用 conventional commit + 中文描述（对齐历史：`feat: 首页升级为文章列表页`、`fix: 侧栏改按路径映射每页只显示本篇目录`）。
- 大图先转 WebP（历史平均省 70%+ 体积）。
- 本地工具目录（`.codeflicker/` 之类）不要提交；**提交前 `git status` 检查必要的新文件都已暂存**（曾因根 .gitignore 规则误吞 `vitepress/.vitepress/` 下新文件导致切机器后站点崩溃，规则已锚定修复，但习惯要保留）。
