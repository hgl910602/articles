// 文章列表数据加载器：扫描根目录 *.md（index.md 除外），解析 frontmatter 供首页列表消费。
// frontmatter 为一行一键的受控格式（迁移批处理与手写文章均如此），故用轻量解析而非完整 YAML。
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''));
    } else {
      v = v.replace(/^"|"$/g, '');
    }
    fm[kv[1]] = v;
  }
  return fm;
}

// 中文阅读速度按 400 字/分钟估个约数，与旧站「约 N 分钟」口径一致
function readMinutes(text) {
  const chars = text.replace(/\s/g, '').length;
  return Math.max(1, Math.round(chars / 400));
}

export default {
  watch: ['*.md'],
  load() {
    return readdirSync(root)
      .filter((f) => f.endsWith('.md') && f !== 'index.md')
      .map((file) => {
        const text = readFileSync(join(root, file), 'utf-8').replace(/\r\n/g, '\n');
        const fm = parseFrontmatter(text);
        const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
        return {
          url: '/' + file.replace(/\.md$/, ''),
          title: fm.title ?? file,
          description: fm.description ?? '',
          date: fm.date ?? '',
          category: fm.category ?? '',
          tags: fm.tags ?? [],
          minutes: readMinutes(body),
        };
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },
};
