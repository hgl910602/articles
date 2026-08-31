<template>
  <div class="side-brand">
    <a class="brand" href="/">
      <img class="brand-logo" src="/logo.svg" alt="" />
      <span>{{ site.title }}</span>
    </a>
    <a class="back-home" href="/">← 全部文章</a>
  </div>
</template>

<script setup>
import { useData } from 'vitepress';

const { site } = useData();
</script>
