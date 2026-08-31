<template>
  <div class="al-wrap">
    <div class="al-search">
      <input v-model="q" type="search" placeholder="搜索文章标题、描述或标签…" autocomplete="off" />
    </div>
    <div class="al-chips">
      <button
        v-for="c in chips"
        :key="c.tag || '__all'"
        class="al-chip"
        :class="{ active: active === c.tag }"
        @click="active = active === c.tag ? '' : c.tag"
      >
        {{ c.tag || '全部' }}<small v-if="c.tag">{{ c.count }}</small>
      </button>
    </div>
    <p v-if="!filtered.length" class="al-empty">没有匹配的文章，换个关键词或标签试试</p>
    <a v-for="a in filtered" :key="a.url" class="al-card" :href="a.url">
      <div class="al-card-head">
        <h2>{{ a.title }}</h2>
        <div class="al-card-meta">
          <span class="al-cat">{{ a.category }}</span>
          <time>{{ a.date }}</time>
          <span>约 {{ a.minutes }} 分钟</span>
        </div>
      </div>
      <p class="al-desc">{{ a.description }}</p>
      <div class="al-tags">
        <span v-for="t in a.tags" :key="t" class="al-tag" :class="{ hit: t === active }">{{ t }}</span>
      </div>
    </a>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { data as posts } from '../../posts.data.js';

const active = ref('');
const q = ref('');

const chips = computed(() => {
  const counts = new Map();
  for (const a of posts) for (const t of a.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [
    { tag: '', count: posts.length },
    ...[...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([tag, count]) => ({ tag, count })),
  ];
});

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase();
  return posts.filter((a) => {
    if (active.value && !a.tags.includes(active.value)) return false;
    if (!kw) return true;
    const hay = `${a.title}\n${a.description}\n${a.tags.join('\n')}`.toLowerCase();
    return hay.includes(kw);
  });
});
</script>
