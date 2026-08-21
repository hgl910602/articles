# 技术知识库

对外分享的纯静态知识库站点：所有文章都是 HTML，共享同一套样式，部署在 Cloudflare Pages，push 到 main 自动上线。

## 目录结构

```
├── articles.json                # 站点配置 + 文章清单（新增文章唯一要手动维护的文件）
├── index.html                   # 首页（由脚本生成，勿手改）
├── template.html                # 新文章模板
├── articles/<slug>/index.html   # 每篇文章一个目录，目录内可放文章专属图片等资源
├── assets/
│   ├── css/theme.css            # 设计变量 + 基础样式（全站共用，改风格改这里）
│   ├── css/article.css          # 文章页样式（侧边栏目录、排版、提示框等）
│   ├── css/site.css             # 首页样式
│   ├── js/article.js            # 文章页脚本（目录高亮跟随、平滑滚动、移动端目录）
│   └── vendor/prism/            # 代码高亮（本地化，不依赖外网 CDN）
└── scripts/
    ├── build-index.mjs          # 读 articles.json → 生成首页
    └── adopt.mjs                # 一键把自包含 HTML 适配成站点文章
```

## 新增一篇文章

### 方式一：从模板开始（推荐）

```bash
cp template.html articles/my-article/index.html   # slug 用英文，决定 URL：/articles/my-article/
```

编辑文章内容（`<title>`、侧边栏目录、正文；正文可用的样式类见模板内注释），然后在 `articles.json` 的 `articles` 数组加一条：

```json
{
  "slug": "my-article",
  "title": "文章标题",
  "description": "首页卡片上显示的摘要，一两句话。",
  "date": "2026-08-18",
  "tags": ["标签1", "标签2"]
}
```

### 方式二：适配一篇现成的自包含 HTML（如 AI 生成的整页文章）

```bash
node scripts/adopt.mjs ~/Downloads/新文章.html my-article
```

脚本会自动：删除内联 style/script 改为引用公共文件、把 cdnjs 的 Prism 替换为本地（缺的组件自动下载）、侧边栏插入「← 返回首页」。之后同样在 `articles.json` 加一条记录。

### 生成首页并上线

```bash
node scripts/build-index.mjs    # 重新生成 index.html
python3 -m http.server 8765     # 本地预览 http://localhost:8765
git add . && git commit -m "新增文章：xxx" && git push   # push 后 Pages 自动部署
```

## 部署（Cloudflare Pages，一次性配置）

1. 推送仓库到 GitHub / GitLab
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → **Connect to Git**，选择本仓库
3. 构建配置：
   - Framework preset: **None**
   - Build command: **留空**（首页已生成好并提交在仓库里）
   - Build output directory: **/**（仓库根目录）
4. Save and Deploy，之后每次 push 到 main 自动上线

## 写作规范（所有文章适用，不限技术文章）

- 正文写作或改写完成后，必须过一遍"去 AI 腔"：skill 位于 `~/.zcode/skills/de-ai-tone`，配套自检脚本：

  ```bash
  python3 ~/.zcode/skills/de-ai-tone/scripts/tone_scan.py articles/<slug>/index.html
  ```

- 常见症状与改法见 skill 内清单（破折号过密、"不是 X 而是 Y"对仗、总结腔、段段加粗金句等）。核心原则：**只动语气，不动事实、数据、引用与排版体系**。
- 详见 [AGENTS.md](AGENTS.md)，AI 助手在本仓库工作时会自动读到。

## 风格统一机制

- 所有颜色、字体、间距等设计变量在 `assets/css/theme.css` 的 `:root` 中，首页与文章页共用
- 文章页全部样式在 `assets/css/article.css`，改这一个文件即可全站生效
- 文章内图片等资源放在 `articles/<slug>/` 目录内，用相对路径引用（如 `<img src="fig1.png">`）
