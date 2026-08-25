#!/usr/bin/env python3
"""tone_scan.py — 扫描中文文章里的 AI 腔标记，输出密度和热点句子。

用法：
    python3 tone_scan.py <文件> [<文件2> ...]      # 支持 .html/.md/.txt
    python3 tone_scan.py <文件> --top 20           # 多显示一些热点句子（默认 10）

只做诊断不改文件。markers 不是必须归零：留少量"——"和加粗是正常中文，
看的是密度和聚集位置。

注意：脚本只能抓词面标记，段末金句落点、对偶节奏、段落长度均匀这类
"读感"问题它看不见——0 标记不等于没有 AI 腔，交付前仍需按 SKILL.md
的工作流程人工通读（落点自检、系列文对照）。
"""
import argparse
import re
import sys
from pathlib import Path

MARKERS = [
    ("破折号——", r"——"),
    ("不是X而是Y", r"不是[^。，；！？\n]{1,30}而是"),
    ("对偶句：不是A，(而)是B", r"不是[^。，；！？\n]{1,15}[，,]\s*(而)?是[^。，；！？\n]{1,20}[。！？；]"),
    ("绝对化：永远/从来/恰恰", r"永远|从来|恰恰|毋庸置疑|无人不"),
    ("说到底/归根结底", r"说到底|归根结底|归根到底"),
    ("顶真对偶：哪里…哪里…/越…越…", r"哪里[^。，；！？\n]{1,10}[，,]哪里|越[^，。；！？\n]{1,8}越[^，。；！？\n]{1,10}"),
    ("金句腔：就不再是…", r"就不再是"),
    ("价值在于/意义在于", r"(价值|意义)在于"),
    ("本质上/本质就是", r"本质上|本质就是|本质都是"),
    ("启示腔", r"(核心|共同|带来)的?启示"),
    ("值得注意/值得关注", r"值得(注意|关注)"),
    ("综上所述/总而言之", r"综上(所述)?|总而言之|一言以蔽之"),
    ("不难发现/由此可见", r"不难发现|由此可见"),
    ("四字堆：缺一不可/有迹可循/各司其职/相辅相成/一目了然", r"缺一不可|有迹可循|各司其职|相辅相成|一目了然|淋漓尽致"),
    ("口号收尾：让我们一起", r"让我们一起|让我们共同"),
    ("空转词：赋能/抓手/闭环", r"赋能|抓手|闭环"),
]

SENT_SPLIT = re.compile(r"[。！？\n]")


def extract_text(path: Path) -> str:
    raw = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix.lower() in (".html", ".htm"):
        raw = re.sub(r"<script\b.*?</script>", "", raw, flags=re.S | re.I)
        raw = re.sub(r"<style\b.*?</style>", "", raw, flags=re.S | re.I)
        raw = re.sub(r"<[^>]+>", "", raw)
        import html as h
        raw = h.unescape(raw)
    return raw


def scan(path: Path, top: int) -> int:
    text = extract_text(path)
    sentences = [s.strip() for s in SENT_SPLIT.split(text) if s.strip()]
    total_chars = sum(len(s) for s in sentences) or 1

    hits = []
    total = 0
    for label, pat in MARKERS:
        regex = re.compile(pat)
        n = len(regex.findall(text))
        total += n
        per_kchar = n / total_chars * 1000
        hits.append((n, per_kchar, label))

    print(f"\n=== {path} （正文约 {total_chars} 字） ===")
    print(f"AI 腔标记总数：{total}（每千字 {total / total_chars * 1000:.1f} 处）\n")
    for n, per, label in sorted(hits, reverse=True):
        if n:
            print(f"  {label:<40} {n:>3} 处  （每千字 {per:.2f}）")

    print(f"\n热点句子（前 {top}）：")
    flagged = []
    for s in sentences:
        found = [label for label, pat in MARKERS if re.search(pat, s)]
        if found:
            flagged.append((len(found), found, s))
    flagged.sort(key=lambda x: -x[0])
    for _, found, s in flagged[:top]:
        tags = "、".join(found)
        print(f"  [{tags}] {s[:76]}")

    dash_paras = [
        p for p in re.split(r"\n\s*\n", text)
        if p.count("——") >= 2
    ]
    if dash_paras:
        print(f"\n破折号密集段落（一段 ≥2 个——）：{len(dash_paras)} 处")
        for p in dash_paras[:5]:
            print(f"  · {p.strip()[:70]}")
    return total


def main() -> None:
    ap = argparse.ArgumentParser(description="扫描中文文章的 AI 腔标记")
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--top", type=int, default=10, help="显示热点句子数（默认 10）")
    args = ap.parse_args()
    grand = 0
    for f in args.files:
        if not f.exists():
            print(f"文件不存在：{f}", file=sys.stderr)
            sys.exit(1)
        grand += scan(f, args.top)
    print(f"\n合计：{grand} 处标记。数字不用归零，改完明显下降、读起来不顺眼的句子清零即可。")
    print("提醒：词面标记只是下限，段末金句落点、对偶节奏、段落均匀这些读感问题脚本看不见，交付前按 SKILL.md 做落点自检。")


if __name__ == "__main__":
    main()
