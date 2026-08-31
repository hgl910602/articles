import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import './custom.css';
import './tocSpy.js';
import SidebarTop from './components/SidebarTop.vue';

export default {
  ...DefaultTheme,
  // 侧栏顶部注入品牌区：站名 + 返回列表入口（顶栏不再放站名）
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'sidebar-nav-before': () => h(SidebarTop),
    });
  },
};
