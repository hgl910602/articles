#!/usr/bin/env python3
"""旧站整页 HTML -> VitePress Markdown 批量转换器（astro-poc 迁移用）。

用法（仓库根目录执行）：
    python scripts/html2vitepress.py <slug> [<slug> ...]

- 输入：articles/<slug>/index.html + articles.json 元信息 + 文章目录内图片资产
- 输出：vitepress/<slug>.md、vitepress/public/images/<slug>/ 资产
- 正文文字一字不改，只做机械结构转换（AGENTS.md：迁移不改内容）
- 章末总结图（内联 SVG）抽取为独立 .svg 文件
- 文内旧锚点（#sec2-1 这类 id）重映射为 VitePress 由标题文本生成的新 slug
"""
import html as htmllib
import json
import re
import shutil
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'articles'
VP = ROOT / 'vitepress'
PUB = VP / 'public' / 'images'

# ---- 与 vitepress/.vitepress/config.mjs 内联的 VitePress slug 算法保持一致 ----
R_CONTROL = re.compile(r'[\u0000-\u001f]')
R_SPECIAL = re.compile(r'[\s~`!@#$%^&*()\-_+=\[\]{}|\\;:"\'“”‘’<>,.?/]+')
R_COMBINING = re.compile(r'[\u0300-\u036f]')


def slugify(text: str) -> str:
    s = unicodedata.normalize('NFKD', text)
    s = R_COMBINING.sub('', s)
    s = R_CONTROL.sub('', s)
    s = R_SPECIAL.sub('-', s)
    s = re.sub(r'-{2,}', '-', s).strip('-')
    if s and s[0].isdigit():
        s = '_' + s
    return s.lower()


RAW_TAG = re.compile(r'</?[A-Za-z][A-Za-z0-9_-]*(?:\s[^>]*)?/?>')

# 块级容器（callout/导语框）内散落的内联文本（如 <strong>核心目标：</strong>正文）包成 <p>，
# 否则块级扫描器会把 <strong> 当未知标签拆碎
BLOCK_TAGS = r'<p[\s>]|<ul[\s>]|<ol[\s>]|<table[\s>]|<h[1-6][\s>]|<blockquote[\s>]|<figure[\s>]|<pre[\s>]|<div[\s>]|<hr[\s/>]'


def wrap_loose_inline(s: str) -> str:
    parts = re.split(r'(?=(?:' + BLOCK_TAGS + r'))', s)
    out = []
    for part in parts:
        if not part:
            continue
        if re.match(BLOCK_TAGS, part) or not part.strip():
            out.append(part)
        else:
            out.append('<p>' + part + '</p>')
    return ''.join(out)


def decode(text: str) -> str:
    return htmllib.unescape(text)


def strip_tags(fragment: str) -> str:
    """去掉全部标签、去掉 badge 类 span 的内容（迁移中 badge 为装饰，不保留）。"""
    fragment = re.sub(r'<span class="badge[^"]*">.*?</span>', '', fragment, flags=re.S)
    fragment = re.sub(r'<[^>]+>', '', fragment)
    return decode(fragment)


# ---- 内联转换：strong/em/code/a/br/span ----

def inline(text: str, anchors: dict) -> str:
    codes = []
    marks = []

    def stash_code(m):
        inner = decode(m.group(1))
        if '`' in inner:
            inner = ' ' + inner + ' '
            codes.append('`` ' + inner + ' ``')
        else:
            codes.append('`' + inner + '`')
        return f'\x00{len(codes) - 1}\x00'

    def stash_mark(m):
        # 输出 HTML 标签而非 **/*：CommonMark 的侧翼规则在「闭合 ** 后紧跟中文」时
        # 不识别强调（如 **核心目标：**辅助），HTML 标签无此问题。
        # 内部递归做 inline 转换，<strong> 里嵌的文内链接也会被正确重映射
        tag, inner = m.group(1), m.group(2)
        marks.append(f'<{tag}>' + inline(inner, anchors) + f'</{tag}>')
        return f'\x01{len(marks) - 1}\x01'

    text = re.sub(r'<code>(.*?)</code>', stash_code, text, flags=re.S)
    text = re.sub(r'<(strong|em)>(.*?)</\1>', stash_mark, text, flags=re.S)

    text = re.sub(r'<(?:strong|b)>(.*?)</(?:strong|b)>', stash_mark, text, flags=re.S)
    text = re.sub(r'<(?:em|i)>(.*?)</(?:em|i)>', stash_mark, text, flags=re.S)

    def conv_a(m):
        attrs, body = m.group(1), m.group(2)
        href = re.search(r'href="([^"]*)"', attrs)
        if not href:
            return strip_tags(body)
        url = href.group(1)
        # 站内文章链接：../slug/ -> /slug（cleanUrls，无尾斜杠）
        m2 = re.match(r'\.\./([a-z0-9-]+)/?$', url)
        if m2:
            url = '/' + m2.group(1)
        # 文内旧锚点 -> 新 slug
        elif url.startswith('#'):
            new = anchors.get(url[1:])
            if new is None:
                print(f'  !! 未找到锚点映射: {url}')
            else:
                url = '#' + new
        body = strip_tags(m.group(2))
        if not body:
            return ''
        return f'[{body}]({url})'

    text = re.sub(r'<a ([^>]*)>(.*?)</a>', conv_a, text, flags=re.S)
    # 残余 span（非 badge）只留文字
    text = re.sub(r'</?span[^>]*>', '', text)
    text = re.sub(r'<br\s*/?>', '\n', text)
    # 已知标签都已消费，此处残存的裸 <xxx> 是旧站渲染时被吞的未知标签（如 <untrusted_input>），剥掉；
    # 实体编码的 &lt;xxx&gt; 是旧站可见文字，须在其后 decode 才能保留
    text = RAW_TAG.sub('', text)
    text = decode(text)
    text = re.sub(r'\x00(\d+)\x00', lambda m: codes[int(m.group(1))], text)
    text = re.sub(r'\x01(\d+)\x01', lambda m: marks[int(m.group(1))], text)
    return text.strip()


def fence_wrap(content: str, lang: str) -> str:
    content = content.strip('\n')
    n = 3
    while '`' * n in content:
        n += 1
    tick = '`' * n
    return f'{tick}{lang}\n{content}\n{tick}'


class Converter:
    def __init__(self, slug: str, meta: dict):
        self.slug = slug
        self.meta = meta
        self.raw = (SRC / slug / 'index.html').read_text(encoding='utf-8')
        m = re.search(r'<div id="content"><div class="inner">(.*?)<div class="footer">', self.raw, re.S)
        if not m:
            raise SystemExit(f'{slug}: 找不到正文区域')
        self.body = m.group(1)
        self.anchors = self.build_anchors()
        self.copied: set[str] = set()
        self.svg_idx = 0

    def build_anchors(self) -> dict:
        amap = {}
        for m in re.finditer(r'<h([1-4])[^>]*\sid="([^"]+)"[^>]*>(.*?)</h\1>', self.body, re.S):
            amap[m.group(2)] = slugify(strip_tags(m.group(3)).strip())
        for m in re.finditer(r'<p id="([^"]+)">\s*<strong>(.*?)</strong>\s*</p>', self.body, re.S):
            amap[m.group(1)] = slugify(decode(m.group(2)).strip())
        return amap

    # ---- 资产 ----

    def asset_url(self, src: str) -> str:
        clean = src.split('?')[0]
        name = Path(clean).name
        srcp = SRC / self.slug / clean
        dst = PUB / self.slug / name
        if not srcp.exists():
            raise SystemExit(f'{self.slug}: 资产不存在 {srcp}')
        if not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(srcp, dst)
        self.copied.add(name)
        return f'/images/{self.slug}/{name}'

    def extract_summary_svg(self, block: str) -> str:
        m = re.search(r'<svg\b.*?</svg>', block, re.S)
        svg = m.group(0)
        title = re.search(r'<title>(.*?)</title>', svg, re.S)
        caption = decode(title.group(1)).strip() if title else '本章总结图'
        self.svg_idx += 1
        name = f'summary-{self.svg_idx:02d}.svg'
        dst = PUB / self.slug / name
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(svg, encoding='utf-8')
        self.copied.add(name)
        return f'![{caption}](/images/{self.slug}/{name})'

    # ---- 块级转换 ----

    BLOCK_RE = re.compile(
        r'(?P<comment><!--.*?-->)'
        r'|(?P<chapter_summary><div class="chapter-summary">.*?</div>)'
        r'|(?P<chapter_intro><div class="chapter-intro">.*?</div>)'
        r'|(?P<callout><div class="callout callout-(?P<co_kind>tip|note|warning|danger)">.*?</div>)'
        r'|(?P<tablewrap><div class="article-table-wrap">.*?</div>\s*)'
        r'|(?P<table><table[^>]*>.*?</table>)'
        r'|(?P<diagram><div class="diagram">\s*<pre>(?P<dg_body>.*?)</pre>\s*</div>)'
        r'|(?P<precode><pre><code class="language-(?P<pc_lang>[\w-]+)">(?P<pc_body>.*?)</code>\s*</pre>)'
        r'|(?P<figure><figure class="article-figure[^"]*">.*?</figure>)'
        r'|(?P<h><h(?P<h_lvl>[1-6])[^>]*>(?P<h_text>.*?)</h(?P=h_lvl)>)'
        r'|(?P<pstrong><p id="[^"]+">\s*<strong>(?P<ps_text>.*?)</strong>\s*</p>)'
        r'|(?P<p><p[^>]*>(?P<p_body>.*?)</p>)'
        r'|(?P<bq><blockquote>(?P<bq_body>.*?)</blockquote>)'
        r'|(?P<ul><ul[^>]*>(?P<ul_body>.*?)</ul>)'
        r'|(?P<ol><ol(?P<ol_attrs>[^>]*)>(?P<ol_body>.*?)</ol>)'
        r'|(?P<hr><hr\s*/?>)'
        r'|(?P<text>[^<]+)'
        r'|(?P<tag><)',
        re.S,
    )

    CO_MAP = {'tip': 'tip', 'note': 'info', 'warning': 'warning', 'danger': 'danger'}

    def convert_blocks(self, s: str) -> list[str]:
        out = []
        for m in self.BLOCK_RE.finditer(s):
            kind = m.lastgroup if m.lastgroup and m.group(m.lastgroup) is not None else None
            # 命名组哪个非空即哪个（text/tag 兜底）
            for g in ('comment', 'chapter_summary', 'chapter_intro', 'callout', 'tablewrap', 'table',
                      'diagram', 'precode', 'figure', 'h', 'pstrong', 'p', 'bq', 'ul', 'ol', 'hr', 'text', 'tag'):
                if m.group(g) is not None:
                    kind = g
                    break
            if kind in (None, 'comment', 'text', 'tag'):
                continue
            if kind == 'chapter_summary':
                out.append(self.extract_summary_svg(m.group('chapter_summary')))
            elif kind == 'chapter_intro':
                inner = re.sub(r'^<div class="chapter-intro">|</div>$', '', m.group('chapter_intro'), flags=re.S)
                blocks = self.convert_blocks(wrap_loose_inline(inner))
                out.append('::: info\n\n' + '\n\n'.join(blocks) + '\n\n:::')
            elif kind == 'callout':
                inner = re.sub(r'^<div class="callout callout-\w+">', '', m.group('callout')).replace('</div>', '', 1)
                blocks = self.convert_blocks(wrap_loose_inline(inner))
                out.append(f"::: {self.CO_MAP[m.group('co_kind')]}\n\n" + '\n\n'.join(blocks) + '\n\n:::')
            elif kind == 'tablewrap':
                inner = re.sub(r'^<div class="article-table-wrap">', '', m.group('tablewrap')).replace('</div>', '', 1)
                out.extend(self.convert_blocks(inner))
            elif kind == 'table':
                out.append(self.convert_table(m.group('table')))
            elif kind == 'diagram':
                # 裸写的类标签文本（如 <task>）在旧站会被浏览器当未知元素吞掉不显示，这里剥掉以保持旧站渲染效果
                out.append(fence_wrap(decode(RAW_TAG.sub('', m.group('dg_body'))), 'text'))
            elif kind == 'precode':
                out.append(fence_wrap(decode(RAW_TAG.sub('', m.group('pc_body'))), m.group('pc_lang')))
            elif kind == 'figure':
                out.append(self.convert_figure(m.group('figure')))
            elif kind == 'h':
                lvl = int(m.group('h_lvl'))
                out.append('#' * lvl + ' ' + strip_tags(m.group('h_text')).strip())
            elif kind == 'pstrong':
                out.append('### ' + decode(m.group('ps_text')).strip())
            elif kind == 'p':
                txt = inline(m.group('p_body'), self.anchors)
                if txt:
                    out.append(txt)
            elif kind == 'bq':
                # 剥掉内部 <p> 标签后整体做 inline 转换（裸文本与 <p> 包裹两种形态都覆盖）
                body_txt = re.sub(r'</?p[^>]*>', '\n', m.group('bq_body'))
                lines = [ln.strip() for ln in inline(body_txt, self.anchors).split('\n') if ln.strip()]
                out.append('\n'.join('> ' + ln for ln in lines))
            elif kind == 'ul':
                items = re.findall(r'<li[^>]*>(.*?)</li>', m.group('ul_body'), re.S)
                out.append('\n'.join('- ' + inline(i, self.anchors).replace('\n', ' ') for i in items))
            elif kind == 'ol':
                items = re.findall(r'<li[^>]*>(.*?)</li>', m.group('ol_body'), re.S)
                out.append('\n'.join(f'{n}. ' + inline(i, self.anchors).replace('\n', ' ')
                                     for n, i in enumerate(items, 1)))
            elif kind == 'hr':
                out.append('---')
        return out

    def convert_table(self, table: str) -> str:
        t = table.strip()

        def remap(m):
            url = m.group(1)
            new = self.anchors.get(url[1:])
            if url.startswith('#') and new:
                return f'href="#{new}"'
            print(f'  !! 表格内锚点未映射: {url}')
            return m.group(0)

        t = re.sub(r'href="(#[^"]+)"', remap, t)

        def imgsrc(m):
            return f'src="{self.asset_url(m.group(1))}"'

        t = re.sub(r'src="(image_[\w.]+|images/[^"]+)"', imgsrc, t)
        return t

    def convert_figure(self, fig: str) -> str:
        img = re.search(r'<img src="([^"]+)"[^>]*?(?:alt="([^"]*)")?', fig)
        if not img:
            img = re.search(r'<img src="([^"]+)"', fig)
            src, alt = img.group(1), ''
        else:
            src, alt = img.group(1), img.group(2) or ''
        cap = re.search(r'<figcaption>(.*?)</figcaption>', fig, re.S)
        caption = strip_tags(cap.group(1)).strip() if cap else decode(alt)
        return f'![{caption}]({self.asset_url(src)})'

    def frontmatter(self) -> str:
        a = self.meta
        desc = a['description'].replace('"', '\\"')
        tags = ', '.join(t.replace('"', '\\"') for t in a['tags'])
        return (f'---\ntitle: "{a["title"]}"\ndescription: "{desc}"\n'
                f'date: {a["date"]}\ncategory: "{a["category"]}"\ntags: [{tags}]\n---\n')

    def run(self) -> str:
        blocks = self.convert_blocks(self.body)
        md = self.frontmatter() + '\n\n' + '\n\n'.join(blocks) + '\n'
        md = re.sub(r'\n{3,}', '\n\n', md)
        out = VP / f'{self.slug}.md'
        # Windows 上 write_text 默认把 \n 翻译成 \r\n，会打破 JS 侧的行首正则，强制 LF
        with open(out, 'w', encoding='utf-8', newline='\n') as f:
            f.write(md)
        return out


def main():
    slugs = sys.argv[1:]
    if not slugs:
        raise SystemExit('用法: python scripts/html2vitepress.py <slug> ...')
    meta = {a['slug']: a for a in json.loads((ROOT / 'articles.json').read_text(encoding='utf-8'))['articles']}
    for slug in slugs:
        if slug not in meta:
            raise SystemExit(f'{slug}: articles.json 中无元信息')
        c = Converter(slug, meta[slug])
        out = c.run()
        print(f'{slug}: {out}  (资产 {len(c.copied)} 个, 锚点映射 {len(c.anchors)} 条)')


if __name__ == '__main__':
    main()
