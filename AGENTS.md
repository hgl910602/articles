# AGENTS.md — 给在本仓库工作的 AI 助手

纯静态中文文章站（Cloudflare Pages 部署）。仓库结构、新增文章流程、部署配置见 [README.md](README.md)，此处只写工作纪律。

## 硬性要求

### 1. 所有文章正文必须过"去 AI 腔"

**适用范围是全部文章，不限技术文章**——业务分析、领域建模、随笔感想，凡新写、扩写、改写的正文都算。

- 加载并遵循 `~/.zcode/skills/de-ai-tone/SKILL.md`（ZCode 环境会自动发现该 skill；其他环境直接读这个文件照做）。
- 交付前自检：

  ```bash
  python3 ~/.zcode/skills/de-ai-tone/scripts/tone_scan.py articles/<slug>/index.html
  ```

  改写后 AI 腔标记密度应明显下降（重点看破折号"——"密度和"一段 ≥2 个——"的段落数），读起来不顺眼的热点句子清零。**扫描 0 标记不等于过关**：段末金句落点、对偶句密度、姊妹篇共用结尾模板这些"读感"问题脚本抓不到，交付前把每章最后一句连起来读一遍做落点自检，并和站内旧文比对收尾句式（详见 skill 工作流程）。
- 核心原则：**只动语气，不动内容**——事实、数字、引用、代码、术语、章节编号一律保持原样。

### 2. 排版对齐站内既有惯例

- 新文章从 `template.html` 起步，沿用嵌套侧边栏目录、`callout`/`diagram` 样式类、相对路径图片。
- 先读一两篇现有文章（如 `articles/llm-engineering-guide/`、`articles/domain-modeling-practice/`）对齐小节分层、图注、导语框的写法。

### 3. 改动后必须校验

- HTML 标签平衡；侧边栏目录锚点与正文标题 id 一一对应。
- 小节重编号时，全文搜索旧编号（如 `6.5.2`）更新交叉引用。
- `index.html` 由 `scripts/build-index.mjs` 生成：改首页先改 `articles.json`，再跑 `node scripts/build-index.mjs`，不要手改首页。

### 4. 提交纪律

- 提交信息用 conventional commit + 中文描述（对齐历史：`feat: 添加领域建模实践姊妹篇`、`perf: 电商文章剩余23张PNG转WebP`）。
- 大图先转 WebP（历史平均省 70%+ 体积）。
- 本地工具目录（`.codeflicker/` 之类）不要提交。
