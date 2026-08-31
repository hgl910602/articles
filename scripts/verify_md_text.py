#!/usr/bin/env python3
"""校验 html2vitepress.py 转换的文字保真度。

用法（仓库根目录）：
    python scripts/verify_md_text.py <slug> [<slug> ...]

两条独立抽取路径做字符级比对：
- HTML 侧：正文区域 -> 去 SVG/figcaption/badge/注释 -> 去标签 -> 实体解码 -> 去空白
- MD 侧：去 frontmatter/图片/围栏与行内代码先隔离/容器标记/强调标记/链接句法/原始表格 -> 去空白
两侧对可见文本的定义一致（图注、badge、SVG 内文字双方都不算可见正文）。
"""
import html as htmllib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def html_side(slug: str) -> str:
    raw = (ROOT / 'articles' / slug / 'index.html').read_text(encoding='utf-8')
    m = re.search(r'<div id="content"><div class="inner">(.*?)<div class="footer">', raw, re.S)
    body = m.group(1)
    body = re.sub(r'<div class="chapter-summary">.*?</div>', '', body, flags=re.S)
    # 顶层 figure 整体删除（转换后只剩 alt，不可见）；表格内嵌 figure/figcaption 以原始 HTML 保留、可见
    protected = []

    def stash_table(m):
        protected.append(m.group(0))
        return f'\x00{len(protected) - 1}\x00'

    body = re.sub(r'<table[^>]*>.*?</table>', stash_table, body, flags=re.S)
    body = re.sub(r'<figure\b.*?</figure>', '', body, flags=re.S)
    body = re.sub(r'\x00(\d+)\x00', lambda m: protected[int(m.group(1))], body)
    body = re.sub(r'<span class="badge[^"]*">.*?</span>', '', body, flags=re.S)
    body = re.sub(r'<!--.*?-->', '', body, flags=re.S)
    # <pre> 代码/示意块先保护：块内只有严格形态的标签（浏览器才吞），裸写的 <、<= 是可见文本
    raw_tag = re.compile(r'</?[A-Za-z][A-Za-z0-9_-]*(?:\s[^>]*)?/?>')

    def strip_pre(m):
        return '\x01' + raw_tag.sub('', m.group(1)) + '\x01'

    body = re.sub(r'<pre[^>]*>(.*?)</pre>', strip_pre, body, flags=re.S)
    # 严格标签形态（字母或/开头）：裸 <、<= 是文本，不能让 < 与远处标签的 > 配对误吞
    body = re.sub(r'</?[A-Za-z][^>]*>', '', body)
    body = body.replace('\x01', '')
    return re.sub(r'\s+', '', htmllib.unescape(body))


def md_side(slug: str) -> str:
    md = (ROOT / 'vitepress' / f'{slug}.md').read_text(encoding='utf-8')
    md = re.sub(r'^---\n.*?\n---\n', '', md, count=1, flags=re.S)
    keep = []

    def stash(text):
        keep.append(text)
        return f'\x00{len(keep) - 1}\x00'

    def stash_fence(m):
        # 只保留围栏内容，丢弃 ```标记和语言行（HTML 侧 <pre> 内容同样无标记）
        inner = re.fullmatch(r'(`{3,})[^\n]*\n(.*?)\n\1[ \t]*', m.group(0), re.S)
        return stash(inner.group(2))

    # 闭合围栏须与开启等长（内嵌 ``` 的四反引号围栏才不会提前截断）
    md = re.sub(r'^(?P<fence>`{3,})[^\n]*\n.*?\n(?P=fence)[ \t]*$', stash_fence, md, flags=re.S | re.M)
    md = re.sub(r'`([^`\n]+)`', lambda m: stash(m.group(1)), md)
    md = re.sub(r'!\[.*?\]\([^)]*\)', '', md)
    md = re.sub(r'^:::.*$', '', md, flags=re.M)
    md = re.sub(r'^> ?', '', md, flags=re.M)
    md = re.sub(r'^#{1,6} ', '', md, flags=re.M)
    md = re.sub(r'^-{3,}$', '', md, flags=re.M)
    md = re.sub(r'^\s*[-*] ', '', md, flags=re.M)
    md = re.sub(r'^\s*\d+\. ', '', md, flags=re.M)
    md = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', md)
    # 只剥成对的强调标记；孤立的 * 是字面文字（如 *.mdc），保留
    md = re.sub(r'\*\*(?=\S)(.+?)(?<=\S)\*\*', r'\1', md, flags=re.S)
    md = re.sub(r'(?<!\*)\*(?=\S)([^*\n]+?)(?<=\S)\*(?!\*)', r'\1', md)
    # 转换器输出的强调为 HTML 标签（CommonMark 侧翼规则对中文邻接不友好）
    md = re.sub(r'</?(?:strong|em|b|i)>', '', md)
    # 只对原始 HTML 表格剥标签；正文里解码后的 <xxx>（如 <String>、<|im_start|>）是文字不是标签
    md = re.sub(r'<table[^>]*>.*?</table>', lambda m: re.sub(r'<[^>]+>', '', m.group(0)), md, flags=re.S)
    md = re.sub(r'\x00(\d+)\x00', lambda m: keep[int(m.group(1))], md)
    return re.sub(r'\s+', '', htmllib.unescape(md))


def main():
    ok = True
    for slug in sys.argv[1:]:
        a, b = html_side(slug), md_side(slug)
        if a == b:
            print(f'{slug}: OK ({len(a)} 字符)')
            continue
        ok = False
        i = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), min(len(a), len(b)))
        lo, hi = max(0, i - 30), i + 30
        print(f'{slug}: DIFF at {i} (html {len(a)} chars / md {len(b)} chars)')
        print(f'  html: ...{a[lo:hi]}...')
        print(f'  md  : ...{b[lo:hi]}...')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
